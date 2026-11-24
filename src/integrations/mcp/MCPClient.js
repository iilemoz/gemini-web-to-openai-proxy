import { randomUUID } from 'node:crypto';
import { toolRegistry } from '../../tools/registry/ToolRegistry.js';
import { logger } from '../../utils/logger.js';

/**
 * MCPClient connects to an external MCP server, discovers its tools,
 * and registers them into the local ToolRegistry for agents and IDEs.
 */
export class MCPClient {
  constructor({ id = `mcp_${randomUUID().slice(0, 8)}`, name = 'External MCP Server', transport = null } = {}) {
    this.id = id;
    this.name = name;
    this.transport = transport; // e.g. { send: async (msg) => res }
    this.connected = false;
    this.tools = [];
  }

  async connect() {
    if (!this.transport) {
      throw new Error(`MCPClient '${this.name}' has no configured transport`);
    }

    // 1. Initialize
    const initRes = await this.transport.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'GeminiUniversalAgent', version: '1.0.0' }
      }
    });

    if (initRes.error) {
      throw new Error(`MCP initialization failed: ${initRes.error.message}`);
    }

    this.connected = true;

    // 2. Discover Tools
    await this.discoverTools();
    return initRes.result;
  }

  async discoverTools() {
    const listRes = await this.transport.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {}
    });

    if (listRes.error) {
      throw new Error(`Failed to list MCP tools: ${listRes.error.message}`);
    }

    const tools = listRes.result?.tools || [];
    this.tools = tools;

    // Register each tool into universal registry
    for (const tool of tools) {
      const toolName = tool.name;
      toolRegistry.register({
        schema: {
          name: toolName,
          description: tool.description || `Tool imported from MCP server: ${this.name}`,
          parameters: tool.inputSchema || { type: 'object', properties: {} },
          requiredPermissions: ['none'],
          executionTarget: 'both'
        },
        handler: async (args) => {
          return await this.callTool(toolName, args);
        }
      });
    }

    logger.info(`[MCPClient] Registered ${tools.length} tools from MCP server '${this.name}'`);
    return tools;
  }

  async callTool(name, args = {}) {
    const callRes = await this.transport.send({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name, arguments: args }
    });

    if (callRes.error) {
      throw new Error(callRes.error.message);
    }

    const content = callRes.result?.content;
    if (Array.isArray(content) && content[0]?.text) {
      return content[0].text;
    }
    return callRes.result;
  }
}

class MCPServerManager {
  constructor() {
    this.clients = new Map();
  }

  registerClient(client) {
    this.clients.set(client.id, client);
    return client;
  }

  getClient(id) {
    return this.clients.get(id);
  }

  listClients() {
    return Array.from(this.clients.values()).map(c => ({
      id: c.id,
      name: c.name,
      connected: c.connected,
      toolsCount: c.tools.length
    }));
  }
}

export const mcpServerManager = new MCPServerManager();
