import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/app.js';
import http from 'node:http';

test('GET /dashboard serves HTML Developer Dashboard', async () => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/dashboard`);
    assert.equal(res.status, 200);
    const contentType = res.headers.get('content-type');
    assert.ok(contentType.includes('text/html'));
    const body = await res.text();
    assert.ok(body.includes('Universal AI Agent Infrastructure'));
    assert.ok(body.includes('Tools Explorer'));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('GET /dashboard/api/stats returns aggregated infrastructure metrics', async () => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/dashboard/api/stats`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'healthy');
    assert.ok(Array.isArray(data.models));
    assert.ok(Array.isArray(data.tools));
    assert.ok(Array.isArray(data.agentRuns));
    assert.ok(Array.isArray(data.devices));
    assert.ok(Array.isArray(data.sandboxes));
    assert.ok(data.tools.length > 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
