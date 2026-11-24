import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { app } from '../src/app.js';
import { config } from '../src/config/index.js';
import { resetRateLimits } from '../src/middleware/rateLimiter.js';

test('DeepSeek Harness Compatibility: Models Discovery (/v1/models)', async () => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/models`);
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.object, 'list');
    assert.ok(Array.isArray(body.data));

    // Verify model structure expected by DeepSeek Harness / OpenAI SDK
    const sample = body.data[0];
    assert.ok(sample.id);
    assert.equal(sample.object, 'model');
    assert.equal(typeof sample.created, 'number');
    assert.ok(sample.owned_by);

    // Verify DeepSeek aliases or standard aliases exist
    const modelIds = body.data.map(m => m.id);
    assert.ok(modelIds.includes('gemini-flash') || modelIds.includes('default'));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('DeepSeek Harness Compatibility: Chat Completions Validation & Contract', async () => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  try {
    // 1. Validation error conforming to OpenAI error schema
    const invalidRes = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-flash',
        messages: 'not an array'
      })
    });

    assert.equal(invalidRes.status, 400);
    const errBody = await invalidRes.json();
    assert.ok(errBody.error);
    assert.ok(errBody.error.message);
    assert.equal(errBody.error.type, 'invalid_request_error');

    // 2. Responses API compatibility (/v1/responses)
    const respRes = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-flash',
        input: 'Ping'
      })
    });

    assert.equal(respRes.status, 200);
    const respBody = await respRes.json();
    assert.equal(respBody.object, 'response');
    assert.ok(respBody.output);

  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('DeepSeek Harness Compatibility: Rate Limiter 429 Retry-After Headers', async () => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  try {
    resetRateLimits();
    const origLimit = config.rateLimitMax;
    config.rateLimitMax = 2;

    try {
      // 1st & 2nd request pass
      await fetch(`http://127.0.0.1:${port}/v1/models`);
      await fetch(`http://127.0.0.1:${port}/v1/models`);

      // 3rd request triggers 429
      const rateLimitedRes = await fetch(`http://127.0.0.1:${port}/v1/models`);
      assert.equal(rateLimitedRes.status, 429);
      assert.ok(rateLimitedRes.headers.get('retry-after'));

      const body = await rateLimitedRes.json();
      assert.equal(body.error.type, 'rate_limit_error');
    } finally {
      resetRateLimits();
      config.rateLimitMax = origLimit;
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
