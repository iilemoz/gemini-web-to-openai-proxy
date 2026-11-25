import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ModelRegistry } from '../src/providers/ModelRegistry.js';
import { ProviderRegistry } from '../src/providers/ProviderRegistry.js';
import { ModelRouter } from '../src/providers/ModelRouter.js';
import { BaseProvider } from '../src/providers/BaseProvider.js';
import { app } from '../src/app.js';
import { modelRegistry as globalModelRegistry, modelRouter as globalModelRouter } from '../src/providers/index.js';

// Dummy provider for isolated testing
class MockTestProvider extends BaseProvider {
  constructor(id = 'mock-provider', name = 'Mock Test Provider') {
    super({ id, name });
    this.models = [];
  }

  setModels(models) {
    this.models = models;
  }

  getModels() {
    return this.models;
  }

  async *chatComplete() {
    yield { type: 'text', text: 'mock completion' };
  }
}

test('PHASE 5.0A: ModelRegistry - Canonical Model Uniqueness & Provider Validation', () => {
  const registry = new ModelRegistry();

  // Rejects missing id or providerId
  assert.throws(() => registry.registerModel({}), /id/);
  assert.throws(() => registry.registerModel({ id: 'test-model' }), /providerId/);
  assert.throws(() => registry.registerModel({ id: '  ', providerId: 'p' }), /id/);

  // Successfully registers a valid canonical model
  registry.registerModel({
    id: 'model-a',
    providerId: 'provider-1',
    upstreamModelId: 'upstream-a-v1',
    description: 'Test Model A',
    capabilities: { chat: true, stream: true, tools: true, vision: true, json: true }
  });

  assert.equal(registry.hasModel('model-a'), true);
  assert.equal(registry.hasModel('MODEL-A'), true); // Case-insensitive
  const retrieved = registry.getModel('model-a');
  assert.equal(retrieved.id, 'model-a');
  assert.equal(retrieved.upstreamModelId, 'upstream-a-v1');
  assert.equal(retrieved.providerId, 'provider-1');

  // Rejects duplicate canonical model registration (case-insensitive)
  assert.throws(() => {
    registry.registerModel({
      id: 'MODEL-A',
      providerId: 'provider-2'
    });
  }, /already registered/);
});

test('PHASE 5.0A: ModelRegistry - Upstream Model ID Validation & Defaults', () => {
  const registry = new ModelRegistry();

  // When upstreamModelId is omitted, defaults to canonical id
  registry.registerModel({
    id: 'model-default-upstream',
    providerId: 'provider-1'
  });
  const m1 = registry.getModel('model-default-upstream');
  assert.equal(m1.upstreamModelId, 'model-default-upstream');

  // When upstreamModelId is provided, preserves it accurately
  registry.registerModel({
    id: 'custom-model',
    providerId: 'provider-1',
    upstreamModelId: 'google/gemini-2.5-flash-preview-02-05'
  });
  const m2 = registry.getModel('custom-model');
  assert.equal(m2.upstreamModelId, 'google/gemini-2.5-flash-preview-02-05');
});

test('PHASE 5.0A: ModelRegistry - Rejection of Alias Collisions & Circular Chaining', () => {
  const registry = new ModelRegistry();

  registry.registerModel({
    id: 'canonical-alpha',
    providerId: 'p1',
    aliases: ['alias-alpha-1', 'alias-alpha-2']
  });

  // Alias cannot be identical to canonical ID
  assert.throws(() => {
    registry.registerModel({
      id: 'canonical-beta',
      providerId: 'p1',
      aliases: ['CANONICAL-BETA']
    });
  }, /cannot be identical/);

  // Rejects alias that collides with an existing canonical model
  assert.throws(() => {
    registry.registerModel({
      id: 'canonical-beta',
      providerId: 'p1',
      aliases: ['canonical-alpha']
    });
  }, /conflicts with an existing canonical model/);

  // Rejects alias that collides with an existing alias
  assert.throws(() => {
    registry.registerModel({
      id: 'canonical-gamma',
      providerId: 'p1',
      aliases: ['alias-alpha-1']
    });
  }, /conflicts with an existing alias/);

  // Rejects canonical model ID colliding with existing alias
  assert.throws(() => {
    registry.registerModel({
      id: 'alias-alpha-2',
      providerId: 'p1'
    });
  }, /conflicts with an existing alias/);

  // Rejects duplicate aliases within same definition
  assert.throws(() => {
    registry.registerModel({
      id: 'canonical-delta',
      providerId: 'p1',
      aliases: ['alias-delta', 'ALIAS-DELTA']
    });
  }, /Duplicate alias/);
});

