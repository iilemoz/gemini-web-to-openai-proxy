/**
 * Agent Facade
 * High-level coordinator that manages agent configuration, tool registry, loop execution, and event dispatch.
 */

import type { LemoConfig } from '../../core/types/config.js';
import { LemoApiClient } from '../../api/client/LemoApiClient.js';
import { ConfigManager } from '../../core/config/index.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import type { Tool } from '../tools/Tool.js';
import { ToolExecutor } from '../tools/ToolExecutor.js';
import { StrictApprovalPolicy, type ApprovalPolicy } from '../policies/ApprovalPolicy.js';
import { ExecutionPolicy } from '../policies/ExecutionPolicy.js';
import { AgentLoop } from './AgentLoop.js';
import { AgentContext, type AgentContextOptions } from './AgentContext.js';
import { AgentState } from './AgentState.js';
import type {
  AgentRunOptions,
  AgentRunResult,
  AgentEvent,
  AgentEventType,
  AgentEventListener
} from '../types/index.js';
import { AgentExecutionError } from '../../core/errors/index.js';
import { logger } from '../../core/logging/index.js';

export interface AgentOptions {
  client?: LemoApiClient | undefined;
  config?: LemoConfig | undefined;
  registry?: ToolRegistry | undefined;
  approvalPolicy?: ApprovalPolicy | undefined;
  executionPolicy?: ExecutionPolicy | undefined;
  defaultModel?: string | undefined;
}

export class Agent {
  public readonly registry: ToolRegistry;
  public readonly approvalPolicy: ApprovalPolicy;
  public readonly executionPolicy: ExecutionPolicy;

  private readonly client: LemoApiClient;
  private readonly config: LemoConfig;
  private readonly loop: AgentLoop;
  private readonly defaultModel: string;
  private readonly listeners = new Set<AgentEventListener>();

  constructor(options: AgentOptions = {}) {
    this.config = options.config || ConfigManager.load();
    this.client = options.client || LemoApiClient.fromConfig(this.config);
    this.registry = options.registry || new ToolRegistry();
    this.approvalPolicy = options.approvalPolicy || new StrictApprovalPolicy();
    this.executionPolicy = options.executionPolicy || new ExecutionPolicy({
      maxIterations: this.config.agentIterationLimit || 25,
      toolTimeoutMs: this.config.timeoutMs || 60000
    });

    const executor = new ToolExecutor(this.registry, this.approvalPolicy, this.executionPolicy);
    this.loop = new AgentLoop(this.client, this.registry, executor, this.executionPolicy);
    this.defaultModel = options.defaultModel || this.config.defaultModel || 'gemini-flash';
  }

  /**
   * Registers a tool into the agent registry.
   */
  public registerTool(tool: Tool): void {
    this.registry.register(tool);
  }

  /**
   * Registers an event listener for tracking agent execution steps.
   */
  public on(listener: AgentEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public onEvent(listener: AgentEventListener): () => void {
    return this.on(listener);
  }

  /**
   * Emits an event to all registered listeners.
   */
  private emitEvent(type: AgentEventType, payload: Record<string, unknown>): void {
    const event: AgentEvent = {
      type,
      payload,
      timestamp: Date.now()
    };

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        logger.error('[Agent] Event listener error:', err);
      }
    }
  }

  /**
   * Runs an agent task from start to completion.
   */
  public async run(task: string, options: AgentRunOptions = {}): Promise<AgentRunResult> {
    const startTime = Date.now();
    const model = options.modelOverride || this.defaultModel;
    const maxIterations = options.maxIterations || this.executionPolicy.maxIterations;

    const contextOptions: AgentContextOptions = {
      task,
      model,
      maxIterations
    };
    if (options.systemPrompt) contextOptions.systemPrompt = options.systemPrompt;
    if (options.signal) contextOptions.signal = options.signal;
    if (options.initialMessages) contextOptions.initialMessages = options.initialMessages;
    if (options.workspace) {
      contextOptions.workspace = options.workspace;
    } else if (this.config.defaultWorkspace) {
      contextOptions.workspace = this.config.defaultWorkspace;
    }

    const context = new AgentContext(contextOptions);
    const state = new AgentState('idle');

    try {
      const finalResponse = await this.loop.run(
        context,
        state,
        (type, payload) => this.emitEvent(type, payload)
      );

      const result: AgentRunResult = {
        status: state.status,
        finalResponse,
        iterations: context.iteration,
        totalToolCalls: context.totalToolCalls,
        messages: context.getMessages(),
        durationMs: Date.now() - startTime
      };
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const isAbort =
        error.name === 'AbortError' ||
        Boolean(context.signal?.aborted) ||
        error.message.toLowerCase().includes('abort') ||
        (error instanceof AgentExecutionError && error.message.includes('cancelled'));

      if (isAbort) {
        state.transitionTo('aborted');
        this.emitEvent('agent_aborted', { reason: error.message });
      } else {
        if (!state.isTerminal) {
          state.transitionTo('failed');
        }
        this.emitEvent('agent_failed', { error: error.message });
      }

      const result: AgentRunResult = {
        status: state.status,
        finalResponse: null,
        iterations: context.iteration,
        totalToolCalls: context.totalToolCalls,
        messages: context.getMessages(),
        error,
        durationMs: Date.now() - startTime
      };
      return result;
    }
  }
}
