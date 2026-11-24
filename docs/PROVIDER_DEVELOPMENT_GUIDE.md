# Provider Development Guide

## 1. Overview

This guide explains how to develop and register a new AI provider adapter in the Lemo Universal AI API Backend.

Following the architecture established in **Milestone 3.2**, all providers inherit from `BaseProvider` and register their models with `ModelRegistry`. New providers (e.g. OpenAI, DeepSeek, Anthropic, or Local Ollama) can be implemented without altering controllers, routes, or middleware.

---

## 2. Step-by-Step Implementation

### Step 1: Create the Provider Directory
Create a dedicated subfolder under `src/providers/`:
```bash
src/providers/
  ├── BaseProvider.js
  ├── ProviderRegistry.js
  ├── ModelRegistry.js
  ├── ModelRouter.js
  ├── gemini/
  │    └── index.js
  └── myprovider/
       ├── index.js
       └── client.js
```

### Step 2: Implement the Provider Adapter
Subclass `BaseProvider` and implement the core methods:

```javascript
// src/providers/myprovider/index.js
import { BaseProvider } from '../BaseProvider.js';
import { logger } from '../../utils/logger.js';

export class MyProvider extends BaseProvider {
  constructor(options = {}) {
    super('myprovider', options);
  }

  async initialize() {
    this.apiKey = process.env.MYPROVIDER_API_KEY;
    if (!this.apiKey) {
      logger.warn('[MyProvider] No API key configured');
    }
  }

  validateConfig() {
    return Boolean(this.apiKey);
  }

  getModels() {
    return [
      {
        id: 'my-flagship-model',
        aliases: ['my-flagship-latest', 'my-flagship-2027'],
        capabilities: {
          chat: true,
          stream: true,
          tools: true,
          vision: false,
          json: true
        },
        owned_by: 'myprovider'
      }
    ];
  }

  supportsModel(modelId) {
    return this.getModels().some(
      m => m.id === modelId || m.aliases.includes(modelId)
    );
  }

  getCapabilities(modelId) {
    const model = this.getModels().find(
      m => m.id === modelId || m.aliases.includes(modelId)
    );
    return model?.capabilities || { chat: true, stream: true, tools: false };
  }

  async *chatComplete(request) {
    const { model, messages, stream, tools, signal } = request;

    // Check client disconnect / abort signal
    if (signal?.aborted) {
      const err = new Error('Request aborted by client');
      err.name = 'AbortError';
      throw err;
    }

    // Call upstream API and yield chunks
    const responseStream = await fetch('https://api.myprovider.com/v1/chat', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model, messages, stream }),
      signal
    });

    if (!responseStream.ok) {
      const errorData = await responseStream.text();
      throw this.normalizeError({ status: responseStream.status, message: errorData });
    }

    // Yield response text chunks
    for await (const chunk of this.parseUpstreamStream(responseStream.body)) {
      if (signal?.aborted) break;
      yield chunk;
    }
  }

  normalizeError(error) {
    return {
      status: error?.status || 502,
      code: 'myprovider_error',
      message: error?.message || 'Upstream provider failure',
      type: 'api_error'
    };
  }
}
```

### Step 3: Register in Central Provider Hub
Open `src/providers/index.js` and register the new provider and its models:

```javascript
import { MyProvider } from './myprovider/index.js';

export const myProvider = new MyProvider();

// Register provider
providerRegistry.register(myProvider);

// Register models
for (const model of myProvider.getModels()) {
  modelRegistry.registerModel(model.id, 'myprovider', {
    aliases: model.aliases,
    capabilities: model.capabilities,
    owned_by: model.owned_by
  });
}
```

---

## 3. Best Practices & Guidelines

1. **Tool Calling & DSML**:
   - If the provider outputs tool calls natively in JSON or via DeepSeek Markup Language (`<tool_call>`), parse or yield appropriate structures so controllers can re-emit them in standard OpenAI format.
2. **AbortSignal Handling**:
   - Always propagate `request.signal` to internal `fetch` or HTTP requests so that when an IDE disconnects or a timeout occurs, upstream connections are torn down immediately.
3. **Graceful Error Normalization**:
   - Never expose raw upstream stack traces or tokens to the user. Always sanitize error messages using `normalizeError`.
4. **Unit & Integration Testing**:
   - Add unit tests in `tests/` verifying `supportsModel()`, `getCapabilities()`, and mock completions without requiring real external API keys.
