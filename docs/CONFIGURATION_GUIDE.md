# Cross-Platform Configuration & Environment Hardening Guide

**Project:** `gemini-web-to-openai-proxy`  
**Phase:** 5.0H.4.3 — Cross-Platform Production Configuration & Hardening  
**Scope:** Unified configuration for Local Windows Workstation & Linux VPS Server  

---

## 1. Overview & Architecture Principle

The `gemini-web-to-openai-proxy` utilizes a **single portable codebase** across all deployment environments. No separate forks or platform-divergent implementations are maintained.

All application logic—including OpenAI v1 route compatibility, the Google Gemini canonical model registry (`gemini-flash`, `gemini-pro`, `gemini-thinking`, `gemini-lite`), text-only enforcement, tool calling translation, streaming SSE lifecycle, and error mapping—is 100% identical on Windows and Linux.

Environment-specific behavior is governed strictly through runtime configuration profiles configured via environment variables and `.env`.

---

## 2. Supported Deployment Profiles

### Profile A — Local Windows Workstation (Direct Node.js / IDE Integration)
* **Target Audience:** Developers running the proxy locally to power VS Code extensions (**Continue**, **Cline**, **Roo Code**).
* **Runtime Environment:** `NODE_ENV=development`
* **Network Binding:** `HOST=127.0.0.1`, `PORT=3000` (Loopback only; never exposed directly to external networks).
* **Authentication:** `PROXY_API_KEY` is optional. If left empty, local requests from `127.0.0.1` proceed in open development mode with an operational warning. If configured, token matching is enforced.
* **CORS:** Defaults to `*` to allow local web/IDE developer tools to communicate smoothly.
* **Secret Storage:** Secured on local workstation filesystem using NTFS Access Control Lists (ACLs).

### Profile B — Remote Linux VPS / Cloud Server (Behind Reverse Proxy)
* **Target Audience:** Dedicated Linux VPS or cloud instance serving remote client connections securely.
* **Runtime Environment:** `NODE_ENV=production`
* **Network Binding:** `HOST=127.0.0.1`, `PORT=3000` (Bound to loopback behind a local reverse proxy such as Nginx or Caddy with TLS termination).
* **Authentication:** `PROXY_API_KEY` is **MANDATORY** and must be **>= 16 characters**. If missing or too short, the application refuses to start or fails closed (HTTP 500 `missing_production_api_key`).
* **CORS:** Browser cross-origin requests are denied unless explicitly whitelisted via `CORS_ORIGIN`. Non-browser IDE clients (which do not send an `Origin` header) are permitted unconditionally.
* **Secret Storage:** Environment files owned by dedicated unprivileged service account with POSIX `chmod 600` permissions.

---

## 3. Verified Environment Variable Inventory

Every environment variable consumed by the application core is cataloged below:

| Environment Variable | Actual Consumer | Default Value | Validation Rule | Required In Profile | Sensitive / Secret |
|---|---|---|---|---|---|
| `NODE_ENV` | `config/index.js`, `validator.js`, `auth.js`, `corsConfig.js` | `'development'` | String (`development`, `production`, `test`) | Recommended in both | No |
| `PORT` | `config/index.js`, `validator.js`, `server.js` | `3000` | Integer (1–65535) | Optional (default 3000) | No |
| `HOST` | `config/index.js`, `validator.js`, `server.js` | `127.0.0.1` | Non-empty string / valid IP | Recommended (`127.0.0.1`) | No |
| `DEFAULT_MODEL` | `config/index.js`, `chatController.js`, `responsesController.js` | `'gemini-flash'` | Canonical model alias | Optional | No |
| `PROXY_API_KEY` | `config/index.js`, `validator.js`, `auth.js`, `logger.js` | `''` (empty) | In prod: trimmed length >= 16 chars | **MANDATORY in Profile B** (Optional in A) | **YES (Masked in logs)** |
| `GEMINI_SECURE_1PSID` | `config/index.js`, `GeminiEngine.js`, `logger.js` | `''` (empty) | String cookie token | Required for Account Mode | **YES (Masked in logs)** |
| `GEMINI_SECURE_1PSIDTS` | `config/index.js`, `GeminiEngine.js`, `logger.js` | `''` (empty) | String cookie token | Required for Account Mode | **YES (Masked in logs)** |
| `GEMINI_SECURE_1PSIDCC` | `config/index.js`, `GeminiEngine.js`, `logger.js` | `''` (empty) | String cookie token | Required for Account Mode | **YES (Masked in logs)** |
| `ALLOW_COOKIE_PASSTHROUGH` | `config/index.js`, `auth.js` | `false` | Boolean (`'true'` / `'false'`) | Optional | No |
| `CORS_ORIGIN` | `config/index.js`, `corsConfig.js` | `'*'` | String (origin URL or list or `*`) | Optional | No |
| `RATE_LIMIT_ENABLED` | `config/index.js`, `rateLimiter.js` | `true` | Boolean (`'true'` / `'false'`) | Optional | No |
| `RATE_LIMIT_MAX` | `config/index.js`, `rateLimiter.js`, `validator.js` | `120` | Positive integer | Optional | No |
| `RATE_LIMIT_WINDOW_MS` | `config/index.js`, `rateLimiter.js`, `validator.js` | `60000` | Integer >= 1000ms | Optional | No |
| `UPSTREAM_CONNECT_TIMEOUT_MS`| `config/index.js`, `validator.js`, `GeminiEngine.js` | `15000` | Integer (1000ms–86400000ms) | Optional | No |
| `REQUEST_TIMEOUT_MS` | `config/index.js`, `validator.js`, `chatController.js` | `120000` | Integer (1000ms–86400000ms) | Optional | No |
| `STREAMING_IDLE_TIMEOUT_MS` | `config/index.js`, `validator.js`, `chatController.js` | `60000` | Integer (1000ms–86400000ms) | Optional | No |
| `SHUTDOWN_TIMEOUT_MS` | `config/index.js`, `validator.js`, `server.js` | `30000` | Integer (1000ms–86400000ms) | Optional | No |
| `RETRY_MAX_ATTEMPTS` | `config/index.js`, `retry.js` | `3` | Integer >= 0 | Optional | No |
| `RETRY_INITIAL_DELAY_MS` | `config/index.js`, `retry.js` | `500` | Integer >= 0 | Optional | No |
| `RETRY_MAX_DELAY_MS` | `config/index.js`, `retry.js` | `8000` | Integer >= 0 | Optional | No |
| `RETRY_JITTER` | `config/index.js`, `retry.js` | `true` | Boolean (`'true'` / `'false'`) | Optional | No |
| `HTTPS_PROXY` / `HTTP_PROXY` | `config/index.js`, `validator.js`, `GeminiEngine.js` | `''` (empty) | Valid HTTP/HTTPS/SOCKS URL | Optional | No |
| `DEBUG` | `config/index.js`, `logger.js` | `false` | Boolean (`'true'` / `'false'`) | Optional | No |

