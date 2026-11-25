# Roo Code Integration Guide

This guide details configuring **Roo Code** (an autonomous, multi-mode AI coding extension for VS Code) to use `gemini-web-to-openai-proxy` as its OpenAI-compatible backend.

---

## 1. Overview & Capabilities

Roo Code extends autonomous agent workflows by providing distinct operational modes:
- **Code Mode**: Direct coding, refactoring, and test execution with tool calling.
- **Architect Mode**: High-level system design, technical planning, and codebase analysis.
- **Ask Mode**: Conversational Q&A and documentation review without executing tool side effects.

### Protocol Verification Status
- **Tool Calling**: Fully verified at the API protocol level (Phase 5.0G.2 test suite). Streaming chunks include integer `index` counters and terminate with `finish_reason: "tool_calls"`.
- **Text-Only Guardrail**: Image generation and vision analysis are permanently unsupported. Any request containing image data returns HTTP 400 (`image_input_unsupported`).

---

## 2. Configuration Steps in Roo Code

1. Open VS Code.
2. Click the **Roo Code icon** in the Activity Bar.
3. Click the **Settings (gear icon)** at the top of the Roo Code panel.
4. In the **Provider** dropdown, select **OpenAI Compatible**.
5. Set the provider configuration parameters:
   - **Base URL**:
     ```text
     http://localhost:3000/v1
     ```
   - **API Key**:
     Enter your `PROXY_API_KEY` from `.env` (or a placeholder like `sk-roo-code-local` in development mode).
   - **Model ID**:
     Configure a canonical model ID based on the active mode:
     - For **Code Mode**: `gemini-flash` (fastest iteration) or `gemini-pro` (tools supported).
     - For **Architect Mode**: `gemini-pro` (with tools) or `gemini-thinking` (text-only reasoning).
     - For **Ask Mode**: `gemini-flash`, `gemini-lite`, or `gemini-thinking` (conversational Q&A).
6. Save your settings.

---

## 3. Workflow & Verification

### Test 1: Ask Mode (Conversational)
1. Switch to **Ask Mode** in Roo Code.
2. Ask:
   ```text
   What are the benefits of pure HTTP proxy architecture compared to browser automation?
   ```
3. Roo Code will stream the plain text response without calling any tools.

### Test 2: Code Mode (Tool Calling)
1. Switch to **Code Mode**.
2. Submit an instruction:
   ```text
   Search the codebase for the string "authMiddleware" and report which file defines it.
   ```
3. Roo Code invokes its search tool via OpenAI tool calls, processes the result, and presents the answer in the conversation log.

---

## 4. Text-Only Safety & Best Practices

1. **Avoid Screenshot Commands**: Roo Code should not be instructed to take browser screenshots or inspect UI layouts visually.
2. **Avoid Image Drag-and-Drop**: Never drag images into the Roo Code chat window.
3. **Use Text Diagnostics**: For web inspection, ask Roo Code to inspect raw HTML, CSS, or JSON API payloads via `curl` or file reading instead of visual rendering.

---

## 5. Troubleshooting in Roo Code

| Issue | Cause | Solution |
|---|---|---|
| "image_input_unsupported" | An image or screenshot was included in the prompt. | Retry the prompt with text only. |
| "Connection refused to http://localhost:3000" | Server is down or listening on another port. | Verify proxy is running with `npm start` on port 3000. |
| "Model not found" | Model ID was set to a foreign identifier (e.g. `claude-3-5-sonnet`). | Set Model ID to `gemini-flash`, `gemini-pro`, or `gemini-thinking`. |
| "Streaming interrupted unexpectedly" | Upstream Google Web connection timed out or hit anti-bot challenge. | Check server console logs; ensure valid session cookies if running extensive queries. |
