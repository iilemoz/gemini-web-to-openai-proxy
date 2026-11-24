import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { app } from '../src/app.js';
import { config } from '../src/config/index.js';
import { requestTracker } from '../src/utils/requestTracker.js';
import {
  calculateBackoff,
  parseRetryAfter,
  isRetryableStatusCode,
  isRetryableError,
  executeWithRetry
} from '../src/utils/retry.js';
import { registry } from '../src/providers/index.js';
import { BaseProvider } from '../src/providers/BaseProvider.js';

let server;
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  requestTracker.reset();
});

// ---------------------------------------------------------------------------
// 1. Retry Logic & Backoff Unit Tests
// ---------------------------------------------------------------------------

test('calculateBackoff calculates exponential backoff and respects maxDelay', () => {
  const d1 = calculateBackoff(1, 100, 1000, false);
  const d2 = calculateBackoff(2, 100, 1000, false);
  const d3 = calculateBackoff(3, 100, 1000, false);
  const d5 = calculateBackoff(5, 100, 1000, false);

  assert.equal(d1, 100);
  assert.equal(d2, 200);
  assert.equal(d3, 400);
  assert.equal(d5, 1000); // capped at maxDelay

  // Jitter test: should be within [0.5 * capped, 1.5 * capped]
  for (let i = 0; i < 20; i++) {
    const dj = calculateBackoff(2, 100, 1000, true);
    assert.ok(dj >= 100, `Expected jittered delay >= 100, got ${dj}`);
    assert.ok(dj <= 300, `Expected jittered delay <= 300, got ${dj}`);
  }
});

test('parseRetryAfter parses delta-seconds and HTTP-date strings correctly', () => {
  assert.equal(parseRetryAfter('5'), 5000);
  assert.equal(parseRetryAfter('0'), 0);
  assert.equal(parseRetryAfter(10), 10000);
  assert.equal(parseRetryAfter(null), null);
  assert.equal(parseRetryAfter(''), null);
  assert.equal(parseRetryAfter('invalid-string'), null);

  // Future HTTP-date
  const futureDate = new Date(Date.now() + 4000).toUTCString();
  const parsedFuture = parseRetryAfter(futureDate);
  assert.ok(parsedFuture > 2000 && parsedFuture <= 5000);

  // Past HTTP-date
  const pastDate = new Date(Date.now() - 5000).toUTCString();
  assert.equal(parseRetryAfter(pastDate), 0);
});

test('isRetryableStatusCode and isRetryableError classify errors correctly', () => {
  // Retryable codes
  assert.equal(isRetryableStatusCode(429), true);
  assert.equal(isRetryableStatusCode(500), true);
  assert.equal(isRetryableStatusCode(502), true);
  assert.equal(isRetryableStatusCode(503), true);
  assert.equal(isRetryableStatusCode(504), true);

  // Non-retryable codes
  assert.equal(isRetryableStatusCode(400), false);
  assert.equal(isRetryableStatusCode(401), false);
  assert.equal(isRetryableStatusCode(403), false);
  assert.equal(isRetryableStatusCode(404), false);
  assert.equal(isRetryableStatusCode(422), false);

  // Error objects
  const rateLimitErr = new Error('Too many requests');
  rateLimitErr.status = 429;
  assert.equal(isRetryableError(rateLimitErr), true);

  const authErr = new Error('Unauthorized');
  authErr.status = 401;
  assert.equal(isRetryableError(authErr), false);

  const badRequestErr = new Error('Invalid schema');
  badRequestErr.status = 400;
  assert.equal(isRetryableError(badRequestErr), false);

  const connResetErr = new Error('Connection reset');
  connResetErr.code = 'ECONNRESET';
  assert.equal(isRetryableError(connResetErr), true);

  const abortErr = new Error('Request was aborted');
  abortErr.name = 'AbortError';
  assert.equal(isRetryableError(abortErr), false);
});

test('executeWithRetry retries on transient errors and eventually succeeds', async () => {
  let callCount = 0;
  const operation = async (attempt) => {
    callCount++;
    if (attempt < 3) {
      const err = new Error('Service Unavailable');
      err.status = 503;
      throw err;
    }
    return 'success-on-attempt-3';
  };

  const result = await executeWithRetry(operation, {
    maxAttempts: 3,
    initialDelayMs: 10,
    maxDelayMs: 50,
    jitter: false
  });

  assert.equal(result, 'success-on-attempt-3');
  assert.equal(callCount, 3);
});

