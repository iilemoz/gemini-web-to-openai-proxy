import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { app } from '../src/app.js';
import { config } from '../src/config/index.js';
import { modelRegistry, modelRouter } from '../src/providers/index.js';
import { GeminiEngine } from '../src/providers/gemini/GeminiEngine.js';
import { Model } from 'gemini-web-sdk';
import {
  isImagePayload,
  validateMessageContent,
  validateResponsesInput
} from '../src/utils/textOnlyValidator.js';
import { authMiddleware } from '../src/middleware/auth.js';

let server;
let baseUrl;

test.before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Text-Only Validation: Legitimate Text with Image URLs (FINDING 50F1-01)
// ─────────────────────────────────────────────────────────────────────────────

test('FINDING 50F1-01: isImagePayload permits legitimate text referencing image URLs', () => {
  const allowedTexts = [
    'Check out https://example.com/logo.png for the latest branding.',
    'Review the image at https://assets.site.org/images/hero.jpg?v=2 and comment.',
    'Failed to load asset at /var/www/static/img/avatar.webp',
    'button { background-image: url("https://cdn.example.com/icons/search.png"); }',
    '<img src="https://example.com/banner.gif" alt="Banner" width="200" />',
    'const icon = require("./assets/icon.svg");',
    'Here is a list of supported formats: png, jpg, gif, webp, svg.',
    'C:\\Users\\User\\Pictures\\screenshot.bmp'
  ];

  for (const text of allowedTexts) {
    assert.equal(isImagePayload(text), false, `Should NOT treat as image payload: ${text}`);
    assert.equal(validateMessageContent(text), null, `validateMessageContent should pass: ${text}`);
    assert.equal(validateResponsesInput(text), null, `validateResponsesInput should pass: ${text}`);
  }
});

test('FINDING 50F1-01: HTTP POST /v1/chat/completions accepts messages with image URLs in text', async () => {
  const testPrompts = [
    'Please inspect https://example.com/logo.png and explain the CSS colors.',
    'background-image: url("https://example.com/bg.jpeg");',
    '<img src="https://example.com/banner.gif" />'
  ];

  for (const content of testPrompts) {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-flash',
        messages: [{ role: 'user', content }]
      })
    });

    // The validation middleware MUST NOT reject this with 400 image_input_unsupported.
    // It should proceed past validation (either 200 or upstream response, NOT 400 image_input_unsupported).
    if (res.status === 400) {
      const err = await res.json();
      assert.notEqual(err.error?.code, 'image_input_unsupported', `Unexpected rejection for text: ${content}`);
    }
  }
});

