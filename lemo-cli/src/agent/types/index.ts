/**
 * Agent Mode Type Definitions
 * Defines types for Agent Core, Tool Execution, Policies, and Events.
 */

import type { ChatMessage, ToolCall, ToolDefinition } from '../../api/types/request.js';
import type { BackendModel } from '../../core/types/models.js';

export type AgentStatus =
  | 'idle'
  | 'running'
  | 'waiting_approval'
  | 'executing_tool'
  | 'completed'
  | 'failed'
  | 'aborted';

export type ToolPermission =
  | 'read_only'
  | 'file_create'
  | 'file_modify'
  | 'file_delete'
  | 'terminal_execute'
  | 'destructive';

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string | undefined;
  raw?: string | undefined;
  durationMs?: number | undefined;
}

export interface ToolExecutionContext {
  toolCallId: string;
  signal?: AbortSignal | undefined;
  workspace?: string | undefined;
  onEvent?: ((type: AgentEventType, payload: Record<string, unknown>) => void) | undefined;
}

export interface ApprovalDecision {
  approved: boolean;
  reason?: string | undefined;
}

export type AgentEventType =
  | 'state_change'
  | 'turn_start'
  | 'turn_end'
  | 'model_request'
  | 'model_response'
  | 'tool_call_requested'
  | 'tool_approval_requested'
  | 'tool_approval_granted'
  | 'tool_approval_denied'
  | 'tool_executing'
  | 'tool_executed'
  | 'agent_completed'
  | 'agent_failed'
  | 'agent_aborted';

export interface AgentEvent {
  type: AgentEventType;
  payload: Record<string, unknown>;
  timestamp: number;
}

export type AgentEventListener = (event: AgentEvent) => void;

export interface AgentRunOptions {
  modelOverride?: string | undefined;
  signal?: AbortSignal | undefined;
  systemPrompt?: string | undefined;
  maxIterations?: number | undefined;
  timeoutMs?: number | undefined;
  initialMessages?: ChatMessage[] | undefined;
  workspace?: string | undefined;
}

export interface AgentRunResult {
  status: AgentStatus;
  finalResponse: string | null;
  iterations: number;
  totalToolCalls: number;
  messages: ChatMessage[];
  error?: Error | undefined;
  durationMs: number;
}

export interface ModelCapabilityCheckResult {
  supported: boolean;
  model: BackendModel;
  reason?: string | undefined;
}

export type { ChatMessage, ToolCall, ToolDefinition };
