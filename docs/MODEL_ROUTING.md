# Model Routing & Registry Architecture

## 1. Overview

In Milestone 3.2, the Lemo Universal AI API Backend transitioned from a Gemini-exclusive proxy to a provider-agnostic inference gateway. Model requests from IDEs and autonomous agents (such as DeepSeek Harness, OpenCode, Cline, Cursor, Continue) are now resolved through a dedicated **Model Registry** and **Model Router**.

A central architectural mandate of this milestone is:
> **Explicit Model Routing**: Requests for unknown or unregistered models are rejected immediately with HTTP 404 (`model_not_found`). The backend **NEVER** silently falls back to a default provider (e.g. Gemini).

---

## 2. Component Architecture

```
                    Incoming Client Request (/v1/chat/completions)
                                        │
                                        ▼
                               [ModelRouter.resolve]
                                        │
                         ┌──────────────┴──────────────┐
                         ▼                             ▼
              [Check ModelRegistry]           [Validate Capabilities]
             (Canonical & Aliases)            (chat, stream, tools, etc.)
                         │                             │
             ┌───────────┴───────────┐                 ▼
             ▼                       ▼          Capability Mismatch?
       Model Found?            Unknown Model?   ──► HTTP 400 (capability_not_supported)
             │                       │
             │                       └──► HTTP 404 (model_not_found)
             ▼
    [Check ProviderRegistry]
             │
             ├──► Provider Inactive / Not Found? ──► HTTP 503 (model_unavailable)
             │
             ▼
   [Dispatch to ProviderAdapter]
 (e.g. GeminiProvider.chatComplete)
```

---

## 3. ModelRegistry (`src/providers/ModelRegistry.js`)

The `ModelRegistry` maintains the single source of truth for all models exposed over the `/v1/models` endpoint and routable by the gateway.

### 3.1 Model Definition Schema

Every registered model has:
- `id` (string): Canonical model identifier (e.g. `gemini-flash`, `deepseek-chat`).
- `provider` (string): Unique identifier of the backing provider (e.g. `gemini`, `deepseek`).
- `aliases` (string[]): Set of alternate names that resolve to this canonical model (e.g. `gemini-2.5-flash`).
- `capabilities` (object): Feature flags supported by this model:
  - `chat`: Can handle chat completions.
  - `stream`: Supports real-time Server-Sent Events (SSE).
  - `tools`: Supports function/tool calling (OpenAI format or DSML).
  - `vision`: Supports image input inputs.
  - `json`: Supports structured JSON output mode.
- `active` (boolean): Whether the model is currently enabled for routing.
- `owned_by` (string): Provider ownership tag displayed in `/v1/models`.

### 3.2 Collision Detection
- Registering a model with an existing canonical ID throws an error.
- Registering an alias that collides with an existing canonical ID throws an error.

### 3.3 Dynamic OpenAI Model Listing
The `/v1/models` endpoint calls `modelRegistry.listModels()`, which returns both canonical models and their aliases as distinct OpenAI-formatted model objects:
```json
{
  "object": "list",
  "data": [
    {
      "id": "gemini-flash",
      "object": "model",
      "created": 1700000000,
      "owned_by": "google",
      "permission": [],
      "root": "gemini-flash",
      "parent": null
    },
    {
      "id": "gemini-2.5-flash",
      "object": "model",
      "created": 1700000000,
      "owned_by": "google",
      "permission": [],
      "root": "gemini-flash",
      "parent": null
    }
  ]
}
```

---

## 4. ModelRouter (`src/providers/ModelRouter.js`)

The `ModelRouter` bridges incoming model strings to the appropriate `ProviderAdapter`.

### 4.1 Resolution Algorithm

1. **Resolution via Registry**:
   - `modelRegistry.resolve(requestedModelId)` looks up the canonical model or alias.
   - If not found, `ModelRouter` queries registered providers via `provider.supportsModel(requestedModelId)` for dynamic model support.
   - If neither resolves, `ModelRouter.resolve` throws an error with HTTP status **404** (`code: 'model_not_found'`).

2. **Active Check**:
   - If the model is marked `active: false`, throws HTTP **503** (`code: 'model_unavailable'`).

3. **Provider Existence Check**:
   - Retrieves the backing provider from `ProviderRegistry`.
   - If provider is not registered or not active, throws HTTP **503** (`code: 'model_unavailable'`).

4. **Capability Negotiation**:
   - If the caller requires a capability (e.g. `requiredCapability: 'tools'`), the router inspects the model's capabilities.
   - If unsupported, throws HTTP **400** (`code: 'capability_not_supported'`, message: `"Model '<modelId>' does not support requested capability: '<capability>'"`).

5. **Return**:
   - Returns `{ provider, canonicalModelId, modelDef }`.

---

## 5. Error Contract

When routing fails, errors conform strictly to OpenAI error specifications:

| Scenario | HTTP Status | Error Type | Error Code | Param |
| :--- | :--- | :--- | :--- | :--- |
| Unknown Model | 404 | `invalid_request_error` | `model_not_found` | `model` |
| Inactive / Unavailable Provider | 503 | `service_unavailable` | `model_unavailable` | `model` |
| Unsupported Capability (e.g. Tools) | 400 | `invalid_request_error` | `capability_not_supported` | `tools` / `model` |
