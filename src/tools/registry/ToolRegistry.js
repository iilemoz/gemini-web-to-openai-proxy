import { ToolSchema } from './ToolSchema.js';
import { logger } from '../../utils/logger.js';

/**
 * Central Tool Registry.
 * Holds all available tools, their schemas, handlers, and permissions.
 */
export class ToolRegistry {
  constructor() {
    this.tools = new Map();
  }

  /**
   * Register a new tool.
   * @param {Object} options
   * @param {ToolSchema|Object} options.schema
   * @param {Function} options.handler - Async function(args, context)
   */
  register({ schema, handler }) {
    const toolSchema = schema instanceof ToolSchema ? schema : new ToolSchema(schema);
    if (typeof handler !== 'function') {
      throw new Error(`Handler for tool '${toolSchema.name}' must be an executable function.`);
    }

    if (this.tools.has(toolSchema.name)) {
      logger.warn(`[ToolRegistry] Overwriting existing tool '${toolSchema.name}'`);
    }

    this.tools.set(toolSchema.name, {
      schema: toolSchema,
      handler
    });

    logger.info(`[ToolRegistry] Registered tool: ${toolSchema.name}`);
    return toolSchema;
  }

  /**
   * Unregister a tool by name.
   */
  unregister(name) {
    return this.tools.delete(name);
  }

  /**
   * Get a tool entry.
   */
  get(name) {
    return this.tools.get(name);
  }

  /**
   * Check if a tool exists.
   */
  has(name) {
    return this.tools.has(name);
  }

  /**
   * List all tool definitions.
   */
  list() {
    return Array.from(this.tools.values()).map(t => t.schema.toJSON());
  }

  /**
   * Export all tools formatted as OpenAI functions.
   */
  toOpenAITools() {
    return Array.from(this.tools.values()).map(t => t.schema.toOpenAIFunction());
  }
}

export const toolRegistry = new ToolRegistry();
