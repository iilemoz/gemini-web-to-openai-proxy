import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { app } from '../src/app.js';
import { config } from '../src/config/index.js';
import { validateStartupConfig } from '../src/config/validator.js';
import { readiness } from '../src/utils/readiness.js';
import { requestTracker } from '../src/utils/requestTracker.js';
import { gracefulShutdown } from '../src/server.js';
import { isUpstreamErrorText } from '../src/utils/upstreamErrors.js';
import { registry } from '../src/providers/index.js';
import { stopRateLimiterCleanup, getRateLimitMapSize } from '../src/middleware/rateLimiter.js';

let server;
let baseUrl;

function httpRequest(path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const req = http.request(url, { method, headers }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch { /* plain text */ }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: json || data
        });
      });
    });
    req.on('error', reject);
    if (body) {
      if (typeof body === 'object') {
        req.setHeader('Content-Type', 'application/json');
        req.write(JSON.stringify(body));
      } else {
        req.write(body);
      }
    }
    req.end();
  });
}

test.before(async () => {
  registry._mockDefaultProvider = {
    name: 'Mock Readiness Provider',
    id: 'gemini',
    chatComplete: async function* ({ signal }) {
      if (signal?.aborted) throw new Error('Aborted');
      yield { type: 'content', text: 'Operational readiness test response' };
    }
  };

  readiness.setInitialized(true);

  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

test.after(async () => {
  readiness.reset();
  requestTracker.reset();
  stopRateLimiterCleanup();
  registry._mockDefaultProvider = null;
  if (server) {
    await new Promise(resolve => server.close(resolve));
  }
});

// ---------------------------------------------------------------------------
// WORKSTREAM A: Health & Readiness Checks
// ---------------------------------------------------------------------------
test.describe('Workstream A: Health and Readiness Endpoints', () => {
  test('GET /healthz returns 200 with minimal status and no secret exposure', async () => {
    const res = await httpRequest('/healthz');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.status, 'ok');
    const raw = JSON.stringify(res.body);
    assert.equal(raw.includes('password'), false);
    assert.equal(raw.includes('secret'), false);
    assert.equal(raw.includes('cookie'), false);
  });

  test('GET /readyz returns 200 when application is initialized and not shutting down', async () => {
    readiness.setInitialized(true);
    requestTracker.isShuttingDown = false;

    const res = await httpRequest('/readyz');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.ready, true);
    assert.equal(res.body?.status, 'ready');
  });

  test('GET /readyz returns 503 when application is not initialized', async () => {
    readiness.setInitialized(false);

    try {
      const res = await httpRequest('/readyz');
      assert.equal(res.statusCode, 503);
      assert.equal(res.body?.ready, false);
      assert.equal(res.body?.status, 'initializing');
    } finally {
      readiness.setInitialized(true);
    }
  });

  test('GET /health returns 200 aggregate compatibility payload', async () => {
    const res = await httpRequest('/health');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.status, 'ok');
    assert.equal(res.body?.service, 'Google Gemini Web to OpenAI Proxy');
    assert.ok(typeof res.body?.timestamp === 'string');
  });
});

