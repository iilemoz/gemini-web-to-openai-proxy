# Continue.dev Integration Guide

This guide details configuring and using **Continue** (open-source AI code assistant for VS Code and JetBrains) with the Gemini-web-to-openai-proxy.

---

## 1. Overview

Continue natively supports the `openai` provider type with customizable `apiBase` URLs. This allows full integration with Gemini-web-to-openai-proxy for both chat, codebase indexing, and tab autocomplete.

---

## 2. Configuration Setup

Continue configuration is stored at:
- **YAML Format**: `~/.continue/config.yaml`
- **JSON Format**: `~/.continue/config.json`

### 2.1 YAML Configuration (`config.yaml`)

Edit `~/.continue/config.yaml` to include the proxy models:

```yaml
name: Local Gemini Proxy Configuration
version: 1.0.0
schema: v1

models:
  - name: Gemini 2.5 Flash
    provider: openai
    model: gemini-2.5-flash
    apiBase: http://127.0.0.1:3000/v1
    apiKey: "sk-continue-token"

  - name: Gemini 2.5 Pro
    provider: openai
    model: gemini-2.5-pro
    apiBase: http://127.0.0.1:3000/v1
    apiKey: "sk-continue-token"

  - name: DeepSeek Chat (Gemini Backend)
    provider: openai
    model: deepseek-chat
    apiBase: http://127.0.0.1:3000/v1
    apiKey: "sk-continue-token"

tabAutocompleteModel:
  title: Gemini Flash Autocomplete
  provider: openai
  model: gemini-flash
  apiBase: http://127.0.0.1:3000/v1
  apiKey: "sk-continue-token"
```

---

## 3. Usage within Continue

1. Open the Continue side panel in VS Code or JetBrains (`Ctrl + L`).
2. Select **Gemini 2.5 Flash** from the model picker at the bottom.
3. Test code explanation, refactoring, and codebase queries (`@codebase`).
4. Streaming responses and token consumption metrics will display directly in the panel.
