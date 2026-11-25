import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { app } from '../src/app.js';
import {
  ProviderRegistry,
  ModelRegistry,
  ModelRouter,
  BaseProvider,
  providerRegistry,
  modelRegistry,
  modelRouter
} from '../src/providers/index.js';
import { GeminiProvider } from '../src/providers/gemini/index.js';

let server;
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  if (server) {
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    await new Promise((resolve) => server.close(resolve));
  }
});

// ---------------------------------------------------------------------------
// 1. Provider Registry Unit Tests
// ---------------------------------------------------------------------------

test('ProviderRegistry: registers and retrieves provider', () => {
  const pReg = new ProviderRegistry();
  class TestProvider extends BaseProvider {
    constructor() {
      super({ id: 'test-p', name: 'Test Provider' });
    }
  }

  const p = new TestProvider();
  pReg.register(p);

  assert.equal(pReg.hasProvider('test-p'), true);
  assert.equal(pReg.getProvider('test-p'), p);
  assert.equal(pReg.getProvider('unknown-p'), null);
  assert.equal(pReg.getAllProviders().length, 1);
});

test('ProviderRegistry: rejects duplicate provider registration', () => {
  const pReg = new ProviderRegistry();
  class DummyProvider extends BaseProvider {
    constructor() {
      super({ id: 'dummy', name: 'Dummy' });
    }
  }

  pReg.register(new DummyProvider());
  assert.throws(
    () => pReg.register(new DummyProvider()),
    /Provider with ID 'dummy' is already registered/
  );
});

test('ProviderRegistry: rejects invalid provider registration', () => {
  const pReg = new ProviderRegistry();
  assert.throws(() => pReg.register(null), /Cannot register undefined or null provider/);
  assert.throws(() => pReg.register({}), /Provider must have a valid non-empty string "id"/);
});

// ---------------------------------------------------------------------------
// 2. Model Registry Unit Tests
// ---------------------------------------------------------------------------

test('ModelRegistry: registers and resolves canonical model IDs and aliases', () => {
  const mReg = new ModelRegistry();
  mReg.registerModel({
    id: 'my-model-1',
    providerId: 'prov-a',
    name: 'Model 1',
    description: 'Test Model',
    aliases: ['my-alias-1', 'my-alias-2'],
    capabilities: { chat: true, stream: true, tools: true }
  });

  const canonical = mReg.getModel('my-model-1');
  assert.ok(canonical);
  assert.equal(canonical.id, 'my-model-1');
  assert.equal(canonical.providerId, 'prov-a');

  const viaAlias1 = mReg.getModel('my-alias-1');
  assert.ok(viaAlias1);
  assert.equal(viaAlias1.id, 'my-model-1');

  const viaAlias2 = mReg.getModel('my-alias-2');
  assert.ok(viaAlias2);
  assert.equal(viaAlias2.id, 'my-model-1');

  assert.equal(mReg.getModel('non-existent'), null);
});

test('ModelRegistry: detects duplicate model registration', () => {
  const mReg = new ModelRegistry();
  mReg.registerModel({ id: 'dupe-model', providerId: 'prov' });

  assert.throws(
    () => mReg.registerModel({ id: 'dupe-model', providerId: 'prov' }),
    /Model 'dupe-model' is already registered/
  );
});

test('ModelRegistry: detects alias collision with canonical model', () => {
  const mReg = new ModelRegistry();
  mReg.registerModel({ id: 'primary-model', providerId: 'prov' });

  assert.throws(
    () => mReg.registerModel({ id: 'secondary-model', providerId: 'prov', aliases: ['primary-model'] }),
    /conflicts with an existing canonical model/
  );
});

test('ModelRegistry: listModels returns OpenAI format with canonical and aliases', () => {
  const mReg = new ModelRegistry();
  mReg.registerModel({
    id: 'base-model',
    providerId: 'prov',
    aliases: ['alias-model']
  });

  const list = mReg.listModels({ availableOnly: false, includeAliases: true });
  assert.equal(list.length, 2);
  const ids = list.map(m => m.id);
  assert.ok(ids.includes('base-model'));
  assert.ok(ids.includes('alias-model'));
  assert.equal(list[0].object, 'model');
});

// ---------------------------------------------------------------------------
// 3. Model Router Unit Tests
// ---------------------------------------------------------------------------

test('ModelRouter: resolves registered model to correct provider', () => {
  const pReg = new ProviderRegistry();
  const mReg = new ModelRegistry();
  const router = new ModelRouter(pReg, mReg);

  class MockAProvider extends BaseProvider {
    constructor() {
      super({ id: 'prov-a', name: 'Provider A' });
    }
  }

  const pA = new MockAProvider();
  pReg.register(pA);

  mReg.registerModel({
    id: 'model-a',
    providerId: 'prov-a',
    capabilities: { chat: true, stream: true, tools: true }
  });

  const resolved = router.resolve('model-a');
  assert.equal(resolved.provider, pA);
  assert.equal(resolved.model.id, 'model-a');
});

test('ModelRouter: rejects unknown model with 404 (NEVER silently fall back to Gemini)', () => {
  const pReg = new ProviderRegistry();
  const mReg = new ModelRegistry();
  const router = new ModelRouter(pReg, mReg);

  // Gemini is registered, but the requested model is completely unknown
  const gemini = new GeminiProvider();
  pReg.register(gemini);

  assert.throws(
    () => router.resolve('unknown-fancy-model-xyz'),
    (err) => {
      assert.equal(err.status, 404);
      assert.equal(err.code, 'model_not_found');
      assert.match(err.message, /The model 'unknown-fancy-model-xyz' does not exist/);
      return true;
    }
  );
});