// ---------------------------------------------------------------------------
// WORKSTREAM B: Startup Configuration and Validation
// ---------------------------------------------------------------------------
test.describe('Workstream B: Startup Configuration Validation', () => {
  test('validateStartupConfig accepts valid configuration', () => {
    const validCfg = {
      port: 3000,
      host: '127.0.0.1',
      isProduction: false,
      proxyApiKey: '',
      connectionTimeoutMs: 15000,
      requestTimeoutMs: 120000,
      streamingIdleTimeoutMs: 60000,
      shutdownGracePeriodMs: 15000,
      models: [{ id: 'gemini-flash' }]
    };

    const result = validateStartupConfig(validCfg);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  test('validateStartupConfig rejects missing PROXY_API_KEY in production mode', () => {
    const prodCfg = {
      port: 3000,
      host: '0.0.0.0',
      isProduction: true,
      proxyApiKey: '',
      models: [{ id: 'gemini-flash' }]
    };

    const result = validateStartupConfig(prodCfg);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('PROXY_API_KEY must be configured')));
  });

  test('validateStartupConfig rejects invalid ports', () => {
    assert.equal(validateStartupConfig({ port: -1, host: '127.0.0.1', models: [{ id: 'gemini-flash' }] }).valid, false);
    assert.equal(validateStartupConfig({ port: 70000, host: '127.0.0.1', models: [{ id: 'gemini-flash' }] }).valid, false);
    assert.equal(validateStartupConfig({ port: 'not-a-number', host: '127.0.0.1', models: [{ id: 'gemini-flash' }] }).valid, false);
  });

  test('validateStartupConfig rejects negative timeouts', () => {
    const invalidCfg = {
      port: 3000,
      host: '127.0.0.1',
      connectionTimeoutMs: -100,
      models: [{ id: 'gemini-flash' }]
    };
    const result = validateStartupConfig(invalidCfg);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('UPSTREAM_CONNECT_TIMEOUT_MS')));
  });

  test('validateStartupConfig rejects missing model definitions', () => {
    const invalidCfg = {
      port: 3000,
      host: '127.0.0.1',
      models: []
    };
    const result = validateStartupConfig(invalidCfg);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('canonical model')));
  });
});

// ---------------------------------------------------------------------------
// WORKSTREAM C: Graceful Shutdown & Request Drainage
// ---------------------------------------------------------------------------
test.describe('Workstream C: Graceful Shutdown and Drainage', () => {
  test('gracefulShutdown is idempotent and marks readiness to false', async () => {
    readiness.setInitialized(true);
    requestTracker.reset();

    const mockServer = {
      close: (cb) => { if (cb) cb(); }
    };

    // First call initiates shutdown
    const res1 = await gracefulShutdown(mockServer, 500);
    assert.equal(res1, true);
    assert.equal(requestTracker.isShuttingDown, true);
    assert.equal(readiness.isReady(), false);

    // Second call is a safe no-op
    const res2 = await gracefulShutdown(mockServer, 500);
    assert.equal(res2, true);

    // Reset tracker for subsequent tests
    requestTracker.reset();
    readiness.setInitialized(true);
  });

  test('Incoming requests are rejected with 503 during shutdown', async () => {
    requestTracker.startShutdown();

    try {
      const res = await httpRequest('/v1/models');
      assert.equal(res.statusCode, 503);
      assert.equal(res.body?.error?.code, 'server_shutting_down');

      // /healthz remains accessible for supervisor liveness
      const healthzRes = await httpRequest('/healthz');
      assert.equal(healthzRes.statusCode, 200);

      // /readyz returns 503 not_ready
      const readyzRes = await httpRequest('/readyz');
      assert.equal(readyzRes.statusCode, 503);
      assert.equal(readyzRes.body?.status, 'shutting_down');
    } finally {
      requestTracker.reset();
      readiness.setInitialized(true);
    }
  });

  test('Graceful shutdown drains active requests within grace period', async () => {
    requestTracker.reset();
    const ac = new AbortController();
    requestTracker.track('test-active-req-1', ac);

    assert.equal(requestTracker.getActiveCount(), 1);

    // Simulate request completing after 100ms
    setTimeout(() => {
      requestTracker.untrack('test-active-req-1');
    }, 100);

    const mockServer = { close: (cb) => { if (cb) cb(); } };
    const success = await gracefulShutdown(mockServer, 2000);

    assert.equal(success, true);
    assert.equal(requestTracker.getActiveCount(), 0);

    requestTracker.reset();
    readiness.setInitialized(true);
  });

  test('Graceful shutdown aborts active requests if grace period expires', async () => {
    requestTracker.reset();
    const ac = new AbortController();
    let wasAborted = false;
    ac.signal.addEventListener('abort', () => { wasAborted = true; });

    requestTracker.track('test-hanging-req', ac);

    const mockServer = { close: (cb) => { if (cb) cb(); } };
    // Grace period 100ms -> should abort
    await gracefulShutdown(mockServer, 100);

    assert.equal(wasAborted, true);
    assert.equal(requestTracker.getActiveCount(), 0);

    requestTracker.reset();
    readiness.setInitialized(true);
  });
});

