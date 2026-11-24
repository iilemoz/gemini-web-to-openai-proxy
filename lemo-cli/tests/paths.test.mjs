import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { getConfigDir, getConfigPath } from '../dist/core/config/paths.js';

test('Paths: Environment variable overrides take precedence', () => {
  const originalDir = process.env.LEMO_CONFIG_DIR;
  const originalPath = process.env.LEMO_CONFIG_PATH;

  try {
    process.env.LEMO_CONFIG_DIR = 'C:\\custom\\lemo\\dir';
    delete process.env.LEMO_CONFIG_PATH;
    assert.equal(getConfigDir(), path.resolve('C:\\custom\\lemo\\dir'));
    assert.equal(getConfigPath(), path.resolve('C:\\custom\\lemo\\dir\\config.json'));

    process.env.LEMO_CONFIG_PATH = 'D:\\explicit\\settings.json';
    assert.equal(getConfigPath(), path.resolve('D:\\explicit\\settings.json'));
  } finally {
    if (originalDir !== undefined) process.env.LEMO_CONFIG_DIR = originalDir;
    else delete process.env.LEMO_CONFIG_DIR;

    if (originalPath !== undefined) process.env.LEMO_CONFIG_PATH = originalPath;
    else delete process.env.LEMO_CONFIG_PATH;
  }
});

test('Paths: Resolves platform-compatible config path on Windows', () => {
  const originalPath = process.env.LEMO_CONFIG_PATH;
  const originalDir = process.env.LEMO_CONFIG_DIR;
  delete process.env.LEMO_CONFIG_PATH;
  delete process.env.LEMO_CONFIG_DIR;

  try {
    const p = getConfigPath();
    assert.ok(typeof p === 'string');
    assert.ok(p.endsWith('config.json'));
    assert.ok(p.includes('lemo'));
  } finally {
    if (originalDir !== undefined) process.env.LEMO_CONFIG_DIR = originalDir;
    if (originalPath !== undefined) process.env.LEMO_CONFIG_PATH = originalPath;
  }
});
