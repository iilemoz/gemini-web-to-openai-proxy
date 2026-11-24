import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { app } from '../src/app.js';
import { toolRegistry, toolDiscovery, toolDispatcher } from '../src/tools/index.js';
import { ToolValidator } from '../src/tools/dispatcher/ToolValidator.js';

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

test('ToolRegistry registers and lists builtins', () => {
  assert.ok(toolRegistry.has('echo'));
  assert.ok(toolRegistry.has('calculator'));
  assert.ok(toolRegistry.has('system_info'));

  const list = toolRegistry.list();
  assert.ok(list.length >= 3);
  assert.ok(list.some(t => t.name === 'echo'));
});

test('ToolDiscovery filters by permissions and target', () => {
  const allTools = toolDiscovery.findAvailable(['all']);
  assert.ok(allTools.length >= 3);

  const noPermTools = toolDiscovery.findAvailable(['none']);
  assert.ok(noPermTools.some(t => t.name === 'echo'));
  assert.ok(!noPermTools.some(t => t.name === 'system_info'), 'system_info requires read:system');

  const searched = toolDiscovery.search('calculator');
  assert.equal(searched.length, 1);
  assert.equal(searched[0].name, 'calculator');
});

test('ToolValidator validates JSON arguments against schema', () => {
  const schema = {
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        count: { type: 'number' }
      },
      required: ['text']
    }
  };

  const valid = ToolValidator.validate(schema, { text: 'hi', count: 5 });
  assert.equal(valid.valid, true);

  const missingReq = ToolValidator.validate(schema, { count: 5 });
  assert.equal(missingReq.valid, false);
  assert.ok(missingReq.error.includes('Missing required parameter'));

  const wrongType = ToolValidator.validate(schema, { text: 123 });
  assert.equal(wrongType.valid, false);
  assert.ok(wrongType.error.includes('must be a string'));
});

test('ToolDispatcher executes echo tool correctly', async () => {
  const res = await toolDispatcher.dispatch({
    name: 'echo',
    arguments: { message: 'hello world' }
  });

  assert.equal(res.role, 'tool');
  assert.equal(res.name, 'echo');
  assert.equal(res.is_error, false);
  const data = JSON.parse(res.content);
  assert.equal(data.echoed, 'hello world');
  assert.ok(res.meta.durationMs >= 0);
});

test('ToolDispatcher executes calculator tool correctly', async () => {
  const res = await toolDispatcher.dispatch({
    name: 'calculator',
    arguments: { expression: '10 * 5 + 2' }
  });

  assert.equal(res.is_error, false);
  const data = JSON.parse(res.content);
  assert.equal(data.result, 52);
});

test('ToolDispatcher enforces permissions correctly', async () => {
  // Should fail when read:system permission is missing
  const deniedRes = await toolDispatcher.dispatch({
    name: 'system_info',
    arguments: {},
    grantedPermissions: ['none']
  });
  assert.equal(deniedRes.is_error, true);
  assert.ok(deniedRes.content.includes('Permission denied'));

  // Should succeed when read:system permission is granted
  const allowedRes = await toolDispatcher.dispatch({
    name: 'system_info',
    arguments: {},
    grantedPermissions: ['read:system']
  });
  assert.equal(allowedRes.is_error, false);
});

test('ToolDispatcher handles execution timeout', async () => {
  toolRegistry.register({
    schema: {
      name: 'slow_tool',
      description: 'Slow mock tool',
      timeoutMs: 50
    },
    handler: async () => {
      await new Promise(r => setTimeout(r, 200));
      return { ok: true };
    }
  });

  const res = await toolDispatcher.dispatch({
    name: 'slow_tool',
    arguments: {}
  });

  assert.equal(res.is_error, true);
  assert.ok(res.content.includes('timed out'));
});

test('GET /v1/tools endpoint returns list of tools', async () => {
  const res = await fetch(`${baseUrl}/v1/tools`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.object, 'list');
  assert.ok(Array.isArray(body.data));
  assert.ok(body.data.some(t => t.name === 'echo'));
});
