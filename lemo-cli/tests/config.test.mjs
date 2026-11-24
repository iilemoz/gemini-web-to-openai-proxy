import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigManager, DEFAULT_CONFIG, validateConfig } from '../dist/core/config/index.js';
import { ConfigError } from '../dist/core/errors/index.js';

test('Config: Default configuration has expected structure and values', () => {
  assert.equal(DEFAULT_CONFIG.baseUrl, 'http://127.0.0.1:3000/v1');
  assert.equal(DEFAULT_CONFIG.defaultModel, 'gemini-flash');
  assert.equal(DEFAULT_CONFIG.defaultMode, 'chat');
  assert.equal(DEFAULT_CONFIG.agentIterationLimit, 25);
  assert.equal(DEFAULT_CONFIG.approvalMode, 'action');
  assert.equal(DEFAULT_CONFIG.logLevel, 'info');
  assert.equal(DEFAULT_CONFIG.timeoutMs, 120000);
});

test('Config: Validation accepts valid configuration', () => {
  const result = validateConfig(DEFAULT_CONFIG);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test('Config: Validation rejects invalid parameters', () => {
  // Invalid baseUrl
  const badUrl = validateConfig({ ...DEFAULT_CONFIG, baseUrl: 'not-a-url' });
  assert.equal(badUrl.valid, false);
  assert.ok(badUrl.errors.some(e => e.includes('baseUrl')));

  // Invalid defaultMode
  const badMode = validateConfig({ ...DEFAULT_CONFIG, defaultMode: 'autonomous' });
  assert.equal(badMode.valid, false);
  assert.ok(badMode.errors.some(e => e.includes('defaultMode')));

  // Out-of-bounds agentIterationLimit
  const badLimit = validateConfig({ ...DEFAULT_CONFIG, agentIterationLimit: 500 });
  assert.equal(badLimit.valid, false);
  assert.ok(badLimit.errors.some(e => e.includes('agentIterationLimit')));

  // Invalid approvalMode
  const badApproval = validateConfig({ ...DEFAULT_CONFIG, approvalMode: 'sometimes' });
  assert.equal(badApproval.valid, false);
  assert.ok(badApproval.errors.some(e => e.includes('approvalMode')));

  // Invalid timeoutMs
  const badTimeout = validateConfig({ ...DEFAULT_CONFIG, timeoutMs: 100 });
  assert.equal(badTimeout.valid, false);
  assert.ok(badTimeout.errors.some(e => e.includes('timeoutMs')));
});

test('Config: Loading non-existent config file auto-generates defaults', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lemo-cfg-test-'));
  const cfgPath = path.join(tmpDir, 'subdir', 'config.json');

  try {
    assert.equal(fs.existsSync(cfgPath), false);
    const loaded = ConfigManager.load(cfgPath);

    assert.equal(fs.existsSync(cfgPath), true);
    assert.equal(loaded.defaultModel, DEFAULT_CONFIG.defaultModel);
    assert.equal(loaded.baseUrl, DEFAULT_CONFIG.baseUrl);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Config: Saving and updating configuration persists accurately', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lemo-cfg-test-'));
  const cfgPath = path.join(tmpDir, 'config.json');

  try {
    ConfigManager.save(DEFAULT_CONFIG, cfgPath);

    const updated = ConfigManager.update({
      defaultModel: 'gemini-pro',
      agentIterationLimit: 50,
      apiKey: 'sk-my-secret-test-key'
    }, cfgPath);

    assert.equal(updated.defaultModel, 'gemini-pro');
    assert.equal(updated.agentIterationLimit, 50);
    assert.equal(updated.apiKey, 'sk-my-secret-test-key');

    // Reload from disk to verify persistence
    const reloaded = ConfigManager.load(cfgPath);
    assert.equal(reloaded.defaultModel, 'gemini-pro');
    assert.equal(reloaded.agentIterationLimit, 50);
    assert.equal(reloaded.apiKey, 'sk-my-secret-test-key');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Config: getRedacted masks secret API keys', () => {
  const cfg = {
    ...DEFAULT_CONFIG,
    apiKey: 'sk-1234567890abcdef1234567890'
  };

  const redacted = ConfigManager.getRedacted(cfg);
  assert.notEqual(redacted.apiKey, cfg.apiKey);
  assert.ok(String(redacted.apiKey).includes('...'));

  const emptyKey = ConfigManager.getRedacted({ ...DEFAULT_CONFIG, apiKey: '' });
  assert.equal(emptyKey.apiKey, '(not set)');
});

test('Config: Invalid configuration file on disk throws ConfigError', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lemo-cfg-test-'));
  const cfgPath = path.join(tmpDir, 'config.json');

  try {
    fs.writeFileSync(cfgPath, JSON.stringify({ baseUrl: 'invalid', defaultMode: 'unknown' }));
    assert.throws(() => ConfigManager.load(cfgPath), ConfigError);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
