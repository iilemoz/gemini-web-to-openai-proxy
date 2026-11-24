# Phase 3 Milestone 3.2 — Multi-Provider Architecture & Model Routing Report

**Date**: November 24, 2026  
**Repository**: `gemini-web-to-openai-proxy` (Lemo Universal AI API Backend)  
**Milestone**: Phase 3 Milestone 3.2: Multi-Provider Architecture & Model Routing  
**Git Branch**: `phase-3-production-readiness`  

---

## 1. Executive Summary

Milestone 3.2 successfully transformed the Lemo Universal AI API Backend from a Gemini-exclusive proxy into a robust, provider-agnostic, multi-provider inference platform. The public interface remains strictly OpenAI-compatible (`/v1/models`, `/v1/chat/completions`, `/v1/responses`, plus legacy un-prefixed aliases), while internal model resolution and execution are governed by decoupled provider adapters and routing registries.

All verification suites pass cleanly:
- **107/107 automated unit and integration tests passing (100%)**.
- **DeepSeek Harness real-world E2E workflow: 10/10 PASS**.
- Zero regressions across existing Gemini Guest Mode, Account Mode, tool calling, image extraction, streaming, and Milestone 3.1 production reliability features.

---

## 2. Architectural Transformations

### 2.1 Provider Adapter Contract (`BaseProvider` / `ProviderAdapter`)
- Standardized provider contract located at `src/providers/BaseProvider.js`.
- Core methods:
  - `initialize()`: Asynchronous lifecycle setup for clients and pools.
  - `validateConfig()`: Configuration and environment integrity verification.
  - `getModels()`: Declarative listing of supported models, aliases, and capability flags.
  - `supportsModel(modelId)`: Explicit model ownership and support testing.
  - `getCapabilities(modelId)`: Capability introspection (`chat`, `stream`, `tools`, `vision`, `json`).
  - `checkHealth()`: Provider health and latency check.
  - `chatComplete(request)`: AsyncGenerator yielding standardized chunks with `AbortSignal` compliance.
  - `complete(request)`: Non-streaming chunk aggregator.
  - `normalizeError(error)`: Vendor error normalization to OpenAI-compatible error schema.

### 2.2 Provider Registry (`src/providers/ProviderRegistry.js`)
- Singleton registry managing loaded provider adapters.
- Features duplicate registration prevention, lifecycle management (`initialize()`), active state tracking, and provider lookups.

### 2.3 Model Registry (`src/providers/ModelRegistry.js`)
- Maintains canonical model definitions and associated aliases.
- Validates against duplicate model registration and alias-to-canonical collision.
- Dynamically surfaces models and their aliases to the `/v1/models` endpoint formatted strictly to the OpenAI specification.

### 2.4 Model Router (`src/providers/ModelRouter.js`)
- Resolves incoming model strings to target provider instances.
- **Strict Anti-Fallback Guarantee**: If an unknown model is requested, `ModelRouter` rejects the request with HTTP 404 (`model_not_found`). The system **NEVER** silently falls back to Gemini.
- **Capability Negotiation**: If an incoming request requires specific features (e.g. `tools`), `ModelRouter` validates that the target model's capabilities include `tools: true`. If not, it rejects the request with HTTP 400 (`capability_not_supported`).
- **Availability Enforcement**: If a model is flagged inactive or its backing provider is down, `ModelRouter` rejects the request with HTTP 503 (`model_unavailable`).

### 2.5 Gemini Provider Migration (`src/providers/gemini/index.js`)
- Refactored `GeminiProvider` to extend `BaseProvider`.
- Fully preserves:
  - Gemini Guest Mode (anonymous ephemeral session management).
  - Gemini Account Mode (`__Secure-1PSID` / `__Secure-1PSIDTS` cookie parsing and validation).
  - Real-time token streaming with SSE formatting.
  - DeepSeek Markup Language (DSML) / `<tool_call>` extraction and parsing.
  - Multimodal image input extraction and URL forwarding.
  - Request tracking, client disconnect propagation, and graceful shutdown integration.
  - Proactive socket and abort listener cleanup to prevent resource leaks.

---

## 3. Key Design Decisions

1. **Routing Before Resource Allocation**:
   - Model resolution and capability checks are executed *before* initializing request timers or registering with `requestTracker`. This ensures invalid or unknown model requests terminate instantly without leaving dangling timers on Node's event loop.
2. **Backward-Compatible Facade (`LegacyRegistryFacade`)**:
   - A facade was placed in `src/providers/index.js` to preserve `registry.defaultProvider` and existing test monkey-patching hooks without breaking historical test suites.
3. **Dual-Stack Endpoint Maintenance**:
   - Both `/v1/*` and root `/*` endpoints remain mounted and operational for broad compatibility across legacy tools and modern IDEs (OpenCode, Cline, Cursor, Continue, DeepSeek Harness).
