# Universal AI Agent Infrastructure — Known Limitations & Operational Boundaries

**Date**: 2026-11-24  
**Classification**: Engineering & Deployment Notice  

This document details the verified real-world operational constraints, edge-case behaviors, and architectural trade-offs of the Universal AI Agent Infrastructure. All items listed here reflect actual behaviors verified during the Phase 1 and Phase 1.1 Integration & Reliability Audits.

---

## 1. Gemini Web SDK & Google Backend Constraints

### 1.1 Guest Mode Anonymous Client Quotas
- **Behavior**: In Guest Mode (no `__Secure-1PSID` cookie provided), the proxy generates temporary anonymous session tokens against Google's Gemini Web endpoint.
- **Limitation**: Google applies IP-based rate limiting on anonymous sessions during high-traffic periods. Heavy concurrency across multiple IDE instances sharing a single public IP will encounter temporary HTTP 429 or CAPTCHA/challenge gates on Google's side.
- **Mitigation**: Configure Account Mode by providing a valid `GEMINI_SECURE_1PSID` (and optionally `GEMINI_SECURE_1PSIDTS`) in `.env` for sustained high-throughput development sessions.

### 1.2 Upstream Fallback Error Messages (Resolved via Upstream Error Guard)
- **Behavior**: Google Gemini Web occasionally emits natural language fallback strings (e.g. `"I seem to be encountering an error. Can I try something else for you?"`) rather than raising HTTP-level exceptions when safety filters or internal models stall.
- **Limitation**: If unintercepted, clients receive HTTP 200 containing confusing conversational error text.
- **Mitigation**: The proxy integrates `src/utils/upstreamErrors.js` in `responsesController` and `chatController`. Any response matching known upstream fallback error patterns is intercepted and returned as HTTP 502 Bad Gateway (`type: "upstream_error"`).

### 1.3 Account Mode Cookie Expiration
- **Behavior**: Google session cookies (`__Secure-1PSID`) typically expire after several weeks or upon logging out of the browser session.
- **Limitation**: When a cookie expires, requests will fail with authentication errors.
- **Status in Testing**: During automated auditing runs where live credentials are not provided, Account Mode is classified strictly as **NOT TESTED**.
- **Mitigation**: The `GeminiEngine` includes automatic fallback: if Account Mode client initialization fails, the engine falls back to Guest Mode gracefully to maintain availability, logging a warning to the administrator to refresh the cookie token.

---

## 2. Security & Process Isolation Boundaries

### 2.1 Process Isolation vs. Kernel Namespace Isolation
- **Limitation**: As documented in `docs/SECURITY_AUDIT_REPORT.md`, default local command execution (`TerminalManager`) uses child process spawning with working directory checks. It does **not** provide Linux kernel cgroup resource enforcement, PID namespace isolation, or network namespace restrictions.
- **Operational Rule**: Do not expose the proxy to untrusted external users in default process mode without enabling Docker container isolation (`DOCKER_ISOLATION=true`).

### 2.2 Windows NTFS Junctions & Symlink Behavior
- **Limitation**: On Windows, creating symbolic links requires elevated Administrator privileges or Windows Developer Mode enabled. NTFS directory junctions can be created without elevation.
- **Mitigation**: `WorkspaceManager.js` uses `fs.realpathSync` to resolve both NTFS junctions and POSIX symlinks down to their canonical physical storage path, blocking any junction or symlink pointing outside authorized roots.

### 2.3 Windows vs. POSIX Shell Nuances
- **Limitation**: On Windows, terminal commands execute via `powershell.exe -NoProfile -Command`, whereas on Linux/macOS they execute via `/bin/bash -c`. Certain Unix-specific commands (e.g. `chmod`, `grep`, `awk`) will fail on Windows unless executed inside WSL or MinGW.
- **Mitigation**: The local runtime provides cross-platform built-in tools (`search_code`, `find_by_name`, `read_file`, `write_file`) that execute purely in Node.js without relying on OS-specific shell binaries.

---

## 3. Streaming & Network Protocols

### 3.1 HTTP Chunk Buffering in Intermediary Proxies
- **Limitation**: If the proxy is deployed behind an aggressive HTTP reverse proxy (e.g. Nginx with `proxy_buffering on;` or Cloudflare without SSE bypass), Server-Sent Events (SSE) streaming chunks may be buffered until completion, degrading the real-time token experience in IDEs.
- **Mitigation**: The proxy sets `X-Accel-Buffering: no` and `Cache-Control: no-cache` on all `/v1/chat/completions` streaming responses. When deploying behind Nginx, ensure `proxy_buffering off;` is configured for `/v1/`.

### 3.2 WebSocket Protocol Support
- **Limitation**: The system does not operate a WebSocket server. IDE integrations and agent telemetry utilize standard HTTP SSE (`text/event-stream`) and REST JSON endpoints. Clients requiring raw WebSocket connections must use SSE-to-WebSocket adapters.

---

## 4. Agent Runtime & Multi-Agent Constraints

### 4.1 Max Iterations Ceiling
- **Limitation**: To prevent infinite autonomous loops and runaway token consumption, `AgentLoop` enforces a strict default maximum of 25 iterations per task run (`maxIterations: 25`). Tasks requiring more steps must be broken into sub-phases or executed via `MultiAgentCoordinator`.

### 4.2 In-Memory Run History Eviction
- **Limitation**: Completed agent runs are tracked in-memory by `AgentOrchestrator` with an LRU capacity cap of 1,000 runs to prevent memory bloat. Persisted facts and artifacts are stored in `PersistentMemory` (`.agent_memory/`), but ephemeral step logs are eventually pruned.

---

## 5. Summary Table

| Category | Constraint | Severity | Verified Mitigation |
| :--- | :--- | :--- | :--- |
| **Gemini Web** | Anonymous IP Rate Limits | Medium | Use Account Mode (`__Secure-1PSID`) for heavy IDE usage. |
| **Gemini Web** | Upstream Error Masking | High | Intercepted by `upstreamErrors.js` -> HTTP 502 Bad Gateway. |
| **Gemini Web** | Account Mode Status | Low | Marked `NOT TESTED` when credentials absent; auto-fallback to Guest. |
| **Tool Calling** | Prompt-driven DSML parsing | Low | Use well-defined tool schemas; DSML parser regex fallback active. |
| **Security** | Process isolation lacks cgroup caps | Medium | Enable Docker isolation for multi-tenant deployments. |
| **Security** | Symlink / Junction directory escape | High | Defended via `fs.realpathSync` path authorization check. |
| **OS** | Windows vs POSIX shell syntax | Low | Prefer built-in FS/Search tools over raw shell scripts. |
| **Networking** | Reverse proxy chunk buffering | Low | Ensure `proxy_buffering off` in external ingress. |
| **Agent** | Max 25 iterations per loop | Low | Decompose large tasks using MultiAgent pipelines. |
