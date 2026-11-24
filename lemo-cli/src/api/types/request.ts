/**
/**
 * Request Types for Lemo API Client
 * Compatible with OpenAI /v1/chat/completions specification.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: unknown[];
  reasoning_content?: string;
}

export interface StreamOptions {
  include_usage?: boolean;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  top_p?: number;
  tools?: unknown[];
  tool_choice?: unknown;
  stream_options?: StreamOptions;
  [key: string]: unknown;
}

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  headers?: Record<string, string>;
}
