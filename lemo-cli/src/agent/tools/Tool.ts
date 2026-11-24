/**
 * Abstract Tool Definition
 * Represents a tool that can be invoked by the LLM in Agent Mode.
 */

import type { ToolDefinition } from '../../api/types/request.js';
import type { ToolPermission, ToolResult, ToolExecutionContext } from '../types/index.js';

export interface ToolSchema {
  type: 'object';
  properties?: Record<string, {
    type?: string;
    description?: string;
    enum?: string[];
    [key: string]: unknown;
  }> | undefined;
  required?: string[] | undefined;
  [key: string]: unknown;
}

export abstract class Tool {
  public abstract readonly name: string;
  public abstract readonly description: string;
  public abstract readonly parameters: ToolSchema;
  public abstract readonly permissions: ToolPermission[];

  /**
   * Validates tool invocation arguments against parameter schema.
   */
  public validateArgs(args: unknown): { valid: boolean; errors?: string[] | undefined } {
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      return { valid: false, errors: ['Tool arguments must be a JSON object'] };
    }

    const record = args as Record<string, unknown>;
    const errors: string[] = [];
    const required = this.parameters?.required || [];

    for (const reqField of required) {
      if (!(reqField in record) || record[reqField] === undefined || record[reqField] === null) {
        errors.push(`Missing required parameter: '${reqField}'`);
      }
    }

    const properties = this.parameters?.properties || {};
    for (const [key, value] of Object.entries(record)) {
      const propDef = properties[key];
      if (propDef && value !== undefined && value !== null) {
        const expectedType = propDef.type;
        if (expectedType) {
          const actualType = Array.isArray(value) ? 'array' : typeof value;
          if (expectedType === 'integer') {
            if (typeof value !== 'number' || !Number.isInteger(value)) {
              errors.push(`Parameter '${key}' must be an integer, received ${typeof value}`);
            }
          } else if (actualType !== expectedType) {
            errors.push(`Parameter '${key}' must be of type '${expectedType}', received '${actualType}'`);
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined
    };
  }

  /**
   * Executes the tool with validated arguments.
   */
  public abstract execute(
    args: Record<string, unknown>,
    context?: ToolExecutionContext
  ): Promise<ToolResult>;

  /**
   * Serializes the tool definition to the OpenAI /v1/chat/completions format.
   */
  public toOpenAITool(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: this.parameters as unknown as Record<string, unknown>
      }
    };
  }
}
