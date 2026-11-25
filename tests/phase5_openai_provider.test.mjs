import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { app } from '../src/app.js';
import {
  providerRegistry,
  modelRegistry,
  modelRouter
} from '../src/providers/index.js';

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

// ── Test 1: Provider Registry Verification ──────────────────────────────────
test('OpenAI Removal: ProviderRegistry contains only Gemini Web and has no OpenAI adapter', () => {
  assert.equal(providerRegistry.hasProvider('gemini'), true);
  assert.equal(providerRegistry.hasProvider('openai'), false);
  assert.equal(providerRegistry.getProvider('openai'), null);

  const allProviders = providerRegistry.getAllProviders();
  assert.equal(allProviders.length, 1);
  assert.equal(allProviders[0].id, 'gemini');
  assert.equal(allProviders[0].name, 'Google Gemini Web');
});

// ── Test 2: Model Registry Verification ─────────────────────────────────────
test('OpenAI Removal: ModelRegistry advertises only genuine Gemini models and zero OpenAI models', () => {
  const models = modelRegistry.listModels();
  const modelIds = models.map(m => m.id);

  // Gemini models must be present
  assert.ok(modelIds.includes('gemini-flash'));
  assert.ok(modelIds.includes('gemini-pro'));
  assert.ok(modelIds.includes('gemini-thinking'));
  assert.ok(modelIds.includes('gemini-lite'));

  // OpenAI models must NOT be present
  const forbiddenOpenAIModels = [
    'gpt-4o',
    'gpt-4o-mini',
    'o1',
    'o1-mini',
    'o1-preview',
    'o3-mini',
    'gpt-4-turbo',
    'gpt-3.5-turbo'
  ];

  for (const forbidden of forbiddenOpenAIModels) {
    assert.equal(modelRegistry.hasModel(forbidden), false, `Forbidden model ${forbidden} must not exist`);
    assert.equal(modelRegistry.getModel(forbidden), null);
    assert.equal(models.some(m => m.id === forbidden), false);
  }

  // All advertised models must have owned_by: google
  for (const m of models) {
    assert.equal(m.owned_by, 'google');
  }
});

// ── Test 3: Router Fail-Closed on OpenAI and Foreign Models ──────────────────
test('OpenAI Removal: ModelRouter fails closed on OpenAI and foreign model requests', () => {
  const foreignModels = ['gpt-4o', 'gpt-4o-mini', 'o1', 'o3-mini', 'claude-3-5-sonnet', 'deepseek-chat'];

  for (const mId of foreignModels) {
    assert.throws(
      () => modelRouter.resolve(mId),
      (err) => {
        return (
          err.status === 404 &&
          err.code === 'model_not_found' &&
          err.message.includes('unconfigured provider') &&
          err.message.includes('Gemini Web')
        );
      },
      `ModelRouter should reject ${mId} with explicit unconfigured provider error`
    );
  }
});

// ── Test 4: HTTP GET /v1/models/gpt-4o returns 404 ─────────────────────────
test('OpenAI Removal: GET /v1/models/:model returns 404 for OpenAI models', async () => {
  const res = await fetch(`${baseUrl}/v1/models/gpt-4o`);
  assert.equal(res.status, 404);
  const data = await res.json();
  assert.equal(data.error.code, 'model_not_found');
  assert.ok(data.error.message.includes('gpt-4o'));
});

// ── Test 5: HTTP POST /v1/chat/completions with OpenAI models fails closed ───
test('OpenAI Removal: POST /v1/chat/completions fails closed with 404 for gpt-4o without fallback', async () => {
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello OpenAI' }]
    })
  });

  assert.equal(res.status, 404);
  const data = await res.json();
  assert.equal(data.error.code, 'model_not_found');
  assert.ok(data.error.message.includes('unconfigured provider'));
  assert.ok(data.error.message.includes('Gemini Web'));
});

// ── Test 6: HTTP POST /v1/chat/completions with o1 / o3-mini fails closed ────
test('OpenAI Removal: POST /v1/chat/completions fails closed with 404 for reasoning models o1 and o3-mini', async () => {
  for (const model of ['o1', 'o3-mini']) {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Solve this' }]
      })
    });

    assert.equal(res.status, 404);
    const data = await res.json();
    assert.equal(data.error.code, 'model_not_found');
  }
});

// ── Test 7: HTTP POST /v1/chat/completions with Claude / DeepSeek fails closed
test('OpenAI Removal: POST /v1/chat/completions fails closed for Claude and DeepSeek', async () => {
  for (const model of ['claude-3-opus', 'deepseek-chat', 'deepseek-reasoner']) {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Hello' }]
      })
    });

    assert.equal(res.status, 404);
    const data = await res.json();
    assert.equal(data.error.code, 'model_not_found');
  }
});

// ── Test 8: Health endpoint reports Gemini service only ────────────────────
test('OpenAI Removal: Health check endpoint reflects single Gemini service', async () => {
  const res = await fetch(`${baseUrl}/health`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.status, 'ok');
  assert.equal(data.service, 'Google Gemini Web to OpenAI Proxy');
  assert.equal(data.openai, undefined);
});
