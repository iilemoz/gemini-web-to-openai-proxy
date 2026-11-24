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
  FileInfoTool
} from '../dist/agent/tools/builtin/index.js';

function createTempDir(prefix = 'lemo-tools-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanTempDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup on busy files
  }
}

// ─── 1. LIST_FILES TESTS ─────────────────────────────────────────────────────

test('ListFilesTool: lists files and directories with metadata', async () => {
  const tempDir = createTempDir();
  try {
    fs.mkdirSync(path.join(tempDir, 'src'));
    fs.writeFileSync(path.join(tempDir, 'src', 'index.ts'), 'console.log("hello");');
    fs.writeFileSync(path.join(tempDir, 'README.md'), '# Project');

    const ws = new WorkspaceManager(tempDir);
    const tool = new ListFilesTool(ws);

    const res = await tool.execute({ path: '.' });
    assert.equal(res.success, true);
    assert.equal(res.data.totalCount, 2);

    const names = res.data.entries.map((e) => e.name);
    assert.ok(names.includes('src'));
    assert.ok(names.includes('README.md'));

    const srcEntry = res.data.entries.find((e) => e.name === 'src');
    assert.equal(srcEntry.isDirectory, true);
    assert.equal(srcEntry.isFile, false);

    const readmeEntry = res.data.entries.find((e) => e.name === 'README.md');
    assert.equal(readmeEntry.isDirectory, false);
    assert.equal(readmeEntry.isFile, true);
    assert.equal(readmeEntry.size, 9);
  } finally {
    cleanTempDir(tempDir);
  }
});

test('ListFilesTool: recursive scan respects max_depth', async () => {
  const tempDir = createTempDir();
  try {
    const deepDir = path.join(tempDir, 'a', 'b', 'c');
    fs.mkdirSync(deepDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'a', 'b', 'c', 'deep.txt'), 'deep file');

    const ws = new WorkspaceManager(tempDir);
    const tool = new ListFilesTool(ws);

    // With recursive: true, max_depth: 3
    const res = await tool.execute({ path: '.', recursive: true, max_depth: 4 });
    assert.equal(res.success, true);
    const names = res.data.entries.map((e) => e.name);
    assert.ok(names.includes('deep.txt'));
  } finally {
    cleanTempDir(tempDir);
  }
});

test('ListFilesTool: skips node_modules and .git by default', async () => {
  const tempDir = createTempDir();
  try {
    fs.mkdirSync(path.join(tempDir, 'node_modules'));
    fs.writeFileSync(path.join(tempDir, 'node_modules', 'dep.js'), 'code');
    fs.mkdirSync(path.join(tempDir, '.git'));
    fs.writeFileSync(path.join(tempDir, '.git', 'config'), 'gitconfig');
    fs.writeFileSync(path.join(tempDir, 'app.ts'), 'main app');

    const ws = new WorkspaceManager(tempDir);
    const tool = new ListFilesTool(ws);

    const res = await tool.execute({ path: '.', recursive: true });
    assert.equal(res.success, true);
    assert.equal(res.data.totalCount, 1);
    assert.equal(res.data.entries[0].name, 'app.ts');
  } finally {
    cleanTempDir(tempDir);
  }
});

test('ListFilesTool: filters sensitive files like .env', async () => {
  const tempDir = createTempDir();
  try {
    fs.writeFileSync(path.join(tempDir, '.env'), 'SECRET_API_KEY=123');
    fs.writeFileSync(path.join(tempDir, '.env.local'), 'SECRET_KEY=abc');
    fs.writeFileSync(path.join(tempDir, 'normal.txt'), 'safe');

    const ws = new WorkspaceManager(tempDir);
    const tool = new ListFilesTool(ws);

    const res = await tool.execute({ path: '.', include_hidden: true });
    assert.equal(res.success, true);
    const names = res.data.entries.map((e) => e.name);
    assert.ok(names.includes('normal.txt'));
    assert.ok(!names.includes('.env'));
    assert.ok(!names.includes('.env.local'));
  } finally {
    cleanTempDir(tempDir);
  }
});

test('ListFilesTool: safely handles non-existent directory and path traversal', async () => {
  const tempDir = createTempDir();
  try {
    const ws = new WorkspaceManager(tempDir);
    const tool = new ListFilesTool(ws);

    const notFound = await tool.execute({ path: 'does-not-exist' });
    assert.equal(notFound.success, false);
    assert.ok(notFound.error.includes('Directory not found'));

    const traversal = await tool.execute({ path: '../../' });
    assert.equal(traversal.success, false);
    assert.ok(traversal.error.includes('Security Exception'));
  } finally {
    cleanTempDir(tempDir);
  }
});

