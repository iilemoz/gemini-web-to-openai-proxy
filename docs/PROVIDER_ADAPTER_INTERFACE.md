# Provider Adapter Interface Specification

## 1. Overview

The **Provider Adapter Interface** (`BaseProvider` / `ProviderAdapter`) defines the standard contract that every AI provider implementation must fulfill to integrate into the Lemo Universal AI API Backend.

By abstracting provider-specific transport protocols, authentication mechanisms, token exchange formats, and generation endpoints behind this unified interface, the backend's core routing, controllers, middleware, and external OpenAI-compatible endpoints remain strictly decoupled from upstream provider specifics.

---

## 2. Interface Contract (`BaseProvider` / `ProviderAdapter`)

Located at: `src/providers/BaseProvider.js`

```javascript
import { EventEmitter } from 'node:events';

export class BaseProvider extends EventEmitter {
  /**
   * @param {string} name - Unique provider identifier (e.g. 'gemini', 'openai', 'deepseek')
   * @param {object} [options={}] - Provider configuration
   */
  constructor(name, options = {}) {
    super();
    this.name = name;
    this.options = options;
  }

  // --- Lifecycle & Discovery ---

  async initialize() {}
  validateConfig() { return true; }
  getModels() { return []; }
  supportsModel(modelId) { return false; }
  getCapabilities(modelId) {
    return { chat: true, stream: true, tools: false, vision: false, json: false };
  }
  async checkHealth() {
    return { status: 'healthy', provider: this.name, timestamp: new Date().toISOString() };
  }

  // --- Inference Generation ---

  async *chatComplete(request) {
    throw new Error(`chatComplete() is not implemented by provider [${this.name}]`);
  }

  async complete(request) {
    let fullContent = '';
    for await (const chunk of this.chatComplete({ ...request, stream: false })) {
      if (typeof chunk === 'string') {
        fullContent += chunk;
      } else if (chunk && typeof chunk.content === 'string') {
        fullContent += chunk.content;
      }
    }
    return { content: fullContent };
  }

  // --- Error Normalization ---

  normalizeError(error) {
    return {
      status: error?.status || 500,
      code: error?.code || 'provider_error',
      message: error?.message || 'An upstream provider error occurred',
      type: error?.type || 'api_error'
    };
  }
}
```

---

## 3. Method Specifications

### 3.1 Lifecycle & Discovery

#### `async initialize()`
- Called by `ProviderRegistry.register()` when the provider is loaded into the system.
- Sets up HTTP clients, credentials, initial authentication tokens, or long-lived connection pools.
- Must be idempotent; subsequent calls should not leak connections or duplicate handlers.

#### `validateConfig()`
- Validates that all required environment variables and configuration parameters for this provider are present and formatted correctly.
- Returns `true` if valid, or throws a descriptive `Error` detailing missing settings.

#### `getModels()`
- Returns an array of model definition objects provided natively by this provider.
- Each model object structure:
  ```javascript
  {
    id: 'provider-model-id',          // Canonical model identifier
    aliases: ['alias-1', 'alias-2'], // Compatible alias names
    capabilities: {
      chat: true,                    // Supports chat completion
      stream: true,                  // Supports SSE streaming
      tools: true,                   // Supports function/tool calling
      vision: false,                 // Supports multimodal image inputs
      json: true                     // Supports structured JSON output
    },
    owned_by: 'provider-name'
  }
  ```

#### `supportsModel(modelId)`
- Synchronous boolean check.
- Returns `true` if the provider natively handles or can claim generation for the given `modelId`.

#### `getCapabilities(modelId)`
- Returns capability flags for the specified model ID.
- Used by `ModelRouter` to validate whether client requests (e.g. function calls, image uploads) are compatible before invoking inference.

#### `async checkHealth()`
- Verifies provider health and connectivity.
- Returns `{ status: 'healthy' | 'degraded' | 'unhealthy', latencyMs?: number, message?: string }`.

---

### 3.2 Inference

#### `async *chatComplete(request)`
- Main inference method returning an **AsyncGenerator** yielding string chunks or standardized chunk objects.
- Request payload:
  - `model`: Canonical or resolved model ID.
  - `messages`: Standard OpenAI message array (`[{ role, content, tool_calls, tool_call_id, name }]`).
  - `stream`: Boolean indicating if SSE streaming was requested by client.
  - `tools`: Optional array of tool definitions (`[{ type: 'function', function: { name, description, parameters } }]`).
  - `signal`: `AbortSignal` for tracking client disconnects or request timeouts.
  - `token`: Optional auth cookie or override token.
  - `options`: Additional hyper-parameters (`temperature`, `top_p`, `max_tokens`, `stop`, etc.).

#### `async complete(request)`
- Convenience non-streaming invocation method.
- Collects and aggregates all chunks from `chatComplete()` and returns `{ content: fullContent, ... }`.

---

### 3.3 Error Normalization

#### `normalizeError(error)`
- Converts vendor-specific error structures (e.g. Gemini gRPC codes, HTTP 429 quota exhaustion, Cloudflare blocks) into standardized OpenAI error structures:
  ```json
  {
    "status": 502,
    "code": "upstream_error",
    "message": "Human-readable sanitized error description",
    "type": "api_error"
  }
  ```

---

## 4. Architectural Rules

1. **Decoupled from Express**: The provider adapter must not receive `req` or `res` objects. It operates exclusively on standard JavaScript data objects and async iterables.
2. **AbortSignal Compliance**: Every provider MUST monitor `request.signal` and throw an `AbortError` or terminate upstream generators when the signal fires.
3. **No Silent Fallback**: If an unsupported model or capability is requested, the adapter must not substitute another model silently.
