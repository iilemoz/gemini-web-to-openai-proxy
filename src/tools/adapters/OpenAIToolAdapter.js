/**
 * Adapter between OpenAI function/tool definitions and ToolRegistry schemas.
 */
export class OpenAIToolAdapter {
  static toOpenAI(toolSchema) {
    return {
      type: 'function',
      function: {
        name: toolSchema.name,
        description: toolSchema.description,
        parameters: toolSchema.parameters
      }
    };
  }

  static fromOpenAI(openAITool) {
    const fn = openAITool.function || openAITool;
    return {
      name: fn.name,
      description: fn.description || '',
      parameters: fn.parameters || { type: 'object', properties: {} }
    };
  }
}
