# Phase 3.2 Multi-Provider Architecture & Model Routing Pre-Implementation Audit

**Project:** Lemo Universal AI API Backend (`gemini-web-to-openai-proxy`)  
**Audit Date:** November 24, 2026  
**Auditor:** Senior Backend Architect, API Compatibility & Reliability Engineer  
**Milestone:** Phase 3 — Milestone 3.2: Multi-Provider Architecture & Model Routing  
**Active Git Branch:** `phase-3-production-readiness`  
**Base Commit:** `e3b966e` (`feat(phase-3): improve production reliability and lifecycle management`)  
**Working Tree Status:** Pristine (Clean working tree, 0 uncommitted changes)  

---

## 1. Audit Scope & Baseline Verification

This audit analyzes the current provider implementation, model routing mechanics, controller coupling, streaming lifecycles, and reliability integrations prior to implementing Milestone 3.2.

### 1.1 Git History & Checkpoint Integrity
- Verified repository branch: `phase-3-production-readiness`.
- Confirmed commit history:
  - `e3b966e` (Milestone 3.1: Production reliability, retries, streaming lifecycle, request tracking, graceful shutdown)
  - `391c615` (Milestone 3.0: Baseline audit & branch verification)
  - `63259cb` (Milestone 2.1: Final compatibility audit)
  - `61d1fb7` (Phase 2: IDE integrations, subprocess logging fix)
- All 92 automated tests pass (`node --test tests/**/*.test.mjs`).
- DeepSeek Harness real-world coding workflow passes with 10/10 criteria.

---

## 2. Existing Provider Implementation Analysis

### 2.1 Provider Registry (`src/providers/index.js`)
Currently, `ProviderRegistry` has minimal functionality:
- Stores providers in a `Map`.
- Sets a `defaultProvider` (initialized to `GeminiProvider`).
- Implements `getProviderForModel(modelId)`:
  ```javascript
  getProviderForModel(modelId) {
    for (const provider of this.providers.values()) {
      if (provider.name !== 'gemini' && typeof provider.supportsModel === 'function' && provider.supportsModel(modelId)) {
        return provider;
      }
    }
    return this.defaultProvider;
  }
  ```
- **Defects Identified**:
  1. **Silent Fallback to Gemini**: Any unrecognized model ID silently returns `this.defaultProvider` (`gemini`). This violates the principle of explicit routing and allows typos or unsupported models to execute unpredictably against Gemini.
  2. **Coupling to Provider Name**: `provider.name !== 'gemini'` was hardcoded as a workaround for test mocking.
  3. **No Model Registry or Capability Validation**: Models are not registered with capability metadata (e.g., streaming, tool calling, multimodal, structured outputs).

### 2.2 BaseProvider Contract (`src/providers/BaseProvider.js`)
- Exposes `name`, `supportsModel(modelId)`, and async generator `chatComplete(params)`.
- **Gaps Identified**:
  - Missing standardized lifecycle methods: `initialize()`, `validateConfig()`, `checkHealth()`.
  - Missing standardized capability declarations: `getCapabilities()`, `getModels()`.
  - Missing explicit error normalization contract: `normalizeError(err)`.
  - Missing non-streaming completion abstraction (callers currently consume the stream generator manually for non-streaming completions).

### 2.3 Gemini Provider & GeminiEngine (`src/providers/gemini/`)
- **`GeminiProvider`**:
  - Thin adapter extending `BaseProvider`.
  - Instantiates `GeminiEngine`.
  - In `supportsModel(_modelId)`, returns `true` unconditionally.
- **`GeminiEngine`**:
  - Manages Guest Mode (anonymous ephemeral client, auto-closed in `finally`) and Account Mode (long-lived client cached by `__Secure-1PSID`).
  - Converts OpenAI chat messages and tools into prompt instructions (`formatPrompt`, `formatToolsInstruction`).
  - Injects DSML `<tool_call>` instructions for tool calling.
  - Handles Vision image extraction (`extractImages`).
  - Handles streaming with thinking tokens and regular tokens.
  - Implements fallback from Account Mode to Guest Mode on `UsageLimitExceeded`.
  - Cleans up temporary guest clients in `finally`.
  - Respects `signal.aborted`.

---

## 3. Controller Coupling & Routing Analysis