test('FINDING 50F1-01 & 50F1-02: HTTP POST /v1/responses accepts text with image URLs', async () => {
  const res = await fetch(`${baseUrl}/v1/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-flash',
      input: 'Please analyze this CSS rule: background-image: url("https://example.com/style.png");'
    })
  });

  if (res.status === 400) {
    const err = await res.json();
    assert.notEqual(err.error?.code, 'image_input_unsupported');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Strict Rejection of Real Image Payloads (FINDING 50F1-01 & 50F1-02)
// ─────────────────────────────────────────────────────────────────────────────

test('FINDING 50F1-01 & 50F1-02: Rejects structured image_url in /v1/chat/completions', async () => {
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-flash',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is in this picture?' },
            { type: 'image_url', image_url: { url: 'https://example.com/photo.png' } }
          ]
        }
      ]
    })
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.error.code, 'image_input_unsupported');
  assert.equal(data.error.type, 'invalid_request_error');
});

test('FINDING 50F1-01 & 50F1-02: Rejects base64 data URI in /v1/chat/completions', async () => {
  const base64Uri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-flash',
      messages: [
        { role: 'user', content: `Here is my avatar: ${base64Uri}` }
      ]
    })
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.error.code, 'image_input_unsupported');
});

test('FINDING 50F1-01 & 50F1-02: Rejects standalone markdown image syntax in /v1/chat/completions', async () => {
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-flash',
      messages: [
        { role: 'user', content: '![diagram](https://example.com/arch.png)' }
      ]
    })
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.error.code, 'image_input_unsupported');
});

test('FINDING 50F1-01 & 50F1-02: Rejects non-text modality in /v1/chat/completions', async () => {
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-flash',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'input_audio', input_audio: { data: 'abc==', format: 'mp3' } }
          ]
        }
      ]
    })
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.error.code, 'unsupported_content_type');
});

test('FINDING 50F1-01 & 50F1-02: Rejects base64 and markdown images in /v1/responses', async () => {
  // 1. Base64
  const res1 = await fetch(`${baseUrl}/v1/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-flash',
      input: 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
    })
  });
  assert.equal(res1.status, 400);
  const data1 = await res1.json();
  assert.equal(data1.error.code, 'image_input_unsupported');

  // 2. Markdown image (standalone)
  const res2 = await fetch(`${baseUrl}/v1/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-flash',
      input: '![alt](https://example.com/photo.jpg)'
    })
  });
  assert.equal(res2.status, 400);
  const data2 = await res2.json();
  assert.equal(data2.error.code, 'image_input_unsupported');
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Quota Fallback & Prevention of Silent Model Downgrade (FINDING 50F1-03)
// ─────────────────────────────────────────────────────────────────────────────

test('FINDING 50F1-03: GeminiEngine allows guest fallback ONLY for BASIC_FLASH on quota error', async () => {
  const engine = new GeminiEngine();

  // Mock account client that throws UsageLimitExceeded
  const mockLimitError = new Error('Usage limit exceeded for your account plan');
  mockLimitError.name = 'UsageLimitExceeded';

  const fakeAccountClient = {
    newChat: () => ({
      generateContentStream: async () => {
        throw mockLimitError;
      }
    })
  };

  engine.getClient = () => ({
    client: fakeAccountClient,
    isTemporary: false
  });

  // 1. Pro model MUST throw 429 insufficient_quota instead of falling back to Flash
  let caughtError = null;
  try {
    const generator = engine.streamChat({
      model: 'gemini-pro',
      messages: [{ role: 'user', content: 'Complex reasoning query' }]
    });
    for await (const _ of generator) {}
  } catch (err) {
    caughtError = err;
  }

  assert.ok(caughtError, 'Expected error to be thrown for Pro model on quota limit');
  assert.equal(caughtError.status, 429);
  assert.equal(caughtError.code, 'insufficient_quota');
  assert.ok(caughtError.message.includes('gemini-3-pro'));
  assert.ok(caughtError.message.includes('Automatic downgrade'));

  // 2. Thinking model MUST ALSO throw 429 insufficient_quota
  let caughtThinkingError = null;
  try {
    const generator = engine.streamChat({
      model: 'gemini-thinking',
      messages: [{ role: 'user', content: 'Deep thinking query' }]
    });
    for await (const _ of generator) {}
  } catch (err) {
    caughtThinkingError = err;
  }

  assert.ok(caughtThinkingError, 'Expected error to be thrown for Thinking model on quota limit');
  assert.equal(caughtThinkingError.status, 429);
  assert.equal(caughtThinkingError.code, 'insufficient_quota');
  assert.ok(caughtThinkingError.message.includes('gemini-3-thinking'));
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Production Authentication & Host Binding (FINDING 50F1-04)
// ─────────────────────────────────────────────────────────────────────────────

test('FINDING 50F1-04: authMiddleware enforces PROXY_API_KEY in production mode', () => {
  const origIsProd = config.isProduction;
  const origKey = config.proxyApiKey;

  try {
    config.isProduction = true;
    config.proxyApiKey = '';

    let resStatus = null;
    let resBody = null;
    let nextCalled = false;

    const fakeReq = { headers: {}, ip: '127.0.0.1', originalUrl: '/v1/chat/completions' };
    const fakeRes = {
      status(s) {
        resStatus = s;
        return this;
      },
      json(b) {
        resBody = b;
        return this;
      }
    };
    const next = () => { nextCalled = true; };

    authMiddleware(fakeReq, fakeRes, next);

    assert.equal(nextCalled, false);
    assert.equal(resStatus, 500);
    assert.equal(resBody?.error?.code, 'missing_production_api_key');
  } finally {
    config.isProduction = origIsProd;
    config.proxyApiKey = origKey;
  }
});

test('FINDING 50F1-04: authMiddleware permits unauthenticated access in development mode', () => {
  const origIsProd = config.isProduction;
  const origKey = config.proxyApiKey;

  try {
    config.isProduction = false;
    config.proxyApiKey = '';

    let nextCalled = false;
    const fakeReq = { headers: {}, ip: '127.0.0.1', originalUrl: '/v1/models' };
    const fakeRes = {
      status() { return this; },
      json() { return this; }
    };
    const next = () => { nextCalled = true; };

    authMiddleware(fakeReq, fakeRes, next);

    assert.equal(nextCalled, true, 'Next should be called in dev mode when proxyApiKey is empty');
  } finally {
    config.isProduction = origIsProd;
    config.proxyApiKey = origKey;
  }
});

test('FINDING 50F1-04: Development host defaults to 127.0.0.1', () => {
  assert.equal(config.host, '127.0.0.1');
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Truthful Model Identity & Registry Integrity (FINDING 50F1-05)
// ─────────────────────────────────────────────────────────────────────────────

test('FINDING 50F1-05: /v1/models exposes only canonical genuine models without misleading 2.5 claims', async () => {
  const res = await fetch(`${baseUrl}/v1/models`);
  assert.equal(res.status, 200);
  const data = await res.json();

  assert.equal(data.object, 'list');
  const ids = data.data.map(m => m.id);

  // Canonical models MUST be present
  assert.ok(ids.includes('gemini-flash'));
  assert.ok(ids.includes('gemini-pro'));
  assert.ok(ids.includes('gemini-thinking'));
  assert.ok(ids.includes('gemini-lite'));

  // Misleading 2.5 aliases should NOT be advertised in public models list
  assert.ok(!ids.includes('gemini-2.5-flash'), 'gemini-2.5-flash should not be in public /v1/models');
  assert.ok(!ids.includes('gemini-2.5-pro'), 'gemini-2.5-pro should not be in public /v1/models');
  assert.ok(!ids.includes('gemini-2.5-thinking'), 'gemini-2.5-thinking should not be in public /v1/models');

  // Descriptions must be truthful
  for (const model of data.data) {
    assert.equal(model.owned_by, 'google');
    assert.ok(!model.description.includes('2.5'), `Description should not claim 2.5: ${model.description}`);
  }
});

test('FINDING 50F1-05: Misleading 2.5 aliases are removed and fail closed with 404 model_not_found', () => {
  // Verifies that unverified legacy aliases are not resolved and fail closed with 404 model_not_found
  assert.throws(
    () => modelRouter.resolve('gemini-2.5-flash'),
    (err) => err.status === 404 && err.code === 'model_not_found'
  );
  assert.throws(
    () => modelRouter.resolve('gemini-2.5-pro'),
    (err) => err.status === 404 && err.code === 'model_not_found'
  );
  assert.throws(
    () => modelRouter.resolve('gemini-2.5-thinking'),
    (err) => err.status === 404 && err.code === 'model_not_found'
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Markdown Text Acceptance vs Rejection Matrix (PHASE 5.0F.2.1)
// ─────────────────────────────────────────────────────────────────────────────

test('PHASE 5.0F.2.1: Markdown image syntax in text is accepted while raw payloads are rejected', () => {
  // Required acceptance cases: ordinary text discussing or illustrating syntax
  const acceptedCases = [
    'Explain this Markdown image syntax: ![alt](https://example.com/image.png)',
    'Why does ![logo](logo.png) not render?',
    '```markdown\n![alt](https://example.com/image.png)\n```',
    'Text explaining how Markdown image embedding works: use ![alt](url) format.',
    '`![alt](https://example.com/image.png)`',
    '"![alt](https://example.com/image.png)"',
    'Here is an example in docs: ![photo](https://example.com/photo.jpg)'
  ];

  for (const text of acceptedCases) {
    assert.equal(isImagePayload(text), false, `Should NOT treat as image payload: ${text}`);
    assert.equal(validateMessageContent(text), null, `validateMessageContent should pass: ${text}`);
    assert.equal(validateResponsesInput(text), null, `validateResponsesInput should pass: ${text}`);
  }

  // Required rejection cases: raw standalone attachment tags, base64 payloads, and structured objects
  const rejectedCases = [
    '![alt](https://example.com/image.png)',
    '![logo](logo.png)',
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'Explain this: ![alt](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==)',
    { type: 'image_url', image_url: { url: 'https://example.com/photo.png' } },
    { type: 'image', image: 'https://example.com/photo.png' }
  ];

  for (const payload of rejectedCases) {
    assert.equal(isImagePayload(payload), true, `Should treat as image payload: ${JSON.stringify(payload)}`);
  }
});

