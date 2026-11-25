# Security, Authentication & Session Privacy Guide

This guide details the security model of `gemini-web-to-openai-proxy`, including proxy gateway authentication, host exposure risks, secret management, and the safe handling of Google Web session credentials.

---

## 1. Proxy Authentication Model

The proxy implements a two-tier authentication architecture:

```text
Client (IDE) ──[ Tier 1: PROXY_API_KEY ]──> Proxy Server ──[ Tier 2: Google Session ]──> Google Gemini Web
```

### Tier 1: Proxy Gateway Protection (`PROXY_API_KEY`)
- Protects the local or remote proxy server against unauthorized access.
- Supported Headers:
  - `Authorization: Bearer <PROXY_API_KEY>`
  - `x-api-key: <PROXY_API_KEY>`

#### Development vs. Production Rules
- **Development Mode (`NODE_ENV=development` or unset)**:
  - Default host binds safely to `127.0.0.1` (localhost only).
  - If `PROXY_API_KEY` is not set, unauthenticated requests are permitted with a console warning.
- **Production Mode (`NODE_ENV=production`)**:
  - `PROXY_API_KEY` is **mandatory**.
  - If `PROXY_API_KEY` is missing upon server startup, the server exits immediately with an error.
  - If any request arrives without a valid matching token, it is rejected with HTTP 401 (`invalid_api_key`).

### Tier 2: Upstream Google Web Credentials
- Access to Google Gemini Web can occur in two modes:
  - **Guest Mode (Default)**: Completely anonymous, requiring zero Google credentials.
  - **Account Mode**: Authenticated using personal Google Web session cookies (`__Secure-1PSID` and `__Secure-1PSIDTS`).

---

## 2. Safe Handling of Google Web Session Cookies

> [!CAUTION]
> **CRITICAL SECURITY NOTICE:**  
> The Google Web session cookies (`__Secure-1PSID` and `__Secure-1PSIDTS`) represent an active login session to your Google Account.  
> Treat these cookies with the same confidentiality as your Google account password.

### Strict Rules for Cookie Safety:
1. **NEVER Commit Cookies to Version Control**:
   - Ensure `.env` is listed in `.gitignore`.
   - Never commit or stage files containing real cookie values.
2. **NEVER Print Cookies in Logs**:
   - The proxy's internal logging engine (`src/utils/logger.js`) never prints raw cookie tokens.
3. **NEVER Share Cookies**:
   - Do not share cookies in bug reports, screenshots, issue trackers, or chat prompts.
   - Always use placeholders such as `YOUR_GOOGLE_SESSION_COOKIE` in documentation and examples.
4. **NEVER Store Cookies in Public Configurations**:
   - Store credentials solely in your local `.env` file on your machine.

---

## 3. How to Safely Extract Google Session Cookies

If you wish to use **Account Mode** (for higher quotas, model availability, and personal workspace access):

1. Open your web browser (Chrome, Firefox, Edge, etc.) and navigate to:
   ```text
   https://gemini.google.com
   ```
2. Log in with your Google account.
3. Open Developer Tools:
   - Press `F12` or `Ctrl + Shift + I` (Windows / Linux) or `Cmd + Option + I` (macOS).
4. Navigate to the storage inspector:
   - In Chrome/Edge: Go to **Application** tab -> expand **Storage** -> expand **Cookies** -> click `https://gemini.google.com`.
   - In Firefox: Go to **Storage** tab -> expand **Cookies** -> click `https://gemini.google.com`.
5. Find the row named `__Secure-1PSID`:
   - Double-click the **Value** column and copy the string (it typically starts with `g.a.` or a long alphanumeric sequence).
6. Optionally find `__Secure-1PSIDTS` and copy its value.
7. Open your local `.env` file in the proxy directory and configure:
   ```env
   # Account Mode configuration (LOCAL ONLY)
   GEMINI_SECURE_1PSID=YOUR_GOOGLE_SESSION_COOKIE
   GEMINI_SECURE_1PSIDTS=YOUR_GOOGLE_SESSION_COOKIE
   ```
8. Save `.env` and restart the proxy.

---

## 4. Network Exposure & Localhost Binding

### Recommended: Localhost Only (`127.0.0.1`)
When running the proxy for personal IDE use (Continue, Cline, Roo Code), keep the proxy bound to loopback:
```env
HOST=127.0.0.1
PORT=3000
```
This guarantees that machines on your local network (LAN) cannot access the proxy or your Google session.

### Remote Exposure Risks (`0.0.0.0`)
If you configure `HOST=0.0.0.0` (e.g. inside a Docker container or remote VPS):
- **Mandatory Authentication**: Always set a strong, random `PROXY_API_KEY`:
  ```bash
  # Generate a cryptographically secure token
  openssl rand -hex 32
  ```
- **TLS / HTTPS Reverse Proxy**: Never expose raw HTTP over the public internet. Use a reverse proxy (such as Nginx, Caddy, or Cloudflare Tunnel) with an SSL/TLS certificate to encrypt traffic.
- **Firewall Rules**: Restrict incoming traffic to your trusted IP addresses.

---

## 5. Security Checklist

| Item | Status / Recommendation |
|---|---|
| **`.env` in `.gitignore`** | Verified. Never commit `.env`. |
| **`PROXY_API_KEY` set in Production** | Mandatory. Checked on startup. |
| **Host Binding** | `127.0.0.1` default in development mode. |
| **Cookie Sanitization** | Redacted in logger and never passed in client error messages. |
| **Path Traversal Protection** | Active in runtime tools and file operations. |
| **Text-Only Validation** | Active. Rejects image payloads and unauthorized data types. |
