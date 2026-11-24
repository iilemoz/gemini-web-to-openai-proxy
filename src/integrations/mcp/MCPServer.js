import { toolRegistry, toolDispatcher } from '../../tools/index.js';
import { logger } from '../../utils/logger.js';

export const MCP_PROTOCOL_VERSION = '2024-11-05';

/**
 * MCPServer implements the Model Context Protocol (MCP) server specification
 * using JSON-RPC 2.0 protocol over HTTP or STDIO.
 */
export class MCPServer {
  constructor({ name = 'gemini-web-openai-proxy-mcp', version = '1.0.0' } = {}) {
    this.name = name;
    this.version = version;
  }

  async handleMessage(message) {
    if (!message || typeof message !== 'object') {
      return this.formatError(null, -32700, 'Parse error');
    }

    const { id, method, params } = message;

    if (!method) {
      return this.formatError(id, -32600, 'Invalid Request: method is missing');
    }

    try {
      switch (method) {
        case 'initialize':
          return {
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: MCP_PROTOCOL_VERSION,
              capabilities: {
                tools: { listChanged: true },
                prompts: {},
                resources: {}
              },
              serverInfo: {
                name: this.name,
                version: this.version
              }
            }
          };

        case 'notifications/initialized':
          return null; // Notification, no response

        case 'ping':
          return { jsonrpc: '2.0', id, result: {} };

        case 'tools/list': {
          const tools = toolRegistry.list().map(t => ({
            name: t.name,
            description: t.description,
            inputSchema: t.parameters
          }));
          return {
            jsonrpc: '2.0',
            id,
            result: { tools }
          };
        }

        case 'tools/call': {
          const { name, arguments: toolArgs } = params || {};
          if (!name) {
            return this.formatError(id, -32602, 'Missing tool name in params');
          }

          const dispatchRes = await toolDispatcher.dispatch({
            name,
            arguments: toolArgs || {},
            grantedPermissions: ['none', 'all']
          });

          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: typeof dispatchRes.content === 'string'
                    ? dispatchRes.content
                    : JSON.stringify(dispatchRes.content)
                }
              ],
              isError: Boolean(dispatchRes.is_error)
            }
          };
        }

        default:
          return this.formatError(id, -32601, `Method not found: ${method}`);
      }
    } catch (err) {
      logger.error(`[MCPServer] Error handling method ${method}: ${err.message}`);
      return this.formatError(id, -32603, err.message);
    }
  }

  formatError(id, code, message, data = null) {
    const error = { code, message };
    if (data) error.data = data;
    return {
      jsonrpc: '2.0',
      id: id !== undefined ? id : null,
      error
    };
  }
}

export const mcpServer = new MCPServer();
