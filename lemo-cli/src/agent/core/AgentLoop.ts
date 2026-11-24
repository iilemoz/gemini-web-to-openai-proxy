/**
 * Agent Loop
 * Coordinates the iterative model request -> tool execution -> model request cycle.
 */

import type { LemoApiClient } from '../../api/client/LemoApiClient.js';
import type { ToolRegistry } from '../tools/ToolRegistry.js';
import type { ToolExecutor } from '../tools/ToolExecutor.js';
import type { ExecutionPolicy } from '../policies/ExecutionPolicy.js';
import type { AgentContext } from './AgentContext.js';
import type { AgentState } from './AgentState.js';
import type { AgentEventType, ToolCall, ToolExecutionContext } from '../types/index.js';
import type { ChatCompletionRequest, ChatMessage, RequestOptions } from '../../api/types/request.js';
import { AgentExecutionError, ModelError } from '../../core/errors/index.js';
import { logger } from '../../core/logging/index.js';

export class AgentLoop {
  constructor(
    private readonly client: LemoApiClient,
    private readonly registry: ToolRegistry,
    private readonly executor: ToolExecutor,
    private readonly executionPolicy: ExecutionPolicy
  ) {}

  /**
   * Validates that the selected model advertises tool calling capabilities.
   */
  public async validateModelCapabilities(modelId: string, signal?: AbortSignal): Promise<void> {
    const reqOptions: RequestOptions = {};
    if (signal) reqOptions.signal = signal;
    const models = await this.client.listModels(reqOptions);
    const target = modelId.toLowerCase();

    const match = models.find(m => {
      if (m.id.toLowerCase() === target) return true;
      if (m.root && m.root.toLowerCase() === target) return true;
      return false;
    });

    if (!match) {
      logger.warn(`[AgentLoop] Model '${modelId}' not explicitly found in backend model list.`);
      return;
    }

    if (match.capabilities && match.capabilities.tools === false) {
      throw new ModelError(
        `Model '${modelId}' does not support tool calling. Please choose a model with tool capabilities (e.g. gemini-flash, gemini-pro).`
      );
    }
  }

  /**
   * Runs the agent execution loop until the model provides a final answer or max iterations is reached.
   */
  public async run(
    context: AgentContext,
    state: AgentState,
    emitEvent: (type: AgentEventType, payload: Record<string, unknown>) => void
  ): Promise<string> {
    // 1. Validate model capability
    await this.validateModelCapabilities(context.model, context.signal);

    state.transitionTo('running');
    emitEvent('state_change', { status: 'running' });

    while (context.iteration < context.maxIterations) {
      // Check cancellation signal
      this.executionPolicy.checkSignal(context.signal);

      const iteration = context.incrementIteration();
      this.executionPolicy.validateIteration(iteration);

      emitEvent('turn_start', { iteration, model: context.model });

      const tools = this.registry.toOpenAITools();

      emitEvent('model_request', {
        iteration,
        messagesCount: context.getMessages().length,
        toolsCount: tools.length
      });

      // Prepare request without undefined properties
      const requestPayload: ChatCompletionRequest = {
        model: context.model,
        messages: context.getMessages()
      };
      if (tools.length > 0) {
        requestPayload.tools = tools;
      }

      const reqOptions: RequestOptions = {};
      if (context.signal) {
        reqOptions.signal = context.signal;
      }

      // Send request to backend
      const response = await this.client.createChatCompletion(requestPayload, reqOptions);

      const choice = response.choices?.[0];
      if (!choice || !choice.message) {
        throw new AgentExecutionError('Backend returned empty choice in chat completion');
      }

      const message = choice.message;
      const rawToolCalls = message.tool_calls as ToolCall[] | undefined;
      const hasToolCalls = Array.isArray(rawToolCalls) && rawToolCalls.length > 0;

      emitEvent('model_response', {
        iteration,
        finishReason: choice.finish_reason,
        hasToolCalls,
        toolCallsCount: rawToolCalls?.length || 0,
        contentLength: (message.content || '').length
      });

      // ── CASE A: Model requested tool calls ───────────────────────────────
      if (hasToolCalls) {
        // Record assistant tool_calls message into history
        context.addMessage({
          role: 'assistant',
          content: message.content ?? null,
          tool_calls: rawToolCalls
        });

        state.transitionTo('executing_tool');
        emitEvent('state_change', { status: 'executing_tool' });

        const seenCallIds = new Set<string>();

        for (const toolCall of rawToolCalls) {
          this.executionPolicy.checkSignal(context.signal);

          // Prevent duplicate execution of identical tool_call_id
          if (seenCallIds.has(toolCall.id)) {
            logger.warn(`[AgentLoop] Duplicate tool_call_id encountered in single turn: ${toolCall.id}`);
            continue;
          }
          seenCallIds.add(toolCall.id);

          emitEvent('tool_call_requested', {
            id: toolCall.id,
            name: toolCall.function?.name,
            arguments: toolCall.function?.arguments
          });

          emitEvent('tool_executing', { id: toolCall.id, name: toolCall.function?.name });

          const execContext: ToolExecutionContext = {
            toolCallId: toolCall.id
          };
          if (context.signal) execContext.signal = context.signal;
          if (context.workspace) execContext.workspace = context.workspace;

          const result = await this.executor.execute(toolCall, execContext);

          context.recordToolCall(toolCall);

          emitEvent('tool_executed', {
            id: toolCall.id,
            name: toolCall.function?.name,
            success: result.success,
            durationMs: result.durationMs,
            error: result.error
          });

          const resultContent = this.executor.formatResultContent(result);

          // Append tool result message to conversation context
          context.addMessage({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: toolCall.function?.name,
            content: resultContent
          });
        }

        state.transitionTo('running');
        emitEvent('state_change', { status: 'running' });
        emitEvent('turn_end', { iteration, completedTools: seenCallIds.size });

        // Loop to next iteration
        continue;
      }

      // ── CASE B: Normal assistant response (Final answer) ─────────────────
      const finalContent = message.content || '';
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: finalContent
      };
      if (message.reasoning_content) {
        assistantMsg.reasoning_content = message.reasoning_content;
      }
      context.addMessage(assistantMsg);

      state.transitionTo('completed');
      emitEvent('state_change', { status: 'completed' });
      emitEvent('agent_completed', {
        iterations: iteration,
        totalToolCalls: context.totalToolCalls,
        finalResponseLength: finalContent.length
      });

      return finalContent;
    }

    // Iteration limit reached
    state.transitionTo('failed');
    emitEvent('state_change', { status: 'failed' });
    throw new AgentExecutionError(
      `Agent execution loop reached iteration limit (max: ${context.maxIterations} iterations)`
    );
  }
}
