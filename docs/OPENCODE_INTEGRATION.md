# OpenCode Integration Guide

This guide details configuring and using **OpenCode CLI** with the Gemini-web-to-openai-proxy.

---

## 1. Overview

OpenCode CLI uses `@ai-sdk/openai-compatible` to connect to OpenAI-compatible endpoints. The local proxy provides full model inference, streaming tokens, and OpenAI schema compatibility.

---

## 2. Configuration Setup

OpenCode configuration files are located at:
- **Global**: `~/.config/opencode/opencode.jsonc` (Windows: `%USERPROFILE%\.config\opencode\opencode.jsonc`)
- **Project**: `.opencode/opencode.jsonc`

### Recommended Configuration

Add the `gemini-proxy` provider under the `"provider"` block in `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "gemini-proxy": {
      "name": "Gemini Web Proxy",
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "http://127.0.0.1:3000/v1",
        "apiKey": "sk-opencode-local"
      },
      "models": {
        "gemini-2.5-flash": {
          "name": "Gemini 2.5 Flash"
        },
        "gemini-2.5-pro": {
          "name": "Gemini 2.5 Pro"
        },
        "deepseek-chat": {
          "name": "DeepSeek Chat (Alias)"
        }
      }
    }
  }
}
```

---

## 3. Running OpenCode

### 3.1 Inspecting Available Models

Verify that the configured models are visible:

```bash
opencode models
```

### 3.2 Running an Interactive Session

Start an interactive session with the proxy backend:

```bash
opencode --model gemini-proxy/gemini-2.5-flash
```

### 3.3 Running Non-Interactive Autonomous Tasks

```bash
opencode run --model gemini-proxy/gemini-2.5-flash "Analyze src/app.js and report code quality."
```

---

## 4. Troubleshooting

- **Connection Refused**: Verify that the Node.js proxy server is active on `http://127.0.0.1:3000`.
- **Base URL Suffix**: OpenCode's `@ai-sdk/openai-compatible` works whether `baseURL` is specified as `http://127.0.0.1:3000/v1` or `http://127.0.0.1:3000`, because the proxy mounts routes at both `/v1` and `/`.
