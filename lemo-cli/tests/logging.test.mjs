import test from 'node:test';
import assert from 'node:assert/strict';
import { redactSecrets, Logger } from '../dist/core/logging/index.js';

test('Logging: redactSecrets masks Bearer tokens', () => {
  const text = 'Authorization: Bearer sk-secret-token-1234567890';
  const redacted = redactSecrets(text);
  assert.ok(!redacted.includes('sk-secret-token-1234567890'));
  assert.ok(redacted.includes('Bearer [REDACTED]') || redacted.includes('[REDACTED_KEY]'));
});

test('Logging: redactSecrets masks sk-... style keys', () => {
  const text = 'Connecting with key sk-abcdef1234567890xyz to gateway';
  const redacted = redactSecrets(text);
  assert.ok(!redacted.includes('sk-abcdef1234567890xyz'));
  assert.ok(redacted.includes('[REDACTED_KEY]'));
});

test('Logging: redactSecrets masks JSON fields with credentials', () => {
  const payload = {
    apiKey: 'sk-999999999999999',
    username: 'developer'
  };
  const redacted = redactSecrets(payload);
  assert.ok(!redacted.includes('sk-999999999999999'));
  assert.ok(redacted.includes('[REDACTED]'));
  assert.ok(redacted.includes('developer'));
});

test('Logging: Log level filtering respects configured thresholds', () => {
  const logs = [];
  const origDebug = console.debug;
  const origLog = console.log;

  console.debug = (...args) => logs.push({ level: 'debug', msg: args.join(' ') });
  console.log = (...args) => logs.push({ level: 'log', msg: args.join(' ') });

  try {
    const logger = new Logger('warn');
    logger.debug('This is debug');
    logger.info('This is info');
    assert.equal(logs.length, 0);

    logger.setLevel('debug');
    logger.debug('Visible debug');
    assert.equal(logs.length, 1);
    assert.ok(logs[0].msg.includes('Visible debug'));
  } finally {
    console.debug = origDebug;
    console.log = origLog;
  }
});
