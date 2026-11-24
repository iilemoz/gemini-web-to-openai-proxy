import crypto from 'node:crypto';
import { toolRegistry } from '../registry/ToolRegistry.js';
import { ToolValidator } from './ToolValidator.js';
import { ToolResultFormatter } from './ToolResultFormatter.js';
import { logger } from '../../utils/logger.js';

/**
 * Executes requested tools securely:
 * - Validates tool existence and schema.
 * - Enforces permission checks.
 * - Enforces timeouts and abort signals.
 * - Records metrics and execution duration.
 * - Prevents duplicate executions.
 */
export class ToolDispatcher {
  constructor(registry = toolRegistry) {
    this.registry = registry;
    this.executedCallIds = new Set();
  }

  /**
   * Execute a single tool call.
   * @param {Object} options
   * @param {string} [options.id]
   * @param {string} options.name
   * @param {Object|string} options.arguments
   * @param {Object} [options.context]
   * @param {AbortSignal} [options.signal]
   * @param {Array<string>} [options.grantedPermissions]
   */
  async dispatch({
    id,
    name,
    arguments: rawArgs,
    context = {},
    signal = null,
    grantedPermissions = ['none', 'all']
  }) {
    const callId = id || `call_${crypto.randomBytes(8).toString('hex')}`;
    const startTime = Date.now();

    // Prevent duplicate execution of identical tool call ID
    if (this.executedCallIds.has(callId)) {
      return ToolResultFormatter.formatError({
        toolCallId: callId,
        toolName: name,
        error: new Error(`Duplicate tool call detected: '${callId}' has already been executed.`),
        durationMs: 0
      });
    }
    this.executedCallIds.add(callId);

    const toolEntry = this.registry.get(name);
    if (!toolEntry) {
      return ToolResultFormatter.formatError({
        toolCallId: callId,
        toolName: name,
        error: new Error(`Tool '${name}' is not registered.`),
        durationMs: Date.now() - startTime
      });
    }

    const { schema, handler } = toolEntry;

    // Check permissions
    const permSet = new Set(grantedPermissions);
    const hasAll = permSet.has('all');
    if (!hasAll) {
      const missing = schema.requiredPermissions.filter(p => p !== 'none' && !permSet.has(p));
      if (missing.length > 0) {
        return ToolResultFormatter.formatError({
          toolCallId: callId,
          toolName: name,
          error: new Error(`Permission denied: Tool '${name}' requires permissions [${missing.join(', ')}].`),
          durationMs: Date.now() - startTime
        });
      }
    }

    // Validate inputs
    const validation = ToolValidator.validate(schema, rawArgs);
    if (!validation.valid) {
      return ToolResultFormatter.formatError({
        toolCallId: callId,
        toolName: name,
        error: new Error(`Invalid arguments for tool '${name}': ${validation.error}`),
        durationMs: Date.now() - startTime
      });
    }

    if (signal?.aborted) {
      return ToolResultFormatter.formatError({
        toolCallId: callId,
        toolName: name,
        error: new Error('Tool execution was aborted before starting.'),
        durationMs: 0
      });
    }

    // Execute with timeout and cancellation
    logger.info(`[ToolDispatcher] Executing tool: ${name} (id: ${callId})`);
    try {
      const timeoutMs = schema.timeoutMs || 30000;
      let timer;

      const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Tool execution timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
      });

      const executionPromise = handler(validation.sanitized, {
        ...context,
        signal,
        callId
      });

      const result = await Promise.race([executionPromise, timeoutPromise]);
      clearTimeout(timer);

      const durationMs = Date.now() - startTime;
      logger.success(`[ToolDispatcher] Completed tool: ${name} in ${durationMs}ms`);

      return ToolResultFormatter.formatSuccess({
        toolCallId: callId,
        toolName: name,
        result,
        durationMs
      });
    } catch (err) {
      const durationMs = Date.now() - startTime;
      logger.error(`[ToolDispatcher] Tool failed: ${name} (${err.message})`);
      return ToolResultFormatter.formatError({
        toolCallId: callId,
        toolName: name,
        error: err,
        durationMs
      });
    }
  }

  /**
   * Execute multiple tool calls sequentially or concurrently.
   */
  async dispatchMany(toolCalls = [], options = {}) {
    const results = [];
    for (const call of toolCalls) {
      const fn = call.function || call;
      const res = await this.dispatch({
        id: call.id,
        name: fn.name,
        arguments: fn.arguments,
        ...options
      });
      results.push(res);
    }
    return results;
  }
}

export const toolDispatcher = new ToolDispatcher();
