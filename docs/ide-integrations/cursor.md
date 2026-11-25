# Cursor Integration Guide

This guide details configuring **Cursor IDE** (AI-powered code editor) to use `gemini-web-to-openai-proxy` as a custom OpenAI-compatible provider.

---

## 1. Overview & Capabilities

Cursor allows configuring a custom OpenAI API Key and overriding the OpenAI Base URL. When pointed to this proxy, Cursor routes chat and composer requests to Google Gemini Web models.

### What Works
- **Cursor Chat (`Ctrl + L` / `Cmd + L`)**: Interactive code discussions and multi-turn conversations with real-time SSE token streaming.
- **Cursor Composer (`Ctrl + I` / `Cmd + I`)**: Multi-file code generation and editing using streaming completions.
- **Model Selection**: Switch between `gemini-flash`, `gemini-pro`, `gemini-thinking`, and `gemini-lite`.

### Limitations & Caveats
- **Cursor Tab Autocomplete**: Cursor's inline tab autocomplete uses Cursor's internal cloud service and custom low-latency models. It does **not** route through custom OpenAI base URL overrides.
- **Text-Only Operation**: Cursor Chat allows dropping images and screenshots. Because this proxy is strictly text-only, attaching images will result in an HTTP 400 error (`image_input_unsupported`). Always keep requests text-only.
- **Agent Tool Execution**: Cursor's Composer Agent mode manages file operations on the client side. Standard streaming tool calling protocol is fully implemented by the proxy (GAP-01/02/04 aligned), but Cursor's proprietary agent loop may execute commands directly in Cursor rather than calling OpenAI function definitions.

---

## 2. Configuration Steps

### Step 1: Start the Proxy
Ensure your proxy server is running locally:
```bash
npm start
```
By default, the server listens on `http://127.0.0.1:3000` (or `http://localhost:3000`).

### Step 2: Open Cursor Settings
1. Press `Ctrl + Shift + J` (Windows / Linux) or `Cmd + Shift + J` (macOS).
2. Alternatively, click the Gear icon in the top right corner of Cursor and select **Cursor Settings**.
3. In the left navigation menu, click **Models**.

### Step 3: Configure OpenAI Provider
1. Scroll down to the **OpenAI API Key** section.
2. **API Key**:
   - If you set `PROXY_API_KEY` in your `.env` file, enter that exact key (e.g. `YOUR_PROXY_API_KEY`).
   - If running in local development mode without `PROXY_API_KEY`, enter any non-empty string (e.g. `sk-local-gemini-proxy`), as Cursor requires a non-empty string to enable the section.
3. Click the toggle to enable the OpenAI API Key.

### Step 4: Override OpenAI Base URL
1. Expand **More Settings** or locate the **Override OpenAI Base URL** field.
2. Enter:
   ```text
   http://localhost:3000/v1
   ```
   *(Note: `http://127.0.0.1:3000/v1` is also supported).*
3. Click **Save** or press Enter.

### Step 5: Add Canonical Gemini Models
Cursor defaults to showing OpenAI models (`gpt-4o`, `gpt-4o-mini`, etc.). Since this proxy only routes Gemini Web models, foreign models will fail closed with HTTP 404 (`model_not_found`).

1. Under the **Model Names** list, click **+ Add Model**.
2. Add each canonical model ID:
   - `gemini-flash` (Recommended for fast general chat & editing)
   - `gemini-pro` (Recommended for complex architectural reasoning)
   - `gemini-thinking` (Deep chain-of-thought analysis)
   - `gemini-lite` (Lightweight low-latency queries)
3. Disable or toggle off default OpenAI models (`gpt-4o`, `gpt-4`, `claude-*`) so they are not accidentally selected.

---

## 3. Verification & Testing

### Test 1: Basic Chat Completion
1. Open Cursor Chat (`Ctrl + L` / `Cmd + L`).
2. Ensure the model dropdown displays `gemini-flash`.
3. Type:
   ```text
   Hello! Please respond with: "Gemini Web Proxy is connected to Cursor."
   ```
4. Verify that the response streams back in real time.

### Test 2: Code Refactoring via Composer
1. Open Composer (`Ctrl + I` / `Cmd + I`).
2. Select `gemini-flash` or `gemini-pro`.
3. Provide an instruction:
   ```text
   Write a JavaScript function to reverse words in a string with unit test examples.
   ```
4. Verify that code is generated cleanly with standard markdown syntax.

---

## 4. Troubleshooting in Cursor

| Symptom | Cause | Solution |
|---|---|---|
| "Connection Refused" | Proxy server is not running on port 3000. | Run `npm start` and verify `http://localhost:3000/health`. |
| "Model not found" (HTTP 404) | Cursor tried to call a non-Gemini model (e.g. `gpt-4o`). | Ensure `gemini-flash` or `gemini-pro` is selected in the model picker. |
| "Invalid API Key" (HTTP 401) | `PROXY_API_KEY` is set in `.env` but does not match Cursor's key. | Update the OpenAI API Key in Cursor settings to match `PROXY_API_KEY`. |
| "Image input unsupported" (HTTP 400) | An image, screenshot, or drag-and-drop file was attached. | Remove the image; this proxy supports text-only requests. |
