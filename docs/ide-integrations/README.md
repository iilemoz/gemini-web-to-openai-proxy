# IDE & AI Agent Integration Guides

Welcome to the integration documentation for the **Google Gemini Web to OpenAI API Proxy** (`gemini-web-to-openai-proxy`).

This directory provides verified setup guides, configuration examples, security best practices, and troubleshooting instructions for connecting your favorite IDEs and coding agents to this proxy.

---

## 🧭 Directory Index

| Document | Description |
|---|---|
| [Continue Integration Guide](continue.md) | Configuration for Continue.dev in VS Code and JetBrains (`config.yaml` / `config.json`). |
| [Cline Integration Guide](cline.md) | Autonomous agent setup for Cline (tool calling, multi-turn interactions, and text-only guardrails). |
| [Roo Code Integration Guide](roo-code.md) | Multi-mode configuration for Roo Code (Architect, Code, and Ask modes). |
| [Compatibility Matrix](compatibility-matrix.md) | Complete capability matrix comparing IDEs, protocol support, models, and limitations. |
| [Security & Authentication Guide](security.md) | Comprehensive guidance on `PROXY_API_KEY`, localhost binding, and safe handling of Google Web cookies. |
| [Troubleshooting Guide](troubleshooting.md) | Detailed diagnostics and solutions for common connection, auth, model, and upstream errors. |

---

## 🏗️ Core Architecture & Endpoints

The proxy acts as a high-performance, local HTTP bridge translating OpenAI API specifications into Google Gemini Web requests.

```text
┌───────────────────────────────┐
│  IDEs & Coding Agents         │
│  (Continue, Cline, Roo Code,  │
│   DeepSeek Harness)           │
└───────────────┬───────────────┘
                │ OpenAI HTTP / SSE (JSON)
                ▼
┌───────────────────────────────┐
│  gemini-web-to-openai-proxy   │
│  http://localhost:3000/v1     │
└───────────────┬───────────────┘
                │ Direct Web HTTP (gemini-web-sdk)
                ▼
┌───────────────────────────────┐
│  Google Gemini Web            │
│  (Flash, Pro, Thinking, Lite) │
└───────────────────────────────┘
```

### Primary Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` or `/healthz` | Health check and server status. |
| `GET` | `/v1/models` | OpenAI-compatible model catalog discovery. |
| `POST` | `/v1/chat/completions` | Streaming (SSE) and non-streaming text chat completions with tool calling. |
| `POST` | `/v1/responses` | Specialized responses API endpoint. |

> **Note on Base URLs:** The proxy mounts routes at both `/v1/*` (standard OpenAI specification) and the root `/*` (e.g. `http://localhost:3000/chat/completions`). For all IDEs, the standard base URL is `http://localhost:3000/v1` (or `http://127.0.0.1:3000/v1`).

---

## ⚡ Core Constraints & Non-Negotiable Boundaries

1. **Exclusively Gemini Web:** The only upstream provider is Google Gemini Web via `gemini-web-sdk`. The proxy does not connect to native OpenAI, Anthropic, DeepSeek, Vertex AI, or Google AI Studio endpoints.
2. **Canonical Model IDs Only:** The proxy strictly exposes canonical Gemini models:
   - `gemini-flash` (Default fast everyday model)
   - `gemini-pro` (Advanced reasoning & large context)
   - `gemini-thinking` (Deep chain-of-thought reasoning)
   - `gemini-lite` (Ultra-low latency lightweight model)  
   *Foreign or legacy model requests (`gpt-4o`, `claude-3-5-sonnet`, `gemini-2.5-*`) fail closed with HTTP 404 (`model_not_found`).*
3. **Strictly Text-Only:** The proxy does not support image generation, vision inputs, or multimodal attachments. Any request containing image data (base64 data URIs, standalone image tags, or structured image parts) is rejected with HTTP 400 (`image_input_unsupported`).
4. **No `/v1/completions` Endpoint:** Only `/v1/chat/completions` is implemented. IDE features requiring legacy text completion (such as Continue Tab Autocomplete) cannot use this proxy.

---

## 🚀 Quick Verification

To verify that the proxy is running and accessible before configuring an IDE:

```bash
# 1. Health check
curl -s http://localhost:3000/health

# 2. Model catalog discovery
curl -s http://localhost:3000/v1/models

# 3. Simple text completion test
curl -s http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test" \
  -d '{
    "model": "gemini-flash",
    "messages": [{"role": "user", "content": "Reply with: Hello from Gemini Proxy"}]
  }'
```
