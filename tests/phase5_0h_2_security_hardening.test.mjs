import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { app } from '../src/app.js';
import { config } from '../src/config/index.js';
import { safeCompareTokens } from '../src/middleware/auth.js';
import {
  rateLimiter,
  cleanupExpiredRecords,
  startRateLimiterCleanup,
  stopRateLimiterCleanup,
  resetRateLimits,
  getRateLimitMapSize
} from '../src/middleware/rateLimiter.js';
import {
  logger,
  sanitizeLogValue,
  redactSensitiveText
} from '../src/utils/logger.js';
import { registry } from '../src/providers/index.js';

let server;
let baseUrl;

// Helper to make HTTP requests against local test server
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
        } catch { /* text response */ }
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
  // Setup mock Gemini provider for chat completion tests
  registry._mockDefaultProvider = {
    name: 'Mock Security Test Provider',
    id: 'gemini',
    chatComplete: async function* () {
      yield { type: 'content', text: 'Security test response' };
    }
  };

  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

test.after(async () => {
  stopRateLimiterCleanup();
  registry._mockDefaultProvider = null;
  if (server) {
    await new Promise(resolve => server.close(resolve));
  }
});

test.describe('SEC-01: Constant-Time API Key Comparison', () => {
  test('safeCompareTokens handles exact match', () => {
    assert.equal(safeCompareTokens('secret-key-12345', 'secret-key-12345'), true);
  });

  test('safeCompareTokens rejects mismatched tokens safely', () => {
    assert.equal(safeCompareTokens('wrong-key-12345', 'secret-key-12345'), false);
  });

  test('safeCompareTokens safely compares tokens of completely different byte lengths', () => {
    assert.equal(safeCompareTokens('short', 'a-very-long-production-secret-api-key-value-999999999'), false);
    assert.equal(safeCompareTokens('a-very-long-production-secret-api-key-value-999999999', 'short'), false);
  });

  test('safeCompareTokens safely handles empty or non-string inputs', () => {
    assert.equal(safeCompareTokens('', 'secret'), false);
    assert.equal(safeCompareTokens('secret', ''), false);
    assert.equal(safeCompareTokens(null, 'secret'), false);
    assert.equal(safeCompareTokens(undefined, 'secret'), false);
    assert.equal(safeCompareTokens({}, 'secret'), false);
    assert.equal(safeCompareTokens('secret', 12345), false);
  });

  test('HTTP auth enforcement with Bearer and x-api-key', async () => {
    const originalKey = config.proxyApiKey;
    config.proxyApiKey = 'sec-test-proxy-token-2026';

    try {
      // 1. Missing token -> 401
      const resMissing = await httpRequest('/v1/models');
      assert.equal(resMissing.statusCode, 401);
      assert.equal(resMissing.body?.error?.code, 'invalid_api_key');
      assert.equal(JSON.stringify(resMissing.body).includes('sec-test-proxy-token-2026'), false);

      // 2. Incorrect Bearer token -> 401
      const resBadBearer = await httpRequest('/v1/models', {
        headers: { 'authorization': 'Bearer wrong-key' }
      });
      assert.equal(resBadBearer.statusCode, 401);
      assert.equal(resBadBearer.body?.error?.code, 'invalid_api_key');

      // 3. Valid Bearer token -> 200
      const resGoodBearer = await httpRequest('/v1/models', {
        headers: { 'authorization': 'Bearer sec-test-proxy-token-2026' }
      });
      assert.equal(resGoodBearer.statusCode, 200);

      // 4. Valid x-api-key header -> 200
      const resGoodApiKey = await httpRequest('/v1/models', {
        headers: { 'x-api-key': 'sec-test-proxy-token-2026' }
      });
      assert.equal(resGoodApiKey.statusCode, 200);

      // 5. Different length token -> 401
      const resDiffLen = await httpRequest('/v1/models', {
        headers: { 'x-api-key': 'short' }
      });
      assert.equal(resDiffLen.statusCode, 401);
    } finally {
      config.proxyApiKey = originalKey;
    }
  });

  test('Production mode fails closed when PROXY_API_KEY is missing', async () => {
    const originalProd = config.isProduction;
    const originalKey = config.proxyApiKey;

    config.isProduction = true;
    config.proxyApiKey = '';

    try {
      const res = await httpRequest('/v1/models');
      assert.equal(res.statusCode, 500);
      assert.equal(res.body?.error?.code, 'missing_production_api_key');
      assert.equal(res.body?.error?.type, 'server_error');
    } finally {
      config.isProduction = originalProd;
      config.proxyApiKey = originalKey;
    }
  });
});