test('PHASE 5.0A: ModelRegistry - Deterministic Resolution Chain & Case Insensitivity', () => {
  const registry = new ModelRegistry();

  registry.registerModel({
    id: 'gemini-2.5-flash',
    providerId: 'gemini',
    upstreamModelId: 'gemini-2.5-flash',
    aliases: ['gemini-flash', 'fast-flash']
  });

  // Resolve by canonical ID with various casing
  const res1 = registry.resolve('gemini-2.5-flash');
  assert.equal(res1.canonicalId, 'gemini-2.5-flash');
  assert.equal(res1.isAlias, false);
  assert.equal(res1.providerId, 'gemini');
  assert.equal(res1.upstreamModelId, 'gemini-2.5-flash');

  const res2 = registry.resolve('GEMINI-2.5-FLASH');
  assert.equal(res2.canonicalId, 'gemini-2.5-flash');
  assert.equal(res2.isAlias, false);

  // Resolve by alias with various casing
  const resAlias = registry.resolve('GEMINI-FLASH');
  assert.equal(resAlias.canonicalId, 'gemini-2.5-flash');
  assert.equal(resAlias.isAlias, true);
  assert.equal(resAlias.requestedId, 'GEMINI-FLASH');
  assert.equal(resAlias.providerId, 'gemini');
  assert.equal(resAlias.upstreamModelId, 'gemini-2.5-flash');

  // Unknown model returns null
  assert.equal(registry.resolve('unknown-model'), null);
});

test('PHASE 5.0A: ModelRegistry - Public listModels Truthfulness & Legacy Aliases', () => {
  const registry = new ModelRegistry();

  registry.registerModel({
    id: 'gemini-2.5-flash',
    providerId: 'gemini',
    owned_by: 'google',
    aliases: ['gemini-flash']
  });

  // Verify listModels only contains genuine models with genuine ownership
  const publicModels = registry.listModels();
  assert.equal(publicModels.length, 2); // canonical + alias
  assert.equal(publicModels[0].id, 'gemini-2.5-flash');
  assert.equal(publicModels[0].owned_by, 'google');
  assert.equal(publicModels[1].id, 'gemini-flash');
  assert.equal(publicModels[1].owned_by, 'google');

  // Register synthetic legacy alias
  registry.registerLegacyAlias('gpt-4o', 'gemini-2.5-flash', 'Compatibility alias');
  assert.equal(registry.isLegacyAlias('gpt-4o'), true);
  assert.equal(registry.isLegacyAlias('gemini-flash'), false);

  // Public listModels must NOT expose synthetic aliases by default
  const defaultList = registry.listModels({ includeSynthetic: false });
  assert.equal(defaultList.some(m => m.id === 'gpt-4o'), false);

  // Even if explicitly requested, synthetic alias points to canonical root and google ownership
  const listWithSynthetic = registry.listModels({ includeSynthetic: true });
  const syntheticEntry = listWithSynthetic.find(m => m.id === 'gpt-4o');
  assert.ok(syntheticEntry);
  assert.equal(syntheticEntry.root, 'gemini-2.5-flash');
  assert.equal(syntheticEntry.owned_by, 'google'); // NOT 'openai'!
});

test('PHASE 5.0A: ModelRouter - Fail-Closed Unknown Models & Foreign Provider Prefix', () => {
  const providerRegistry = new ProviderRegistry();
  const modelRegistry = new ModelRegistry();
  const router = new ModelRouter(providerRegistry, modelRegistry);

  const gemini = new MockTestProvider('gemini', 'Google Gemini Web');
  providerRegistry.register(gemini);

  modelRegistry.registerModel({
    id: 'gemini-2.5-flash',
    providerId: 'gemini',
    aliases: ['gemini-flash']
  });

  // 1. Missing model ID throws 400
  assert.throws(() => router.resolve(''), err => {
    return err.status === 400 && err.code === 'missing_model';
  });

  // 2. Arbitrary unknown model throws 404 model_not_found
  assert.throws(() => router.resolve('completely-unknown-model'), err => {
    return err.status === 404 && err.code === 'model_not_found';
  });

  // 3. Foreign provider prefixes (gpt-4o, deepseek-chat, claude-3) throw 404 with explicit truthful message
  assert.throws(() => router.resolve('gpt-4o'), err => {
    return err.status === 404 &&
      err.code === 'model_not_found' &&
      err.message.includes('unconfigured provider');
  });

  assert.throws(() => router.resolve('deepseek-chat'), err => {
    return err.status === 404 &&
      err.code === 'model_not_found' &&
      err.message.includes('unconfigured provider');
  });

  assert.throws(() => router.resolve('claude-3-opus'), err => {
    return err.status === 404 &&
      err.code === 'model_not_found' &&
      err.message.includes('unconfigured provider');
  });

  // 4. Legitimate model resolves strictly to its registered provider (NO silent fallback)
  const resolved = router.resolve('gemini-flash');
  assert.equal(resolved.provider.id, 'gemini');
  assert.equal(resolved.model.id, 'gemini-2.5-flash');
});

