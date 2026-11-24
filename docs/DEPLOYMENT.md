# Deployment & Operations Guide

Instructions for deploying and operating the Universal AI Agent Infrastructure in production or local environments.

---

## 1. System Requirements
- Node.js >= 20.0.0 (Node 22 LTS recommended)
- Optional: Docker daemon for container-isolated cloud runtimes
- Optional: PowerShell 5.1+ (Windows) or Bash (Linux / macOS)

---

## 2. Running Locally

```bash
# Install dependencies
npm install

# Start server (default port 3000)
npm start

# Or with live reload
npm run dev
```

---

## 3. Running with Docker

Build and run using Docker:

```bash
docker build -t gemini-universal-agent .
docker run -p 3000:3000 --env-file .env gemini-universal-agent
```

---

## 4. Environment Variables

| Variable | Description | Default |
| :--- | :--- | :--- |
| `PORT` | HTTP Server port | `3000` |
| `HOST` | Bind address | `0.0.0.0` |
| `PROXY_API_KEY` | Secret bearer key required for proxy access | *(optional)* |
| `GEMINI_COOKIE_1PSID` | Google Account cookie for Account Mode | *(optional)* |
| `GEMINI_COOKIE_1PSIDTS` | Google Account cookie for Account Mode | *(optional)* |
| `UPSTREAM_PROXY` | HTTP/HTTPS/SOCKS proxy for upstream requests | *(optional)* |
| `RATE_LIMIT_MAX_REQUESTS` | Max requests per time window | `120` |
| `RATE_LIMIT_WINDOW_MS` | Rate limiting window in milliseconds | `60000` |
