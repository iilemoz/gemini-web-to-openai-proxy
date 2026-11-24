/**
 * Tool Registry
 * Manages tool registration, lookup, schema validation, and OpenAI tool formatting.
 */

import { Tool } from './Tool.js';
import { ToolError } from '../../core/errors/index.js';
import type { ToolDefinition } from '../../api/types/request.js';

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  /**
   * Registers a tool. Throws ToolError if name is duplicate.
   */
  public register(tool: Tool): void {
    if (!tool || !tool.name || typeof tool.name !== 'string') {
      throw new ToolError('Tool registration requires a valid tool with a non-empty name');
    }

    const normalizedName = tool.name.trim();
    if (this.tools.has(normalizedName)) {
      throw new ToolError(`Tool '${normalizedName}' is already registered in registry`);
    }

    this.tools.set(normalizedName, tool);
  }

  /**
   * Unregisters a tool by name.
   */
  public unregister(name: string): boolean {
    return this.tools.delete(name.trim());
  }

  /**
   * Retrieves a tool by name.
   */
  public get(name: string): Tool | undefined {
    return this.tools.get(name.trim());
  }

  /**
   * Checks if a tool exists by name.
   */
  public has(name: string): boolean {
    return this.tools.has(name.trim());
  }

  /**
   * Lists all registered tools.
   */
  public list(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Converts all registered tools to OpenAI tool definitions.
   */
  public toOpenAITools(): ToolDefinition[] {
    return this.list().map(t => t.toOpenAITool());
  }

  /**
   * Validates arguments for a specific tool.
   */
  public validate(name: string, args: unknown): { valid: boolean; errors?: string[] | undefined } {
    const tool = this.get(name);
    if (!tool) {
      return { valid: false, errors: [`Unknown tool: '${name}'`] };
    }
    return tool.validateArgs(args);
  }

  /**
   * Clears all registered tools (useful for tests).
   */
  public clear(): void {
    this.tools.clear();
  }
}
