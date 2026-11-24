/**
 * Response Types for Lemo API Client
 * Compatible with OpenAI /v1 response schemas.
 */

import type { ChatMessage } from './request.js';

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: 'stop' | 'tool_calls' | 'length' | 'content_filter' | null;
}

export interface CompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: CompletionUsage;
}

export interface ApiErrorDetail {
  message: string;
  type?: string;
  code?: string;
  param?: string | null;
}

export interface ApiErrorPayload {
  error: ApiErrorDetail;
}
