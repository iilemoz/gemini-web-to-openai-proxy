import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { app } from '../src/app.js';
import { config } from '../src/config/index.js';
import { validateStartupConfig } from '../src/config/validator.js';
import { mapUpstreamError, isUpstreamErrorText } from '../src/utils/upstreamErrors.js';
import { requestTracker } from '../src/utils/requestTracker.js';
import { readiness } from '../src/utils/readiness.js';
import { gracefulShutdown } from '../src/server.js';
import { registry } from '../src/providers/index.js';

// Helper to make local HTTP requests
function makeRequest(server, path, options = {}) {
  const addr = server.address();
  const port = addr.port;
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method: options.method || 'GET',
      headers: options.headers || {}
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: parsed,
          rawData: data
        });
      });
    });
    req.on('error', reject);
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

test('Finding H32-01: Production API Key Validation Contract', async (t) => {
  const baseValidConfig = {
    port: 3000,
    host: '127.0.0.1',
    isProduction: true,
    proxyApiKey: 'valid-secret-key-16-chars-long',
    connectionTimeoutMs: 15000,
    requestTimeoutMs: 120000,
    streamingIdleTimeoutMs: 60000,
    shutdownGracePeriodMs: 30000,
    models: config.models
  };

  await t.test('Rejects missing PROXY_API_KEY in production mode', () => {
    const res = validateStartupConfig({ ...baseValidConfig, proxyApiKey: '' });
    assert.strictEqual(res.valid, false);
    assert.ok(res.errors.some(e => e.includes('PROXY_API_KEY must be configured')));
  });

  await t.test('Rejects whitespace-only PROXY_API_KEY in production mode', () => {
    const res = validateStartupConfig({ ...baseValidConfig, proxyApiKey: '   ' });
    assert.strictEqual(res.valid, false);
    assert.ok(res.errors.some(e => e.includes('PROXY_API_KEY must be configured')));
  });

  await t.test('Rejects short PROXY_API_KEY (< 16 chars) in production mode', () => {
    const res = validateStartupConfig({ ...baseValidConfig, proxyApiKey: 'short-key-123' });
    assert.strictEqual(res.valid, false);
    assert.ok(res.errors.some(e => e.includes('at least 16 characters')));
    // Ensure supplied secret is not echoed in error message
    assert.strictEqual(res.errors.some(e => e.includes('short-key-123')), false);
  });

  await t.test('Accepts PROXY_API_KEY of exactly 16 characters', () => {
    const res = validateStartupConfig({ ...baseValidConfig, proxyApiKey: '1234567890abcdef' });
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.errors.length, 0);
  });

  await t.test('Accepts PROXY_API_KEY of more than 16 characters', () => {
    const res = validateStartupConfig({ ...baseValidConfig, proxyApiKey: 'long-production-api-key-with-sufficient-entropy' });
    assert.strictEqual(res.valid, true);
  });

  await t.test('Allows missing PROXY_API_KEY in development mode', () => {
    const res = validateStartupConfig({ ...baseValidConfig, isProduction: false, proxyApiKey: '' });
    assert.strictEqual(res.valid, true);
  });
});

test('Finding H32-02: Timeout Configuration Validation Contract', async (t) => {
  const baseConfig = {
    port: 3000,
    host: '127.0.0.1',
    isProduction: false,
    proxyApiKey: '',
    connectionTimeoutMs: 15000,
    requestTimeoutMs: 120000,
    streamingIdleTimeoutMs: 60000,
    shutdownGracePeriodMs: 30000,
    models: config.models
  };

  await t.test('Rejects negative or below-minimum (<1000ms) timeouts', () => {
    const res1 = validateStartupConfig({ ...baseConfig, connectionTimeoutMs: 500 });
    assert.strictEqual(res1.valid, false);
    assert.ok(res1.errors.some(e => e.includes('UPSTREAM_CONNECT_TIMEOUT_MS') && e.includes('at least 1000ms')));

    const res2 = validateStartupConfig({ ...baseConfig, requestTimeoutMs: -100 });
    assert.strictEqual(res2.valid, false);

    const res3 = validateStartupConfig({ ...baseConfig, shutdownGracePeriodMs: 0 });
    assert.strictEqual(res3.valid, false);
  });

  await t.test('Rejects non-integer, non-numeric, or NaN timeouts', () => {
    const res1 = validateStartupConfig({ ...baseConfig, connectionTimeoutMs: '15000' });
    assert.strictEqual(res1.valid, false);

    const res2 = validateStartupConfig({ ...baseConfig, requestTimeoutMs: 12.5 });
    assert.strictEqual(res2.valid, false);

    const res3 = validateStartupConfig({ ...baseConfig, streamingIdleTimeoutMs: NaN });
    assert.strictEqual(res3.valid, false);

    const res4 = validateStartupConfig({ ...baseConfig, shutdownGracePeriodMs: Infinity });
    assert.strictEqual(res4.valid, false);
  });

  await t.test('Rejects excessively large timeouts (> 24 hours)', () => {
    const res = validateStartupConfig({ ...baseConfig, requestTimeoutMs: 999999999 });
    assert.strictEqual(res.valid, false);
    assert.ok(res.errors.some(e => e.includes('Exceeds maximum allowable duration')));
  });

  await t.test('Accepts valid bounded timeout integers', () => {
    const res = validateStartupConfig(baseConfig);
    assert.strictEqual(res.valid, true);
  });
});

