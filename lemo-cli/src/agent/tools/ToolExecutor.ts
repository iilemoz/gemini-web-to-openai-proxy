/**
 * Tool Executor
 * Coordinates tool invocation, policy checks, argument validation, and error wrapping.
 */

import type { ToolRegistry } from './ToolRegistry.js';
import type { ApprovalPolicy } from '../policies/ApprovalPolicy.js';
import type { ExecutionPolicy } from '../policies/ExecutionPolicy.js';
import type { ApprovalManager } from '../approval/ApprovalManager.js';
import type { WorkspaceManager } from '../workspace/WorkspaceManager.js';
import type { ToolCall } from '../../api/types/request.js';
import type { ToolResult, ToolExecutionContext } from '../types/index.js';
import { logger } from '../../core/logging/index.js';

export class ToolExecutor {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly approvalPolicy: ApprovalPolicy,
    private readonly executionPolicy?: ExecutionPolicy,
    private readonly approvalManager?: ApprovalManager,
    private readonly workspaceManager?: WorkspaceManager
  ) {}

  /**
   * Executes a tool requested by the model.
   * Never throws unhandled errors; always returns structured ToolResult.
   */
  public async execute(
    toolCall: ToolCall,
    context?: ToolExecutionContext
  ): Promise<ToolResult> {
    const startTime = Date.now();
    const toolName = toolCall?.function?.name || '';
    const rawArgs = toolCall?.function?.arguments || '{}';
    const executionContext: ToolExecutionContext = context ?? {
      toolCallId: toolCall?.id || ''
    };

    // 1. Check signal
    if (executionContext.signal?.aborted) {
      return {
        success: false,
        error: 'Execution cancelled by signal',
        durationMs: Date.now() - startTime
      };
    }

    // 2. Parse arguments
    let parsedArgs: Record<string, unknown>;
    try {
      if (typeof rawArgs === 'string') {
        parsedArgs = rawArgs.trim() ? JSON.parse(rawArgs) : {};
      } else if (typeof rawArgs === 'object' && rawArgs !== null) {
        parsedArgs = rawArgs as Record<string, unknown>;
      } else {
        parsedArgs = {};
      }
    } catch (parseErr) {
      return {
        success: false,
        error: `Malformed JSON arguments: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
        durationMs: Date.now() - startTime
      };
    }

    // 3. Resolve tool from registry
    const tool = this.registry.get(toolName);
    if (!tool) {
      return {
        success: false,
        error: `Unknown tool: '${toolName}'. Available tools: ${this.registry.list().map(t => t.name).join(', ') || 'none'}`,
        durationMs: Date.now() - startTime
      };
    }

    // 4. Validate arguments against schema
    const validation = tool.validateArgs(parsedArgs);
    if (!validation.valid) {
      return {
        success: false,
        error: `Invalid arguments for tool '${toolName}': ${(validation.errors || []).join('; ')}`,
        durationMs: Date.now() - startTime
      };
    }

    // 5. Evaluate approval policy
    let approvalToken: string | undefined;
    let approvalId: string | undefined;
    let preview: string | undefined;

    const requiresApproval = tool.permissions && tool.permissions.some((p) => p !== 'read_only');

    try {
      if (requiresApproval && typeof tool.prepareApproval === 'function') {
        try {
          const prep = await tool.prepareApproval(parsedArgs, executionContext);
          if (prep && this.approvalManager && this.workspaceManager) {
            preview = prep.preview;
            const issued = this.approvalManager.createApproval({
              toolName: tool.name,
              operationType: prep.operationType,
              workspaceIdentity: this.workspaceManager.getIdentity(),
              targetPaths: prep.targetPaths,
              payloadDigest: prep.payloadDigest,
              destinationIdentity: prep.destinationIdentity,
              parameters: parsedArgs,
              preview: prep.preview
            });
            approvalToken = issued.token;
            approvalId = issued.record.approvalId;
          }
        } catch (prepErr) {
          return {
            success: false,
            error: `Failed to prepare approval for '${toolName}': ${
              prepErr instanceof Error ? prepErr.message : String(prepErr)
            }`,
            durationMs: Date.now() - startTime
          };
        }
      }

      executionContext.approvalToken = approvalToken;
      executionContext.approvalId = approvalId;

      executionContext.onEvent?.('tool_approval_requested', {
        id: toolCall.id,
        name: tool.name,
        permissions: tool.permissions,
        arguments: parsedArgs,
        preview,
        approvalId
      });

      const decision = await this.approvalPolicy.evaluate(tool, parsedArgs, executionContext);
      if (!decision.approved) {
        if (approvalId && this.approvalManager) {
          this.approvalManager.invalidate(approvalId);
        }
        executionContext.onEvent?.('tool_approval_denied', {
          id: toolCall.id,
          name: tool.name,
          reason: decision.reason || 'Not approved'
        });
        return {
          success: false,
          error: `Execution denied by policy: ${decision.reason || 'Not approved'}`,
          durationMs: Date.now() - startTime
        };
      }

      executionContext.onEvent?.('tool_approval_granted', {
        id: toolCall.id,
        name: tool.name
      });
    } catch (policyErr) {
      if (approvalId && this.approvalManager) {
        this.approvalManager.invalidate(approvalId);
      }
      return {
        success: false,
        error: `Approval policy check failed: ${policyErr instanceof Error ? policyErr.message : String(policyErr)}`,
        durationMs: Date.now() - startTime
      };
    }

    // 6. Execute tool with timeout support
    try {
      logger.debug(`[ToolExecutor] Executing '${toolName}' with args: ${JSON.stringify(parsedArgs)}`);
      const executionPromise = tool.execute(parsedArgs, executionContext);

      let result: ToolResult;
      const timeoutMs = this.executionPolicy?.toolTimeoutMs;

      if (timeoutMs && timeoutMs > 0) {
        let timeoutHandle: NodeJS.Timeout | undefined;
        const timeoutPromise = new Promise<ToolResult>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(new Error(`Tool execution timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        });

        try {
          result = await Promise.race([executionPromise, timeoutPromise]);
        } finally {
          if (timeoutHandle) clearTimeout(timeoutHandle);
        }
      } else {
        result = await executionPromise;
      }

      result.durationMs = Date.now() - startTime;
      return result;
    } catch (execErr) {
      return {
        success: false,
        error: `Tool execution failed: ${execErr instanceof Error ? execErr.message : String(execErr)}`,
        durationMs: Date.now() - startTime
      };
    }
  }

  /**
   * Formats a ToolResult into a string content suitable for a 'tool' role ChatMessage.
   */
  public formatResultContent(result: ToolResult): string {
    if (result.success) {
      if (typeof result.raw === 'string' && result.raw.length > 0) {
        return result.raw;
      }
      if (result.data !== undefined) {
        return typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2);
      }
      return 'Success';
    }

    return JSON.stringify({
      status: 'error',
      error: result.error || 'Unknown error occurred during tool execution'
    });
  }
}
