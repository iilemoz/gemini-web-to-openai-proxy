import test from 'node:test';
import assert from 'node:assert/strict';
import { dockerManager, containerManager, cloudRuntime } from '../src/runtime/index.js';
import { app } from '../src/app.js';
import http from 'node:http';

test('DockerManager checks availability without crashing', async () => {
  const available = await dockerManager.isDockerAvailable();
  assert.equal(typeof available, 'boolean');
});

test('ContainerManager creates and manages sandboxed workspace', async () => {
  const sandbox = await containerManager.createSandbox({
    image: 'node:20-alpine',
    memoryLimit: '256m'
  });

  assert.ok(sandbox.id.startsWith('sandbox_'));
  assert.ok(['docker', 'process_fallback'].includes(sandbox.mode));
  assert.equal(sandbox.status, 'ready');

  // File write and read inside sandbox
  await containerManager.writeFile(sandbox.id, 'test.txt', 'hello from cloud sandbox');
  const fileRes = await containerManager.readFile(sandbox.id, 'test.txt');
  assert.equal(fileRes.content, 'hello from cloud sandbox');

  // Execute command inside sandbox
  const cmd = process.platform === 'win32' && sandbox.mode === 'process_fallback'
    ? 'echo cloud_ok'
    : 'echo cloud_ok';
  const execRes = await containerManager.executeInSandbox(sandbox.id, cmd);
  assert.ok(execRes.stdout.includes('cloud_ok'));

  // Clean up
  const destroyed = await containerManager.destroySandbox(sandbox.id);
  assert.equal(destroyed, true);
});

test('Cloud Runtime HTTP Endpoints (/v1/runtime/cloud/*)', async () => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  try {
    // 1. GET /v1/runtime/cloud/status
    const resStatus = await fetch(`http://127.0.0.1:${port}/v1/runtime/cloud/status`);
    assert.equal(resStatus.status, 200);
    const statusData = await resStatus.json();
    assert.equal(statusData.status, 'active');
    assert.equal(typeof statusData.dockerAvailable, 'boolean');

    // 2. POST /v1/runtime/cloud/sandboxes
    const resCreate = await fetch(`http://127.0.0.1:${port}/v1/runtime/cloud/sandboxes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memoryLimit: '256m' })
    });
    assert.equal(resCreate.status, 201);
    const sandbox = await resCreate.json();
    assert.ok(sandbox.id);

    // 3. POST /v1/runtime/cloud/sandboxes/:id/exec
    const resExec = await fetch(`http://127.0.0.1:${port}/v1/runtime/cloud/sandboxes/${sandbox.id}/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'echo cloud_http_test' })
    });
    assert.equal(resExec.status, 200);
    const execData = await resExec.json();
    assert.ok(execData.stdout.includes('cloud_http_test'));

    // 4. DELETE /v1/runtime/cloud/sandboxes/:id
    const resDel = await fetch(`http://127.0.0.1:${port}/v1/runtime/cloud/sandboxes/${sandbox.id}`, {
      method: 'DELETE'
    });
    assert.equal(resDel.status, 200);
    const delData = await resDel.json();
    assert.equal(delData.status, 'destroyed');

  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
