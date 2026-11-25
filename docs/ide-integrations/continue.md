# Continue.dev Integration Guide

This guide details configuring **Continue** (open-source AI code assistant for VS Code and JetBrains) to use `gemini-web-to-openai-proxy` as an OpenAI-compatible provider.

---

## 1. Overview & Supported Workflows

Continue natively supports the `openai` provider type with customizable `apiBase` URLs.

### What Works
- **Chat (`Ctrl + L` / `Cmd + L`)**: Interactive code discussions and explanations in the sidebar.
- **Inline Edit (`Ctrl + I` / `Cmd + I`)**: In-place code generation and refactoring directly in the active editor.
- **Codebase Context (`@codebase`)**: Semantic indexing and query workflows powered by `gemini-pro` or `gemini-flash`.
- **Custom System Instructions & Slash Commands**: Supported via standard chat completion prompts.

### Critical Known Limitation: Tab Autocomplete
> **IMPORTANT:**  
> The current proxy does **not** implement the legacy `/v1/completions` endpoint. Continue's `tabAutocompleteModel` relies on `/v1/completions` for FIM (Fill-in-the-Middle) prompt formatting.  
> Attempting to set `gemini-web-to-openai-proxy` as `tabAutocompleteModel` will fail with HTTP 404 (`not_found`).  
> **Do not use this proxy for Continue tab autocomplete.** Use Continue's default autocomplete provider (e.g. Ollama, StarCoder) or rely strictly on Chat and Inline Edit workflows.

---

## 2. Configuration Setup

Continue configuration is typically stored in:
- **YAML format** (Continue v0.9+): `~/.continue/config.yaml`
- **JSON format** (Legacy / alternate): `~/.continue/config.json`

### Option A: YAML Configuration (`~/.continue/config.yaml`)

Add the following model block to your `models` section:

```yaml
name: Gemini Web Proxy
version: 1.0.0
schema: v1

models:
  - name: Gemini Flash (Web Proxy)
    provider: openai
    model: gemini-flash
    apiBase: http://localhost:3000/v1
    apiKey: YOUR_PROXY_API_KEY
    roles:
      - chat
      - edit

  - name: Gemini Pro (Web Proxy)
    provider: openai
    model: gemini-pro
    apiBase: http://localhost:3000/v1
    apiKey: YOUR_PROXY_API_KEY
    roles:
      - chat
      - edit

  - name: Gemini Thinking (Web Proxy)
    provider: openai
    model: gemini-thinking
    apiBase: http://localhost:3000/v1
    apiKey: YOUR_PROXY_API_KEY
    roles:
      - chat

# NOTE: Do NOT configure tabAutocompleteModel with this proxy
# tabAutocompleteModel: (leave empty or point to a local model supporting /v1/completions)
```

### Option B: JSON Configuration (`~/.continue/config.json`)

If using `config.json`, add the proxy models to the `models` array:

```json
{
  "models": [
    {
      "title": "Gemini Flash (Web Proxy)",
      "provider": "openai",
      "model": "gemini-flash",
      "apiBase": "http://localhost:3000/v1",
      "apiKey": "YOUR_PROXY_API_KEY"
    },
    {
      "title": "Gemini Pro (Web Proxy)",
      "provider": "openai",
      "model": "gemini-pro",
      "apiBase": "http://localhost:3000/v1",
      "apiKey": "YOUR_PROXY_API_KEY"
    },
    {
      "title": "Gemini Thinking (Web Proxy)",
      "provider": "openai",
      "model": "gemini-thinking",
      "apiBase": "http://localhost:3000/v1",
      "apiKey": "YOUR_PROXY_API_KEY"
    }
  ]
}
```

> **Security Note:** Replace `YOUR_PROXY_API_KEY` with the key defined in your `.env` file. If running in local development mode without `PROXY_API_KEY`, use any placeholder (e.g. `"sk-continue-local"`).

---

## 3. Verification & Testing

### Test 1: Sidebar Chat
1. Open the Continue side panel (`Ctrl + L` / `Cmd + L`).
2. In the model dropdown at the bottom of the panel, select **Gemini Flash (Web Proxy)**.
3. Submit a prompt:
   ```text
   Explain the difference between synchronous and asynchronous iteration in JavaScript.
   ```
4. Verify that the response streams smoothly into the Continue panel.

### Test 2: Inline Code Editing
1. Highlight a block of code in your editor.
2. Press `Ctrl + I` / `Cmd + I` to open Continue inline edit.
3. Submit an instruction:
   ```text
   Add JSDoc comments to this function.
   ```
4. Continue will propose a diff. Accept or reject the diff to confirm full functionality.

---

## 4. Troubleshooting in Continue

| Issue | Cause | Resolution |
|---|---|---|
| "404 Not Found: POST /v1/completions" | Continue tried to use the proxy for Tab Autocomplete. | Remove the proxy from `tabAutocompleteModel` in `config.yaml` / `config.json`. |
| "Connection error: Failed to fetch" | The proxy server is not running on port 3000. | Start the server with `npm start` and verify `http://localhost:3000/health`. |
| "Incorrect API key provided" (401) | `apiKey` in `config.yaml` does not match `PROXY_API_KEY`. | Align the API key value with the proxy's `.env` configuration. |
| "Image input unsupported" (400) | An image was dragged into Continue chat. | Keep requests text-only; remove image attachments. |
