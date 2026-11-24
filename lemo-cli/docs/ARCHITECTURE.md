# Lemo CLI Architecture

## 1. System Overview

Lemo CLI is a standalone terminal-based AI client designed for developers. It operates in two primary modes:
1. **Interactive Chat Mode:** Fluid, streaming terminal conversations with AI models via the Lemo Universal AI API Backend.
2. **Autonomous Agent Mode:** An interactive coding agent capable of codebase analysis, file editing, and sandboxed terminal command execution with strict human-in-the-loop safety approvals.

### Core Architectural Principle: Decoupled API Consumer
Lemo CLI **never** connects directly to upstream model providers (Google Gemini, OpenAI, DeepSeek, Anthropic). It connects exclusively to the **Lemo Universal AI API Backend** (`gemini-web-to-openai-proxy`) through standard OpenAI-compatible REST endpoints (`/v1/chat/completions`, `/v1/models`).

```
+-------------------------------------------------------------------------+
|                               LEMO CLI                                  |
|                                                                         |
|  +--------------------+  +---------------------+  +------------------+  |
|  |     Chat Mode      |  |     Agent Mode      |  |  Config Manager  |  |
|  |  (REPL, Streaming) |  |   (Task Loop, Plan) |  |  (JSON, Env, CLI)|  |
|  +---------+----------+  +----------+----------+  +--------+---------+  |
|            |                        |                      |            |
|            |           +------------+------------+         |            |
|            |           |   Local Tool Execution  |         |            |
|            |           |  (Filesystem, Terminal) |         |            |
|            |           | Strict Human Gatekeeper |         |            |
|            |           +------------+------------+         |            |
|            \                        |                     /             |
|             \                       |                    /              |
|              +----------------------+-------------------+               |
|                                     |                                   |
|                        +------------v------------+                      |
|                        |   Lemo API Client       |                      |
|                        |  (OpenAI SDK / Fetch)   |                      |
|                        +------------+------------+                      |
+-------------------------------------|-----------------------------------+
                                      | HTTP / SSE (`/v1/*`)
                                      v
+-------------------------------------------------------------------------+
|                     LEMO UNIVERSAL AI API BACKEND                       |
|                      (`gemini-web-to-openai-proxy`)                     |
|                                                                         |
|  +-------------------+  +---------------------+  +-------------------+  |
|  | Multi-Provider    |  | Model Registry &    |  | Resilience & SSE  |  |
|  | Routing Engine    |  | Context Management  |  | Stream Lifecycle  |  |
|  +---------+---------+  +----------+----------+  +---------+---------+  |
|            |                       |                       |            |
+------------|-----------------------|-----------------------|------------+
             |                       |                       |
             v                       v                       v
     [Google Gemini]          [OpenAI Models]        [DeepSeek Models]
```

---

## 2. Component Responsibilities

| Component | Responsibility | Boundary & Isolation |
| :--- | :--- | :--- |
| **CLI Layer (`src/cli/`)** | Command-line parsing (`commander`), option validation, help banners, formatted terminal output, colorized styling (`picocolors`). | Interacts only with Core and API layers. |
| **Config Layer (`src/core/config/`)** | Cross-platform config discovery (`paths.ts`), JSON persistence, in-memory updates, schema validation (`schema.ts`). | Self-contained; provides validated immutable copies. |
| **Logging & Errors (`src/core/`)** | Leveled logger (`debug`, `info`, `warn`, `error`, `silent`), credential and Bearer token redaction, custom error hierarchy. | Universal cross-cutting concern. |
| **API Client (`src/api/`)** | Typed HTTP and Server-Sent Events (SSE) client consuming Lemo Backend `/v1/*` endpoints. | Strictly consumes standard OpenAI schema. |
| **Chat Mode (`src/chat/`)** | Read-Eval-Print-Loop (REPL), multi-turn conversation memory, live markdown/token streaming renderer. | Consumes API Client; does not access tools or filesystem. |
| **Agent Mode (`src/agent/`)** | Autonomous task execution cycle (Perceive -> Plan -> Act -> Reflect), tool call routing, step limit enforcement. | Orchestrates API Client and Local Tools. |
| **Local Tools (`src/tools/`)** | Sandboxed local actions: `read_file`, `write_file`, `list_directory`, `execute_command`. | Enforces interactive user confirmation before execution. |

---

## 3. Backend Interaction Model

The CLI interacts with the Lemo Backend solely through the following standard OpenAI-compatible endpoints:

### 3.1 Model Discovery
- **Endpoint:** `GET /v1/models`
- **Purpose:** Retrieve available models dynamically routed by the backend (e.g., `gemini-2.5-pro`, `gemini-2.5-flash`, `deepseek-chat`, `gpt-4o`).
- **Response Format:**
  ```json
  {
    "object": "list",
    "data": [
      {
        "id": "gemini-2.5-flash",
        "object": "model",
        "created": 1700000000,
        "owned_by": "lemo-backend",
        "permission": []
      }
    ]
  }
  ```

### 3.2 Chat & Agent Completions
- **Endpoint:** `POST /v1/chat/completions`
- **Payload:** Standard OpenAI format including `model`, `messages`, `stream` (boolean), `temperature`, and optional `tools` definition for Agent Mode.
- **Streaming:** Server-Sent Events (`data: {"choices": [{"delta": {"content": "..."}}]}`) terminating with `data: [DONE]`.

---

## 4. Configuration Architecture

### 4.1 Cross-Platform Resolution Priority
Configuration values are resolved using the following order of precedence:
1. Explicit CLI Flags (e.g., `--api-url`, `--model`, `--timeout`).
2. Environment Variables (e.g., `LEMO_API_URL`, `LEMO_API_KEY`, `LEMO_MODEL`, `LEMO_LOG_LEVEL`).
3. Persistent Configuration File (`config.json`).
4. Hardcoded System Defaults (`DEFAULT_CONFIG`).

### 4.2 Storage Locations
- **Windows:** `%APPDATA%\lemo\config.json` (fallback: `~/.lemo/config.json`)
- **POSIX (Linux / macOS):** `$XDG_CONFIG_HOME/lemo/config.json` or `~/.config/lemo/config.json` (fallback: `~/.lemo/config.json`)
- **Explicit Override:** Via `LEMO_CONFIG_PATH` or `LEMO_CONFIG_DIR`.

---

## 5. Logging & Security Architecture

### 5.1 Leveled Logging
Logging levels include `debug`, `info`, `warn`, `error`, and `silent`. In `debug` mode, network requests, headers, and internal state transitions are displayed.

### 5.2 Secret Redaction
Sensitive information is sanitized before being written to standard output or log streams:
- `Authorization: Bearer <token>` -> `Authorization: Bearer [REDACTED]`
- `sk-[a-zA-Z0-9]{20,}` -> `sk-***[REDACTED]***`
- Object keys matching sensitive patterns (`apiKey`, `password`, `secret`, `token`) have their string values masked (`"***REDACTED***"`).

---

## 6. Planned Chat Mode Architecture (Phase 4.1)

```
[User Input] --> [REPL Controller] --> [Context Manager] --> [API Client (SSE)]
                        ^                                           |
                        |                                           v
                 [History Store] <--- [Streaming Renderer] <--- [Chunk Stream]
```

- **REPL Loop:** Powered by Node.js `readline/promises`.
- **Context Management:** Sliding window message buffer with configurable token budget.
- **Streaming UI:** Live token rendering with terminal cursor manipulation and formatting.
- **Slash Commands:** Support for in-session commands (`/help`, `/model`, `/clear`, `/exit`).

---

## 7. Planned Agent Mode & Tool Security Boundaries (Phase 4.2 & 4.3)

```
                   +------------------------+
                   |  Agent Execution Loop  |
                   +-----------+------------+
                               |
                               v
                     +--------------------+
                     | Tool Call Received |
                     +---------+----------+
                               |
                  [Risk / Safety Classification]
                     /                    \
     (Read-Only: inspect, list)      (Mutating: write, exec)
                    |                          |
                    v                          v
             [Auto-Execute]          +-------------------+
                                     | Interactive Gate: |
                                     | "Allow command?"  |
                                     +---------+---------+
                                               |
                                     +---------+---------+
                                     | [Yes]       [No]  |
                                     +---+-----------+---+
                                         |           |
                                         v           v
                                    [Execute]   [Deny & Feedback]
```

### 7.1 Security Boundaries
1. **Interactive Approval Gate:** File write, delete, and terminal command execution MUST prompt the user with clear diffs or command strings before running.
2. **Workspace Sandboxing:** File operations default to the current working directory tree; operations outside the tree require explicit warning.
3. **Execution Timeouts:** Shell commands have explicit timeouts and kill switches.
4. **Denial Feedback:** When a user rejects an action, the rejection reason is returned to the model context so it can replan safely.

---

## 8. Modularity & Extensibility

The codebase strictly adheres to modular boundaries:
- `src/core/`: Foundation shared by all features.
- `src/cli/`: Terminal interface and command definitions.
- `src/api/`: Backend communication abstraction.
- `src/chat/`: Chat-specific REPL and conversation management.
- `src/agent/`: Agent state machine and loop.
- `src/tools/`: Local tool implementations and permission gates.