// ---------------------------------------------------------------------------
// WORKSTREAM D: Upstream Failure & Timeout Handling
// ---------------------------------------------------------------------------
test.describe('Workstream D: Upstream Error and Timeout Handling', () => {
  test('isUpstreamErrorText identifies upstream model apology / crash text', () => {
    assert.equal(isUpstreamErrorText('I seem to be encountering an error'), true);
    assert.equal(isUpstreamErrorText('An internal error occurred'), true);
    assert.equal(isUpstreamErrorText('Something went wrong on our end'), true);
    assert.equal(isUpstreamErrorText('Here is the code you requested: function foo() {}'), false);
    assert.equal(isUpstreamErrorText(''), false);
    assert.equal(isUpstreamErrorText(null), false);
  });

  test('Non-streaming completion with mock error maps to 502/500 without crashing', async () => {
    const originalProvider = registry._mockDefaultProvider;
    registry._mockDefaultProvider = {
      name: 'Failing Provider',
      id: 'gemini',
      chatComplete: async function* () {
        const err = new Error('Upstream model unavailable');
        err.status = 502;
        err.code = 'upstream_unavailable';
        throw err;
      }
    };

    try {
      const res = await httpRequest('/v1/chat/completions', {
        method: 'POST',
        body: {
          model: 'gemini-flash',
          messages: [{ role: 'user', content: 'hello' }],
          stream: false
        }
      });

      assert.equal(res.statusCode, 502);
      assert.equal(res.body?.error?.code, 'upstream_unavailable');
    } finally {
      registry._mockDefaultProvider = originalProvider;
    }
  });

  test('Streaming completion error after headers sent terminates with SSE error frame and DONE', async () => {
    const originalProvider = registry._mockDefaultProvider;
    registry._mockDefaultProvider = {
      name: 'Stream Fail Provider',
      id: 'gemini',
      chatComplete: async function* () {
        yield { type: 'content', text: 'Partial initial chunk' };
        throw new Error('Mid-stream network disconnect');
      }
    };

    try {
      const res = await httpRequest('/v1/chat/completions', {
        method: 'POST',
        body: {
          model: 'gemini-flash',
          messages: [{ role: 'user', content: 'hello stream' }],
          stream: true
        }
      });

      assert.equal(res.statusCode, 200);
      assert.match(res.headers['content-type'], /text\/event-stream/);
      assert.ok(typeof res.body === 'string');
      assert.ok(res.body.includes('Partial initial chunk'));
      assert.ok(res.body.includes('Mid-stream network disconnect'));
      assert.ok(res.body.includes('data: [DONE]'));
    } finally {
      registry._mockDefaultProvider = originalProvider;
    }
  });
});

// ---------------------------------------------------------------------------
// WORKSTREAM E & F: Resource Lifecycle & Operational Diagnostics
// ---------------------------------------------------------------------------
test.describe('Workstream E & F: Resource Lifecycle and Diagnostics', () => {
  test('Completed requests cleanly untrack from requestTracker', async () => {
    const initialCount = requestTracker.getActiveCount();

    const res = await httpRequest('/v1/chat/completions', {
      method: 'POST',
      body: {
        model: 'gemini-flash',
        messages: [{ role: 'user', content: 'test request' }],
        stream: false
      }
    });

    assert.equal(res.statusCode, 200);
    assert.equal(requestTracker.getActiveCount(), initialCount);
  });

  test('Readiness state correctly transitions across lifecycle', () => {
    readiness.reset();
    assert.equal(readiness.isReady(), false);
    assert.equal(readiness.getStatus().status, 'initializing');

    readiness.setInitialized(true);
    assert.equal(readiness.isReady(), true);
    assert.equal(readiness.getStatus().status, 'ready');

    requestTracker.startShutdown();
    assert.equal(readiness.isReady(), false);
    assert.equal(readiness.getStatus().status, 'shutting_down');

    requestTracker.reset();
    readiness.setInitialized(true);
  });
});
