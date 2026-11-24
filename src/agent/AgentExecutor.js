import { toolDispatcher } from '../tools/index.js';

/**
 * Executes tools authorized by the agent runtime, enforcing autonomy levels:
 * - Assisted: pauses and requests human approval for all tool calls.
 * - Supervised: executes read-only tools automatically, requests approval for write/execute tools.
 * - Autonomous: executes all permitted tools up to limits.
 */
export class AgentExecutor {
  constructor({ autonomyMode = 'autonomous', grantedPermissions = ['none', 'all'] } = {}) {
    this.autonomyMode = autonomyMode; // 'assisted' | 'supervised' | 'autonomous'
    this.grantedPermissions = grantedPermissions;
  }

  isApprovalRequired(toolName, schema) {
    if (this.autonomyMode === 'assisted') return true;
    if (this.autonomyMode === 'supervised') {
      const perms = schema?.requiredPermissions || [];
      const hasWriteOrExec = perms.some(p => p.startsWith('write:') || p.startsWith('execute:'));
      return hasWriteOrExec;
    }
    return false; // autonomous
  }

  async executeTool(toolCall, { context = {}, signal = null } = {}) {
    const fn = toolCall.function || toolCall;
    return await toolDispatcher.dispatch({
      id: toolCall.id,
      name: fn.name,
      arguments: fn.arguments,
      context,
      signal,
      grantedPermissions: this.grantedPermissions
    });
  }
}