test('executeWithRetry throws immediately without retrying non-retryable 401 error', async () => {
  let callCount = 0;
  const operation = async () => {
    callCount++;
    const err = new Error('Unauthorized access');
    err.status = 401;
    throw err;
  };

  await assert.rejects(
    async () => {
      await executeWithRetry(operation, {
        maxAttempts: 3,
        initialDelayMs: 10
      });
    },
    (err) => {
      assert.equal(err.status, 401);
      return true;
    }
  );

  assert.equal(callCount, 1);
});

test('executeWithRetry exhausts maximum attempts on continuous retryable failure', async () => {
  let callCount = 0;
  const operation = async () => {
    callCount++;
    const err = new Error('Bad Gateway');
    err.status = 502;
    throw err;
  };

  await assert.rejects(
    async () => {
      await executeWithRetry(operation, {
        maxAttempts: 3,
        initialDelayMs: 10,
        jitter: false
      });
    },
    (err) => {
      assert.equal(err.status, 502);
      return true;
    }
  );

  assert.equal(callCount, 3);
});

test('executeWithRetry halts immediately when AbortSignal is aborted', async () => {
  const ac = new AbortController();
  let callCount = 0;

  const operation = async () => {
    callCount++;
    const err = new Error('Temporary 503');
    err.status = 503;
    // Abort after first failed attempt
    ac.abort();
    throw err;
  };

  await assert.rejects(
    async () => {
      await executeWithRetry(operation, {
        maxAttempts: 4,
        initialDelayMs: 100,
        signal: ac.signal
      });
    },
    (err) => {
      assert.equal(err.name, 'AbortError');
      return true;
    }
  );

  assert.equal(callCount, 1);
});

// ---------------------------------------------------------------------------
// 2. Request Tracker & Graceful Shutdown Integration Tests
// ---------------------------------------------------------------------------

test('requestTracker tracks active requests and updates activeCount', () => {
  requestTracker.reset();
  const ac1 = new AbortController();
  const ac2 = new AbortController();

  assert.equal(requestTracker.getActiveCount(), 0);
  assert.equal(requestTracker.track('req-1', ac1), true);
  assert.equal(requestTracker.track('req-2', ac2), true);
  assert.equal(requestTracker.getActiveCount(), 2);

  requestTracker.untrack('req-1');
  assert.equal(requestTracker.getActiveCount(), 1);

  requestTracker.untrack('req-2');
  assert.equal(requestTracker.getActiveCount(), 0);
});

test('requestTracker.abortAll aborts all in-flight controllers', () => {
  requestTracker.reset();
  const ac1 = new AbortController();
  const ac2 = new AbortController();

  let aborted1 = false;
  let aborted2 = false;
  ac1.signal.addEventListener('abort', () => { aborted1 = true; });
  ac2.signal.addEventListener('abort', () => { aborted2 = true; });

  requestTracker.track('req-1', ac1);
  requestTracker.track('req-2', ac2);

  requestTracker.abortAll('Shutdown test');

  assert.equal(aborted1, true);
  assert.equal(aborted2, true);
  assert.equal(requestTracker.getActiveCount(), 0);
});

test('Incoming requests receive 503 when server is shutting down', async () => {
  requestTracker.reset();
  requestTracker.startShutdown();

  try {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-flash',
        messages: [{ role: 'user', content: 'hello' }]
      })
    });

    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error.code, 'server_shutting_down');
    assert.equal(body.error.type, 'service_unavailable');
  } finally {
    requestTracker.reset();
  }
});

// ---------------------------------------------------------------------------
// 3. Streaming Lifecycle & Disconnect Tests
// ---------------------------------------------------------------------------

test('Streaming completion terminates cleanly with [DONE] and un-tracks request', async () => {
  requestTracker.reset();

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-flash',
      messages: [{ role: 'user', content: 'Say "OK"' }],
      stream: true
    })
  });

  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');

  const text = await res.text();
  assert.ok(text.includes('data: [DONE]'), 'Stream must include data: [DONE]');
  // Verify exactly one [DONE] chunk
  const doneOccurrences = text.split('data: [DONE]').length - 1;
  assert.equal(doneOccurrences, 1, 'Stream must contain exactly one [DONE]');

  // Verify request is cleanly untracked after stream completion
  assert.equal(requestTracker.getActiveCount(), 0);
});

test('Non-streaming completion cleanly un-tracks request in tracker', async () => {
  requestTracker.reset();

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-flash',
      messages: [{ role: 'user', content: 'Say "PONG"' }],
      stream: false
    })
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.object, 'chat.completion');
  assert.equal(requestTracker.getActiveCount(), 0);
});

