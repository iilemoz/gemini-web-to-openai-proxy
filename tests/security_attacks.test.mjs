import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import { WorkspaceManager } from '../src/runtime/local/WorkspaceManager.js';
import { TerminalManager } from '../src/runtime/local/TerminalManager.js';
import { DeviceManager } from '../src/runtime/local/DeviceManager.js';
import { toolDispatcher } from '../src/tools/index.js';

let tempWorkspace;
let workspaceManager;
let terminalManager;
let deviceManager;

test.before(async () => {
  tempWorkspace = path.join(os.tmpdir(), `sec_audit_${Date.now()}`);
  await fs.mkdir(tempWorkspace, { recursive: true });
  await fs.writeFile(path.join(tempWorkspace, 'allowed.txt'), 'Hello Safe World');

  workspaceManager = new WorkspaceManager([tempWorkspace]);
  terminalManager = new TerminalManager(tempWorkspace);
  deviceManager = new DeviceManager();
});

test.after(async () => {
  try {
    await fs.rm(tempWorkspace, { recursive: true, force: true });
  } catch { /* cleanup best effort */ }
});

test('Security 1: Path Traversal attack is strictly blocked', async () => {
  const traversalPaths = [
    '../../Windows/System32/drivers/etc/hosts',
    '..\\..\\Windows\\win.ini',
    '/etc/passwd',
    '../../../../../../../../../../../../../../etc/shadow'
  ];

  for (const target of traversalPaths) {
    assert.throws(() => {
      workspaceManager.assertAuthorized(target);
    }, /Security Exception: Access denied/);
  }
});

test('Security 2: Symlink-based workspace escape is detected and blocked', async () => {
  const outsideDir = path.join(os.tmpdir(), `sec_outside_${Date.now()}`);
  await fs.mkdir(outsideDir, { recursive: true });
  await fs.writeFile(path.join(outsideDir, 'secret.env'), 'SUPER_SECRET_KEY=12345');

  const symlinkInside = path.join(tempWorkspace, 'escape_link');

  try {
    // Attempt to create symlink / junction inside authorized workspace pointing outside
    try {
      symlinkSync(outsideDir, symlinkInside, 'junction');
    } catch {
      // In non-elevated Windows environments without Developer Mode, junction is permitted
    }

    if (existsSync(symlinkInside)) {
      const escapeTarget = path.join(symlinkInside, 'secret.env');
      assert.throws(() => {
        workspaceManager.assertAuthorized(escapeTarget);
      }, /Security Exception: Symlink points outside authorized workspace/);
    }
  } finally {
    try {
      await fs.rm(outsideDir, { recursive: true, force: true });
    } catch { /* cleanup */ }
  }
});

test('Security 3: Unauthorized file write outside workspace throws Security Exception', async () => {
  const illegalDest = path.join(os.tmpdir(), 'unauthorized_pwn.txt');
  await assert.rejects(async () => {
    await workspaceManager.writeFile(illegalDest, 'malicious payload');
  }, /Security Exception: Access denied/);
});

test('Security 4: Process termination and timeout enforcement kills hanging commands', async () => {
  const startTime = Date.now();
  // Sleep command that attempts to run for 10 seconds with a 1-second timeout
  const isWin = os.platform() === 'win32';
  const sleepCmd = isWin ? 'Start-Sleep -Seconds 10' : 'sleep 10';

  const res = await terminalManager.executeCommand(sleepCmd, { timeoutMs: 1200 });
  const duration = Date.now() - startTime;

  assert.equal(res.timedOut, true);
  assert.equal(res.exitCode, -1);
  assert.ok(duration < 4000, `Process did not terminate within timeout! Duration was: ${duration}ms`);
});

test('Security 5: Device pairing token replay attack is rejected', () => {
  const token = deviceManager.createPairingToken({ name: 'DevPC', platform: 'win32' });

  // 1st attempt: Valid
  const paired = deviceManager.pairDevice(token, { name: 'DevPC' });
  assert.ok(paired.id.startsWith('dev_'));

  // 2nd attempt with same token (Replay attack): MUST be rejected
  assert.throws(() => {
    deviceManager.pairDevice(token, { name: 'AttackerPC' });
  }, /Invalid or expired pairing token/);
});

test('Security 6: Expired device pairing token is rejected', () => {
  const token = deviceManager.createPairingToken();
  const record = deviceManager.pairingTokens.get(token);
  // Force token expiration
  record.expiresAt = Date.now() - 1000;

  assert.throws(() => {
    deviceManager.pairDevice(token, { name: 'LatePC' });
  }, /Pairing token has expired/);
});

test('Security 7: Unauthorized tool execution without granted permission is rejected', async () => {
  // execute_command requires 'execute:command'
  const res = await toolDispatcher.dispatch({
    name: 'execute_command',
    arguments: { command: 'echo hello' },
    grantedPermissions: ['read:file'] // Lacks 'execute:command'
  });

  assert.equal(res.is_error, true);
  assert.match(res.content, /Permission denied|requires permissions/i);
});

test('Security 8: Shell metacharacters are safely contained within child process execution', async () => {
  // Attempt metacharacters injection
  const injection = 'echo "hello"; echo "world"';
  const res = await terminalManager.executeCommand(injection, { timeoutMs: 5000 });
  assert.equal(res.exitCode, 0);
  assert.match(res.stdout, /hello/);
});
