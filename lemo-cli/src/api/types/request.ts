/**
 * Request Types for Lemo API Client
 * Compatible with OpenAI /v1/chat/completions specification.
 */

export interface ToolCallFunction {
  name: string;
  arguments: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: ToolCallFunction;
  index?: number;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string | undefined;
  tool_call_id?: string | undefined;
  tool_calls?: ToolCall[] | unknown[] | undefined;
  reasoning_content?: string | undefined;
}

export interface StreamOptions {
  include_usage?: boolean | undefined;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean | undefined;
  temperature?: number | undefined;
  max_tokens?: number | undefined;
  max_completion_tokens?: number | undefined;
  top_p?: number | undefined;
  tools?: ToolDefinition[] | unknown[] | undefined;
  tool_choice?: unknown | undefined;
  stream_options?: StreamOptions | undefined;
  [key: string]: unknown;
}

export interface RequestOptions {
  signal?: AbortSignal | undefined;
  timeoutMs?: number | undefined;
  headers?: Record<string, string> | undefined;
}
