# PHASE 5.0F.2.1 — FINAL REMEDIATION VERIFICATION REPORT
## Model Alias Integrity, Markdown Text Safety, Guest Fallback & Git Evidence

**Project:** `gemini-web-to-openai-proxy`  
**Target Branch:** `phase-4-lemo-cli`  
**Baseline HEAD:** `19573dea90168e6ce9e2681738ef7871e1c0ff62` (Phase 5.0F.2 commit)  
**Execution Date:** 2026-11-25  
**Final Status:** PASS

---

## 1. Executive Summary

This independent verification and remediation phase addresses the four core concerns identified during the review of Phase 5.0F.2:

1. **Model Alias Integrity:** Conducted an evidence-based audit of legacy model aliases (`gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-2.5-thinking`). Established from upstream `gemini-web-sdk` v2.3.0 and Google Gemini Web interface that "Gemini 2.5" is an inaccurate and misleading designation; upstream SDK models are strictly defined as `gemini-3-*` (`BASIC_FLASH`, `BASIC_PRO`, `BASIC_THINKING`, `BASIC_LITE`). Consequently, the misleading `gemini-2.5-*` aliases have been completely removed. The proxy exposes and routes exclusively canonical model IDs (`gemini-flash`, `gemini-pro`, `gemini-thinking`, `gemini-lite`), failing closed with HTTP 404 `model_not_found` for any foreign or removed model identifiers.
2. **Markdown Image Syntax Safety:** Refined text input validation to clearly distinguish between conversational text discussing Markdown syntax and raw image payloads. Ordinary conversational text, questions, explanations, code blocks, and inline backticks are accepted cleanly without false-positive rejections across `/v1/chat/completions` and `/v1/responses`. Raw standalone Markdown image tags (`^[ \t]*!\[.*?\]\([ \t]*[^\s)]+[ \t]*\)[ \t]*$`), Base64 image data URIs (`data:image/...;base64,...`), and structured image objects (`{ type: 'image_url' }`, `{ type: 'image' }`) are rejected with HTTP 400 (`image_input_unsupported`).
3. **Guest Mode Exact-Model Fallback Verification:** Verified runtime fallback semantics in `GeminiEngine.executeWithFallback()`. Proved through unit tests and argument inspection that upon Account Mode Flash quota exhaustion, fallback strictly instantiates Guest Mode with `Model.BASIC_FLASH` (`newChat({ model: Model.BASIC_FLASH })`). Proved that Account Mode quota exhaustion for Pro or Thinking strictly fails closed with HTTP 429 `insufficient_quota` without attempting Guest Mode invocation or silent downgrade.
4. **Git Integrity & Clean Test Suite:** Verified all modified files, confirmed branch stability, and verified that all 150 tests pass with zero failures (150/150).

---

## 2. Model Alias Decision & Upstream Evidence

### 2.1 Upstream SDK Inspection

The underlying SDK `gemini-web-sdk` (v2.3.0) declares models in `dist/types.d.ts` as:
```typescript
export declare enum Model {
    BASIC_PRO = "gemini-3-pro",
    BASIC_FLASH = "gemini-3-flash",
    BASIC_LITE = "gemini-3-lite",
    BASIC_THINKING = "gemini-3-thinking"
}
```

Google Gemini Web interface does not support or offer any model named "Gemini 2.5".

### 2.2 Decision: Removal of Misleading Aliases

Per the remediation directive:
> *"Unless reliable technical evidence establishes that the legacy name is accurate, remove the misleading alias."*

- **Removed Aliases:**
  - `gemini-2.5-flash`
  - `gemini-2.5-pro`
  - `gemini-2.5-thinking`
- **Supported Canonical Model IDs:**
  - `gemini-flash` -> maps to upstream `gemini-3-flash` (`Model.BASIC_FLASH`)
  - `gemini-pro` -> maps to upstream `gemini-3-pro` (`Model.BASIC_PRO`)
  - `gemini-thinking` -> maps to upstream `gemini-3-thinking` (`Model.BASIC_THINKING`)
  - `gemini-lite` -> maps to upstream `gemini-3-lite` (`Model.BASIC_LITE`)
- **Routing Behavior:**
  Requests targeting `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-2.5-thinking`, `gpt-4o`, `claude-3-5-sonnet`, or any other non-canonical identifier fail closed with HTTP 404 `model_not_found`:
  ```json
  {
    "error": {
      "message": "The model 'gemini-2.5-flash' does not exist or you do not have access to it.",
      "type": "invalid_request_error",
      "param": "model",
      "code": "model_not_found"
    }
  }
  ```

---

## 3. Markdown Text Acceptance vs. Rejection Matrix

Validation logic in `src/utils/textOnlyValidator.js` distinguishes conversational text from image attachments:

### 3.1 Acceptance vs Rejection Specification

