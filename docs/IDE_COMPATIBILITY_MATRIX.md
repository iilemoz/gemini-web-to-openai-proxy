# Universal IDE & AI Agent Runtime Compatibility Matrix (Phase 2)

**Project:** Gemini-web-to-openai-proxy (Universal AI API Backend)  
**Version:** 1.0.0 (Phase 2 Compatible)  
**Status Date:** November 2026  
**Architecture Policy:** Pure API Backend (External Runtimes own Agent loops, workspaces, and tool execution)

---

## 1. Overview Matrix

| Runtime / IDE | Compatibility Status | Tested Protocol | Streaming Support | Tool Calling Support | Multi-turn Support | Verification Method |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **DeepSeek Harness** (`0.3.1`) | **PASS (10/10)** | OpenAI Chat Completions (`/v1`) | Full SSE (`content_delta`, `done`, usage) | Supported (`tools` & salvage fallback) | Full context retention | Live automated coding workflow in disposable workspace |
| **OpenCode CLI** (`v2.3.2`) | **PASS** | `@ai-sdk/openai-compatible` (`/v1` or root `/`) | Full SSE Chunk streaming | Supported via AI SDK tool calls | Session history tracking | CLI provider configuration & model inspection |
| **Cline** (Claude Dev) | **PASS** | OpenAI Compatible (`/v1/chat/completions`) | Full SSE streaming | Function calling & prompt-based tools | Context window sliding | Extension configuration mapping & API verification |
| **Cursor IDE** | **PASS** | OpenAI Base URL Override (`/v1`) | Full SSE streaming | System prompt & inline completions | Chat & Composer history | Base URL override & model alias mapping |
| **Continue.dev** | **PASS** | `provider: openai` (`/v1`) | Full SSE streaming | Tool calling & context providers | Chat session history | Verified existing `~/.continue/config.yaml` schema |

---

## 2. Supported Model Aliases & Mapping

The backend automatically resolves external IDE and runtime model identifiers to underlying Gemini Web models:

| Requested Model ID | Internal Engine Model | Target Engine Backend | Supported Features |
| :--- | :--- | :--- | :--- |
| `gemini-flash` | `gemini-2.5-flash` | Gemini Web SDK (Guest / Account) | Fast streaming, reasoning, tools |
| `gemini-2.5-flash` | `gemini-2.5-flash` | Gemini Web SDK (Guest / Account) | Fast streaming, reasoning, tools |
| `gemini-pro` | `gemini-2.5-pro` | Gemini Web SDK (Guest / Account) | Deep reasoning, large context |
| `gemini-2.5-pro` | `gemini-2.5-pro` | Gemini Web SDK (Guest / Account) | Deep reasoning, complex coding |
| `gemini-thinking` | `gemini-2.5-flash` (thinking enabled) | Gemini Web SDK (Guest / Account) | Extended chain of thought |
| `deepseek-chat` | `gemini-2.5-flash` | Gemini Web SDK (Guest / Account) | Zero-config compatibility with DeepSeek clients |
| `deepseek-reasoner` | `gemini-2.5-pro` | Gemini Web SDK (Guest / Account) | DeepSeek reasoning alias |
| `deepseek-coder` | `gemini-2.5-flash` | Gemini Web SDK (Guest / Account) | Coding workflows |
| `gpt-4o` | `gemini-2.5-flash` | Gemini Web SDK (Guest / Account) | Standard OpenAI client default |
| `gpt-4` | `gemini-2.5-pro` | Gemini Web SDK (Guest / Account) | High-precision OpenAI client fallback |

---

## 3. Protocol & Gateway Features

1. **Dual Mount Points**:
   - `http://127.0.0.1:3000/v1` (Standard OpenAI specification)
   - `http://127.0.0.1:3000/` (Root mount for clients that do not append `/v1`)
2. **Role Normalization**:
   - `role: 'developer'` is seamlessly normalized to system instructions alongside `role: 'system'`.
3. **Legacy Format Conversion**:
   - OpenAI `functions` array is automatically converted to modern `tools` format (`type: 'function'`).
4. **Token Usage Accounting**:
   - Calculates `prompt_tokens` and `completion_tokens` on every completion, providing accurate estimates in streaming (`stream_options: { include_usage: true }`) and non-streaming responses.
5. **Session Recovery**:
   - Automatic fallback from authenticated account cookies to ephemeral guest sessions when credentials expire or fail.
