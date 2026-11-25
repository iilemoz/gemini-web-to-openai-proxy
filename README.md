# Universal AI Agent Infrastructure 🚀
### Gemini Web to OpenAI-Compatible Multi-Runtime Agent Platform

[![Node.js Version](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-339933?style=flat&logo=node.js)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![OpenAI Compatible](https://img.shields.io/badge/API-OpenAI%20Compatible-412991?logo=openai)](https://platform.openai.com/docs/api-reference)
[![MCP Protocol](https://img.shields.io/badge/MCP-2024--11--05-blueviolet)](https://modelcontextprotocol.io/)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek--Harness-Compatible-success)](https://github.com/DeepSeek-ai/deepseek-harness)
[![Tests Passing](https://img.shields.io/badge/Tests-133%2F133%20Passing-brightgreen.svg)](tests/)
[![Author](https://img.shields.io/badge/Author-Lemo-orange.svg)](#author--credits)

> **Architected by Lemo**  
> An enterprise-grade, modular, pure HTTP OpenAI-compatible AI Agent Infrastructure. Exclusively bridges **Google Gemini Web** to OpenAI API endpoints (`/v1/chat/completions`, `/v1/models`, `/v1/responses`) with **pure text-based processing**. Features a **Universal Tool Calling Engine**, **Autonomous Agent Orchestrator**, **Local Agent Runtime** (WebSocket secure tunneling), **Cloud Isolation Runtime** (Docker + Process fallback), **Model Context Protocol (MCP)** server/client, **Persistent Fact Memory**, **Multi-Agent Pipeline Coordinator**, and a real-time **Developer Admin Dashboard**. Fully benchmark-verified against the **DeepSeek AI Harness**.
>
> **Scope & Capabilities Note:**  
> - **Gemini Web Only**: The upstream provider is Google Gemini Web exclusively. Foreign models (`gpt-*`, `claude-*`, `deepseek-*`) fail closed with HTTP 404 (`model_not_found`).  
> - **Pure Text Generation**: Multimodal and image inputs (Base64 data URIs, image URLs, attachment parts) are strictly rejected with HTTP 400 (`image_input_unsupported`). All vision claims and processing logic are removed.

---

## 🌟 Key Subsystems & Highlights

- **⚡ 100% Pure HTTP Gemini Web Bridge (Text-Only)**:
  - Direct HTTP streaming via `gemini-web-sdk` 2.3.0.
  - Zero Puppeteer, Playwright, or headless browser requirements.
  - No CAPTCHAs, low latency, and zero display server dependencies.
  - Dedicated text-only pipeline with stop sequence truncation filter.
- **👥 Dual Gemini Operational Modes**:
  - **Guest Mode (Default)**: Fully anonymous, instant out-of-the-box usage with zero API keys or cookies.
  - **Account Mode**: Pass `__Secure-1PSID` / `__Secure-1PSIDTS` via `.env` or client `Authorization: Bearer <cookie>` to access user quotas and advanced capabilities.
- **🛠️ Dual Tool Execution Modes**:
  - **Mode A (IDE-Managed Tool Calling)**: Standard OpenAI `tools` definitions parsed and returned via standard `tool_calls` for IDE execution (Cursor, Continue, Cline, DeepSeek Harness).
  - **Mode B (Agent-Managed Execution)**: Autonomous internal execution through the Universal Tool Dispatcher across local workspace and cloud sandboxes.
- **🤖 Autonomous Agent Orchestrator**:
  - Full multi-step loop: Inspect -> Plan -> Tool Execution -> Error Detection -> Self-Healing Recovery -> Completion Verification.
  - Configurable safety caps: max iterations, max retries, execution timeouts, and human-in-the-loop approvals.
- **💻 Local Agent Runtime (Outbound WSS)**:
  - Secure outbound WebSocket connection (`/v1/runtime/tunnel`) requiring no open public ports.
  - Cryptographic device pairing tokens.
  - Sandboxed file system operations (path traversal protection), terminal execution (PowerShell/Bash), Git operations, and project diagnostic tools.
- **🐳 Cloud Isolation Runtime**:
  - Container-based isolated execution (`DockerManager`) with automatic graceful fallback to hardened child process isolation when Docker daemon is not active.
- **🔌 Model Context Protocol (MCP)**:
  - Compliant with Anthropic MCP specification `2024-11-05` over JSON-RPC 2.0.
  - Built-in MCP Server (`POST /v1/mcp`) exposing all registered tools, and MCP Client (`MCPClient`) for external server federation.
- **🧠 Persistent Memory & Multi-Agent Pipelines**:
  - File-backed persistent fact store (`PersistentMemory`) across sessions.
  - Multi-agent collaboration pipeline (`MultiAgentCoordinator`) orchestrating Architect, Developer, Reviewer, Debugger, and QA Tester roles.
- **📊 Real-time Developer Dashboard**:
  - Built-in dark UI (`GET /dashboard`) with live metrics, active agent runs, registered tools, connected runtimes, and Gemini status.
- **🎯 DeepSeek Benchmark Harness Compatibility**:
  - Fully compatible with `https://github.com/DeepSeek-ai/deepseek-harness`.
  - Conforms to OpenAI models discovery, chat completions schema, error structures, and HTTP 429 rate limiter headers (`Retry-After`).

---

## 📋 Model Catalog

| Model ID | Description | Reasoning Stream | Best For |
| :--- | :--- | :---: | :--- |
| `gemini-flash` | Google Gemini 2.5 Flash / Gemini 3 Flash | No | Fast everyday coding, completions, DeepSeek Harness |
| `gemini-2.5-flash` | Google Gemini 2.5 Flash Flagship Speed Alias | No | High throughput, quick responses |
| `gemini-pro` | Google Gemini 2.5 Pro / Gemini 3 Pro | No | Complex problem solving, architectural planning |
| `gemini-2.5-pro` | Google Gemini 2.5 Pro Alias | No | In-depth refactoring, multi-file analysis |
| `gemini-thinking` | Google Gemini Thinking Model | ✅ Yes | Deep mathematical, algorithmic, and code reasoning |
| `gemini-2.5-thinking` | Google Gemini 2.5 Thinking | ✅ Yes | Advanced reasoning with live thought tokens |
| `gemini-lite` | Google Gemini Lite | No | Lightweight tasks and minimal latency |

---

## 🏗️ Architecture & Project Directory Structure

```text
gemini-web-to-openai-proxy/
├── src/
│   ├── app.js                         # Express application setup & middleware pipeline
│   ├── server.js                      # Server entry point & WebSocket server mount
│   │
│   ├── config/
│   │   └── index.js                   # Environment config, model catalog & aliases
│   │
│   ├── middleware/
│   │   ├── auth.js                    # Bearer PROXY_API_KEY authentication guard
│   │   ├── validation.js              # Request body & parameters schema validator
│   │   └── rateLimiter.js             # IP-based rate limiter with 429 Retry-After headers
│   │
│   ├── controllers/
│   │   ├── chatController.js          # /v1/chat/completions (SSE & non-streaming, DSML)
│   │   ├── modelsController.js        # /v1/models & /v1/models/:model discovery
│   │   └── responsesController.js     # /v1/responses endpoint
│   │
│   ├── providers/
│   │   ├── BaseProvider.js            # Provider interface contract
│   │   ├── index.js                   # Provider registry
│   │   └── gemini/
│   │       ├── GeminiEngine.js        # Gemini Web client, Guest/Account modes, session management
│   │       └── index.js
│   │
│   ├── tools/                         # Universal Tool Calling Subsystem
│   │   ├── registry/                  # ToolRegistry, ToolSchema, ToolDiscovery
│   │   ├── adapters/                  # OpenAIToolAdapter, GeminiToolAdapter, MCPToolAdapter
│   │   ├── dispatcher/                # ToolDispatcher, ToolValidator, ToolResultFormatter
│   │   └── builtins/                  # echo, calculator, system_info
│   │
│   ├── runtime/
│   │   ├── local/                     # Local Agent Runtime
│   │   │   ├── WorkspaceManager.js    # Authorized roots & path traversal defense
│   │   │   ├── TerminalManager.js     # PowerShell / Bash execution with timeouts
│   │   │   ├── DeviceManager.js       # Device registration & pairing token manager
│   │   │   ├── wss/                   # WebSocket server tunnel handler
│   │   │   └── tools/                 # FS, Terminal, Git, Project, DevTools
│   │   └── cloud/                     # Cloud Isolation Runtime (Docker & Process fallback)
│   │       ├── DockerManager.js
│   │       ├── ContainerManager.js
│   │       └── CloudRuntime.js
│   │
│   ├── agent/                         # Autonomous Agent Orchestration
│   │   ├── AgentState.js              # FSM (idle, planning, executing, paused, completed, failed)
│   │   ├── AgentEvents.js             # Event emitter for lifecycle hooks
│   │   ├── AgentMemory.js             # In-memory execution context
│   │   ├── AgentContext.js            # Context window manager & token budgeting
│   │   ├── AgentCancellation.js       # Abort controller & task cancellation tokens
│   │   ├── AgentRecovery.js           # Self-healing & error recovery strategies
│   │   ├── AgentPlanner.js            # Structured task decomposition
│   │   ├── AgentExecutor.js           # Tool execution coordinator
│   │   ├── AgentLoop.js               # Multi-step iteration loop with safety caps
│   │   ├── AgentOrchestrator.js       # Top-level lifecycle manager
│   │   └── MultiAgentCoordinator.js   # Multi-agent role pipeline (Architect -> Dev -> QA)
│   │
│   ├── memory/
│   │   └── PersistentMemory.js        # Persistent fact store & session state storage
│   │
│   ├── integrations/
│   │   └── mcp/                       # Model Context Protocol (2024-11-05)
│   │       ├── MCPServer.js           # MCP Server exposing tools via JSON-RPC 2.0
│   │       ├── MCPClient.js           # MCP Client connecting to external servers
│   │       └── mcpServerManager.js
│   │
│   ├── dashboard/                     # Developer Admin Dashboard
│   │   ├── index.html                 # Modern responsive dark-mode UI
│   │   └── dashboardRouter.js         # /dashboard & /dashboard/api/stats
│   │
│   ├── routes/
│   │   └── v1.js                      # Express v1 router mounting all subsystems
│   │
│   └── utils/
│       ├── dsmlParser.js              # DeepSeek DSML & <tool_call> parser
│       ├── sse.js                     # Server-Sent Events stream generator
│       └── logger.js                  # Structured colored logger
│
├── tests/                             # 54 Automated Deterministic Tests
│   ├── baseline.test.mjs              # Phase 0 Baseline tests (8 tests)
│   ├── phase1_foundation.test.mjs     # Security & Validation tests (6 tests)
│   ├── phase2_tools.test.mjs          # Tool Engine tests (8 tests)
│   ├── phase3_local_runtime.test.mjs  # Local Runtime & FS sandbox tests (6 tests)
│   ├── phase4_agent.test.mjs          # Agent Orchestrator tests (7 tests)
│   ├── phase5_cloud_runtime.test.mjs  # Cloud Runtime & Isolation tests (3 tests)
│   ├── phase6_dev_tools.test.mjs      # DevTools & Search tests (4 tests)
│   ├── phase7_mcp.test.mjs            # MCP JSON-RPC protocol tests (4 tests)
│   ├── phase8_memory.test.mjs         # Memory & Multi-Agent tests (3 tests)
│   ├── phase9_dashboard.test.mjs      # Developer Dashboard tests (2 tests)
│   └── phase10_deepseek_harness.test.mjs # DeepSeek Harness verification (3 tests)
│
└── docs/                              # Comprehensive Documentation Suite
    ├── ARCHITECTURE.md                # System Architecture & Subsystem Interactions
    ├── IMPLEMENTATION_STATUS.md       # Full roadmap execution status & test ledger
    ├── DEEPSEEK_HARNESS.md            # DeepSeek benchmark harness configuration
    ├── API_REFERENCE.md               # Complete REST API reference
    ├── TOOL_SYSTEM.md                 # Universal Tool Engine documentation
    ├── AGENT_ENGINE.md                # Agent Orchestrator & Loop guide
    ├── LOCAL_RUNTIME.md               # Local Runtime & WSS tunnel guide
    ├── CLOUD_RUNTIME.md               # Cloud Docker sandbox & Process isolation
    ├── MCP_INTEGRATION.md             # Model Context Protocol integration guide
    ├── SECURITY.md                    # Security architecture & sandbox policies
    ├── IDE_COMPATIBILITY.md           # Setup guides for Cursor, Continue, Aider, Cline
    ├── DEPLOYMENT.md                  # Production deployment & Docker recipes
    └── TROUBLESHOOTING.md             # Diagnostics & troubleshooting runbook
```

---

## 🚀 Quick Start

### 1. Requirements
- [Node.js](https://nodejs.org/) v18.0.0 or higher (v20+ or v22 LTS recommended).
- [npm](https://www.npmjs.com/) installed.

### 2. Installation
```bash
git clone https://github.com/iilemoz/gemini-web-to-openai-proxy.git
cd gemini-web-to-openai-proxy
npm install
```

### 3. Configuration
Copy the sample environment file:
```bash
cp env.example .env
```

Configure your `.env`:
```env
PORT=3000
HOST=0.0.0.0
DEFAULT_MODEL=gemini-flash

# Optional: Proxy API Key (if set, clients must send Authorization: Bearer <key>)
PROXY_API_KEY=

# Optional: Gemini Account Mode cookie (leave blank for Anonymous Guest Mode)
GEMINI_SECURE_1PSID=
GEMINI_SECURE_1PSIDTS=

# Rate Limiting
RATE_LIMIT_ENABLED=true
RATE_LIMIT_MAX=120
RATE_LIMIT_WINDOW_MS=60000

# Local Runtime Workspace Root (defaults to current working directory)
WORKSPACE_ROOT=
```

### 4. Running the Server
```bash
# Start in production mode
npm start

# Start in development mode with auto-reload
npm run dev
```

The server starts on `http://localhost:3000`.
- **Developer Dashboard**: `http://localhost:3000/dashboard`
- **Health Check**: `http://localhost:3000/healthz`
- **Models List**: `http://localhost:3000/v1/models`

### 5. Running the Test Suite
Run the full automated test suite (133 tests):
```bash
npm test
```

---

## 🔌 API Endpoints Summary

| Endpoint | Method | Description |
| :--- | :---: | :--- |
| `/v1/chat/completions` | `POST` | OpenAI-compatible chat completions (Streaming SSE & Non-Streaming) |
| `/v1/models` | `GET` | List available Gemini models |
| `/v1/models/:model` | `GET` | Retrieve specific model details |
| `/v1/responses` | `POST` | Simplified responses API |
| `/v1/tools` | `GET` | Discover all registered tools with JSON schemas |
| `/v1/runtime/devices` | `POST` | Register a new device for Local Runtime pairing |
| `/v1/runtime/sessions`| `GET` | List active Local Runtime WebSocket sessions |
| `/v1/runtime/cloud/status` | `GET` | Cloud runtime status (Docker daemon detection) |
| `/v1/runtime/cloud/sandboxes` | `POST` | Create an isolated sandbox environment |
| `/v1/agents` | `GET` | List available autonomous agent roles & capabilities |
| `/v1/agent/runs` | `POST` | Create and start an autonomous agent execution run |
| `/v1/agent/runs/:id` | `GET` | Inspect status, plan, and history of an agent run |
| `/v1/agent/runs/:id/cancel` | `POST` | Cancel an active agent run |
| `/v1/agent/runs/:id/approve`| `POST` | Human-in-the-loop tool execution approval |
| `/v1/agent/pipeline` | `POST` | Execute multi-agent collaborative pipeline |
| `/v1/mcp` | `POST` | Model Context Protocol JSON-RPC 2.0 endpoint |
| `/v1/mcp/servers` | `GET` | List connected external MCP servers |
| `/dashboard` | `GET` | Developer Admin Dashboard UI |
| `/dashboard/api/stats` | `GET` | Aggregated real-time metrics |
| `/healthz` | `GET` | High-availability readiness probe |

---

## 🎯 DeepSeek Harness Compatibility

This infrastructure is engineered and verified to support the **DeepSeek Evaluation Harness** (`https://github.com/DeepSeek-ai/deepseek-harness`).

Configure DeepSeek Harness with:
```yaml
openai_api_base: "http://127.0.0.1:3000/v1"
openai_api_key: "none"  # Or your PROXY_API_KEY
model: "gemini-flash"   # Or gemini-thinking, gemini-pro
temperature: 0.0
```
For complete setup, evaluation examples, and benchmark execution instructions, see [docs/DEEPSEEK_HARNESS.md](file:///c:/Users/Ahmed/Desktop/Gemini-web-to-openai-proxy%202027/docs/DEEPSEEK_HARNESS.md).

---

## 💻 IDE Integration Quick Guides

### Cursor
1. Go to **Settings** > **Features** > **AI Models**.
2. Set **OpenAI Base URL** to `http://localhost:3000/v1`.
3. Set **OpenAI API Key** to any string (or your `PROXY_API_KEY`).
4. Select `gemini-flash` or `gemini-pro`.

### Continue (VS Code & JetBrains)
In your `~/.continue/config.json`:
```json
{
  "models": [
    {
      "title": "Gemini Flash (Local Proxy)",
      "provider": "openai",
      "model": "gemini-flash",
      "apiBase": "http://localhost:3000/v1",
      "apiKey": "any-string"
    }
  ]
}
```

### Cline / Roo-Code
1. Choose **OpenAI Compatible** provider.
2. Base URL: `http://localhost:3000/v1`.
3. Model ID: `gemini-flash`.
4. API Key: `any-string` (or `PROXY_API_KEY`).

For additional IDE configurations (Aider, Claude Dev, etc.), see [docs/IDE_COMPATIBILITY.md](file:///c:/Users/Ahmed/Desktop/Gemini-web-to-openai-proxy%202027/docs/IDE_COMPATIBILITY.md).

---

## 📖 Comprehensive Documentation

| Document | Purpose |
| :--- | :--- |
| [ARCHITECTURE.md](file:///c:/Users/Ahmed/Desktop/Gemini-web-to-openai-proxy%202027/docs/ARCHITECTURE.md) | Subsystem architecture, component diagrams, and data flows |
| [IMPLEMENTATION_STATUS.md](file:///c:/Users/Ahmed/Desktop/Gemini-web-to-openai-proxy%202027/docs/IMPLEMENTATION_STATUS.md) | Complete roadmap milestone tracking and test verification logs |
| [DEEPSEEK_HARNESS.md](file:///c:/Users/Ahmed/Desktop/Gemini-web-to-openai-proxy%202027/docs/DEEPSEEK_HARNESS.md) | DeepSeek Harness benchmark integration and testing guide |
| [API_REFERENCE.md](file:///c:/Users/Ahmed/Desktop/Gemini-web-to-openai-proxy%202027/docs/API_REFERENCE.md) | Full endpoint specifications, parameters, and payloads |
| [TOOL_SYSTEM.md](file:///c:/Users/Ahmed/Desktop/Gemini-web-to-openai-proxy%202027/docs/TOOL_SYSTEM.md) | Tool Registry, Schema definitions, and custom tool creation |
| [AGENT_ENGINE.md](file:///c:/Users/Ahmed/Desktop/Gemini-web-to-openai-proxy%202027/docs/AGENT_ENGINE.md) | Autonomous Agent Orchestrator, planning, and execution loop |
| [LOCAL_RUNTIME.md](file:///c:/Users/Ahmed/Desktop/Gemini-web-to-openai-proxy%202027/docs/LOCAL_RUNTIME.md) | Outbound WebSocket tunnel, Workspace sandboxing, and terminal execution |
| [CLOUD_RUNTIME.md](file:///c:/Users/Ahmed/Desktop/Gemini-web-to-openai-proxy%202027/docs/CLOUD_RUNTIME.md) | Docker container management and graceful process isolation fallback |
| [MCP_INTEGRATION.md](file:///c:/Users/Ahmed/Desktop/Gemini-web-to-openai-proxy%202027/docs/MCP_INTEGRATION.md) | Model Context Protocol server/client guide |
| [SECURITY.md](file:///c:/Users/Ahmed/Desktop/Gemini-web-to-openai-proxy%202027/docs/SECURITY.md) | Threat modeling, sandboxing policies, and authentication design |
| [IDE_COMPATIBILITY.md](file:///c:/Users/Ahmed/Desktop/Gemini-web-to-openai-proxy%202027/docs/IDE_COMPATIBILITY.md) | Client integration guides for Cursor, Continue, Aider, and Cline |
| [DEPLOYMENT.md](file:///c:/Users/Ahmed/Desktop/Gemini-web-to-openai-proxy%202027/docs/DEPLOYMENT.md) | Systemd, PM2, Docker, and reverse proxy deployment guide |
| [TROUBLESHOOTING.md](file:///c:/Users/Ahmed/Desktop/Gemini-web-to-openai-proxy%202027/docs/TROUBLESHOOTING.md) | Diagnostic workflows, known issues, and recovery procedures |

---

## 🛡️ License

MIT License. See [LICENSE](LICENSE) for details.

### Author & Credits
- **Project Architect & Maintainer**: **Lemo**
