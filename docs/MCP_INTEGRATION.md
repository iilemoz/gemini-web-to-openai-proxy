# Model Context Protocol (MCP) Integration

The Universal AI Agent Infrastructure includes full Model Context Protocol (MCP) support compliant with the JSON-RPC 2.0 specification (`protocolVersion: 2024-11-05`).

---

## Dual MCP Capability

### 1. Embedded MCP Server (`src/integrations/mcp/MCPServer.js`)
Exposes all registered universal tools (filesystem, terminal, git, search) to external MCP clients (such as Claude Desktop, Cursor, or external agent runners).

- Endpoint: `POST /v1/mcp`
- Standard JSON-RPC 2.0 messages supported:
  - `initialize`
  - `ping`
  - `tools/list`
  - `tools/call`

### 2. Embedded MCP Client (`src/integrations/mcp/MCPClient.js`)
Connects to external MCP servers, dynamically discovers their tools, and registers them directly into the universal `ToolRegistry` so Gemini and all agent roles can use them immediately.