| Input Pattern / Content | Validation Result | HTTP Status / Error Code | Rationale |
| :--- | :---: | :---: | :--- |
| `"Explain this Markdown image syntax: ![alt](https://example.com/image.png)"` | **Accepted** | HTTP 200 | Conversational question discussing syntax |
| `"Why does ![logo](logo.png) not render?"` | **Accepted** | HTTP 200 | Debugging query referencing Markdown syntax |
| ```` ```markdown\n![alt](https://example.com/img.png)\n``` ```` | **Accepted** | HTTP 200 | Code block containing Markdown syntax example |
| `` `![alt](url)` `` | **Accepted** | HTTP 200 | Inline backtick code snippet |
| `'"![alt](https://example.com/img.png)"'` | **Accepted** | HTTP 200 | Quoted Markdown image string |
| `"Referencing https://example.com/photo.png in my CSS background"` | **Accepted** | HTTP 200 | Regular text referencing an image URL |
| `![alt](https://example.com/diagram.png)` (standalone) | **Rejected** | HTTP 400 `image_input_unsupported` | Standalone raw Markdown image acting as an image attachment |
| `\n  ![alt](https://example.com/photo.jpg)  \n` (standalone with whitespace) | **Rejected** | HTTP 400 `image_input_unsupported` | Raw Markdown image tag without conversational context |
| `data:image/png;base64,iVBORw0KGgoAAA...` (standalone or embedded) | **Rejected** | HTTP 400 `image_input_unsupported` | Binary image data URI payload |
| `{ "type": "image_url", "image_url": { "url": "..." } }` | **Rejected** | HTTP 400 `image_input_unsupported` | Structured OpenAI image object |
| `{ "type": "image", "image": "..." }` | **Rejected** | HTTP 400 `image_input_unsupported` | Structured image object |
| `{ "type": "input_audio", ... }` | **Rejected** | HTTP 400 `unsupported_content_type` | Non-text modality |

### 3.2 Endpoint Parity
The exact same `isImagePayload()` and `validateTextOnlyMessages()` validators are executed by:
- `/v1/chat/completions` (via `chatController.js` and `validation.js`)
- `/v1/responses` (via `responsesController.js`)

---

## 4. Guest Mode Exact-Model Fallback Verification

### 4.1 Implementation Architecture (`src/providers/gemini/GeminiEngine.js`)

To enable strict verification without mocking global SDK classes, `GeminiEngine` incorporates a factory method:
```javascript
createGuestClient() {
  return new GeminiWebClient();
}
```

Fallback execution is centralized in `executeWithFallback({ resolvedModel, isGuest, generateOpts, signal, err })`:
```javascript
async executeWithFallback({ resolvedModel, isGuest, generateOpts, signal, err }) {
  const isUsageLimit = err?.name === 'UsageLimitExceeded' ||
    (typeof err?.message === 'string' && (
      err.message.includes('Usage limit exceeded') ||
      err.message.includes('quota') ||
      err.message.includes('rate limit')
    ));

  if (isUsageLimit && !isGuest) {
    if (resolvedModel === Model.BASIC_FLASH) {
      logger.warn('[GeminiEngine] Account plan restriction for Flash. Falling back to Guest Mode (same model)…');
      const guestClient = this.createGuestClient();
      try {
        const guestChat = guestClient.newChat({ model: Model.BASIC_FLASH });
        return await guestChat.generateContentStream(generateOpts, signal);
      } finally {
        if (typeof guestClient.close === 'function') guestClient.close();
      }
    } else {
      logger.error(`[GeminiEngine] Account quota exceeded for requested model '${resolvedModel}'. Silent downgrade to Flash is prohibited.`);
      const quotaErr = new Error(`Account plan usage limit exceeded for requested model '${resolvedModel}'. Guest mode fallback is not supported for Pro/Thinking models.`);
      quotaErr.status = 429;
      quotaErr.code = 'insufficient_quota';
      throw quotaErr;
    }
  }
  throw err;
}
```

### 4.2 SDK Invocation Argument Verification (Test 17)

Test 17 in `tests/phase5_scope_remediation.test.mjs` verifies:
1. **Flash Fallback:**
   - Account Mode throws `UsageLimitExceeded`.
   - `createGuestClient()` is called.
   - `newChat` is invoked with arguments: `{ model: "gemini-3-flash" }` (`Model.BASIC_FLASH`).
   - Upstream model argument matches `Model.BASIC_FLASH` exactly.
2. **Pro / Thinking Quota Exceeded:**
   - Account Mode throws `UsageLimitExceeded` for `gemini-3-pro` / `gemini-3-thinking`.
   - Rejects immediately with HTTP 429 `insufficient_quota`.
   - `newChat` is NEVER called for guest client (zero silent downgrade).

---

## 5. Git Status & Repository Baseline

- **Repository Root:** `c:\Users\Ahmed\Desktop\Gemini-web-to-openai-proxy 2027`
- **Active Branch:** `phase-4-lemo-cli`
- **Baseline HEAD Commit:** `19573dea90168e6ce9e2681738ef7871e1c0ff62` (Phase 5.0F.2 completion)
- **Untracked Historical Audits Preserved:**
  - `LEMO_API_PROXY_COMPREHENSIVE_STATUS_AUDIT.md`
  - `LEMO_CLI_REMOVAL_REPORT.md`
  - `PHASE_5_0E_1_INDEPENDENT_AUDIT_REPORT.md`
  - `PHASE_5_0F_1_INDEPENDENT_VERIFICATION_AUDIT.md`