// ─── 2. READ_FILE TESTS ──────────────────────────────────────────────────────

test('ReadFileTool: reads entire text file', async () => {
  const tempDir = createTempDir();
  try {
    const file = path.join(tempDir, 'greeting.txt');
    fs.writeFileSync(file, 'Hello, Lemo Agent!\nLine 2\nLine 3');

    const ws = new WorkspaceManager(tempDir);
    const tool = new ReadFileTool(ws);

    const res = await tool.execute({ path: 'greeting.txt' });
    assert.equal(res.success, true);
    assert.equal(res.data.content, 'Hello, Lemo Agent!\nLine 2\nLine 3');
    assert.equal(res.data.linesRead, 3);
    assert.equal(res.data.totalLines, 3);
    assert.equal(res.data.truncated, false);
  } finally {
    cleanTempDir(tempDir);
  }
});

test('ReadFileTool: supports start_line and line_count pagination', async () => {
  const tempDir = createTempDir();
  try {
    const file = path.join(tempDir, 'lines.txt');
    const content = Array.from({ length: 10 }, (_, i) => `Line ${i + 1}`).join('\n');
    fs.writeFileSync(file, content);

    const ws = new WorkspaceManager(tempDir);
    const tool = new ReadFileTool(ws);

    const res = await tool.execute({ path: 'lines.txt', start_line: 4, line_count: 3 });
    assert.equal(res.success, true);
    assert.equal(res.data.startLine, 4);
    assert.equal(res.data.linesRead, 3);
    assert.equal(res.data.totalLines, 10);
    assert.equal(res.data.content, 'Line 4\nLine 5\nLine 6');
    assert.equal(res.data.truncated, true);
  } finally {
    cleanTempDir(tempDir);
  }
});

test('ReadFileTool: truncates when content exceeds max_bytes', async () => {
  const tempDir = createTempDir();
  try {
    const file = path.join(tempDir, 'big.txt');
    const bigContent = 'A'.repeat(5000);
    fs.writeFileSync(file, bigContent);

    const ws = new WorkspaceManager(tempDir);
    const tool = new ReadFileTool(ws);

    const res = await tool.execute({ path: 'big.txt', max_bytes: 1000 });
    assert.equal(res.success, true);
    assert.equal(res.data.content.length, 1000);
    assert.equal(res.data.truncated, true);
  } finally {
    cleanTempDir(tempDir);
  }
});

test('ReadFileTool: blocks reading binary files', async () => {
  const tempDir = createTempDir();
  try {
    const file = path.join(tempDir, 'image.png');
    fs.writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0a]));

    const ws = new WorkspaceManager(tempDir);
    const tool = new ReadFileTool(ws);

    const res = await tool.execute({ path: 'image.png' });
    assert.equal(res.success, false);
    assert.ok(res.error.includes('Cannot read binary file'));
  } finally {
    cleanTempDir(tempDir);
  }
});

test('ReadFileTool: blocks reading sensitive files (.env)', async () => {
  const tempDir = createTempDir();
  try {
    const file = path.join(tempDir, '.env');
    fs.writeFileSync(file, 'DATABASE_PASSWORD=secret');

    const ws = new WorkspaceManager(tempDir);
    const tool = new ReadFileTool(ws);

    const res = await tool.execute({ path: '.env' });
    assert.equal(res.success, false);
    assert.ok(res.error.includes('Security Exception'));
    assert.ok(res.error.includes('sensitive file'));
  } finally {
    cleanTempDir(tempDir);
  }
});

test('ReadFileTool: returns clear error on directory or missing file', async () => {
  const tempDir = createTempDir();
  try {
    const subDir = path.join(tempDir, 'some-dir');
    fs.mkdirSync(subDir);

    const ws = new WorkspaceManager(tempDir);
    const tool = new ReadFileTool(ws);

    const dirRes = await tool.execute({ path: 'some-dir' });
    assert.equal(dirRes.success, false);
    assert.ok(dirRes.error.includes('is a directory'));

    const missingRes = await tool.execute({ path: 'missing.txt' });
    assert.equal(missingRes.success, false);
    assert.ok(missingRes.error.includes('File not found'));
  } finally {
    cleanTempDir(tempDir);
  }
});

// ─── 3. SEARCH_FILES TESTS ───────────────────────────────────────────────────

test('SearchFilesTool: searches text pattern across files', async () => {
  const tempDir = createTempDir();
  try {
    fs.writeFileSync(path.join(tempDir, 'a.txt'), 'apple banana cherry');
    fs.writeFileSync(path.join(tempDir, 'b.txt'), 'dog elephant banana');
    fs.writeFileSync(path.join(tempDir, 'c.txt'), 'no fruits here');

    const ws = new WorkspaceManager(tempDir);
    const tool = new SearchFilesTool(ws);

    const res = await tool.execute({ query: 'banana' });
    assert.equal(res.success, true);
    assert.equal(res.data.totalMatches, 2);
    assert.equal(res.data.matches[0].file, 'a.txt');
    assert.equal(res.data.matches[1].file, 'b.txt');
  } finally {
    cleanTempDir(tempDir);
  }
});

