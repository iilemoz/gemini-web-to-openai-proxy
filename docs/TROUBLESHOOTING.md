# Troubleshooting & Diagnostics

Common issues, diagnostics, and solutions.

---

## 1. Diagnostics Tool

Run built-in project diagnostics via terminal or ToolDispatcher:
```bash
npm test
```
Or query `/v1/tools` to verify `run_diagnostics` is active.

---

## 2. Common Scenarios

### "Tool execution timed out"
- By default, tools have execution timeouts (30-60s) to prevent stalled shell commands.
- For long-running scripts, increase `timeoutMs` in the tool argument or runtime config.

### "Rate limit exceeded (HTTP 429)"
- The proxy includes built-in rate limiting. Check the `Retry-After` header and wait for the window reset or increase `RATE_LIMIT_MAX_REQUESTS` in your `.env`.

### "Security Exception: Access denied to path outside authorized workspace"
- The path being accessed is outside `WorkspaceManager` authorized roots.
- Add the root folder in `config.js` or via `sessionManager.createSession({ workspacePath })`.

### "Docker is unavailable"
- The Cloud Runtime will automatically fall back to Process Isolation mode without crashing.
- To enable Docker sandboxing, ensure Docker Desktop / dockerd is running.