---

## 4. Authentication Specifications

1. **Production Mode (`NODE_ENV=production`):**
   * If `PROXY_API_KEY` is not configured or is whitespace, startup validation rejects initialization with code 1.
   * If an unauthenticated request reaches protected routes without a configured key, auth middleware responds with HTTP 500 (`missing_production_api_key`).
   * Supported authentication headers:
     - `Authorization: Bearer <PROXY_API_KEY>`
     - `x-api-key: <PROXY_API_KEY>`
   * Token comparison uses constant-time comparison via Node.js `crypto.timingSafeEqual()` on SHA-256 digests to prevent timing side-channel attacks.
   * If token is invalid or missing: HTTP 401 (`invalid_api_key`).

2. **Development Mode (`NODE_ENV=development`):**
   * If `PROXY_API_KEY` is empty, requests are admitted with an operational console log warning.
   * If `PROXY_API_KEY` is configured in `.env`, the key is enforced strictly.

3. **Separation from Upstream Session Credentials:**
   * `PROXY_API_KEY` controls client access to the proxy gateway.
   * `GEMINI_SECURE_1PSID`, `GEMINI_SECURE_1PSIDTS`, and `GEMINI_SECURE_1PSIDCC` control the gateway's session with Google Gemini Web.
   * If Google Gemini session credentials expire, the proxy returns HTTP 502 (`gemini_session_expired`), never confusing client proxy authentication with upstream authentication.

---

## 5. CORS Configuration Specifications

* **Non-Browser Clients (IDE Extensions):**
  Extensions like **Continue**, **Cline**, and **Roo Code** (as well as curl and backend microservices) do not send browser `Origin` headers. These requests are allowed unconditionally in both development and production.

* **Browser Clients in Development:**
  When `NODE_ENV !== 'production'`, `CORS_ORIGIN` defaults to `*` to allow rapid web development.

* **Browser Clients in Production:**
  * When `CORS_ORIGIN` is configured as a comma-separated list of origins (e.g. `https://ide.company.internal`), only exact matches are granted `Access-Control-Allow-Origin`.
  * When `CORS_ORIGIN` is empty or unset, cross-origin browser requests are denied.
  * Wildcard `*` is supported with `credentials: false`.

---

## 6. Secret Redaction & Protection Guidelines

### Automated Log Redaction
The integrated logging utility (`src/utils/logger.js`) automatically sanitizes all log outputs:
* Values matching `PROXY_API_KEY`, `GEMINI_SECURE_1PSID`, `GEMINI_SECURE_1PSIDTS`, and `GEMINI_SECURE_1PSIDCC` are replaced with `[REDACTED_SECRET]`.
* Header keys (`authorization`, `x-api-key`, `x-gemini-cookie`, `cookie`, `set-cookie`) are replaced with `[REDACTED_HEADER]`.
* Error objects and stack traces are recursively scanned and redacted.

### File Permissions & Secret Storage

* **Windows Workstation:**
  Protect `.env` file permissions using NTFS access controls:
  ```powershell
  icacls .env /inheritance:r /grant:r "${env:USERNAME}:(R,W)"
  ```

* **Linux VPS:**
  Ensure `.env` file is owned by the unprivileged application service user:
  ```bash
  chown gemini-proxy:gemini-proxy /opt/gemini-proxy/.env
  chmod 600 /opt/gemini-proxy/.env
  ```

* **Version Control:**
  `.env` is listed in `.gitignore` and must never be staged or committed. Use `.env.example` as the canonical reference template.
