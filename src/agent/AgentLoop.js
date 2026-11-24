import { AgentState } from './AgentState.js';
import { agentEvents } from './AgentEvents.js';
import { AgentMemory } from './AgentMemory.js';
import { AgentRecovery } from './AgentRecovery.js';
import { AgentPlanner } from './AgentPlanner.js';
import { AgentExecutor } from './AgentExecutor.js';
import { toolDiscovery } from '../tools/index.js';
import { logger } from '../utils/logger.js';

/**
 * AgentLoop coordinates the multi-step execution cycle:
 * Plan -> Inspect -> Model Turn -> Tool Execution -> Verification -> Result.
 */
export class AgentLoop {
  constructor({
    runId,
    stateMachine,
    cancellation,
    context,
    modelProvider = null,
    model = 'gemini-flash',
    autonomyMode = 'autonomous',
    maxIterations = 15,
    maxExecutionTimeMs = 120000
  }) {
    this.runId = runId;
    this.stateMachine = stateMachine;
    this.cancellation = cancellation;
    this.context = context;
    this.modelProvider = modelProvider;
    this.model = model;
    this.maxIterations = maxIterations;
    this.maxExecutionTimeMs = maxExecutionTimeMs;

    this.memory = new AgentMemory();
    this.recovery = new AgentRecovery();
    this.planner = new AgentPlanner();
    this.executor = new AgentExecutor({
      autonomyMode,
      grantedPermissions: context.permissions || ['none', 'all']
    });

    this.pendingApproval = null;
    this.result = null;
    this.error = null;
  }

  async run() {
    const startTime = Date.now();
    try {
      this.cancellation.throwIfCancelled();

      // Phase 1: Planning
      this.stateMachine.transition(AgentState.PLANNING, 'Starting plan formulation');
      agentEvents.emitStateChange(this.runId, AgentState.QUEUED, AgentState.PLANNING);

      const availableTools = toolDiscovery.getAuthorizedTools(this.context.permissions);
      const plan = this.planner.createInitialPlan(this.context.task, availableTools);
      this.memory.setFact('plan', plan);

      // Phase 2: Execution Loop
      this.stateMachine.transition(AgentState.RUNNING, 'Executing agent steps');
      agentEvents.emitStateChange(this.runId, AgentState.PLANNING, AgentState.RUNNING);

      let iteration = 0;
      const messages = [
        { role: 'system', content: this.context.buildSystemPrompt(availableTools) },
        { role: 'user', content: this.context.task }
      ];

      while (iteration < this.maxIterations) {
        iteration++;
        this.cancellation.throwIfCancelled();

        if (Date.now() - startTime > this.maxExecutionTimeMs) {
          throw new Error(`Agent run exceeded max execution time (${this.maxExecutionTimeMs}ms)`);
        }

        agentEvents.emitStep(this.runId, iteration, `Starting iteration ${iteration}`);

        // Model decision turn
        const decision = await this.getModelTurn(messages, availableTools);

        if (decision.toolCalls && decision.toolCalls.length > 0) {
          for (const tc of decision.toolCalls) {
            this.cancellation.throwIfCancelled();

            const fn = tc.function || tc;
            agentEvents.emitToolCall(this.runId, tc);

            // Autonomy & Approval check
            const schema = availableTools.find(t => t.name === fn.name);
            if (this.executor.isApprovalRequired(fn.name, schema)) {
              this.stateMachine.transition(AgentState.WAITING_FOR_APPROVAL, `Tool '${fn.name}' requires human approval`);
              agentEvents.emitStateChange(this.runId, AgentState.RUNNING, AgentState.WAITING_FOR_APPROVAL);
              
              // Pause until approved or rejected
              const approved = await this.waitForApproval(tc);
              if (!approved) {
                this.stateMachine.transition(AgentState.RUNNING, `Tool '${fn.name}' execution rejected by user`);
                this.memory.recordToolResult(tc, { is_error: true, content: 'User rejected tool execution' });
                messages.push({
                  role: 'tool',
                  tool_call_id: tc.id,
                  content: JSON.stringify({ error: 'User rejected tool execution' })
                });
                continue;
              }
              this.stateMachine.transition(AgentState.RUNNING, `Tool '${fn.name}' approved by user`);
            }

            // Execute the tool
            let toolRes;
            try {
              toolRes = await this.executor.executeTool(tc, {
                context: { runId: this.runId, workspaceRoot: this.context.workspaceRoot },
                signal: this.cancellation.signal
              });
            } catch (toolErr) {
              toolRes = {
                tool_call_id: tc.id,
                name: fn.name,
                content: JSON.stringify({ error: toolErr.message }),
                is_error: true
              };
            }

            this.memory.recordToolResult(tc, toolRes);
            agentEvents.emitToolResult(this.runId, toolRes);

            // Error recovery handling
            if (toolRes.is_error && this.recovery.shouldRetry(fn.name)) {
              this.recovery.recordAttempt(fn.name, toolRes.content);
            }

            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: typeof toolRes.content === 'string' ? toolRes.content : JSON.stringify(toolRes.content)
            });
          }
        } else {
          // Model finished with final response
          this.result = {
            task: this.context.task,
            summary: decision.content || 'Task completed successfully.',
            iterations: iteration,
            durationMs: Date.now() - startTime,
            memory: this.memory.getSummary()
          };

          this.stateMachine.transition(AgentState.COMPLETED, 'Task goal achieved');
          agentEvents.emitComplete(this.runId, this.result);
          return this.result;
        }
      }

      // Max iterations reached without stopping
      this.result = {
        task: this.context.task,
        summary: `Reached maximum iterations limit (${this.maxIterations})`,
        iterations: iteration,
        durationMs: Date.now() - startTime,
        memory: this.memory.getSummary()
      };
      this.stateMachine.transition(AgentState.COMPLETED, 'Maximum iterations reached');
      agentEvents.emitComplete(this.runId, this.result);
      return this.result;

    } catch (err) {
      this.error = err;
      if (err.name === 'AbortError' || this.cancellation.isCancelled) {
        if (!this.stateMachine.isTerminal()) {
          this.stateMachine.transition(AgentState.CANCELLED, err.message);
        }
      } else {
        if (!this.stateMachine.isTerminal()) {
          this.stateMachine.transition(AgentState.FAILED, err.message);
        }
      }
      agentEvents.emitError(this.runId, err);
      throw err;
    }
  }

  async getModelTurn(messages, tools) {
    if (this.modelProvider && typeof this.modelProvider.generateTurn === 'function') {
      return await this.modelProvider.generateTurn({ messages, tools, model: this.model });
    }

    // Default: simulated or provider-based turn
    return {
      content: `Finished evaluating task: ${this.context.task}`,
      toolCalls: []
    };
  }

  waitForApproval(toolCall) {
    return new Promise((resolve) => {
      this.pendingApproval = {
        toolCall,
        resolve: (approved) => {
          this.pendingApproval = null;
          resolve(approved);
        }
      };
    });
  }

  approvePendingTool(approved = true) {
    if (this.pendingApproval) {
      this.pendingApproval.resolve(approved);
      return true;
    }
    return false;
  }
}
