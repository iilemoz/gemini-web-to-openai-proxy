# Cline (Autonomous Coding Agent) Integration Guide

This guide details configuring **Cline** (formerly Claude Dev) in Visual Studio Code / Cursor to use `gemini-web-to-openai-proxy` as its AI backend.

---

## 1. Overview & Tool Calling Alignment

Cline is an autonomous coding agent that executes terminal commands, reads and writes files, inspects project directories, and orchestrates complex development tasks.

### Protocol Support
- **OpenAI-Compatible Tool Calling**: Cline sends tool definitions (`execute_command`, `read_file`, `write_to_file`, `list_files`, etc.) in the OpenAI standard `tools` array.
- **Streaming Tool Execution**: In Phase 5.0G.2, the proxy aligned its streaming tool-calling protocol (GAP-01, GAP-02, GAP-04):
  - Emits integer `index` (`0, 1, 2...`) on each tool call delta chunk.
  - Terminates the stream with a dedicated empty delta chunk carrying `finish_reason: "tool_calls"`.
  - Supports multi-turn interaction loops: Round 1 (Tool Call) -> Cline Execution -> Round 2 (Tool Result with `role: "tool"`).

### Critical Constraint: Text-Only Guardrail
> **WARNING: Strictly Text-Only**  
> Cline includes browser automation and screenshot capture capabilities.  
> This proxy is **strictly text-only** and permanently rejects images with HTTP 400 (`image_input_unsupported`).  
> **Do NOT ask Cline to capture screenshots, inspect browser images, or review graphical assets.** When prompted to interact with the browser, instruct Cline to perform text-based inspections (e.g. `curl`, CLI diagnostics) rather than visual inspections.

---

## 2. Configuration Steps in Cline

1. Open VS Code or Cursor.
2. Click the **Cline robot icon** in the primary Activity Bar (left or right pane).
3. Click the **Settings (gear icon)** at the top right of the Cline panel.
4. Configure the following fields:
   - **API Provider**: Select `OpenAI Compatible`.
   - **Base URL**: Enter `http://localhost:3000/v1` (or `http://127.0.0.1:3000/v1`).
   - **API Key**: Enter your `PROXY_API_KEY` (or any non-empty string like `sk-cline-local` in open development mode).
   - **Model ID**: Enter a canonical model identifier:
     - `gemini-flash` *(Recommended for fast, low-cost autonomous tool iteration)*
     - `gemini-pro` *(Recommended for complex code architecture and debugging)*
     - `gemini-thinking` *(Extended reasoning)*
5. Optional Settings:
   - **Custom Instructions**:
     ```text
     You are an autonomous software engineer. Maintain concise explanations and focus on accurate tool execution. Never attempt to capture screenshots or send images.
     ```
6. Click **Done** / Save.

---

## 3. Recommended Workflow & Verification

### Step 1: Start a New Task
In the Cline chat input, enter an autonomous task:
```text
Inspect the package.json file in this workspace and tell me the project name, version, and main dependencies.
```

### Step 2: Observe the Tool Execution Loop
1. **Tool Invocation**: Cline will receive a tool call from the proxy:
   ```json
   {
     "name": "read_file",
     "arguments": "{\"path\":\"package.json\"}"
   }
   ```
2. **Approval & Execution**: Cline prompts you for permission to run `read_file` (or auto-approves if configured).
3. **Multi-Turn Submission**: Cline executes the file read locally and sends the tool output back to the proxy in a follow-up request (`role: "tool"`).
4. **Final Response**: The proxy receives the tool result, feeds it to Gemini, and streams the final answer back to the Cline UI.

---

## 4. Troubleshooting in Cline

| Issue | Cause | Solution |
|---|---|---|
| "Failed to process request: image_input_unsupported" | Cline attempted to send a screenshot or image file. | Instruct Cline: *"Do not take screenshots. Perform a text-based terminal check instead."* |
| "Connection error: connect ECONNREFUSED" | Proxy server is not running on port 3000. | Start the proxy server using `npm start` and verify `http://localhost:3000/health`. |
| "Model not found" (HTTP 404) | A non-Gemini model ID was entered (e.g. `gpt-4o`, `claude-3-5-sonnet`). | Set Model ID to `gemini-flash` or `gemini-pro` in Cline settings. |
| "Invalid API key" (HTTP 401) | Mismatch between Cline's API key and the server's `PROXY_API_KEY`. | Align the keys in `.env` and Cline settings. |
| Tool call JSON parse error | Gemini generated malformed tool syntax. | Ensure proxy is running the hardened Phase 5.0G.2 release with regex fallbacks. |