test('ModelRouter: rejects inactive model with 503 model_unavailable', () => {
  const pReg = new ProviderRegistry();
  const mReg = new ModelRegistry();
  const router = new ModelRouter(pReg, mReg);

  class DummyProvider extends BaseProvider {
    constructor() {
      super({ id: 'p', name: 'P' });
    }
  }
  pReg.register(new DummyProvider());
  mReg.registerModel({
    id: 'inactive-model',
    providerId: 'p',
    isAvailable: false
  });

  assert.throws(
    () => router.resolve('inactive-model'),
    (err) => {
      assert.equal(err.status, 503);
      assert.equal(err.code, 'model_unavailable');
      return true;
    }
  );
});

test('ModelRouter: rejects unsupported capability with 400 capability_not_supported', () => {
  const pReg = new ProviderRegistry();
  const mReg = new ModelRegistry();
  const router = new ModelRouter(pReg, mReg);

  class NoToolsProvider extends BaseProvider {
    constructor() {
      super({ id: 'no-tools-p', name: 'No Tools Provider' });
    }
  }
  pReg.register(new NoToolsProvider());
  mReg.registerModel({
    id: 'reasoning-model',
    providerId: 'no-tools-p',
    capabilities: { chat: true, stream: true, tools: false }
  });

  assert.throws(
    () => router.resolve('reasoning-model', { requiredCapability: 'tools' }),
    (err) => {
      assert.equal(err.status, 400);
      assert.equal(err.code, 'capability_not_supported');
      assert.match(err.message, /does not support the 'tools' capability/);
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// 4. Gemini Adapter Implementation Tests
// ---------------------------------------------------------------------------

test('GeminiProvider: implements ProviderAdapter interface correctly', () => {
  const gemini = new GeminiProvider();

  assert.equal(gemini.id, 'gemini');
  assert.equal(gemini.name, 'Google Gemini Web');

  const configValidation = gemini.validateConfig();
  assert.equal(configValidation.valid, true);

  const models = gemini.getModels();
  assert.ok(models.length >= 4);
  assert.ok(models.some(m => m.id === 'gemini-flash'));
  assert.ok(models.some(m => m.id === 'gemini-pro'));
  assert.ok(models.some(m => m.id === 'gemini-thinking'));
  assert.ok(models.some(m => m.id === 'gemini-lite'));

  // Test supportsModel explicit matching (canonical models supported, misleading aliases rejected)
  assert.equal(gemini.supportsModel('gemini-flash'), true);
  assert.equal(gemini.supportsModel('gemini-2.5-flash'), false);
  assert.equal(gemini.supportsModel('gemini-pro'), true);
  assert.equal(gemini.supportsModel('non-gemini-model'), false);

  // Test capabilities (vision disabled for text-only proxy)
  const flashCaps = gemini.getCapabilities('gemini-flash');
  assert.equal(flashCaps.tools, true);
  assert.notEqual(flashCaps.vision, true);

  const thinkCaps = gemini.getCapabilities('gemini-thinking');
  assert.equal(thinkCaps.tools, false);
});

// ---------------------------------------------------------------------------
// 5. End-to-End API Routing & Integration Tests
// ---------------------------------------------------------------------------

test('E2E Routing: POST /v1/chat/completions with unknown model returns HTTP 404', async () => {
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'completely-unknown-model-xyz',
      messages: [{ role: 'user', content: 'hello' }]
    })
  });

  assert.equal(res.status, 404);
  const data = await res.json();
  assert.equal(data.error.code, 'model_not_found');
  assert.match(data.error.message, /does not exist or is not available/);
});

test('E2E Routing: POST /v1/chat/completions rejects tools on a model without tool capability with HTTP 400', async () => {
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-thinking',
      messages: [{ role: 'user', content: 'solve this' }],
      tools: [{
        type: 'function',
        function: { name: 'calculator', description: 'calculate' }
      }]
    })
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.error.code, 'capability_not_supported');
  assert.match(data.error.message, /does not support the 'tools' capability/);
});

test('E2E Routing: Can dynamically register a custom provider and route completions to it', async () => {
  class CustomTestProvider extends BaseProvider {
    constructor() {
      super({ id: 'custom-eco', name: 'Custom Eco Provider' });
      this.called = false;
    }
    getModels() {
      return [{
        id: 'eco-model-1',
        aliases: ['eco-flash'],
        capabilities: { chat: true, stream: true, tools: true }
      }];
    }
    async *chatComplete() {
      this.called = true;
      yield { type: 'content', text: 'Hello from custom eco provider!' };
    }
  }

  const customProvider = new CustomTestProvider();
  providerRegistry.register(customProvider);
  for (const m of customProvider.getModels()) {
    modelRegistry.registerModel({
      ...m,
      providerId: customProvider.id,
      owned_by: 'eco'
    });
  }

  try {
    // 1. Verify model discovery reflects new model
    const modelsRes = await fetch(`${baseUrl}/v1/models`);
    const modelsData = await modelsRes.json();
    assert.ok(modelsData.data.some(m => m.id === 'eco-model-1'));

    // 2. Execute completion through the new provider
    const chatRes = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'eco-flash',
        messages: [{ role: 'user', content: 'hi eco' }]
      })
    });

    assert.equal(chatRes.status, 200);
    const chatData = await chatRes.json();
    assert.equal(customProvider.called, true);
    assert.equal(chatData.choices[0].message.content, 'Hello from custom eco provider!');
  } finally {
    // Cleanup custom test provider
    modelRegistry.unregisterModel('eco-model-1');
    providerRegistry.unregister('custom-eco');
  }
});
