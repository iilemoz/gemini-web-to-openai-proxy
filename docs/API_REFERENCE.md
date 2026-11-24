# API Reference

Complete reference for all REST, SSE, and JSON-RPC endpoints available in the Universal AI Agent Infrastructure.

---

## Base URLs
- **Standard API**: `http://localhost:3000/v1`
- **Health / Readiness**: `http://localhost:3000/health`, `http://localhost:3000/healthz`
- **Developer Dashboard**: `http://localhost:3000/dashboard`

---

## 1. Core Model & Chat Endpoints

### `GET /health` & `GET /healthz`
Returns system health, status, and uptime.

### `GET /v1/models`
Returns list of available models and aliases in OpenAI format.

### `GET /v1/models/:model`
Returns metadata for a specific model or alias.

### `POST /v1/chat/completions`
OpenAI-compliant chat completions endpoint. Supports:
- Streaming (`stream: true`) via Server-Sent Events (SSE).
- Non-streaming (`stream: false`).
- Tool calling (`tools`, `tool_choice`).
- Request validation and rate-limiting.

### `POST /v1/responses`
OpenAI Responses API compatible endpoint.

---

## 2. Universal Tool Calling Endpoints

### `GET /v1/tools`
Lists all registered tools, their parameter JSON schemas, required permissions, and execution targets (`local`, `cloud`, `both`).

---

## 3. Local Runtime Endpoints

### `GET /v1/runtime/devices`
Lists paired host devices.

### `POST /v1/runtime/devices/pair`
Initiates or completes device pairing token exchange.

### `POST /v1/runtime/devices/:id/revoke`
Revokes an existing paired device token.

### `GET /v1/runtime/sessions`
Lists active workspace runtime sessions.

### `POST /v1/runtime/sessions`
Creates an authorized runtime session bound to a workspace path.

### `DELETE /v1/runtime/sessions/:id`
Terminates a runtime session.

---

## 4. Cloud Runtime Endpoints

### `GET /v1/runtime/cloud/status`
Returns Docker daemon availability and active sandbox count.

### `POST /v1/runtime/cloud/sandboxes`
Provisions a new isolated container sandbox (or process-isolated fallback).

### `POST /v1/runtime/cloud/sandboxes/:id/exec`
Executes an isolated command inside the target sandbox.

### `DELETE /v1/runtime/cloud/sandboxes/:id`
Destroys and cleans up a sandbox.

---

## 5. Agent Orchestrator Endpoints

### `GET /v1/agents`
Returns available agent roles (`Architect`, `Developer`, `Debugger`, `Reviewer`, `Tester`).

### `POST /v1/agent/runs`
Creates a new autonomous agent run.
- Query param `?wait=true`: executes synchronously and returns the completed run report.
- Default: returns HTTP 202 with `run_id` for asynchronous execution.

### `GET /v1/agent/runs`
Lists all active and historical agent runs.

### `GET /v1/agent/runs/:id`
Returns detailed status, execution timeline, memory facts, and tool traces for a run.

### `POST /v1/agent/runs/:id/cancel`
Signals cancellation and halts execution.

### `POST /v1/agent/runs/:id/approve`
Approves or rejects a tool call held in `waiting_for_approval` state.

### `POST /v1/agent/pipeline`
Executes a multi-agent collaborative pipeline passing context across specialized roles.

---

## 6. MCP Protocol Endpoints

### `POST /v1/mcp`
JSON-RPC 2.0 endpoint for external clients connecting to the server via Model Context Protocol.
- Methods: `initialize`, `ping`, `tools/list`, `tools/call`.

### `GET /v1/mcp/servers`
Lists connected external MCP servers and imported tools.