test('SearchFilesTool: supports regular expressions and case sensitivity', async () => {
  const tempDir = createTempDir();
  try {
    fs.writeFileSync(path.join(tempDir, 'code.ts'), 'function calculateSum(a: number, b: number) {\n  return a + b;\n}');

    const ws = new WorkspaceManager(tempDir);
    const tool = new SearchFilesTool(ws);

    const regexRes = await tool.execute({ query: 'function\\s+[a-zA-Z]+', is_regex: true });
    assert.equal(regexRes.success, true);
    assert.equal(regexRes.data.totalMatches, 1);
    assert.equal(regexRes.data.matches[0].line, 1);

    const caseRes = await tool.execute({ query: 'CALCULATESUM', case_sensitive: true });
    assert.equal(caseRes.success, true);
    assert.equal(caseRes.data.totalMatches, 0);
  } finally {
    cleanTempDir(tempDir);
  }
});

test('SearchFilesTool: filters by file_pattern', async () => {
  const tempDir = createTempDir();
  try {
    fs.writeFileSync(path.join(tempDir, 'match.ts'), 'target keyword');
    fs.writeFileSync(path.join(tempDir, 'ignore.md'), 'target keyword');

    const ws = new WorkspaceManager(tempDir);
    const tool = new SearchFilesTool(ws);

    const res = await tool.execute({ query: 'target', file_pattern: '.ts' });
    assert.equal(res.success, true);
    assert.equal(res.data.totalMatches, 1);
    assert.equal(res.data.matches[0].file, 'match.ts');
  } finally {
    cleanTempDir(tempDir);
  }
});

test('SearchFilesTool: safely rejects invalid regex pattern', async () => {
  const tempDir = createTempDir();
  try {
    const ws = new WorkspaceManager(tempDir);
    const tool = new SearchFilesTool(ws);

    const res = await tool.execute({ query: '[unclosed regex', is_regex: true });
    assert.equal(res.success, false);
    assert.ok(res.error.includes('Invalid regular expression'));
  } finally {
    cleanTempDir(tempDir);
  }
});

// ─── 4. FILE_INFO TESTS ──────────────────────────────────────────────────────

test('FileInfoTool: returns metadata for existing file', async () => {
  const tempDir = createTempDir();
  try {
    const file = path.join(tempDir, 'app.ts');
    fs.writeFileSync(file, 'export const x = 1;');

    const ws = new WorkspaceManager(tempDir);
    const tool = new FileInfoTool(ws);

    const res = await tool.execute({ path: 'app.ts' });
    assert.equal(res.success, true);
    assert.equal(res.data.exists, true);
    assert.equal(res.data.isFile, true);
    assert.equal(res.data.isDirectory, false);
    assert.equal(res.data.extension, '.ts');
    assert.equal(res.data.isBinary, false);
    assert.equal(res.data.size, 19);
  } finally {
    cleanTempDir(tempDir);
  }
});

test('FileInfoTool: returns metadata for existing directory', async () => {
  const tempDir = createTempDir();
  try {
    const dir = path.join(tempDir, 'src');
    fs.mkdirSync(dir);

    const ws = new WorkspaceManager(tempDir);
    const tool = new FileInfoTool(ws);

    const res = await tool.execute({ path: 'src' });
    assert.equal(res.success, true);
    assert.equal(res.data.exists, true);
    assert.equal(res.data.isFile, false);
    assert.equal(res.data.isDirectory, true);
  } finally {
    cleanTempDir(tempDir);
  }
});

test('FileInfoTool: returns exists: false for non-existent path', async () => {
  const tempDir = createTempDir();
  try {
    const ws = new WorkspaceManager(tempDir);
    const tool = new FileInfoTool(ws);

    const res = await tool.execute({ path: 'non-existent.txt' });
    assert.equal(res.success, true);
    assert.equal(res.data.exists, false);
  } finally {
    cleanTempDir(tempDir);
  }
});

test('FileInfoTool: blocks path traversal attacks', async () => {
  const tempDir = createTempDir();
  try {
    const ws = new WorkspaceManager(tempDir);
    const tool = new FileInfoTool(ws);

    const res = await tool.execute({ path: '../../outside.txt' });
    assert.equal(res.success, false);
    assert.ok(res.error.includes('Security Exception'));
  } finally {
    cleanTempDir(tempDir);
  }
});
