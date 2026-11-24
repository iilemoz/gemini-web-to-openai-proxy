import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { app } from '../src/app.js';
import { workspaceManager } from '../src/runtime/local/WorkspaceManager.js';
import { terminalManager } from '../src/runtime/local/TerminalManager.js';
import { deviceManager, sessionManager } from '../src/runtime/index.js';
import { toolDispatcher } from '../src/tools/index.js';

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

test('WorkspaceManager blocks path traversal outside authorized roots', async () => {
  const illegalPath = path.resolve(process.cwd(), '../../Windows/System32/calc.exe');
  assert.throws(() => {
    workspaceManager.assertAuthorized(illegalPath);
  }, /Security Exception: Access denied/);
});

test('WorkspaceManager filesystem CRUD works correctly', async () => {
  const testFile = 'tests/__temp_test_file.txt';

  // Write
  const writeRes = await workspaceManager.writeFile(testFile, 'initial content 123');
  assert.equal(writeRes.path, testFile);

  // Read
  const content = await workspaceManager.readFile(testFile);
  assert.equal(content, 'initial content 123');

  // Edit
  const editRes = await workspaceManager.editFile(testFile, '123', '456');
  assert.equal(editRes.status, 'edited');
  const updated = await workspaceManager.readFile(testFile);
  assert.equal(updated, 'initial content 456');

  // Info
  const info = await workspaceManager.getFileInfo(testFile);
  assert.equal(info.isDirectory, false);
  assert.ok(info.size > 0);

  // Delete
  const delRes = await workspaceManager.deleteFile(testFile);
  assert.equal(delRes.status, 'deleted');
});

test('ToolDispatcher executes local FS tools via registry', async () => {
  const testFile = 'tests/__temp_tool_fs.txt';

  // write_file tool
  const writeRes = await toolDispatcher.dispatch({
    name: 'write_file',
    arguments: { path: testFile, content: 'agent generated text' },
    grantedPermissions: ['write:fs']
  });
  assert.equal(writeRes.is_error, false);

  // read_file tool
  const readRes = await toolDispatcher.dispatch({
    name: 'read_file',
    arguments: { path: testFile },
    grantedPermissions: ['read:fs']
  });
  assert.equal(readRes.is_error, false);
  const data = JSON.parse(readRes.content);
  assert.equal(data.content, 'agent generated text');

  // clean up
  await workspaceManager.deleteFile(testFile);
});

test('TerminalManager executes command and captures output', async () => {
  const res = await terminalManager.executeCommand('echo terminal_ok');
  assert.equal(res.exitCode, 0);
  assert.ok(res.stdout.includes('terminal_ok'));
  assert.equal(res.timedOut, false);
});

test('DeviceManager pairing workflow', () => {
  const token = deviceManager.createPairingToken({ env: 'test' });
  assert.ok(token.startsWith('pair_'));

  const device = deviceManager.pairDevice(token, { name: 'DevLaptop', platform: 'windows' });
  assert.ok(device.id.startsWith('dev_'));
  assert.equal(device.name, 'DevLaptop');

  const list = deviceManager.listDevices();
  assert.ok(list.some(d => d.id === device.id));

  const revoked = deviceManager.revokeDevice(device.id);
  assert.equal(revoked, true);
});

test('Runtime HTTP endpoints: devices and sessions', async () => {
  // 1. Get pairing token
  const pairTokenRes = await fetch(`${baseUrl}/v1/runtime/devices/pair`, { method: 'POST' });
  assert.equal(pairTokenRes.status, 200);
  const { token } = await pairTokenRes.json();
  assert.ok(token);

  // 2. Pair device
  const pairRes = await fetch(`${baseUrl}/v1/runtime/devices/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, name: 'AgentNode', platform: 'linux' })
  });
  assert.equal(pairRes.status, 200);
  const pairData = await pairRes.json();
  assert.equal(pairData.status, 'paired');

  // 3. Create session
  const sessionRes = await fetch(`${baseUrl}/v1/runtime/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'local', workspacePath: process.cwd() })
  });
  assert.equal(sessionRes.status, 200);
  const session = await sessionRes.json();
  assert.ok(session.id.startsWith('sess_'));

  // 4. Delete session
  const delRes = await fetch(`${baseUrl}/v1/runtime/sessions/${session.id}`, { method: 'DELETE' });
  assert.equal(delRes.status, 200);
});
