/**
 * Approval Policy
 * Defines extensible security policies for approving or rejecting tool executions.
 */

import type { Tool } from '../tools/Tool.js';
import type { ToolPermission, ApprovalDecision, ToolExecutionContext } from '../types/index.js';

export interface ApprovalPolicy {
  evaluate(
    tool: Tool,
    args: Record<string, unknown>,
    context?: ToolExecutionContext
  ): Promise<ApprovalDecision>;
}

/**
 * Strict Policy: Rejects all tools with dangerous permissions (create, modify, delete, terminal, destructive).
 * Only explicitly permitted permissions (default: read_only) are approved automatically.
 */
export class StrictApprovalPolicy implements ApprovalPolicy {
  private readonly allowedPermissions: Set<ToolPermission>;

  constructor(allowed: ToolPermission[] = ['read_only']) {
    this.allowedPermissions = new Set(allowed);
  }

  public async evaluate(tool: Tool): Promise<ApprovalDecision> {
    const requiredPermissions = tool.permissions || [];

    // If tool requires no permissions, it's considered safe
    if (requiredPermissions.length === 0) {
      return { approved: true };
    }

    for (const perm of requiredPermissions) {
      if (!this.allowedPermissions.has(perm)) {
        return {
          approved: false,
          reason: `Tool '${tool.name}' requires permission '${perm}' which is not approved under StrictApprovalPolicy`
        };
      }
    }

    return { approved: true };
  }
}

/**
 * Auto Approval Policy: Primarily for automated testing or non-interactive environments
 * where a specific set of permissions are pre-approved.
 */
export class AutoApprovalPolicy implements ApprovalPolicy {
  private readonly approvedPermissions: Set<ToolPermission>;

  constructor(approved: ToolPermission[] = ['read_only']) {
    this.approvedPermissions = new Set(approved);
  }

  public async evaluate(tool: Tool): Promise<ApprovalDecision> {
    for (const perm of tool.permissions) {
      if (!this.approvedPermissions.has(perm)) {
        return {
          approved: false,
          reason: `Permission '${perm}' is not approved for auto-execution`
        };
      }
    }
    return { approved: true };
  }
}

/**
 * Callback Approval Policy: Delegates evaluation to an asynchronous handler (e.g. CLI prompt).
 */
export class CallbackApprovalPolicy implements ApprovalPolicy {
  constructor(
    private readonly handler: (
      tool: Tool,
      args: Record<string, unknown>,
      context?: ToolExecutionContext
    ) => Promise<boolean | ApprovalDecision>
  ) {}

  public async evaluate(
    tool: Tool,
    args: Record<string, unknown>,
    context?: ToolExecutionContext
  ): Promise<ApprovalDecision> {
    const res = await this.handler(tool, args, context);
    if (typeof res === 'boolean') {
      return res ? { approved: true } : { approved: false, reason: 'User or callback denied approval' };
    }
    return res;
  }
}
