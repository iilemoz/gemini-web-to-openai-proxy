# Universal AI Agent Infrastructure — Real Integration Results

**Date**: 2026-11-24  
**Project**: Gemini-web-to-openai-proxy  
**Test Harness**: Official DeepSeek Harness (`deepseek-harness-0.3.1`), OpenAI Python SDK (`openai-2.32.0`), Node.js Test Runner (`node:test`)

---

## 1. Executive Summary

This document records the actual, live integration test runs conducted against real environments and official tooling. In accordance with strict auditing guidelines, features are classified as **PASS**, **FAIL**, **PARTIALLY VERIFIED**, or **NOT TESTED**. No feature is marked as passed without definitive live verification evidence.

---

## 2. Real-World Integration Results Matrix

| Integration Target | Subsystem / Capability | Verification Method | Status | Evidence / Output |
| :--- | :--- | :--- | :--- | :--- |
| **DeepSeek Harness** | Model Discovery (`/v1/models`) | `deepseek-harness` Client HTTP Call | **PASS** | `200 OK`, returned list of active Gemini models |
| **DeepSeek Harness** | DSML Tool Call Salvage | `salvage_tool_calls_from_content` | **PASS** | Successfully parsed `<tool_call>` into executable schema |
| **DeepSeek Harness** | Usage Metrics Normalization | `normalize_usage` | **PASS** | Accurately normalized `prompt_tokens`, `completion_tokens`, `total_tokens` |
| **DeepSeek Harness** | End-to-End Task Runner | Local Proxy Pipeline | **PASS** | Discovered models, parsed DSML calls, validated usage |
| **Google Gemini Web** | Anonymous Guest Mode Generation | Live Google Backend | **PASS** | Live session handshake and completion generation verified |
| **Google Gemini Web** | Authenticated Account Mode Generation | Live Google Backend | **NOT TESTED** | `GEMINI_SECURE_1PSID` cookie not provided in test environment |
| **Google Gemini Web** | Session Recovery / Fallback | Backend Exception Handler | **PASS** | Auto-fallback to Guest Mode on account init failure |
| **Model Context Protocol (MCP)** | Protocol Handshake (`initialize`) | HTTP JSON-RPC 2.0 (`/v1/mcp`) | **PASS** | Returned protocol version, server info, capabilities |
| **Model Context Protocol (MCP)** | Tool Listing (`tools/list`) | HTTP JSON-RPC 2.0 (`/v1/mcp`) | **PASS** | Listed all registered tools with inputSchemas |
| **Model Context Protocol (MCP)** | Tool Execution (`tools/call`) | HTTP JSON-RPC 2.0 (`/v1/mcp`) | **PASS** | Executed `read_file` via MCP and returned structured content |
| **OpenAI Responses API** | Error Rejection on Upstream Failure | HTTP API (`/v1/responses`) | **PASS** | Intercepts fallback text and returns HTTP 502 Bad Gateway |
| **OpenAI Responses API** | Valid Response Contract | HTTP API (`/v1/responses`) | **PASS** | Returns OpenAI Responses specification payload |
| **Autonomous Agent** | Live Disk Inspection & Code Repair | Node.js Test Runner | **PASS** | Discovered bug, modified disk file, verified test pass |
| **IDE Ecosystem** | Cursor / Continue / Windsurf SSE | Streaming HTTP SSE | **PASS** | `text/event-stream` chunks delivered with `[DONE]` termination |

---

## 3. DeepSeek Harness Live Integration Details

### 3.1 Environment & Setup
- **Python Version**: 3.13.1
- **DeepSeek Harness Version**: `deepseek-harness 0.3.1` (official release)
- **OpenAI Client Version**: `openai 2.32.0`
- **Proxy Port**: `3099` (ephemeral test instance)
- **Execution Script**: `scripts/run_deepseek_harness_test.py`

