import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { app } from '../src/app.js';
import { applyStopSequences, createStreamingStopFilter } from '../src/utils/stopSequences.js';
import { modelRegistry } from '../src/providers/index.js';

let server;
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  if (server) {
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    await new Promise((resolve) => server.close(resolve));
  }
});

// ── Test 1: Stop Sequences - Pure Text Filtering ────────────────────────────
test('StopSequences: applyStopSequences truncates text at single or multiple stop strings', () => {
  assert.equal(applyStopSequences('Hello world STOP here', 'STOP').text, 'Hello world ');
  assert.equal(applyStopSequences('foo bar baz', ['qux', 'bar']).text, 'foo ');
  assert.equal(applyStopSequences('No stop words here', ['END', 'FINISH']).text, 'No stop words here');
  assert.equal(applyStopSequences('Sample text', null).text, 'Sample text');
  assert.equal(applyStopSequences('Sample text', []).text, 'Sample text');
});

// ── Test 2: Stop Sequences - Streaming Buffer Filter ────────────────────────
test('StopSequences: createStreamingStopFilter handles streaming chunks across stop boundaries', () => {
  const emitted = [];
  const filter = createStreamingStopFilter(['<|im_end|>', 'STOP'], (chunk) => {
    emitted.push(chunk);
  });

  filter.push('This is chunk 1 ');
  filter.push('and here is ST');
  filter.push('OP rest of text');
  filter.flush();

  const fullText = emitted.join('');
  assert.ok(!fullText.includes('STOP'));
  assert.ok(!fullText.includes('rest of text'));
  assert.equal(fullText, 'This is chunk 1 and here is ');
  assert.equal(filter.isStopped(), true);
});

// ── Test 3: Model Capabilities - No Vision ──────────────────────────────────
test('Capabilities: Gemini Web models have vision disabled or omitted', () => {
  const models = modelRegistry.listModels();
  for (const m of models) {
    if (m.capabilities) {
      assert.notEqual(m.capabilities.vision, true, `Model ${m.id} must not claim vision capability`);
    }
  }
});

// ── Test 4: Chat Completions - Rejection of HTTP Image URLs ─────────────────
test('Multimodal Rejection: Chat completions rejects HTTP/HTTPS image URLs with 400 image_input_unsupported', async () => {
  const payloads = [
    {
      model: 'gemini-flash',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Inspect this picture' },
            { type: 'image_url', image_url: { url: 'https://example.com/photo.png' } }
          ]
        }
      ]
    },
    {
      model: 'gemini-flash',
      messages: [
        {
          role: 'user',
          content: 'Here is an image: ![diagram](https://example.com/chart.jpg)'
        }
      ]
    }
  ];

  for (const body of payloads) {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.error.code, 'image_input_unsupported');
    assert.ok(data.error.message.includes('text-based'));
  }
});

// ── Test 5: Chat Completions - Rejection of Base64 Image URIs ───────────────
test('Multimodal Rejection: Chat completions rejects Base64 image URIs with 400 image_input_unsupported', async () => {
  const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  const payloads = [
    {
      model: 'gemini-flash',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUri } }
          ]
        }
      ]
    },
    {
      model: 'gemini-pro',
      messages: [
        {
          role: 'user',
          content: `Attached image: ${dataUri}`
        }
      ]
    }
  ];

  for (const body of payloads) {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.error.code, 'image_input_unsupported');
  }
});

// ── Test 6: Responses API - Rejection of Image Inputs ───────────────────────
test('Responses API: Rejects image input with 400 image_input_unsupported', async () => {
  const res = await fetch(`${baseUrl}/v1/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-flash',
      input: [
        {
          role: 'user',
          content: [{ type: 'image_url', image_url: { url: 'https://example.com/test.jpg' } }]
        }
      ]
    })
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.error.code, 'image_input_unsupported');
});

// ── Test 7: Responses API - Rejection of Streaming ──────────────────────────
test('Responses API: Rejects stream: true with 400 streaming_not_supported', async () => {
  const res = await fetch(`${baseUrl}/v1/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-flash',
      input: 'Explain recursion',
      stream: true
    })
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.error.code, 'streaming_not_supported');
});

// ── Test 8: Chat Completions - Valid Text-Only Array Format ─────────────────
test('Chat completions: Accepts text-only array parts format without error', async () => {
  // We send a request with text parts array; validation middleware passes it.
  // We use non-existent model to check validation passes before reaching router (404 instead of 400)
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'unknown-model-for-validation-check',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Hello, proxy!' },
            { type: 'text', text: 'How are you?' }
          ]
        }
      ]
    })
  });

  // Reaching router means validation middleware passed the request cleanly!
  assert.equal(res.status, 404);
  const data = await res.json();
  assert.equal(data.error.code, 'model_not_found');
});
