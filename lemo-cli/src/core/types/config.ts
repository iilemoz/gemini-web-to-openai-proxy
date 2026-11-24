/**
 * Configuration Types for Lemo CLI
 */

export type OperatingMode = 'chat' | 'agent';

export type ApprovalMode = 'always' | 'action' | 'never';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface LemoConfig {
  /** Base URL of the Lemo Universal AI API Backend */
  baseUrl: string;
  /** Optional API key for proxy gateway authentication */
  apiKey?: string;
  /** Default model identifier (e.g. 'gemini-flash', 'gemini-2.5-flash') */
  defaultModel: string;
  /** Default operating mode when starting the CLI */
  defaultMode: OperatingMode;
  /** Default workspace root directory */
  defaultWorkspace: string;
  /** Maximum autonomous execution loop iterations in Agent Mode */
  agentIterationLimit: number;
  /** Action approval preference ('always', 'action', 'never') */
  approvalMode: ApprovalMode;
  /** Terminal and diagnostic logging level */
  logLevel: LogLevel;
  /** Request timeout in milliseconds */
  timeoutMs: number;
}

export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
}
