import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LemoError,
  ConfigError,
  ValidationError,
  NetworkError,
  AuthenticationError,
  ModelError,
  formatErrorMessage
} from '../dist/core/errors/index.js';

test('Errors: Error classes preserve names and error codes', () => {
  const configErr = new ConfigError('Invalid setting');
  assert.equal(configErr.name, 'ConfigError');
  assert.equal(configErr.code, 'CONFIG_ERROR');
  assert.ok(configErr instanceof LemoError);

  const valErr = new ValidationError('Bad arg');
  assert.equal(valErr.name, 'ValidationError');
  assert.equal(valErr.code, 'VALIDATION_ERROR');

  const netErr = new NetworkError('Gateway timeout', 504);
  assert.equal(netErr.name, 'NetworkError');
  assert.equal(netErr.code, 'NETWORK_ERROR');
  assert.equal(netErr.status, 504);

  const authErr = new AuthenticationError();
  assert.equal(authErr.name, 'AuthenticationError');
  assert.equal(authErr.code, 'AUTH_ERROR');

  const modelErr = new ModelError('Model not found');
  assert.equal(modelErr.name, 'ModelError');
  assert.equal(modelErr.code, 'MODEL_ERROR');
});

test('Errors: formatErrorMessage formats user messages without leaking stack in non-debug mode', () => {
  const err = new ConfigError('File missing');
  const formatted = formatErrorMessage(err, false);
  assert.equal(formatted, '[CONFIG_ERROR] File missing');
  assert.ok(!formatted.includes('at '));

  const debugFormatted = formatErrorMessage(err, true);
  assert.ok(debugFormatted.includes('[CONFIG_ERROR] File missing'));
  assert.ok(debugFormatted.includes('at '));
});