test('PHASE 5.0A: ModelRouter - Provider Offline & Capability Validation', () => {
  const providerRegistry = new ProviderRegistry();
  const modelRegistry = new ModelRegistry();
  const router = new ModelRouter(providerRegistry, modelRegistry);

  const gemini = new MockTestProvider('gemini', 'Google Gemini Web');
  providerRegistry.register(gemini);

  // Model associated with an uninstalled provider
  modelRegistry.registerModel({
    id: 'future-openai-model',
    providerId: 'openai-native'
  });

  // Throws 503 provider_unavailable when provider adapter is not installed
  assert.throws(() => router.resolve('future-openai-model'), err => {
    return err.status === 503 && err.code === 'provider_unavailable';
  });

  // Capability validation
  modelRegistry.registerModel({
    id: 'gemini-thinking',
    providerId: 'gemini',
    capabilities: {
      chat: true,
      stream: true,
      tools: false,
      vision: false,
      json: false,
      reasoning: true
    }
  });

  // Asking for tools on gemini-thinking fails closed with 400
  assert.throws(() => {
    router.resolve('gemini-thinking', { requiredCapability: 'tools' });
  }, err => {
    return err.status === 400 && err.code === 'capability_not_supported' && err.param === 'tools';
  });

  // Asking for vision on gemini-thinking fails closed with 400
  assert.throws(() => {
    router.resolve('gemini-thinking', { requiredCapabilities: ['vision'] });
  }, err => {
    return err.status === 400 && err.code === 'capability_not_supported' && err.param === 'vision';
  });

  // Asking for chat / stream succeeds
  const res = router.resolve('gemini-thinking', { requiredCapability: 'stream' });
  assert.equal(res.model.id, 'gemini-thinking');
});

test('PHASE 5.0A: HTTP Integration - GET /v1/models reflects genuine models only', async () => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/models`);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.object, 'list');
    assert.ok(Array.isArray(body.data));

    // Ensure all advertised models are owned by 'google' and none are fake openai / deepseek
    for (const m of body.data) {
      assert.equal(m.owned_by, 'google');
      assert.notEqual(m.id, 'gpt-4o');
      assert.notEqual(m.id, 'deepseek-chat');
      assert.notEqual(m.id, 'deepseek-reasoner');
    }

    // Verify key genuine models exist
    const ids = body.data.map(m => m.id);
    assert.ok(ids.includes('gemini-flash'));
    assert.ok(ids.includes('gemini-pro'));
    assert.ok(ids.includes('gemini-thinking'));
  } finally {
    server.close();
  }
});

test('PHASE 5.0A: HTTP Integration - GET /v1/models/:model case-insensitivity & 404', async () => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  try {
    // Exact canonical
    const res1 = await fetch(`http://127.0.0.1:${port}/v1/models/gemini-flash`);
    assert.equal(res1.status, 200);
    const body1 = await res1.json();
    assert.equal(body1.owned_by, 'google');

    // Case-insensitive lookup
    const res2 = await fetch(`http://127.0.0.1:${port}/v1/models/GEMINI-FLASH`);
    assert.equal(res2.status, 200);

    // Fake models rejected with 404 (when ENABLE_LEGACY_CROSS_PROVIDER_ALIASES is off)
    const resFake1 = await fetch(`http://127.0.0.1:${port}/v1/models/gpt-4o`);
    assert.equal(resFake1.status, 404);

    const resFake2 = await fetch(`http://127.0.0.1:${port}/v1/models/deepseek-chat`);
    assert.equal(resFake2.status, 404);
  } finally {
    server.close();
  }
});

test('PHASE 5.0A: HTTP Integration - POST /v1/chat/completions fails closed on unconfigured models & capability violations', async () => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  try {
    // 1. Unknown foreign model gpt-4o returns 404 model_not_found
    const res1 = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hello' }]
      })
    });
    assert.equal(res1.status, 404);
    const body1 = await res1.json();
    assert.equal(body1.error.code, 'model_not_found');
    assert.ok(body1.error.message.includes('unconfigured provider'));

    // 2. Unknown foreign model deepseek-chat returns 404 model_not_found
    const res2 = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: 'hello' }]
      })
    });
    assert.equal(res2.status, 404);
    const body2 = await res2.json();
    assert.equal(body2.error.code, 'model_not_found');

    // 3. Capability violation: requesting tools on gemini-thinking returns 400 capability_not_supported
    const res3 = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-thinking',
        messages: [{ role: 'user', content: 'calculate this' }],
        tools: [{
          type: 'function',
          function: { name: 'calculator', description: 'calculate' }
        }]
      })
    });
    assert.equal(res3.status, 400);
    const body3 = await res3.json();
    assert.equal(body3.error.code, 'capability_not_supported');
    assert.equal(body3.error.param, 'tools');

    // 4. Capability violation: requesting vision on gemini-thinking returns 400 capability_not_supported
    const res4 = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-thinking',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'what is this image?' },
            { type: 'image_url', image_url: { url: 'https://example.com/cat.jpg' } }
          ]
        }]
      })
    });
    assert.equal(res4.status, 400);
    const body4 = await res4.json();
    assert.equal(body4.error.code, 'capability_not_supported');
    assert.equal(body4.error.param, 'vision');
  } finally {
    server.close();
  }
});