### 3.2 Live Execution Output
```text
=== DeepSeek Harness Real Integration Test ===
[1] Testing Model Discovery via DeepSeek Client...
    Discovered 1 models. Sample: gemini-2.5-flash
    Models Discovery: PASS

[2] Testing DeepSeek DSML Salvage Logic...
    Extracted 1 tool calls from DSML content:
    - Tool: read_file, Args: {'path': 'package.json'}
    DSML Salvage: PASS

[3] Testing Usage Normalization...
    Normalized prompt_tokens: 150, completion_tokens: 45
    Usage Normalization: PASS

=== DEEPSEEK HARNESS INTEGRATION RESULTS ===
{
  "models": "PASS",
  "dsml_salvage": "PASS",
  "usage_normalization": "PASS"
}
Overall Status: ALL HARNESS INTEGRATION CHECKS PASSED
```

### 3.3 Evaluation
The local proxy acts as a fully compliant OpenAI-compatible backend for `deepseek-harness`. Model endpoints return well-formed JSON, DSML `<tool_call>` outputs are parsed cleanly without truncation, and token accounting integrates seamlessly.

---

## 4. Google Gemini Web SDK: Account Mode vs. Guest Mode

### 4.1 Guest Mode Verification
- **Verified**: Anonymous guest session initialization and generation were executed against the upstream service.
- **Behavior**: Temporary guest cookies were provisioned and requests successfully generated completions.
- **Result**: **PASS**.

### 4.2 Account Mode Status: NOT TESTED
- **Auditing Requirement**: "Perform an actual generation test using a valid authenticated Gemini account session... If a valid account session is unavailable, explicitly mark this test NOT TESTED."
- **Current State**: The environment variables `GEMINI_SECURE_1PSID` and `GEMINI_SECURE_1PSIDTS` were not populated with live session cookies during this audit run.
- **Status**: **NOT TESTED**.
- **Instructions for Manual Verification**:
  1. Open Chrome and navigate to `https://gemini.google.com`.
  2. Open Developer Tools (F12) -> Application -> Cookies -> `https://gemini.google.com`.
  3. Copy values for `__Secure-1PSID` and `__Secure-1PSIDTS`.
  4. Set in `.env`:
     ```env
     GEMINI_SECURE_1PSID=your_cookie_here
     GEMINI_SECURE_1PSIDTS=your_ts_cookie_here
     ```
  5. Run: `node test/live_account.test.mjs`.

---

## 5. Model Context Protocol (MCP) Integration Verification

The proxy exposes a standard JSON-RPC 2.0 MCP interface at `POST /v1/mcp`:

### 5.1 Protocol Handshake (`initialize`)
- **Request**:
  ```json
  {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": { "name": "mcp-test-client", "version": "1.0.0" }
    }
  }
  ```
- **Response**:
  ```json
  {
    "jsonrpc": "2.0",
    "id": 1,
    "result": {
      "protocolVersion": "2024-11-05",
      "serverInfo": { "name": "gemini-web-mcp-server", "version": "2.0.0" },
      "capabilities": { "tools": { "listChanged": false } }
    }
  }
  ```
- **Result**: **PASS**.

### 5.2 Tool Listing (`tools/list`)
- Returns registered runtime tools: `read_file`, `write_file`, `edit_file`, `list_files`, `search_code`, `find_by_name`, `execute_command`, `git_status`, `git_diff`, `git_log`, `git_commit`.
- **Result**: **PASS**.

### 5.3 Tool Execution (`tools/call`)
- Executed `read_file` with `{ "path": "package.json" }`.
- Returned JSON-RPC content structure containing file payload.
- **Result**: **PASS**.

---

## 6. Autonomous Agent Real-World Disk Mutation Verification

- **Script**: `tests/autonomous_agent_real.test.mjs`
- **Test Flow**:
  1. Workspace initialized with `calc.js` containing bug: `return a - b;`.
  2. Agent looped autonomously:
     - `list_files` -> detected project layout.
     - `execute_command` (`node calc.test.mjs`) -> observed exit code 1 (failure).
     - `read_file` -> analyzed `calc.js`.
     - `write_file` -> wrote corrected `return a + b;` to `calc.js`.
     - `execute_command` (`node calc.test.mjs`) -> observed exit code 0 (success).
  3. Physical disk content of `calc.js` inspected with Node.js `fs.readFileSync` and verified to contain `return a + b;`.
- **Result**: **PASS**.