test('Finding H32-03: Model Registry Integrity Contract', async (t) => {
  const baseConfig = {
    port: 3000,
    host: '127.0.0.1',
    isProduction: true,
    proxyApiKey: 'abcdef1234567890',
    connectionTimeoutMs: 15000,
    requestTimeoutMs: 120000,
    streamingIdleTimeoutMs: 60000,
    shutdownGracePeriodMs: 30000,
    models: config.models
  };

  await t.test('Accepts genuine canonical model registry', () => {
    const res = validateStartupConfig(baseConfig);
    assert.strictEqual(res.valid, true);
  });

  await t.test('Rejects missing canonical model definition (e.g. missing gemini-thinking) in production', () => {
    const subsetModels = config.models.filter(m => m.id !== 'gemini-thinking');
    const res = validateStartupConfig({ ...baseConfig, models: subsetModels });
    assert.strictEqual(res.valid, false);
    assert.ok(res.errors.some(e => e.includes('Missing required canonical model definition: "gemini-thinking"')));
  });

  await t.test('Rejects duplicate canonical model identifiers', () => {
    const duplicateModels = [...config.models, config.models[0]];
    const res = validateStartupConfig({ ...baseConfig, models: duplicateModels });
    assert.strictEqual(res.valid, false);
    assert.ok(res.errors.some(e => e.includes('Duplicate canonical model identifier')));
  });

  await t.test('Rejects invalid model schema (missing id or invalid type)', () => {
    const invalidModels = [
      null,
      { id: 'gemini-pro', object: 'model', owned_by: 'google' },
      { id: 'gemini-thinking', object: 'model', owned_by: 'google' },
      { id: 'gemini-lite', object: 'model', owned_by: 'google' }
    ];
    const res = validateStartupConfig({ ...baseConfig, models: invalidModels });
    assert.strictEqual(res.valid, false);
    assert.ok(res.errors.some(e => e.includes('Each model entry must be an object with a non-empty "id" property')));
  });
});

test('Finding H32-04: Separation of Proxy Authentication vs Upstream Session Expiry', async (t) => {
  await t.test('mapUpstreamError maps upstream 401 session expiry to 502 gemini_session_expired, NOT invalid_api_key', () => {
    const upstreamErr = new Error('Session cookie expired');
    upstreamErr.status = 401;
    upstreamErr.code = 'AUTH_FAILED';

    const mapped = mapUpstreamError(upstreamErr);
    assert.strictEqual(mapped.status, 502);
    assert.strictEqual(mapped.body.error.code, 'gemini_session_expired');
    assert.strictEqual(mapped.body.error.type, 'upstream_error');
    assert.notStrictEqual(mapped.body.error.code, 'invalid_api_key');
    assert.ok(mapped.body.error.message.includes('Gemini Web session authentication failed'));
  });

  await t.test('mapUpstreamError maps upstream 405 anti-bot response to 502 upstream_rejected', () => {
    const err405 = new Error('Method Not Allowed');
    err405.status = 405;

    const mapped = mapUpstreamError(err405);
    assert.strictEqual(mapped.status, 502);
    assert.strictEqual(mapped.body.error.code, 'upstream_rejected');
    assert.strictEqual(mapped.body.error.type, 'upstream_error');
  });

  await t.test('mapUpstreamError maps upstream 429 rate limit to 429 insufficient_quota rate_limit_exceeded', () => {
    const err429 = new Error('Too Many Requests');
    err429.status = 429;

    const mapped = mapUpstreamError(err429);
    assert.strictEqual(mapped.status, 429);
    assert.strictEqual(mapped.body.error.code, 'rate_limit_exceeded');
    assert.strictEqual(mapped.body.error.type, 'insufficient_quota');
  });

  await t.test('mapUpstreamError maps timeout to 504 request_timeout', () => {
    const errTimeout = new Error('Gateway Timeout');
    errTimeout.status = 504;

    const mapped = mapUpstreamError(errTimeout);
    assert.strictEqual(mapped.status, 504);
    assert.strictEqual(mapped.body.error.code, 'request_timeout');
  });
});

test('Finding H32-05 & H32-06: Graceful Shutdown Drainage & SSE Mid-Stream Error Lifecycle', async (t) => {
  let server;

  t.beforeEach(async () => {
    readiness.reset();
    requestTracker.reset();
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    readiness.setInitialized(true);
  });

  t.afterEach(async () => {
    readiness.reset();
    requestTracker.reset();
    if (server && server.listening) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  await t.test('Controlled request drainage completes naturally during graceful shutdown', async () => {
    const fakeReqId = 'drain-test-req-1';
    const fakeAbortController = new AbortController();
    assert.strictEqual(requestTracker.track(fakeReqId, fakeAbortController), true);
    assert.strictEqual(requestTracker.getActiveCount(), 1);

    // Simulate completion after 50ms
    setTimeout(() => {
      requestTracker.untrack(fakeReqId);
    }, 50);

    const shutdownPromise = gracefulShutdown(server, 500);
    const shutdownResult = await shutdownPromise;

    assert.strictEqual(shutdownResult, true);
    assert.strictEqual(requestTracker.getActiveCount(), 0);
    assert.strictEqual(readiness.isReady(), false);
  });

  await t.test('Graceful shutdown aborts lingering requests when grace period expires', async () => {
    const fakeReqId = 'stuck-req-2';
    let wasAborted = false;
    const fakeAbortController = new AbortController();
    fakeAbortController.signal.addEventListener('abort', () => {
      wasAborted = true;
    });

    assert.strictEqual(requestTracker.track(fakeReqId, fakeAbortController), true);

    // Grace period of 100ms
    await gracefulShutdown(server, 100);

    assert.strictEqual(wasAborted, true);
    assert.strictEqual(requestTracker.getActiveCount(), 0);
  });

  await t.test('Graceful shutdown is idempotent and handles repeated invocations without race condition', async () => {
    const [res1, res2] = await Promise.all([
      gracefulShutdown(server, 200),
      gracefulShutdown(server, 200)
    ]);
    assert.strictEqual(res1, true);
    assert.strictEqual(res2, true);
  });
});
