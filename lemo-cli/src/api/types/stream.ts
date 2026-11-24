/**
 * Streaming Chunk Types for Lemo API Client
 * Compatible with OpenAI /v1/chat/completions SSE format.
 */

import type { CompletionUsage } from './response.js';
import type { ToolCall } from './request.js';

export interface DeltaMessage {
  role?: string;
  content?: string | null;
  reasoning_content?: string | null;
  tool_calls?: ToolCall[] | unknown[];
}

export interface ChatCompletionChunkChoice {
  index: number;
  delta: DeltaMessage;
  finish_reason: 'stop' | 'tool_calls' | 'length' | 'content_filter' | null;
}

export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: ChatCompletionChunkChoice[];
  usage?: CompletionUsage;
}
