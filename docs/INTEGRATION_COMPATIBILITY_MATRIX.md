# Universal AI Agent Infrastructure — Integration & Compatibility Matrix

**Date**: 2026-11-24  
**Tested Endpoints**: `http://localhost:3000/v1/chat/completions`, `http://localhost:3000/v1/models`, `http://localhost:3000/v1/mcp`  
**Compatibility Level**: Full OpenAI Chat Completions Specification + Anthropic MCP Specification  

---

## 1. Compatibility Overview

The infrastructure exposes two primary interfaces for IDEs and developer tooling:
1. **OpenAI-Compatible Chat Completions & Models API**: For standard LLM prompting, streaming SSE, and client-managed tool execution.
2. **Model Context Protocol (MCP) JSON-RPC 2.0 Server**: For standard tool discovery and execution via modern MCP-aware clients.

| Target Application / Framework | Integration Mode | Protocol Used | Status | Notes & Verified Behaviors |
| :--- | :--- | :--- | :--- | :--- |
| **DeepSeek Harness** | Custom Backend | OpenAI REST + SSE + DSML | **PASS** | Full streaming SSE with `[DONE]`, DSML `<tool_call>` extraction, non-streaming usage tracking. |
| **Continue.dev** (VS Code / JetBrains) | Custom OpenAI Provider | `/v1/chat/completions` (SSE) | **PASS** | Autocomplete, chat, model selection (`gemini-flash`, `gemini-pro`, `gemini-thinking`). |
| **Cursor IDE** | Custom OpenAI Base URL | `/v1/chat/completions` (SSE) | **PASS** | Multi-turn chat, composer editing, token streaming, client disconnect abort. |
| **Cline (formerly Claude Dev)** | OpenAI-Compatible API / MCP | `/v1/chat/completions` + MCP | **PASS** | Tool execution via both OpenAI `tool_calls` mode and MCP `/v1/mcp` JSON-RPC endpoint. |
| **Aider** (CLI Pair Programmer) | Custom OpenAI-Compatible Host | `/v1/chat/completions` (SSE) | **PASS** | File editing, commit message generation, diff inspection via streaming responses. |
| **Claude Desktop / MCP Clients** | External MCP Tool Server | `/v1/mcp` (HTTP / JSON-RPC 2.0)| **PASS** | Protocol `2024-11-05`, capability negotiation, `tools/list` (23 tools), `tools/call`. |
| **Official Gemini API Clients** | Native Google SDK | N/A | **NOT APPLICABLE**| Infrastructure deliberately uses HTTP Gemini Web SDK (Guest/Account) to preserve free/quota-less operation. |

---

## 2. Client Configuration Guides

### 2.1 Continue.dev (`config.json`)
```json
{
  "models": [
    {
      "title": "Gemini 3 Flash (via Agent Proxy)",
      "provider": "openai",
      "model": "gemini-flash",
      "apiBase": "http://localhost:3000/v1",
      "apiKey": "optional-proxy-api-key"
    },
    {
      "title": "Gemini 3 Thinking (via Agent Proxy)",
      "provider": "openai",
      "model": "gemini-thinking",
      "apiBase": "http://localhost:3000/v1",
      "apiKey": "optional-proxy-api-key"
    }
  ]
}
```

### 2.2 Cursor IDE
1. Open **Cursor Settings** -> **Models**.
2. Enable **OpenAI API Key**. Enter any string (or your `PROXY_API_KEY`).
3. Click **Override OpenAI Base URL** and enter:
   ```text
   http://localhost:3000/v1
   ```
4. Under Model Names, add:
   - `gemini-flash`
   - `gemini-pro`
   - `gemini-thinking`

### 2.3 Cline (VS Code Extension)
1. Select **OpenAI Compatible** as API Provider.
2. **Base URL**: `http://localhost:3000/v1`
3. **API Key**: `optional-proxy-api-key` (or any string if unset).
4. **Model ID**: `gemini-flash`
5. Enable **Streaming** mode.

### 2.4 Aider CLI
```bash
aider --openai-api-base http://localhost:3000/v1 --openai-api-key none --model openai/gemini-flash
```

### 2.5 DeepSeek Harness Configuration
In your harness configuration:
```yaml
backend:
  type: openai
  base_url: http://localhost:3000/v1
  api_key: none
  model: gemini-flash
  stream: true
  enable_dsml_parsing: true
```

### 2.6 Claude Desktop MCP Integration (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "gemini-proxy-tools": {
      "command": "node",
      "args": ["src/integrations/mcp/stdioTransport.js"],
      "env": {
        "PORT": "3000"
      }
    }
  }
}
```
Or connect via HTTP transport to `http://localhost:3000/v1/mcp`.

---

## 3. Tool Calling Dual-Mode Support

The infrastructure provides verified support for both execution paradigms:

### Mode A: IDE-Managed Execution (Passive Proxy)
- **Workflow**: Model generates tool calls (via DSML `<tool_call>` or JSON) -> Proxy parses and formats as OpenAI `tool_calls` array in response -> Client (Cursor/Cline) executes tool locally -> Client sends tool result back in next turn.
- **Supported Clients**: Cursor, Continue, Cline, Aider, DeepSeek Harness.

### Mode B: Agent Runtime Execution (Autonomous Server-Side)
- **Workflow**: Client dispatches task to `/v1/agent/run` or `/v1/agent/pipeline` -> Multi-step Agent Engine plans, executes tools through `ToolDispatcher`, captures output, self-heals, and returns final report.
- **Supported Tools**: 23 built-in tools covering Filesystem CRUD, Terminal execution, Code search, Git operations, and System diagnostics.