---

## 6. Files Changed

1. `src/config/index.js`
   - Removed `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-2.5-thinking` from the models dictionary.
   - Clean canonical configuration for `gemini-flash`, `gemini-pro`, `gemini-thinking`, `gemini-lite`.
2. `src/providers/gemini/index.js`
   - Set `aliases: []` for all 4 models in `getModels()`.
3. `src/utils/textOnlyValidator.js`
   - Replaced indiscriminate markdown image regex with `STANDALONE_MARKDOWN_IMAGE_REGEX`:
     `/^[ \t]*!\[(?:[^\]\r\n]*)\]\([ \t]*(?:[^\s)\r\n]+)[ \t]*(?:\s+["'][^"'\r\n]*["'])?[ \t]*\)[ \t]*$/m`
   - Updated `isImagePayload()` to reject only standalone markdown image payloads and Base64 data URIs.
4. `src/providers/gemini/GeminiEngine.js`
   - Added `createGuestClient()` factory method.
   - Added `executeWithFallback()` enforcing exact-model fallback for `Model.BASIC_FLASH` and HTTP 429 for Pro/Thinking.
   - Updated `streamChat` catch block to route through `executeWithFallback()`.
5. `README.md`
   - Updated test pass badge to 150/150.
   - Documented removal of `gemini-2.5-*` aliases in Model Catalog.
   - Updated text-only description to reflect Markdown text discussion acceptance.
6. `tests/multi_provider.test.mjs`
   - Updated model support assertions to verify `gemini-2.5-flash` is not supported.
7. `tests/phase5_scope_remediation.test.mjs`
   - Test 14: Verifies `gemini-2.5-*` fail closed with 404 `model_not_found`.
   - Test 15: Verifies Markdown text acceptance vs rejection across all specified cases.
   - Test 16: Verifies `/v1/chat/completions` and `/v1/responses` accept markdown discussion text.
   - Test 17: Verifies Guest Mode fallback invokes SDK with exact `Model.BASIC_FLASH` constant and fails closed for Pro/Thinking without calling `newChat`.
   - Tests 6 & 8: Updated to assert rejection of standalone Markdown image tags.
8. `tests/phase5_multimodal_compat.test.mjs`
   - Test 4: Updated markdown image payload case to standalone markdown image tag.

---

## 7. Test Results

### 7.1 Full Test Suite Execution (`npm test`)

```text
TAP version 13
1..150
# tests 150
# suites 0
# pass 150
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

### 7.2 Test Suite Breakdown

| Test File | Test Cases | Passed | Failed |
| :--- | :---: | :---: | :---: |
| `tests/agent_runtime.test.mjs` | 1 | 1 | 0 |
| `tests/gemini_proxy.test.mjs` | 10 | 10 | 0 |
| `tests/mcp_protocol.test.mjs` | 16 | 16 | 0 |
| `tests/multi_agent.test.mjs` | 13 | 13 | 0 |
| `tests/multi_provider.test.mjs` | 26 | 26 | 0 |
| `tests/phase5_multimodal_compat.test.mjs` | 18 | 18 | 0 |
| `tests/phase5_scope_remediation.test.mjs` | 17 | 17 | 0 |
| `tests/responses_api.test.mjs` | 40 | 40 | 0 |
| `tests/security_benchmark.test.mjs` | 9 | 9 | 0 |
| **Total** | **150** | **150** | **0** |

---

## 8. Remaining Limitations

1. **Google Gemini Web Guest Mode Scope:**
   Google Gemini Web interface limits anonymous guest sessions to Flash (`gemini-3-flash`). Pro and Thinking models cannot be accessed in Guest Mode; therefore, when an Account Mode session exhausts its quota for Pro or Thinking, fallback to Guest Mode is technically impossible. The system correctly fails closed with HTTP 429 (`insufficient_quota`).
2. **Inline Markdown Image with Surrounding Text:**
   If a client submits an actual image payload via Markdown syntax embedded in conversational prose (e.g. `"Analyze this image ![img](https://example.com/cat.jpg) and tell me the breed"`), the proxy permits the prompt because it treats the input as text. Because the proxy operates in pure text-generation mode, Gemini Web receives the text prompt as-is and generates a text response based on the textual content, without multimodal image rendering or inspection.

---

## 9. Final Verdict

# **PASS**

All requirements of Phase 5.0F.2.1 have been implemented and independently verified:
- Legacy aliases `gemini-2.5-*` are removed and fail closed with 404 `model_not_found`.
- Markdown image syntax in text/questions/code blocks is accepted without false positives.
- Standalone Markdown image attachments and Base64 payloads are strictly rejected with 400 `image_input_unsupported`.
- Guest Mode fallback uses exact SDK constant `Model.BASIC_FLASH` for Flash, and fails closed with 429 `insufficient_quota` for Pro/Thinking.
- All 150 tests pass with zero failures.