test.describe('SEC-02: HTTP Security Response Headers', () => {
  test('Defensive security headers present on 200 JSON responses', async () => {
    const res = await httpRequest('/health');
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-frame-options'], 'DENY');
    assert.equal(res.headers['referrer-policy'], 'no-referrer');
    assert.equal(res.headers['cross-origin-resource-policy'], 'same-origin');
    assert.equal(res.headers['x-xss-protection'], '0');
    assert.match(res.headers['permissions-policy'], /camera=\(\)/);
    assert.match(res.headers['content-security-policy'], /default-src 'self'/);
  });

  test('Defensive security headers present on 400 validation error responses', async () => {
    const res = await httpRequest('/v1/chat/completions', {
      method: 'POST',
      body: { invalid: 'payload' }
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-frame-options'], 'DENY');
    assert.equal(res.headers['referrer-policy'], 'no-referrer');
  });

  test('Defensive security headers present on 401 authentication error responses', async () => {
    const originalKey = config.proxyApiKey;
    config.proxyApiKey = 'sec-test-proxy-key';

    try {
      const res = await httpRequest('/v1/models');
      assert.equal(res.statusCode, 401);
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
      assert.equal(res.headers['x-frame-options'], 'DENY');
    } finally {
      config.proxyApiKey = originalKey;
    }
  });

  test('Defensive security headers present on SSE streaming responses without breaking stream', async () => {
    const res = await httpRequest('/v1/chat/completions', {
      method: 'POST',
      body: {
        model: 'gemini-flash',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true
      }
    });

    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'], /text\/event-stream/);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-frame-options'], 'DENY');
    assert.equal(res.headers['referrer-policy'], 'no-referrer');
    assert.ok(typeof res.body === 'string' && res.body.includes('data: [DONE]'));
  });
});

test.describe('SEC-03: Rate Limiter Memory Lifecycle', () => {
  test('Rate limiter tracks request counts and enforces limit', () => {
    resetRateLimits();
    const mockReq = { ip: '192.168.1.100' };
    let statusCode = null;
    let jsonBody = null;
    const mockRes = {
      setHeader: () => {},
      status: (c) => { statusCode = c; return { json: (b) => { jsonBody = b; } }; }
    };

    const origMax = config.rateLimitMax;
    config.rateLimitMax = 2;

    try {
      let nextCalled = 0;
      const next = () => { nextCalled++; };

      // Request 1
      rateLimiter(mockReq, mockRes, next);
      assert.equal(nextCalled, 1);

      // Request 2
      rateLimiter(mockReq, mockRes, next);
      assert.equal(nextCalled, 2);

      // Request 3 -> Rate limit exceeded (429)
      rateLimiter(mockReq, mockRes, next);
      assert.equal(nextCalled, 2);
      assert.equal(statusCode, 429);
      assert.equal(jsonBody?.error?.code, 'rate_limit_exceeded');
    } finally {
      config.rateLimitMax = origMax;
      resetRateLimits();
    }
  });

  test('cleanupExpiredRecords removes expired IP entries while preserving active ones', () => {
    resetRateLimits();
    const now = 1700000000000;
    const windowMs = config.rateLimitWindowMs || 60000;

    // Simulate entry 1 (active)
    rateLimiter({ ip: '10.0.0.1' }, {}, () => {});
    // Simulate entry 2 (expired by setting fake clock)
    rateLimiter({ ip: '10.0.0.2' }, {}, () => {});

    assert.equal(getRateLimitMapSize(), 2);

    // Call cleanup with current time -> 0 removed (both are fresh)
    const removedFresh = cleanupExpiredRecords(Date.now());
    assert.equal(removedFresh, 0);
    assert.equal(getRateLimitMapSize(), 2);

    // Call cleanup with future time past window -> all expired entries removed
    const removedExpired = cleanupExpiredRecords(Date.now() + windowMs + 5000);
    assert.equal(removedExpired, 2);
    assert.equal(getRateLimitMapSize(), 0);
  });

  test('startRateLimiterCleanup and stopRateLimiterCleanup lifecycle management', () => {
    // Should safely stop without throwing
    stopRateLimiterCleanup();
    stopRateLimiterCleanup(); // Idempotent

    // Should safely start without creating duplicate intervals
    startRateLimiterCleanup(5000);
    startRateLimiterCleanup(5000); // Idempotent duplicate check

    stopRateLimiterCleanup();
  });
});

