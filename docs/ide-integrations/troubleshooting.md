# Comprehensive Troubleshooting Guide

This guide provides diagnostic procedures and actionable resolutions for common errors and edge cases encountered when running `gemini-web-to-openai-proxy` and connecting external IDEs and agents.

---

## 1. Quick Diagnostic Checklist

Before diving into specific error codes, run these verification checks:

1. **Is the proxy running?**
   ```bash
   curl -s http://localhost:3000/health
   # Expected output: {"status":"ok","service":"Google Gemini Web to OpenAI Proxy",...}
   ```
2. **Can the proxy list canonical models?**
   ```bash
   curl -s http://localhost:3000/v1/models
   # Expected output: JSON list containing gemini-flash, gemini-pro, gemini-thinking, gemini-lite
   ```
3. **Does a basic completion work?**
   ```bash
   curl -s http://localhost:3000/v1/chat/completions \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer YOUR_PROXY_API_KEY" \
     -d '{"model":"gemini-flash","messages":[{"role":"user","content":"Ping"}]}'
   ```

---

## 2. Common Issues & Solutions

### 2.1 Connection Refused (`ECONNREFUSED`)
- **Symptoms:** IDE reports `connect ECONNREFUSED 127.0.0.1:3000` or `Failed to fetch`.
- **Cause:** The proxy server is not started, is listening on a different port, or host binding blocked the request.
- **Diagnosis:**
  - Check whether `node src/server.js` or `npm start` is running in your terminal.
  - Check the output banner: it prints the active port (default: 3000) and host (`127.0.0.1` in development).
- **Fix:**
  - Start the proxy: `npm start`.
  - In your IDE settings, ensure the URL is `http://localhost:3000/v1` or `http://127.0.0.1:3000/v1`. If testing inside Docker or WSL, set `HOST=0.0.0.0` in `.env` to allow cross-container networking.

---

### 2.2 HTTP 401 Unauthorized (`invalid_api_key`)
- **Symptoms:** Response body contains `{"error":{"message":"Incorrect API key provided...","code":"invalid_api_key"}}`.
- **Cause:** `PROXY_API_KEY` is configured in your `.env` file, but the IDE is sending a missing or mismatched `Authorization: Bearer <key>` or `x-api-key` header.
- **Diagnosis:** Inspect `.env` for `PROXY_API_KEY`.
- **Fix:**
  - In your IDE (Continue, Cline, Roo Code), ensure the API Key field matches the exact value of `PROXY_API_KEY`.
  - If running in local development mode without security requirements, you can clear `PROXY_API_KEY` in `.env` to allow open access.

---

### 2.3 HTTP 500 Server Error (`missing_production_api_key`)
- **Symptoms:** Server startup fails with error `CRITICAL SECURITY ERROR: PROXY_API_KEY must be configured...` or returns HTTP 500.
- **Cause:** `NODE_ENV` is set to `production`, but `PROXY_API_KEY` is empty.
- **Diagnosis:** Check environment variables: `NODE_ENV=production`.
- **Fix:**
  - Generate a secure API key and set it in `.env`:
    ```bash
    PROXY_API_KEY=your-secure-random-token-here
    ```
  - Or, if running locally for development, remove or change `NODE_ENV=development`.

---

### 2.4 HTTP 404 Model Not Found (`model_not_found`)
- **Symptoms:** Request fails with `Model '...' not found. Available models: gemini-flash, gemini-pro, gemini-thinking, gemini-lite`.
- **Cause:** The client IDE requested a non-Gemini model (e.g. `gpt-4o`, `gpt-4`, `claude-3-5-sonnet`, `deepseek-chat`) or an obsolete legacy alias (`gemini-2.5-flash`).
- **Diagnosis:** Check the `"model"` property sent by the IDE.
- **Fix:**
  - Configure the IDE to use one of the four supported canonical IDs:
    - `gemini-flash`
    - `gemini-pro`
    - `gemini-thinking`
    - `gemini-lite`
  - Ensure any default non-Gemini models are unselected or removed from your IDE's active model list.

