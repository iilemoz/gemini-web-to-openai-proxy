/**
 * Adapter for Model Context Protocol (MCP) tool format.
 */
export class MCPToolAdapter {
  static toMCP(toolSchema) {
    return {
      name: toolSchema.name,
      description: toolSchema.description,
      inputSchema: toolSchema.parameters
    };
  }

  static fromMCP(mcpTool) {
    return {
      name: mcpTool.name,
      description: mcpTool.description || '',
      parameters: mcpTool.inputSchema || { type: 'object', properties: {} }
    };
  }
}
