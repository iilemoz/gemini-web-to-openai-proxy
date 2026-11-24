import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { WorkspaceManager, isPathInside } from '../dist/agent/workspace/WorkspaceManager.js';
import { SecurityError, WorkspaceError } from '../dist/core/errors/index.js';

function createTempDir(prefix = 'lemo-ws-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanTempDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors on busy files in Windows
  }
}

test('isPathInside: correctly detects child paths inside parent', () => {
  const root = path.resolve('/test/workspace');
  assert.equal(isPathInside(root, root), true);
  assert.equal(isPathInside(root, path.resolve('/test/workspace/src/index.ts')), true);
  assert.equal(isPathInside(root, path.resolve('/test/workspace/sub/dir/deep')), true);
  assert.equal(isPathInside(root, path.resolve('/test/other')), false);
  assert.equal(isPathInside(root, path.resolve('/test/workspace-sibling')), false);
});

test('WorkspaceManager: initializes with valid directory and resolves canonical root', () => {
  const tempDir = createTempDir();
  try {
    const ws = new WorkspaceManager(tempDir);
    const canonical = fs.realpathSync(tempDir);
    assert.equal(ws.getRoot(), canonical);
  } finally {
    cleanTempDir(tempDir);
  }
});

test('WorkspaceManager: rejects non-existent directory with WorkspaceError', () => {
  const nonExistent = path.join(os.tmpdir(), 'lemo-non-existent-' + Date.now());
  assert.throws(
    () => new WorkspaceManager(nonExistent),
    (err) => err instanceof WorkspaceError && err.message.includes('does not exist')
  );
});

test('WorkspaceManager: rejects file path as workspace root', () => {
  const tempDir = createTempDir();
  const filePath = path.join(tempDir, 'somefile.txt');
  fs.writeFileSync(filePath, 'hello');
  try {
    assert.throws(
      () => new WorkspaceManager(filePath),
      (err) => err instanceof WorkspaceError && err.message.includes('not a directory')
    );
  } finally {
    cleanTempDir(tempDir);
  }
});

test('WorkspaceManager: rejects empty or invalid workspace string', () => {
  assert.throws(
    () => new WorkspaceManager(''),
    (err) => err instanceof WorkspaceError
  );
});

test('WorkspaceManager: resolvePath resolves relative subpaths securely', () => {
  const tempDir = createTempDir();
  try {
    const subDir = path.join(tempDir, 'src', 'utils');
    fs.mkdirSync(subDir, { recursive: true });
    const targetFile = path.join(subDir, 'test.ts');
    fs.writeFileSync(targetFile, 'content');

    const ws = new WorkspaceManager(tempDir);
    const resolved = ws.resolvePath('src/utils/test.ts');
    assert.equal(resolved, fs.realpathSync(targetFile));
  } finally {
    cleanTempDir(tempDir);
  }
});

test('WorkspaceManager: blocks path traversal attacks (../../)', () => {
  const tempDir = createTempDir();
  try {
    const ws = new WorkspaceManager(tempDir);

    assert.throws(
      () => ws.resolvePath('../../etc/passwd'),
      (err) => err instanceof SecurityError && err.message.includes('outside workspace root')
    );

    assert.throws(
      () => ws.resolvePath('sub/../../../outside.txt'),
      (err) => err instanceof SecurityError && err.message.includes('outside workspace root')
    );
  } finally {
    cleanTempDir(tempDir);
  }
});

test('WorkspaceManager: blocks absolute paths pointing outside workspace', () => {
  const tempDir = createTempDir();
  try {
    const ws = new WorkspaceManager(tempDir);
    const outside = process.platform === 'win32' ? 'C:\\Windows\\System32\\drivers' : '/etc/shadow';

    assert.throws(
      () => ws.resolvePath(outside),
      (err) => err instanceof SecurityError && err.message.includes('outside workspace root')
    );
  } finally {
    cleanTempDir(tempDir);
  }
});