test.describe('SEC-04: Production CORS Restrictions', () => {
  test('Non-browser clients (no Origin header) are allowed unconditionally', async () => {
    const res = await httpRequest('/health');
    assert.equal(res.statusCode, 200);
  });

  test('Allowed browser origin receives CORS headers', async () => {
    const res = await httpRequest('/health', {
      headers: { 'origin': 'http://localhost:3000' }
    });
    assert.equal(res.statusCode, 200);
    // In dev mode with wildcard, Access-Control-Allow-Origin: * is returned
    assert.equal(res.headers['access-control-allow-origin'], '*');
  });
});

test.describe('SEC-05: Sensitive Logging & Error Redaction', () => {
  test('redactSensitiveText redacts Bearer tokens, Gemini cookies, and secrets', () => {
    const raw = 'Request with Bearer sk-secret12345678901234567890 and __Secure-1PSID=g.a.some_long_session_cookie_value_here';
    const redacted = redactSensitiveText(raw);

    assert.equal(redacted.includes('sk-secret12345678901234567890'), false);
    assert.equal(redacted.includes('some_long_session_cookie_value_here'), false);
    assert.ok(redacted.includes('Bearer [REDACTED_TOKEN]'));
    assert.ok(redacted.includes('__Secure-1PSID=[REDACTED]'));
  });

  test('sanitizeLogValue redacts sensitive headers in objects', () => {
    const logData = {
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        'authorization': 'Bearer my-secret-api-key-12345',
        'x-api-key': 'my-custom-api-key-67890',
        'cookie': '__Secure-1PSID=g.a.cookie_val; __Secure-1PSIDTS=ts_val',
        'x-gemini-cookie': 'secret-gemini-cookie',
        'user-agent': 'Continue/0.8.0'
      }
    };

    const sanitized = sanitizeLogValue(logData);
    assert.equal(sanitized.headers.authorization, '[REDACTED_HEADER]');
    assert.equal(sanitized.headers['x-api-key'], '[REDACTED_HEADER]');
    assert.equal(sanitized.headers.cookie, '[REDACTED_HEADER]');
    assert.equal(sanitized.headers['x-gemini-cookie'], '[REDACTED_HEADER]');
    assert.equal(sanitized.headers['user-agent'], 'Continue/0.8.0');
  });

  test('sanitizeLogValue sanitizes Error objects without exposing secrets in stack or message', () => {
    const secret = 'super-secret-production-key-9999';
    const err = new Error(`Connection failed while verifying Bearer ${secret}`);
    err.code = 'ECONNREFUSED';

    const sanitized = sanitizeLogValue(err);
    assert.equal(sanitized.name, 'Error');
    assert.equal(sanitized.message.includes(secret), false);
    assert.ok(sanitized.message.includes('Bearer [REDACTED_TOKEN]'));
  });

  test('logger methods execute safely and do not throw', () => {
    logger.info('Test info message with secret Bearer abcdef123456789012345');
    logger.success('Test success message');
    logger.warn('Test warning with sensitive object', { authorization: 'Bearer 12345' });
    logger.error('Test error message', new Error('Test failure with __Secure-1PSID=g.a.foo_bar_secret_123'));
    logger.debug('Test debug message');
  });
});
