# Universal AI Agent Infrastructure — Known Limitations & Operational Boundaries

**Date**: 2026-11-24  
**Classification**: Engineering & Deployment Notice  

This document details the verified real-world operational constraints, edge-case behaviors, and architectural trade-offs of the Universal AI Agent Infrastructure. All items listed here reflect actual behaviors verified during the Phase 1 Integration & Reliability Audit.

---

## 1. Gemini Web SDK & Google Backend Constraints

### 1.1 Guest Mode Anonymous Client Quotas
- **Behavior**: In Guest Mode (no `__Secure-1PSID` cookie provided), the proxy generates temporary anonymous session tokens against Google's Gemini Web endpoint.
- **Limitation**: Google applies strict IP-based rate limiting on anonymous sessions during high-traffic periods. Heavy concurrency across multiple IDE instances sharing a single public IP will encounter temporary HTTP 429 or CAPTCHA/challenge gates on Google's side.
- **Mitigation**: Configure Account Mode by providing a valid `GEMINI_SECURE_1PSID` (and optionally `GEMINI_SECURE_1PSIDTS`) in `.env` for sustained high-throughput development sessions.

### 1.2 Function Calling / Tool Schema Enforcement
- **Behavior**: The underlying Gemini Web service is designed primarily as a conversational interface; it does not natively enforce structured JSON Schema function calling at the remote Google model layer.
- **Limitation**: The proxy bridges this gap by injecting DSML instructions and formatting schemas into the system prompt (`[AVAILABLE_TOOLS]`). While standard models (`gemini-flash`, `gemini-pro`, `gemini-thinking`) reliably emit `<tool_call>` blocks for typical programming tasks, complex nested schemas or ambiguous queries may occasionally produce conversational text explaining the tool rather than the strict `<tool_call>` tag.
- **Mitigation**: The `dsmlParser` includes regex fallbacks to salvage malformed or unclosed `<tool_call>` tags, and the `ToolValidator` rejects invalid argument payloads before execution.

### 1.3 Account Cookie Expiration
- **Behavior**: Google session cookies (`__Secure-1PSID`) typically expire after several weeks or upon logging out of the browser session.
- **Limitation**: When a cookie expires, requests will fail with authentication errors.
- **Mitigation**: The `GeminiEngine` includes automatic fallback: if Account Mode client initialization fails, the engine falls back to Guest Mode gracefully to maintain availability, logging a warning to the administrator to refresh the cookie token.

---

## 2. Security & Process Isolation Boundaries

### 2.1 Process Isolation vs. Kernel Namespace Isolation
- **Limitation**: As documented in `docs/SECURITY_AUDIT_REPORT.md`, default local command execution (`TerminalManager`) uses child process spawning with working directory checks. It does **not** provide Linux kernel cgroup resource enforcement, PID namespace isolation, or network namespace restrictions.
- **Operational Rule**: Do not expose the proxy to untrusted external users in default process mode without enabling Docker container isolation (`DOCKER_ISOLATION=true`).

### 2.2 Windows vs. POSIX Shell Nuances
- **Limitation**: On Windows, terminal commands execute via `powershell.exe -NoProfile -Command`, whereas on Linux/macOS they execute via `/bin/bash -c`. Certain Unix-specific commands (e.g. `chmod`, `grep`, `awk`) will fail on Windows unless executed inside WSL or MinGW.
- **Mitigation**: The local runtime provides cross-platform built-in tools (`search_code`, `find_by_name`, `read_file`, `write_file`) that execute purely in Node.js without relying on OS-specific shell binaries.

---

## 3. Streaming & Network Behaviors

### 3.1 HTTP Chunk Buffering in Intermediary Proxies
- **Limitation**: If the proxy is deployed behind an aggressive HTTP reverse proxy (e.g. Nginx with `proxy_buffering on;` or Cloudflare without SSE bypass), Server-Sent Events (SSE) streaming chunks may be buffered until completion, degrading the real-time token experience in IDEs.
- **Mitigation**: The proxy sets `X-Accel-Buffering: no` and `Cache-Control: no-cache` on all `/v1/chat/completions` streaming responses. When deploying behind Nginx, ensure `proxy_buffering off;` is configured for `/v1/`.

### 3.2 Client Abort Propagation
- **Limitation**: When a client (e.g. Cursor or Continue) cancels generation by closing the HTTP socket, the proxy aborts the active Gemini Web stream and tears down temporary resources. However, tokens already in transit over Google's HTTP pipeline cannot be retroactively cancelled on Google's remote servers.

---

## 4. Agent Runtime & Multi-Agent Constraints

### 4.1 Max Iterations Ceiling
- **Limitation**: To prevent infinite autonomous loops and runaway token consumption, `AgentLoop` enforces a strict default maximum of 25 iterations per task run (`maxIterations: 25`). Tasks requiring more steps must be broken into sub-phases or executed via `MultiAgentCoordinator`.

### 4.2 In-Memory Run History Eviction
- **Limitation**: Completed agent runs are tracked in-memory by `AgentOrchestrator` with an LRU capacity cap of 1,000 runs to prevent memory bloat. Persisted facts and artifacts are stored in `PersistentMemory` (`.agent_memory/`), but ephemeral step logs are eventually pruned.

---

## 5. Summary Table

| Category | Constraint | Severity | Recommended Mitigation |
| :--- | :--- | :--- | :--- |
| **Gemini Web** | Anonymous IP Rate Limits | Medium | Use Account Mode (`__Secure-1PSID`) for heavy IDE usage. |
| **Tool Calling** | Prompt-driven DSML parsing | Low | Use well-defined tool schemas; DSML parser regex fallback active. |
| **Security** | Process isolation lacks cgroup caps | Medium | Enable Docker isolation for multi-tenant deployments. |
| **OS** | Windows vs POSIX shell syntax | Low | Prefer built-in FS/Search tools over raw shell scripts. |
| **Networking** | Reverse proxy chunk buffering | Low | Ensure `proxy_buffering off` in external ingress. |
| **Agent** | Max 25 iterations per loop | Low | Decompose large tasks using MultiAgent pipelines. |
