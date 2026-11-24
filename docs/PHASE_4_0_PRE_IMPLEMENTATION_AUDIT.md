# Phase 4.0 — Pre-Implementation Architecture Discovery Report

**Date**: November 24, 2026  
**Repository**: `gemini-web-to-openai-proxy`  
**Current Branch**: `phase-4-lemo-cli` (branched from `phase-3-production-readiness` commit `1bcb061`)  
**Objective**: Architecture audit of the backend before establishing Lemo CLI foundation.

---

## 1. Repository & Backend Overview

- **Project Core**: High-performance OpenAI-compatible AI API backend written in Node.js (ESM).
- **Package Management & Tooling**: `npm` with Node.js v22.12.0, native test runner (`node --test`).
- **Git State**: Clean working tree on branch `phase-4-lemo-cli`. Preserves all Phase 1, Phase 2, and Phase 3 commits intact.

---

## 2. API Endpoints & Contract Audit

The backend exposes the following endpoints (dual-mounted at `/v1/*` and `/*`):

| Endpoint | Method | Purpose | Protocol / Format |
| :--- | :--- | :--- | :--- |
| `/health`, `/healthz` | GET | Liveness and health checks | JSON (`{ status: "ok" }`) or plaintext `OK` |
| `/v1/models` | GET | Model discovery | OpenAI list schema (`{ object: "list", data: [...] }`) |
| `/v1/models/:model` | GET | Single model inspection | OpenAI model object |
| `/v1/chat/completions` | POST | Chat completions | OpenAI schema; supports SSE streaming (`stream: true`) and non-streaming (`stream: false`), tool calls, and usage statistics |
| `/v1/responses` | POST | Simplified completion | Responses schema (`{ object: "response", output: ... }`) |

---

## 3. Authentication & Security Mechanism

- **Gateway Authentication**:
  - Controlled by `PROXY_API_KEY` environment variable.
  - When configured: Requests require `Authorization: Bearer <token>` or `x-api-key: <token>`. Unauthorized requests return HTTP 401 (`invalid_api_key`).
  - When unset: Open development mode (ideal for local loopback CLI interactions).
- **Provider Cookie Passthrough**:
  - Gemini session cookies (`__Secure-1PSID`, `__Secure-1PSIDTS`) are handled server-side or via `x-gemini-cookie` header when allowed.
  - The CLI interacts purely as a client to the OpenAI-compatible gateway and does NOT handle raw Google session tokens.

---

## 4. Model Capabilities & Routing Architecture

- Governed by `ModelRegistry` and `ModelRouter` (established in Milestone 3.2):
  - Models currently registered: `gemini-flash` (alias `gemini-2.5-flash`), `gemini-pro` (alias `gemini-2.5-pro`), `gemini-thinking` (alias `gemini-2.5-thinking`), and `gemini-lite`.
  - Capabilities explicitly tracked: `chat`, `stream`, `tools`, `vision`, `json`.
  - Unknown models are rejected with HTTP 404 (`model_not_found`) with **zero silent fallback**.
  - Unsupported capabilities (e.g. tools on `gemini-thinking`) are rejected with HTTP 400 (`capability_not_supported`).

---

## 5. Scope Boundary for Lemo CLI

- **Backend Ownership**: Provider integrations (Gemini, OpenAI, DeepSeek), model routing, provider auth, token streaming, error normalization.
- **CLI Responsibility**:
  - Terminal user interface (CMD, PowerShell, Windows Terminal, POSIX).
  - Operating modes: Chat Mode and Agent Mode.
  - Local workspace management, approval prompts, and local tool execution (in later phases).
  - **Phase 4.0 Scope**: Strictly foundation — CLI entry point (`--help`, `--version`), configuration management, error handling, logging, type definitions, and architecture documentation.
