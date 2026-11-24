# Security & Permission Architecture

Security and isolation are core principles of the Universal AI Agent Infrastructure.

---

## 1. Authentication Separation
- **Proxy Authentication**: Enforced via `PROXY_API_KEY` header (`Authorization: Bearer <key>`).
- **Gemini Web Cookies**: Managed independently via `x-gemini-cookie` or server environment variables (`GEMINI_COOKIE_1PSID`, `GEMINI_COOKIE_1PSIDTS`).
- **Zero Token Leakage**: The proxy never exposes or reflects upstream Google account cookies to connecting IDE clients.

---

## 2. Path Traversal Guard
The `WorkspaceManager` resolves all target paths against authorized workspace root folders.
Attempts to read, write, or delete files outside authorized boundaries (such as `../../etc/passwd` or `..\..\Windows`) are rejected with an explicit security exception.

---

## 3. Sandboxing & Process Isolation
- Docker container execution enforces memory and CPU limits and disabled network access (`--network none`) for untrusted tasks.
- Terminal commands are restricted to configured workspace working directories with execution timeouts to prevent hanging processes.
