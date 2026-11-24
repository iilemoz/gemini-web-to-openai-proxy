import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { app } from '../src/app.js';
import { isUpstreamErrorText } from '../src/utils/upstreamErrors.js';
import { registry } from '../src/providers/index.js';

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
    await new Promise((resolve) => server.close(resolve));
  }
});

test('isUpstreamErrorText detects Google Gemini Web error fallback strings', () => {
  assert.equal(isUpstreamErrorText('I encountered an error doing what you asked. Could you try again?'), true);
  assert.equal(isUpstreamErrorText('I seem to be encountering an error. Can I try something else for you?'), true);
  assert.equal(isUpstreamErrorText('Something went wrong on our end.'), true);
  assert.equal(isUpstreamErrorText('An internal error occurred. Please try again later.'), true);

  // Normal text should not trigger
  assert.equal(isUpstreamErrorText('Hello! How can I help you today?'), false);
  assert.equal(isUpstreamErrorText('The result of 2 + 2 is 4.'), false);
  assert.equal(isUpstreamErrorText(''), false);
  assert.equal(isUpstreamErrorText(null), false);
});

test('POST /v1/responses rejects missing input with 400', async () => {
  const res = await fetch(`${baseUrl}/v1/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gemini-flash' })
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.error.code, 'missing_input');
});

test('POST /v1/responses returns HTTP 502 when upstream returns generic error message', async () => {
  // Mock provider temporarily
  const originalProvider = registry.defaultProvider;
  const mockProvider = {
    name: 'gemini',
    chatComplete: async function* () {
      yield { type: 'content', text: 'I encountered an error doing what you asked. Could you try again?' };
    }
  };
  registry.defaultProvider = mockProvider;

  try {
    const res = await fetch(`${baseUrl}/v1/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gemini-flash', input: 'Hello' })
    });

    assert.equal(res.status, 502);
    const data = await res.json();
    assert.equal(data.error.type, 'upstream_error');
    assert.equal(data.error.code, 'model_error');
    assert.match(data.error.message, /Upstream model error/);
  } finally {
    registry.defaultProvider = originalProvider;
  }
});

test('POST /v1/responses returns HTTP 200 with valid contract on meaningful completion', async () => {
  // Mock provider to return valid content
  const originalProvider = registry.defaultProvider;
  const mockProvider = {
    name: 'gemini',
    chatComplete: async function* () {
      yield { type: 'content', text: 'Pong! Service operational.' };
    }
  };
  registry.defaultProvider = mockProvider;

  try {
    const res = await fetch(`${baseUrl}/v1/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-flash',
        input: 'Ping test',
        instructions: 'Answer briefly'
      })
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.object, 'response');
    assert.equal(data.status, 'completed');
    assert.ok(data.id.startsWith('resp-'));
    assert.ok(Array.isArray(data.output));
    assert.equal(data.output[0].role, 'assistant');
    assert.equal(data.output[0].content[0].type, 'text');
    assert.equal(data.output[0].content[0].text, 'Pong! Service operational.');
    assert.ok(data.usage.total_tokens > 0);
  } finally {
    registry.defaultProvider = originalProvider;
  }
});