test('WorkspaceManager: blocks null-byte path injection', () => {
  const tempDir = createTempDir();
  try {
    const ws = new WorkspaceManager(tempDir);
    assert.throws(
      () => ws.resolvePath('safe.txt\0/../../etc/passwd'),
      (err) => err instanceof SecurityError && err.message.includes('Null byte detected')
    );
  } finally {
    cleanTempDir(tempDir);
  }
});

test('WorkspaceManager: verifies symlinks escaping workspace', () => {
  const tempDir = createTempDir();
  const outsideDir = createTempDir('lemo-outside-');
  const secretFile = path.join(outsideDir, 'secret.txt');
  fs.writeFileSync(secretFile, 'super-secret-outside');

  const symlinkPath = path.join(tempDir, 'link-outside');
  try {
    try {
      fs.symlinkSync(secretFile, symlinkPath, 'file');
    } catch {
      // If symlink creation fails due to Windows privileges, skip symlink assertion
      return;
    }

    const ws = new WorkspaceManager(tempDir);
    assert.throws(
      () => ws.resolvePath('link-outside'),
      (err) => err instanceof SecurityError && err.message.includes('Symlink points outside workspace')
    );
  } finally {
    cleanTempDir(tempDir);
    cleanTempDir(outsideDir);
  }
});

test('WorkspaceManager: correctly identifies sensitive files', () => {
  const tempDir = createTempDir();
  try {
    const ws = new WorkspaceManager(tempDir);

    assert.equal(ws.isSensitive(path.join(tempDir, '.env')), true);
    assert.equal(ws.isSensitive(path.join(tempDir, '.env.production')), true);
    assert.equal(ws.isSensitive(path.join(tempDir, '.env.local')), true);
    assert.equal(ws.isSensitive(path.join(tempDir, 'id_rsa')), true);
    assert.equal(ws.isSensitive(path.join(tempDir, 'id_ed25519')), true);
    assert.equal(ws.isSensitive(path.join(tempDir, 'server.key')), true);
    assert.equal(ws.isSensitive(path.join(tempDir, 'cert.pem')), true);
    assert.equal(ws.isSensitive(path.join(tempDir, 'credentials.json')), true);
    assert.equal(ws.isSensitive(path.join(tempDir, '.npmrc')), true);
    assert.equal(ws.isSensitive(path.join(tempDir, '.git', 'config')), true);

    // Safe regular files
    assert.equal(ws.isSensitive(path.join(tempDir, 'index.ts')), false);
    assert.equal(ws.isSensitive(path.join(tempDir, 'package.json')), false);
    assert.equal(ws.isSensitive(path.join(tempDir, 'README.md')), false);
  } finally {
    cleanTempDir(tempDir);
  }
});

test('WorkspaceManager: detects binary content via null bytes', async () => {
  const tempDir = createTempDir();
  try {
    const ws = new WorkspaceManager(tempDir);

    const textFile = path.join(tempDir, 'hello.txt');
    fs.writeFileSync(textFile, 'Hello world text file!', 'utf-8');

    const binaryFile = path.join(tempDir, 'data.bin');
    fs.writeFileSync(binaryFile, Buffer.from([0x48, 0x65, 0x00, 0x6c, 0x6f]));

    assert.equal(await ws.isBinary(textFile), false);
    assert.equal(await ws.isBinary(binaryFile), true);
  } finally {
    cleanTempDir(tempDir);
  }
});

test('WorkspaceManager: toRelative returns clean posix relative paths', () => {
  const tempDir = createTempDir();
  try {
    const ws = new WorkspaceManager(tempDir);
    const canonical = ws.getRoot();
    assert.equal(ws.toRelative(canonical), '.');
    assert.equal(ws.toRelative(path.join(canonical, 'src', 'app.ts')), 'src/app.ts');
  } finally {
    cleanTempDir(tempDir);
  }
});
