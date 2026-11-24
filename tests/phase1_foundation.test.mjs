import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { app } from '../src/app.js';
import { config } from '../src/config/index.js';
import { resetRateLimits } from '../src/middleware/rateLimiter.js';

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
  config.proxyApiKey = '';
  config.rateLimitMax = 120;
});

test('GET /healthz returns 200 OK', async () => {
  const res = await fetch(`${baseUrl}/healthz`);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.equal(text, 'OK');
});

test('Request validation rejects invalid role', async () => {
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'super_admin', content: 'test' }]
    })
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.error.code, 'invalid_role');
});

test('Request validation rejects invalid temperature', async () => {
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'hello' }],
      temperature: 5.5
    })
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.error.code, 'invalid_temperature');
});

test('Request validation rejects invalid max_tokens', async () => {
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: -10
    })
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.error.code, 'invalid_max_tokens');
});

test('Auth middleware enforces PROXY_API_KEY when configured', async () => {
  config.proxyApiKey = 'secret-test-token-123';

  // Request without key
  const unauthRes = await fetch(`${baseUrl}/v1/models`);
  assert.equal(unauthRes.status, 401);
  const errData = await unauthRes.json();
  assert.equal(errData.error.code, 'invalid_api_key');

  // Request with invalid key
  const invalidRes = await fetch(`${baseUrl}/v1/models`, {
    headers: { 'Authorization': 'Bearer wrong-key' }
  });
  assert.equal(invalidRes.status, 401);

  // Request with correct key
  const authRes = await fetch(`${baseUrl}/v1/models`, {
    headers: { 'Authorization': 'Bearer secret-test-token-123' }
  });
  assert.equal(authRes.status, 200);

  // Reset
  config.proxyApiKey = '';
});

test('Rate limiter enforces max requests limit', async () => {
  resetRateLimits();
  config.rateLimitMax = 3;

  for (let i = 0; i < 3; i++) {
    const res = await fetch(`${baseUrl}/v1/models`);
    assert.equal(res.status, 200);
  }

  // 4th request should be rate-limited
  const limitedRes = await fetch(`${baseUrl}/v1/models`);
  assert.equal(limitedRes.status, 429);
  const data = await limitedRes.json();
  assert.equal(data.error.code, 'rate_limit_exceeded');

  // Reset
  resetRateLimits();
  config.rateLimitMax = 120;
});
