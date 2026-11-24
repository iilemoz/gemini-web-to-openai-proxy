import { randomUUID } from 'node:crypto';
import { AgentState, AgentStateMachine } from './AgentState.js';
import { AgentCancellation } from './AgentCancellation.js';
import { AgentContext } from './AgentContext.js';
import { AgentLoop } from './AgentLoop.js';
import { agentEvents } from './AgentEvents.js';
import { logger } from '../utils/logger.js';

/**
 * AgentOrchestrator manages the lifecycle of all active and historical agent runs.
 */
export class AgentOrchestrator {
  constructor() {
    this.runs = new Map();
  }

  createRun({
    task,
    role = 'Developer Agent',
    model = 'gemini-flash',
    autonomyMode = 'autonomous',
    workspaceRoot = process.cwd(),
    permissions = ['none', 'all'],
    maxIterations = 15,
    maxExecutionTimeMs = 120000,
    modelProvider = null
  }) {
    if (!task || typeof task !== 'string') {
      throw new Error('Task is required and must be a string');
    }

    const runId = `run_${randomUUID()}`;
    const stateMachine = new AgentStateMachine(AgentState.QUEUED);
    const cancellation = new AgentCancellation();
    const context = new AgentContext({ task, workspaceRoot, role, permissions });

    const loop = new AgentLoop({
      runId,
      stateMachine,
      cancellation,
      context,
      modelProvider,
      model,
      autonomyMode,
      maxIterations,
      maxExecutionTimeMs
    });

    const runRecord = {
      id: runId,
      task,
      role,
      model,
      autonomyMode,
      stateMachine,
      cancellation,
      context,
      loop,
      status: AgentState.QUEUED,
      createdAt: Date.now(),
      completedAt: null,
      result: null,
      error: null
    };

    this.runs.set(runId, runRecord);
    logger.info(`[AgentOrchestrator] Created run: ${runId} (role: ${role}, mode: ${autonomyMode})`);
    return runRecord;
  }

  async startRun(runId) {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Run '${runId}' not found`);

    const updateStatus = ({ to }) => {
      run.status = to;
    };
    agentEvents.on('state', updateStatus);

    try {
      const result = await run.loop.run();
      run.status = run.stateMachine.state;
      run.completedAt = Date.now();
      run.result = result;
      return run;
    } catch (err) {
      run.status = run.stateMachine.state;
      run.completedAt = Date.now();
      run.error = err.message || String(err);
      throw err;
    } finally {
      agentEvents.removeListener('state', updateStatus);
    }
  }

  getRun(runId) {
    const run = this.runs.get(runId);
    if (!run) return null;
    return {
      id: run.id,
      task: run.task,
      role: run.role,
      model: run.model,
      status: run.stateMachine.state,
      history: run.stateMachine.history,
      autonomyMode: run.autonomyMode,
      createdAt: run.createdAt,
      completedAt: run.completedAt,
      result: run.result,
      error: run.error,
      summary: run.loop.memory.getSummary()
    };
  }

  listRuns() {
    return Array.from(this.runs.values()).map(r => ({
      id: r.id,
      task: r.task,
      role: r.role,
      model: r.model,
      status: r.stateMachine.state,
      autonomyMode: r.autonomyMode,
      createdAt: r.createdAt,
      completedAt: r.completedAt
    }));
  }

  cancelRun(runId, reason = 'Cancelled by user') {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Run '${runId}' not found`);
    run.cancellation.cancel(reason);
    if (!run.stateMachine.isTerminal()) {
      run.stateMachine.transition(AgentState.CANCELLED, reason);
    }
    run.status = AgentState.CANCELLED;
    return true;
  }

  approveToolCall(runId, approved = true) {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Run '${runId}' not found`);
    return run.loop.approvePendingTool(approved);
  }
}

export const agentOrchestrator = new AgentOrchestrator();