---

### 2.5 HTTP 400 Bad Request (`image_input_unsupported`)
- **Symptoms:** Request returns `{"error":{"message":"Image input is not supported. This proxy operates exclusively as a text-only Gemini Web bridge...","code":"image_input_unsupported"}}`.
- **Cause:** The client sent an image payload, such as a base64 data URI, an OpenAI structured image part (`type: "image_url"`), or an uncontextualized standalone markdown image tag.
- **Diagnosis:** Look for screenshot captures, dragged image files, or vision attachments in the IDE chat.
- **Fix:**
  - Remove images or screenshots from the prompt.
  - Disable screenshot/vision capabilities in agent extensions (e.g. Cline browser action).
  - Note: Markdown image syntax discussed in code blocks (e.g. `![logo](https://example.com/logo.png)`) or ordinary text is accepted; only actual image payloads are rejected.

---

### 2.6 HTTP 404 Not Found on `/v1/completions` (Continue Autocomplete)
- **Symptoms:** Continue logs `404 Not Found: POST /v1/completions`.
- **Cause:** Continue's Tab Autocomplete attempts to hit the legacy `/v1/completions` endpoint for code completion. The proxy intentionally does not implement `/v1/completions`.
- **Fix:**
  - Do not set `tabAutocompleteModel` to this proxy in `~/.continue/config.yaml` or `~/.continue/config.json`.
  - Use this proxy exclusively for `models` (Chat and Inline Edit workflows).

---

### 2.7 HTTP 405 Method Not Allowed / Google Bot Challenges
- **Symptoms:** Requests fail with upstream errors containing HTTP 405 or "Google Bot Challenge / Abuse Exemption Required".
- **Cause:** When running in Guest Mode (unauthenticated, with no Google session cookies), Google Web periodically applies bot detection or rate challenges to the client IP.
- **Diagnosis:** Check server logs for `[GeminiEngine]` or `gemini-web-sdk` upstream errors.
- **Fix:**
  - Switch to **Account Mode**:
    1. Log in to [gemini.google.com](https://gemini.google.com) in your web browser.
    2. Open DevTools (`F12` or `Ctrl+Shift+I`) -> **Application** -> **Storage** -> **Cookies** -> `https://gemini.google.com`.
    3. Copy the value of `__Secure-1PSID` (and optionally `__Secure-1PSIDTS`).
    4. Paste into your `.env` file:
       ```env
       GEMINI_SECURE_1PSID=YOUR_GOOGLE_SESSION_COOKIE
       GEMINI_SECURE_1PSIDTS=YOUR_GOOGLE_SESSION_COOKIE
       ```
    5. Restart the proxy.

---

### 2.8 HTTP 429 Insufficient Quota / Rate Limit Exceeded
- **Symptoms:** Response status is 429 with error message stating rate limit or quota exceeded.
- **Cause:**
  - Local rate limit exceeded (default: 120 requests/minute per IP).
  - Or upstream Google Web quota exceeded on `gemini-pro` or `gemini-thinking`. The proxy fails closed rather than silently downgrading model quality.
- **Fix:**
  - If local rate limiting is the cause, adjust `RATE_LIMIT_MAX` or `RATE_LIMIT_WINDOW_MS` in `.env`.
  - If Google quota is exhausted, wait for quota reset or switch to `gemini-flash` which has significantly higher availability.

---

### 2.9 Streaming Stalls or Premature Interruption
- **Symptoms:** The response starts streaming in the IDE, but stops abruptly mid-sentence.
- **Cause:** Client socket timeout, upstream idle timeout (`STREAMING_IDLE_TIMEOUT_MS`), or network disruption.
- **Fix:**
  - Check `.env` settings: `STREAMING_IDLE_TIMEOUT_MS` defaults to `60000` (60s). Increase it if running complex `gemini-thinking` prompts.
  - If behind a corporate proxy or VPN, configure `HTTPS_PROXY` in `.env` to ensure stable connectivity to Google Web servers.
