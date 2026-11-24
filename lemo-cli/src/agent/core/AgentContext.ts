/**
 * Agent Context
 * Maintains the session, conversation history, execution counters, and options for an agent task.
 */

import type { ChatMessage, ToolCall } from '../../api/types/request.js';

export interface AgentContextOptions {
  task: string;
  model: string;
  maxIterations?: number | undefined;
  systemPrompt?: string | undefined;
  signal?: AbortSignal | undefined;
  workspace?: string | undefined;
}

export class AgentContext {
  public readonly task: string;
  public readonly model: string;
  public readonly maxIterations: number;
  public readonly signal?: AbortSignal | undefined;
  public readonly workspace?: string | undefined;

  private readonly messages: ChatMessage[] = [];
  private currentIteration = 0;
  private toolCallCount = 0;
  private readonly executedToolCalls: { toolCall: ToolCall; timestamp: number }[] = [];

  constructor(options: AgentContextOptions) {
    this.task = options.task.trim();
    this.model = options.model.trim();
    this.maxIterations = options.maxIterations && options.maxIterations > 0 ? options.maxIterations : 25;
    this.signal = options.signal;
    this.workspace = options.workspace;

    // Initialize conversation with system prompt if provided
    if (options.systemPrompt && options.systemPrompt.trim()) {
      this.messages.push({
        role: 'system',
        content: options.systemPrompt.trim()
      });
    }

    // Add initial user task message
    this.messages.push({
      role: 'user',
      content: this.task
    });
  }

  public get iteration(): number {
    return this.currentIteration;
  }

  public get totalToolCalls(): number {
    return this.toolCallCount;
  }

  public incrementIteration(): number {
    this.currentIteration++;
    return this.currentIteration;
  }

  public addMessage(message: ChatMessage): void {
    this.messages.push(message);
  }

  public getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  public recordToolCall(toolCall: ToolCall): void {
    this.toolCallCount++;
    this.executedToolCalls.push({ toolCall, timestamp: Date.now() });
  }

  public getExecutedToolCalls(): readonly { toolCall: ToolCall; timestamp: number }[] {
    return [...this.executedToolCalls];
  }
}