test('Responses API cleanly tracks and un-tracks request in tracker', async () => {
  requestTracker.reset();

  const res = await fetch(`${baseUrl}/v1/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-flash',
      input: 'Reply with the number 42'
    })
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.object, 'response');
  assert.equal(requestTracker.getActiveCount(), 0);
});

// ---------------------------------------------------------------------------
// 4. Deterministic Mock Provider Lifecycle Tests
// ---------------------------------------------------------------------------

class MockTimeoutProvider extends BaseProvider {
  constructor() {
    super('mock-timeout');
  }
  supportsModel(modelId) {
    return modelId === 'mock-timeout-model';
  }
  async *chatComplete({ signal }) {
    yield { type: 'content', text: 'Chunk 1' };
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 4000);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        const err = new Error('Aborted by signal');
        err.name = 'AbortError';
        reject(err);
      });
    });
  }
}

class MockStreamErrorProvider extends BaseProvider {
  constructor() {
    super('mock-stream-error');
    this.callCount = 0;
  }
  supportsModel(modelId) {
    return modelId === 'mock-stream-error-model';
  }
  async *chatComplete() {
    this.callCount++;
    yield { type: 'content', text: 'First chunk' };
    const err = new Error('Mid-stream failure');
    err.status = 502;
    throw err;
  }
}

class MockDisconnectProvider extends BaseProvider {
  constructor() {
    super('mock-disconnect');
    this.wasAborted = false;
  }
  supportsModel(modelId) {
    return modelId === 'mock-disconnect-model';
  }
  async *chatComplete({ signal }) {
    yield { type: 'content', text: 'First token' };
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 2000);
      if (signal) {
        signal.addEventListener('abort', () => {
          this.wasAborted = true;
          clearTimeout(timer);
          resolve();
        });
      }
    });
    if (signal?.aborted) return;
    yield { type: 'content', text: 'Second token' };
  }
}

test('Streaming idle token timeout triggers abort and cleanly ends stream', async () => {
  const timeoutProvider = new MockTimeoutProvider();
  registry.register(timeoutProvider);

  const prevIdleTimeout = config.streamingIdleTimeoutMs;
  config.streamingIdleTimeoutMs = 150; // Fast 150ms timeout for test

  try {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'mock-timeout-model',
        messages: [{ role: 'user', content: 'test timeout' }],
        stream: true
      })
    });

    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('Chunk 1'));
    assert.equal(requestTracker.getActiveCount(), 0);
  } finally {
    config.streamingIdleTimeoutMs = prevIdleTimeout;
  }
});

test('Mid-stream failure does NOT retry and terminates with error SSE and [DONE]', async () => {
  const streamErrorProvider = new MockStreamErrorProvider();
  registry.register(streamErrorProvider);

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'mock-stream-error-model',
      messages: [{ role: 'user', content: 'test error' }],
      stream: true
    })
  });

  assert.equal(res.status, 200);
  const text = await res.text();

  // Exactly 1 call attempted: MUST NOT retry once streaming starts!
  assert.equal(streamErrorProvider.callCount, 1);
  assert.ok(text.includes('First chunk'));
  assert.ok(text.includes('Mid-stream failure') || text.includes('upstream_error'));
  assert.ok(text.includes('data: [DONE]'));
  assert.equal(requestTracker.getActiveCount(), 0);
});

test('Client disconnect propagates to upstream signal and untracks active request', async () => {
  const disconnectProvider = new MockDisconnectProvider();
  registry.register(disconnectProvider);

  const clientAc = new AbortController();

  const fetchPromise = fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'mock-disconnect-model',
      messages: [{ role: 'user', content: 'disconnect test' }],
      stream: true
    }),
    signal: clientAc.signal
  });

  // Wait a short moment for request to arrive and start
  await new Promise((r) => setTimeout(r, 80));

  // Client aborts the request
  clientAc.abort();

  try {
    await fetchPromise;
  } catch {
    // Expected abort error on fetch
  }

  // Allow event loop to process disconnect event
  await new Promise((r) => setTimeout(r, 100));

  assert.equal(disconnectProvider.wasAborted, true);
  assert.equal(requestTracker.getActiveCount(), 0);
});

test('gracefulShutdown closes server and aborts in-flight requests after grace period', async () => {
  requestTracker.reset();
  const mockServer = {
    closed: false,
    close(cb) {
      this.closed = true;
      if (cb) cb();
    }
  };

  const ac = new AbortController();
  requestTracker.track('in-flight-test', ac);
  assert.equal(requestTracker.getActiveCount(), 1);

  const { gracefulShutdown } = await import('../src/server.js');
  await gracefulShutdown(mockServer, 100);

  assert.equal(mockServer.closed, true);
  assert.equal(ac.signal.aborted, true);
  assert.equal(requestTracker.getActiveCount(), 0);
  requestTracker.reset();
});
