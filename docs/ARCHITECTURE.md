# SYSTEM ARCHITECTURE
# Universal AI Agent Infrastructure (Gemini-web-to-openai-proxy)

## 1. Architectural Overview

```text
+-------------------------------------------------------------------------------------------------+
|                                    CLIENT INTEGRATIONS                                          |
|  [ Antigravity / Cursor / VS Code / OpenCode / Cline / DeepSeek Harness / Custom OpenAI SDKs ]  |
+-------------------------------------------------------------------------------------------------+
                                                |
                                                v
+-------------------------------------------------------------------------------------------------+
|                                     API GATEWAY (Express)                                       |
|  - Auth Middleware (PROXY_API_KEY / Bearer Token Separation)                                    |
|  - Rate Limiting, Request Validation & Security Headers (CORS)                                  |
|  - Endpoints:                                                                                   |
|      /v1/chat/completions (Stream/Non-stream, Tool-call chunking)                               |
|      /v1/models & /v1/models/:model                                                             |
|      /v1/responses (Responses API)                                                              |
|      /v1/tools & /v1/agents                                                                     |
|      /v1/runtime/devices & /v1/runtime/sessions                                                 |
|      /health & /healthz                                                                         |
+-------------------------------------------------------------------------------------------------+
           |                                     |                                   |
           v                                     v                                   v
+-----------------------+              +-------------------+               +--------------------+
|  GEMINI MODEL ADAPTER |              |  UNIVERSAL TOOLS  |               | AGENT ORCHESTRATOR |
|  - GeminiEngine       |              |  - ToolRegistry   |               | - AgentPlanner     |
|  - Guest/Account Mode |<------------>|  - ToolDispatcher |<------------->| - AgentLoop        |
|  - SSE Streaming      |              |  - Schema/Adapter |               | - AgentMemory      |
|  - Thinking/Reasoning |              |  - ToolValidator  |               | - State Machine    |
+-----------------------+              +-------------------+               +--------------------+
                                                 |
                       +-------------------------+-------------------------+
                       |                                                   |
                       v                                                   v
          +-------------------------+                         +--------------------------+
          |      LOCAL RUNTIME      |                         |      CLOUD RUNTIME       |
          |  (Outbound WSS Client)  |                         |    (Docker Workspaces)   |
          |  - Filesystem Tools     |                         |  - Isolated Containers   |
          |  - Terminal/PTY Tools   |                         |  - Resource Limits       |
          |  - Git & Diagnostics    |                         |  - Workspace Lifecycle   |
          |  - Workspace Sandbox    |                         |  - Command Execution     |
          +-------------------------+                         +--------------------------+
                       |
                       v
          +-------------------------+
          |     MCP INTEGRATION     |
          |  - MCP Server (STDIO)   |
          |  - MCP Client & Tools   |
          +-------------------------+
```

## 2. Core Subsystems

### 2.1 API Gateway
- **OpenAI Compatibility**: Complete `/v1/chat/completions` with streaming Server-Sent Events (SSE) and finish reasons (`stop`, `tool_calls`).
- **Responses API**: `/v1/responses` for modern agent workflows.
- **Security**: Distinct authentication layer separating Proxy API keys from Gemini credentials.

### 2.2 Gemini Model Adapter
- **Guest Mode**: Instant zero-login access via `gemini-web-sdk` with automated socket cleanup per request.
- **Account Mode**: Cookie authentication via `__Secure-1PSID` and `__Secure-1PSIDTS`.
- **Reasoning**: Native streaming of thinking tokens (`reasoning_content`).
- **Prompt & Tool Injection**: Formatting tools into clear directives with DSML/`<tool_call>` extraction.

### 2.3 Universal Tool Engine
- Central registry for tool schemas with JSON Schema validation.
- Adapters for OpenAI tools, Gemini tools, and Model Context Protocol (MCP).
- Dual execution modes: Mode A (IDE-managed) and Mode B (Agent-managed).

### 2.4 Local & Cloud Runtimes
- **Local Runtime**: Runs on developer's machine, establishes an outbound WebSocket connection (no open ports needed), sandboxed to authorized directories.
- **Cloud Runtime**: Runs in Docker containers with memory/CPU limits and isolated volumes.
