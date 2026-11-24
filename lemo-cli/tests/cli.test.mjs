import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN_PATH = path.resolve(__dirname, '../bin/lemo.js');

test('CLI: --version outputs valid version number', async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [BIN_PATH, '--version']);
  assert.equal(stderr, '');
  assert.ok(stdout.includes('0.1.0'));
});

test('CLI: --help displays application name, options, and commands', async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [BIN_PATH, '--help']);
  assert.equal(stderr, '');
  assert.ok(stdout.includes('Lemo CLI'));
  assert.ok(stdout.includes('--version'));
  assert.ok(stdout.includes('--help'));
  assert.ok(stdout.includes('config'));
  assert.ok(stdout.includes('chat'));
  assert.ok(stdout.includes('agent'));
});

test('CLI: invocation with no arguments launches chat startup and displays banner', async () => {
  const { stdout } = await execFileAsync(process.execPath, [BIN_PATH]);
  assert.ok(stdout.includes('Lemo CLI'));
  assert.ok(stdout.includes('Backend Target: Lemo Universal AI API Backend'));
});

test('CLI: config path command displays active path', async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [BIN_PATH, 'config', 'path']);
  assert.equal(stderr, '');
  assert.ok(stdout.includes('config.json'));
});

test('CLI: config show displays redacted configuration', async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [BIN_PATH, 'config', 'show']);
  assert.equal(stderr, '');
  assert.ok(stdout.includes('Current Configuration:'));
  assert.ok(stdout.includes('baseUrl'));
  assert.ok(stdout.includes('defaultModel'));
});

test('CLI: chat command accepts --help and describes streaming chat', async () => {
  const { stdout } = await execFileAsync(process.execPath, [BIN_PATH, 'chat', '--help']);
  assert.ok(stdout.includes('Start an interactive AI chat session with streaming'));
  assert.ok(stdout.includes('--model'));
});

test('CLI: agent command accepts --help and describes interactive agent mode', async () => {
  const { stdout } = await execFileAsync(process.execPath, [BIN_PATH, 'agent', '--help']);
  assert.ok(stdout.includes('Start interactive AI Coding Agent Mode with tools'));
  assert.ok(stdout.includes('--workspace'));
  assert.ok(stdout.includes('--model'));
});
