/**
 * Chat Mode Types for Lemo CLI
 */

import type { LemoApiClient } from '../api/client/LemoApiClient.js';
import type { LemoConfig } from '../core/types/config.js';

export interface ChatSessionOptions {
  client: LemoApiClient;
  config: LemoConfig;
  modelOverride?: string | undefined;
}

export interface CommandResult {
  handled: boolean;
  shouldExit?: boolean | undefined;
  message?: string | undefined;
}

export interface SendMessageResult {
  content: string;
  aborted?: boolean | undefined;
}

export interface ChatReplOptions {
  client?: LemoApiClient | undefined;
  config?: LemoConfig | undefined;
  modelOverride?: string | undefined;
  input?: NodeJS.ReadableStream | undefined;
  output?: NodeJS.WritableStream | undefined;
}
