# IDE & AI Agent Compatibility Matrix

**Project:** `gemini-web-to-openai-proxy`  
**Phase:** 5.0G.3  
**Architecture Policy:** Pure HTTP OpenAI-Compatible API Proxy (Google Gemini Web Upstream Exclusively)  
**Verification Level:** Deterministic API Protocol Verification (Mock & Contract Aligned)

---

## 1. IDE Compatibility Overview

The table below summarizes the compatibility of external IDEs and AI coding agents with this proxy.

> **Verification Level Definitions:**
> - **Protocol Verified**: Request/response contracts, streaming chunk structures (SSE), tool-call indexing, and error codes are 100% verified against deterministic regression test suites.
> - **Configuration Verified**: Configuration parameters, settings schemas, and provider mapping match the official IDE documentation and extension schemas.
> - **Live IDE End-to-End**: Verified during interactive developer sessions with actual running extensions (requires valid Google session cookies for live upstream).

| IDE / Extension | Configuration Verified | Protocol Verified | Streaming (SSE) | Tool Calling | Multi-Turn Interaction | Live IDE Status | Known Unsupported Features |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|:---|
| **Continue.dev** | ✅ Yes | ✅ Yes | ✅ Supported | ✅ Supported | ✅ Supported | Verified (Chat & Inline Edit) | Tab Autocomplete FIM (relies on missing `/v1/completions`); Image inputs |
| **Cline** | ✅ Yes | ✅ Yes | ✅ Supported | ✅ Supported | ✅ Supported | Verified (Protocol Level) | Browser screenshot / visual inspection; Image inputs |
| **Roo Code** | ✅ Yes | ✅ Yes | ✅ Supported | ✅ Supported | ✅ Supported | Verified (Protocol Level) | Image/vision analysis; Image inputs |

---

## 2. Detailed IDE Capabilities & Constraints

### 2.1 Continue.dev
- **Configuration Format:** `~/.continue/config.yaml` or `config.json` with `provider: openai`.
- **Base URL Setting:** `http://localhost:3000/v1`.
- **Supported Workflows:**
  - Sidebar Chat (`Ctrl + L` / `Cmd + L`).
  - Inline Code Editing (`Ctrl + I` / `Cmd + I`).
  - `@codebase` Context Indexing & Retrieval.
- **Unsupported Workflows:**
  - `tabAutocompleteModel`: Continue's code completion attempts to call `/v1/completions`. Because this proxy strictly implements `/v1/chat/completions`, autocomplete requests fail with HTTP 404 (`not_found`).

### 2.2 Cline (Autonomous Coding Agent)
- **Configuration Format:** Extension Settings -> Provider: `OpenAI Compatible`.
- **Base URL Setting:** `http://localhost:3000/v1`.
- **Supported Workflows:**
  - Autonomous Tool Calling: `execute_command`, `read_file`, `write_to_file`, `list_files`.
  - Multi-turn execution loop: Assistant tool calls -> Cline execution -> Tool result submission.
  - Streaming tool calling with sequential integer `index` (GAP-01) and dedicated terminal chunk `finish_reason: "tool_calls"` (GAP-02).
- **Unsupported Workflows:**
  - Browser screenshots and graphical UI inspections (fails with HTTP 400 `image_input_unsupported`).

### 2.3 Roo Code (Multi-Mode Agent)
- **Configuration Format:** Extension Settings -> Provider: `OpenAI Compatible`.
- **Base URL Setting:** `http://localhost:3000/v1`.
- **Supported Workflows:**
  - Code Mode: Full tool calling and coding execution.
  - Architect Mode: High-level system design with `gemini-pro` or `gemini-thinking`.
  - Ask Mode: Text-only question answering with tools suppressed (`tool_choice: "none"`).
- **Unsupported Workflows:**
  - Image / Vision inspection.

---

## 3. Canonical Model Catalog & Compatibility

The proxy exposes strictly genuine canonical model identifiers in `GET /v1/models`.

| Public Model ID | Upstream Web Model | Streaming | Tool Calling | Reasoning Stream | Description & Recommended Use |
|:---|:---|:---:|:---:|:---:|:---|
| **`gemini-flash`** | `gemini-3-flash` | ✅ Yes | ✅ Yes | ❌ No | Default fast model. Ideal for everyday chat, refactoring, and Cline/Roo Code iterative coding. |
| **`gemini-pro`** | `gemini-3-pro` | ✅ Yes | ✅ Yes | ❌ No | High-capacity model. Best for complex software architecture, multi-file planning, and tools. |
| **`gemini-thinking`** | `gemini-3-thinking` | ✅ Yes | ❌ No | ✅ Yes | Extended chain-of-thought reasoning (Text only). Requests with tools fail with HTTP 400. |
| **`gemini-lite`** | `gemini-3-lite` | ✅ Yes | ❌ No | ❌ No | Ultra-low latency model for simple text queries. Requests with tools fail with HTTP 400. |

> **Model Policy:**
> - Foreign models (e.g. `gpt-4o`, `claude-3-5-sonnet`, `deepseek-chat`) and obsolete aliases (e.g. `gemini-2.5-flash`) fail closed with HTTP 404 (`model_not_found`).
> - There are **zero silent model downgrades**. If a quota limit is reached on `gemini-pro`, the request returns HTTP 429 (`insufficient_quota`) rather than silently switching models.