### 3.1 Chat Controller (`src/controllers/chatController.js`)
- Directly imports `registry` from `../providers/index.js`.
- Queries `const provider = registry.getProviderForModel(model);`.
- If `model` is invalid or unsupported, no error is thrown; `gemini` is invoked silently.
- Manages request tracking, request timeouts, client disconnect abortion, streaming idle timeouts, and retry logic.

### 3.2 Models Controller (`src/controllers/modelsController.js`)
- Directly queries static array `config.models`.
- Has no awareness of registered providers or whether the backing provider is initialized and healthy.
- Exposes fake model aliases (`gpt-4o`, `deepseek-chat`) mapped to Gemini without explicit capability isolation.

### 3.3 Responses Controller (`src/controllers/responsesController.js`)
- Also calls `registry.getProviderForModel(model)`.
- Fallbacks silently to Gemini when an unknown model is supplied.

---

## 4. Key Requirements for Milestone 3.2 Architecture

1. **Unified Provider Adapter Contract (`ProviderAdapter`)**:
   - `id`: unique string identifier (e.g., `'gemini'`).
   - `name`: human-readable name.
   - `initialize()`: lifecycle hook.
   - `validateConfig()`: verifies environment/credentials without leaking secrets.
   - `getCapabilities(modelId)`: declares support for chat, streaming, tool_calling, vision, etc.
   - `getModels()`: returns registered model definitions with metadata.
   - `supportsModel(modelId)`: explicit model resolution.
   - `chatComplete(params)`: generator yielding typed deltas.
   - `complete(params)`: convenience non-streaming helper.
   - `normalizeError(err)`: provider-specific error mapping to standard OpenAI error codes and HTTP statuses.
   - `checkHealth()`: status check reporting provider availability.

2. **Centralized Provider Registry (`ProviderRegistry`)**:
   - Explicit registration: `register(provider)`.
   - Rejection of duplicate provider IDs.
   - Explicit retrieval: `getProvider(providerId)`.
   - Iteration: `getAllProviders()`.
   - No silent default fallback!

3. **Centralized Model Registry (`ModelRegistry`)**:
   - Registers models with canonical IDs, aliases, owner, and capability flags.
   - Rejects duplicate model IDs.
   - Resolves aliases to canonical model records.
   - Exposes OpenAI-compliant model listing for discovery.

4. **Model Router (`ModelRouter`)**:
   - Maps requested model ID to the responsible provider adapter.
   - If model is unknown -> returns `404 Not Found` (`model_not_found`).
   - If provider is unavailable -> returns `503 Service Unavailable` (`provider_unavailable`).
   - If model does not support requested capability (e.g. tools requested for a model without tool capability) -> returns `400 Bad Request` (`capability_not_supported`).
   - Absolute elimination of silent default provider fallbacks.

5. **Gemini Migration**:
   - Refactor `GeminiProvider` to implement the complete `ProviderAdapter` contract.
   - Preserve 100% of existing functionality: Guest Mode, Account Mode, prompt generation, DSML formatting, image extraction, streaming, token estimation, and client cleanup.

6. **Preservation of Milestone 3.1 Production Reliability**:
   - Retries with backoff and jitter for retryable errors.
   - Immediate non-retry once streaming output commences.
   - Client disconnect cancellation propagation.
   - Streaming idle timeout.
   - Graceful shutdown and request tracking.

---

## 5. Risk Assessment & Mitigation Plan

| Risk | Mitigation |
| :--- | :--- |
| Existing tests mocking `registry.defaultProvider` break | Provide backward compatibility in `registry` while routing new requests via `ModelRouter`. |
| Unknown model rejection breaks tests passing arbitrary model names | Audit all existing test model names; ensure mock test providers register their mock models with the registry or router. |
| Gemini Guest/Account mode regression | Maintain existing `GeminiEngine` internals intact; only wrap them through the new adapter methods. |
| Breaking IDE compatibility (DeepSeek Harness) | Re-run full 10/10 E2E Harness verification to ensure complete protocol fidelity. |

---

## 6. Audit Conclusion

The architecture is well-positioned for transformation into a provider-independent design. The planned abstractions directly address existing coupling without adding heavyweight external dependencies or altering public OpenAI-compatible API contracts.