test('PHASE 5.0F.2.1: /v1/chat/completions & /v1/responses accept markdown discussion text', async () => {
  // 1. /v1/chat/completions accepts markdown discussion
  const chatRes = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-flash',
      messages: [
        { role: 'user', content: 'Explain this Markdown image syntax: ![alt](https://example.com/image.png)' }
      ]
    })
  });
  if (chatRes.status === 400) {
    const data = await chatRes.json();
    assert.notEqual(data.error?.code, 'image_input_unsupported');
  }

  // 2. /v1/responses accepts markdown discussion
  const respRes = await fetch(`${baseUrl}/v1/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-flash',
      input: 'Why does ![logo](logo.png) not render?'
    })
  });
  if (respRes.status === 400) {
    const data = await respRes.json();
    assert.notEqual(data.error?.code, 'image_input_unsupported');
  }

  // 3. /v1/chat/completions rejects standalone markdown image attachment
  const rejectRes = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-flash',
      messages: [
        { role: 'user', content: '![alt](https://example.com/image.png)' }
      ]
    })
  });
  assert.equal(rejectRes.status, 400);
  const rejectData = await rejectRes.json();
  assert.equal(rejectData.error.code, 'image_input_unsupported');
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Guest Mode Fallback SDK Invocation Arguments Verification (PHASE 5.0F.2.1)
// ─────────────────────────────────────────────────────────────────────────────

test('PHASE 5.0F.2.1: Guest Mode fallback invokes SDK with exact Model.BASIC_FLASH constant and fails closed for Pro/Thinking', async () => {
  const engine = new GeminiEngine();

  let capturedChatOpts = null;
  const mockGuestClient = {
    newChat: (opts) => {
      capturedChatOpts = opts;
      return {
        generateContentStream: async function* () {
          yield { candidates: [{ index: 0, text_delta: 'Guest Flash response' }] };
        }
      };
    },
    close: async () => {}
  };

  engine.createGuestClient = () => mockGuestClient;

  // 1. Account Mode Flash quota limit -> Exact-model fallback to Guest Mode using Model.BASIC_FLASH
  const flashLimitError = new Error('Usage limit exceeded for your account plan');
  flashLimitError.name = 'UsageLimitExceeded';

  const flashGenerator = engine.executeWithFallback({
    resolvedModel: Model.BASIC_FLASH,
    isGuest: false,
    generateOpts: { prompt: 'Test Flash prompt' },
    signal: null,
    err: flashLimitError
  });

  const flashChunks = [];
  for await (const chunk of flashGenerator) {
    flashChunks.push(chunk);
  }

  assert.ok(capturedChatOpts, 'Guest client newChat should have been called');
  assert.equal(capturedChatOpts.model, Model.BASIC_FLASH, 'Must pass exact Model.BASIC_FLASH to SDK');
  assert.equal(capturedChatOpts.model.model_name, 'gemini-3-flash');
  assert.equal(flashChunks[0].text, 'Guest Flash response');

  // Reset spy
  capturedChatOpts = null;

  // 2. Account Mode Pro quota limit -> MUST FAIL CLOSED, newChat must NOT be called
  let proCaught = null;
  try {
    const proGenerator = engine.executeWithFallback({
      resolvedModel: Model.BASIC_PRO,
      isGuest: false,
      generateOpts: { prompt: 'Test Pro prompt' },
      signal: null,
      err: flashLimitError
    });
    for await (const _ of proGenerator) {}
  } catch (err) {
    proCaught = err;
  }

  assert.ok(proCaught, 'Pro quota limit must throw error');
  assert.equal(proCaught.status, 429);
  assert.equal(proCaught.code, 'insufficient_quota');
  assert.equal(capturedChatOpts, null, 'Guest client newChat must NOT be called for Pro model');

  // 3. Account Mode Thinking quota limit -> MUST FAIL CLOSED, newChat must NOT be called
  let thinkingCaught = null;
  try {
    const thinkingGenerator = engine.executeWithFallback({
      resolvedModel: Model.BASIC_THINKING,
      isGuest: false,
      generateOpts: { prompt: 'Test Thinking prompt' },
      signal: null,
      err: flashLimitError
    });
    for await (const _ of thinkingGenerator) {}
  } catch (err) {
    thinkingCaught = err;
  }

  assert.ok(thinkingCaught, 'Thinking quota limit must throw error');
  assert.equal(thinkingCaught.status, 429);
  assert.equal(thinkingCaught.code, 'insufficient_quota');
  assert.equal(capturedChatOpts, null, 'Guest client newChat must NOT be called for Thinking model');
});
