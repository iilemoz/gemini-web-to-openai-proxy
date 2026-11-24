/**
 * Security Hardening & Vulnerability Remediation Regression Tests (Phase 4.3A.1)
 *
 * Verifies remediations for:
 * - SEC-01: ReDoS & catastrophic regex backtracking isolation in Worker Thread
 * - SEC-02: TOCTOU race conditions, safe open flags, and descriptor cleanup
 * - SEC-03: Cyclic directory symlink handling in recursive traversal
 * - SEC-04: Expanded sensitive file filtering and consistent tool enforcement
 * - SEC-05: Metadata isolation and symlink target containment
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { WorkspaceManager } from '../dist/agent/workspace/WorkspaceManager.js';
import {
  ListFilesTool,
  ReadFileTool,
  SearchFilesTool,
  FileInfoTool,
  SafeRegexMatcher
} from '../dist/agent/tools/builtin/index.js';

function createTempDir(prefix = 'lemo-sec-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanTempDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors on busy Windows handles
  }
}

function canCreateSymlinks() {
  const tmp = createTempDir('symlink-check-');
  try {
    const target = path.join(tmp, 'target.txt');
    const link = path.join(tmp, 'link.txt');
    fs.writeFileSync(target, 'test');
    fs.symlinkSync(target, link);
    return true;
  } catch {
    return false;
  } finally {
    cleanTempDir(tmp);
  }
}

// ─── 1. SEC-01: REGEX REDOS ISOLATION TESTS ──────────────────────────────────

test('SEC-01 ReDoS: SafeRegexMatcher catches catastrophic pattern (x+x+)+y and terminates without freezing', async () => {
  const matcher = new SafeRegexMatcher({ timeoutMs: 300 });
  const catastrophicLines = ['xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx']; // 30 chars causes catastrophic backtracking

  const start = Date.now();
  await assert.rejects(
    async () => {
      await matcher.matchLines(catastrophicLines, '(x+x+)+y', '');
    },
    /timed out.*ReDoS/i
  );
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 2000, `Execution should abort near timeout (took ${elapsed}ms)`);
  await matcher.terminate();
});

test('SEC-01 ReDoS: SearchFilesTool rejects (x+x+)+y without blocking main event loop', async () => {
  const tempDir = createTempDir();
  try {
    // File with repeating content that triggers catastrophic backtracking
    fs.writeFileSync(path.join(tempDir, 'vulnerable.txt'), 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\nnormal line\n');

    const ws = new WorkspaceManager(tempDir);
    const tool = new SearchFilesTool(ws);

    const start = Date.now();
    const result = await tool.execute({
      query: '(x+x+)+y',
      is_regex: true
    });
    const elapsed = Date.now() - start;

    assert.strictEqual(result.success, false);
    assert.match(String(result.error), /timed out|ReDoS/i);
    assert.ok(elapsed < 3000, `Tool must return within timeout limit, took ${elapsed}ms`);
  } finally {
    cleanTempDir(tempDir);
  }
});

test('SEC-01 ReDoS: SearchFilesTool rejects catastrophic pattern (a|aa)+$ and (a+)+$', async () => {
  const tempDir = createTempDir();
  try {
    // 35 'a's followed by '!' triggers exponential backtracking exceeding 10 seconds in V8
    fs.writeFileSync(path.join(tempDir, 'test-a.txt'), 'a'.repeat(35) + '!\n');

    const ws = new WorkspaceManager(tempDir);
    const tool = new SearchFilesTool(ws);

    // Pattern 1: (a|aa)+$
    const res1 = await tool.execute({
      query: '(a|aa)+$',
      is_regex: true
    });
    assert.strictEqual(res1.success, false);
    assert.match(String(res1.error), /timed out|ReDoS/i);

    // Pattern 2: (a+)+$
    const res2 = await tool.execute({
      query: '(a+)+$',
      is_regex: true
    });
    assert.strictEqual(res2.success, false);
    assert.match(String(res2.error), /timed out|ReDoS/i);
  } finally {
    cleanTempDir(tempDir);
  }
});

test('SEC-01 ReDoS: SearchFilesTool enforces maximum query length (500 chars)', async () => {
  const tempDir = createTempDir();
  try {
    const ws = new WorkspaceManager(tempDir);
    const tool = new SearchFilesTool(ws);

    const overlongQuery = 'a'.repeat(501);
    const result = await tool.execute({ query: overlongQuery });

    assert.strictEqual(result.success, false);
    assert.match(String(result.error), /exceeds maximum allowed limit of 500 characters/i);
  } finally {
    cleanTempDir(tempDir);
  }
});

test('SEC-01 ReDoS: SearchFilesTool handles invalid regex patterns cleanly', async () => {
  const tempDir = createTempDir();
  try {
    const ws = new WorkspaceManager(tempDir);
    const tool = new SearchFilesTool(ws);

    const result = await tool.execute({
      query: '[unclosed-bracket',
      is_regex: true
    });

    assert.strictEqual(result.success, false);
    assert.match(String(result.error), /Invalid regular expression query/i);
  } finally {
    cleanTempDir(tempDir);
  }
});

test('SEC-01 ReDoS: SearchFilesTool literal search is immune to regex characters', async () => {
  const tempDir = createTempDir();
  try {
    fs.writeFileSync(path.join(tempDir, 'code.js'), 'const pattern = "[regex]*";\n');

    const ws = new WorkspaceManager(tempDir);
    const tool = new SearchFilesTool(ws);

    // is_regex is false by default
    const result = await tool.execute({
      query: '[regex]*',
      is_regex: false
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.matches.length, 1);
    assert.strictEqual(result.data.matches[0].line, 1);
  } finally {
    cleanTempDir(tempDir);
  }
});

// ─── 2. SEC-02: TOCTOU & DESCRIPTOR HARDENING TESTS ──────────────────────────

test('SEC-02 TOCTOU: ReadFileTool uses handle-based read and closes descriptors properly', async () => {
  const tempDir = createTempDir();
  try {
    const filePath = path.join(tempDir, 'data.txt');
    fs.writeFileSync(filePath, 'Line 1\nLine 2\nLine 3');

    const ws = new WorkspaceManager(tempDir);
    const tool = new ReadFileTool(ws);

    // Valid read
    const res1 = await tool.execute({ path: 'data.txt' });
    assert.strictEqual(res1.success, true);
    assert.strictEqual(res1.data.totalLines, 3);

    // File immediately writable/deletable (proves handle was not leaked on Windows)
    fs.appendFileSync(filePath, '\nLine 4');
    const res2 = await tool.execute({ path: 'data.txt' });
    assert.strictEqual(res2.success, true);
    assert.strictEqual(res2.data.totalLines, 4);
  } finally {
    cleanTempDir(tempDir);
  }
});

test('SEC-02 TOCTOU: ReadFileTool fails closed on directory and cleans up descriptor', async () => {
  const tempDir = createTempDir();
  try {
    const subDir = path.join(tempDir, 'sub');
    fs.mkdirSync(subDir);

    const ws = new WorkspaceManager(tempDir);
    const tool = new ReadFileTool(ws);

    const res = await tool.execute({ path: 'sub' });
    assert.strictEqual(res.success, false);
    assert.match(String(res.error), /Path is a directory, not a file/i);

    // Subdir can be modified immediately
    fs.rmdirSync(subDir);
  } finally {
    cleanTempDir(tempDir);
  }
});

test('SEC-02 TOCTOU: ReadFileTool rejects binary content and cleans up descriptor', async () => {
  const tempDir = createTempDir();
  try {
    const binFile = path.join(tempDir, 'binary.dat');
    fs.writeFileSync(binFile, Buffer.from([0x00, 0x01, 0x02, 0x03]));

    const ws = new WorkspaceManager(tempDir);
    const tool = new ReadFileTool(ws);

    const res = await tool.execute({ path: 'binary.dat' });
    assert.strictEqual(res.success, false);
    assert.match(String(res.error), /Cannot read binary file/i);

    // File can be unlinked immediately
    fs.unlinkSync(binFile);
  } finally {
    cleanTempDir(tempDir);
  }
});

// ─── 3. SEC-03: CYCLIC DIRECTORY SYMLINK TESTS ───────────────────────────────

test('SEC-03 Cycles: ListFilesTool safely handles directory self-referencing symlinks', async (t) => {
  if (!canCreateSymlinks()) {
    t.skip('Symlink creation requires elevated privileges on this Windows environment');
    return;
  }

  const tempDir = createTempDir();
  try {
    const sub = path.join(tempDir, 'sub');
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, 'hello.txt'), 'hello');

    // Create self-referencing symlink sub/loop -> sub
    fs.symlinkSync(sub, path.join(sub, 'loop'), 'junction');

    const ws = new WorkspaceManager(tempDir);
    const tool = new ListFilesTool(ws);

    // Should complete cleanly without infinite recursion or quota exhaustion
    const result = await tool.execute({ recursive: true, max_depth: 5 });
    assert.strictEqual(result.success, true);

    const paths = result.data.entries.map((e) => e.path);
    assert.ok(paths.includes('sub/hello.txt'));
  } finally {
    cleanTempDir(tempDir);
  }
});

test('SEC-03 Cycles: SearchFilesTool safely skips cyclic directory links without loop', async (t) => {
  if (!canCreateSymlinks()) {
    t.skip('Symlink creation requires elevated privileges on this Windows environment');
    return;
  }

  const tempDir = createTempDir();
  try {
    const sub = path.join(tempDir, 'docs');
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, 'target.md'), 'important content inside docs\n');

    // Create cycle link docs/cycle -> docs
    fs.symlinkSync(sub, path.join(sub, 'cycle'), 'junction');

    const ws = new WorkspaceManager(tempDir);
    const tool = new SearchFilesTool(ws);

    const result = await tool.execute({ query: 'important content' });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.matches.length, 1);
  } finally {
    cleanTempDir(tempDir);
  }
});

// ─── 4. SEC-04: SENSITIVE FILE PATTERNS EXPANSION TESTS ───────────────────────

test('SEC-04 Sensitive: WorkspaceManager identifies all SSH private key variants', () => {
  const ws = new WorkspaceManager(process.cwd());

  const sensitiveKeys = [
    'id_rsa',
    'id_dsa',
    'id_ecdsa',
    'id_ed25519',
    'id_ecdsa_sk',
    'id_ed25519_sk',
    'ID_ECDSA',
    'id_backup_key'
  ];

  for (const key of sensitiveKeys) {
    assert.strictEqual(ws.isSensitive(key), true, `Expected '${key}' to be classified as sensitive`);
  }

  // Public keys should NOT be classified as sensitive
  assert.strictEqual(ws.isSensitive('id_rsa.pub'), false);
  assert.strictEqual(ws.isSensitive('id_ecdsa.pub'), false);
});

test('SEC-04 Sensitive: WorkspaceManager blocks AWS credentials, PKCS12, and certificate stores', () => {
  const ws = new WorkspaceManager(process.cwd());

  const sensitiveFiles = [
    '.aws/credentials',
    '.aws/config',
    'project/.aws/credentials',
    'PROJECT/.AWS/CREDENTIALS',
    'certs/client.p12',
    'certs/keystore.jks',
    'server.pfx',
    'app.kdbx',
    '.pypirc',
    '.pgpass',
    'master.key',
    '.bash_history',
    '.zsh_history',
    'credentials.yaml',
    'token.ini',
    'secrets.json',
    'passwords.yml'
  ];

  for (const f of sensitiveFiles) {
    assert.strictEqual(ws.isSensitive(f), true, `Expected '${f}' to be classified as sensitive`);
  }
});

test('SEC-04 Sensitive: WorkspaceManager blocks docker-compose override files but allows regular compose files', () => {
  const ws = new WorkspaceManager(process.cwd());

  // Block override files
  assert.strictEqual(ws.isSensitive('docker-compose.override.yml'), true);
  assert.strictEqual(ws.isSensitive('docker-compose.override.yaml'), true);
  assert.strictEqual(ws.isSensitive('compose.override.yml'), true);
  assert.strictEqual(ws.isSensitive('compose.override.yaml'), true);
  assert.strictEqual(ws.isSensitive('sub/docker-compose.override.yml'), true);

  // Allow standard compose files
  assert.strictEqual(ws.isSensitive('docker-compose.yml'), false);
  assert.strictEqual(ws.isSensitive('docker-compose.yaml'), false);
  assert.strictEqual(ws.isSensitive('compose.yml'), false);
  assert.strictEqual(ws.isSensitive('compose.yaml'), false);
});

test('SEC-04 Sensitive: All 4 tools consistently enforce sensitive file blocks', async () => {
  const tempDir = createTempDir();
  try {
    // Create sensitive files
    fs.writeFileSync(path.join(tempDir, '.env'), 'SECRET=123\n');
    fs.writeFileSync(path.join(tempDir, 'id_ecdsa'), 'PRIVATE KEY\n');
    fs.mkdirSync(path.join(tempDir, '.aws'));
    fs.writeFileSync(path.join(tempDir, '.aws', 'credentials'), 'aws_access_key_id=test\n');

    // Create non-sensitive file
    fs.writeFileSync(path.join(tempDir, 'normal.txt'), 'regular content\n');

    const ws = new WorkspaceManager(tempDir);

    // 1. ListFilesTool: sensitive files are hidden
    const listTool = new ListFilesTool(ws);
    const listRes = await listTool.execute({ include_hidden: true });
    assert.strictEqual(listRes.success, true);
    const listedPaths = listRes.data.entries.map((e) => e.path);
    assert.ok(!listedPaths.includes('.env'));
    assert.ok(!listedPaths.includes('id_ecdsa'));
    assert.ok(!listedPaths.includes('.aws/credentials'));
    assert.ok(listedPaths.includes('normal.txt'));

    // 2. ReadFileTool: throws Security Exception
    const readTool = new ReadFileTool(ws);
    const readRes1 = await readTool.execute({ path: '.env' });
    assert.strictEqual(readRes1.success, false);
    assert.match(String(readRes1.error), /Access denied to sensitive file/i);

    const readRes2 = await readTool.execute({ path: 'id_ecdsa' });
    assert.strictEqual(readRes2.success, false);
    assert.match(String(readRes2.error), /Access denied to sensitive file/i);

    const readRes3 = await readTool.execute({ path: '.aws/credentials' });
    assert.strictEqual(readRes3.success, false);
    assert.match(String(readRes3.error), /Access denied to sensitive file/i);

    // 3. SearchFilesTool: sensitive files are not scanned
    const searchTool = new SearchFilesTool(ws);
    const searchRes = await searchTool.execute({ query: 'aws_access_key_id' });
    assert.strictEqual(searchRes.success, true);
    assert.strictEqual(searchRes.data.matches.length, 0);

    // 4. FileInfoTool: throws Security Exception
    const infoTool = new FileInfoTool(ws);
    const infoRes = await infoTool.execute({ path: '.env' });
    assert.strictEqual(infoRes.success, false);
    assert.match(String(infoRes.error), /Access denied to sensitive file/i);
  } finally {
    cleanTempDir(tempDir);
  }
});

// ─── 5. SEC-05: METADATA ISOLATION TESTS ─────────────────────────────────────

test('SEC-05 Metadata: FileInfoTool always returns workspace-relative paths, never absolute host paths', async () => {
  const tempDir = createTempDir();
  try {
    fs.writeFileSync(path.join(tempDir, 'safe.txt'), 'sample');

    const ws = new WorkspaceManager(tempDir);
    const tool = new FileInfoTool(ws);

    const result = await tool.execute({ path: 'safe.txt' });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.path, 'safe.txt');
    assert.strictEqual(path.isAbsolute(result.data.path), false);
  } finally {
    cleanTempDir(tempDir);
  }
});

test('SEC-05 Metadata: FileInfoTool rejects out-of-workspace symlink and does not leak target path', async (t) => {
  if (!canCreateSymlinks()) {
    t.skip('Symlink creation requires elevated privileges on this Windows environment');
    return;
  }

  const workspaceDir = createTempDir('ws-');
  const externalDir = createTempDir('ext-');
  try {
    const secretFile = path.join(externalDir, 'host_secret.txt');
    fs.writeFileSync(secretFile, 'super_secret');

    // Create symlink inside workspace pointing outside
    const linkPath = path.join(workspaceDir, 'ext_link.txt');
    fs.symlinkSync(secretFile, linkPath);

    const ws = new WorkspaceManager(workspaceDir);
    const tool = new FileInfoTool(ws);

    const result = await tool.execute({ path: 'ext_link.txt' });
    assert.strictEqual(result.success, false);
    assert.match(String(result.error), /Security Exception.*Symlink points outside workspace/i);
  } finally {
    cleanTempDir(workspaceDir);
    cleanTempDir(externalDir);
  }
});
