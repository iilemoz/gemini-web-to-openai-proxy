import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import {
  validateImageUrl,
  validateContent,
  hasMultimodalContent,
  countImagesInMessages,
  extractHttpImageUrls,
  formatContentToPromptText,
  applyStopSequences,
  createStreamingStopFilter,
  isBlockedSsrfHost,
  MULTIMODAL_LIMITS
} from '../src/utils/multimodal.js';
import { validateChatCompletionRequest } from '../src/middleware/validation.js';
import { OpenAIProvider } from '../src/providers/openai/index.js';
import { GeminiEngine } from '../src/providers/gemini/GeminiEngine.js';
import { ModelRegistry } from '../src/providers/ModelRegistry.js';
import { ProviderRegistry } from '../src/providers/ProviderRegistry.js';
import { ModelRouter } from '../src/providers/ModelRouter.js';
import { handleChatCompletion } from '../src/controllers/chatController.js';
import { handleResponses } from '../src/controllers/responsesController.js';

// ── Test 1: SSRF Hostname & IP Filtering ─────────────────────────────────────
test('Multimodal: SSRF protection blocks private, loopback, and metadata hosts', () => {
  assert.strictEqual(isBlockedSsrfHost('localhost'), true);
  assert.strictEqual(isBlockedSsrfHost('127.0.0.1'), true);
  assert.strictEqual(isBlockedSsrfHost('::1'), true);
  assert.strictEqual(isBlockedSsrfHost('169.254.169.254'), true); // AWS/GCP metadata
  assert.strictEqual(isBlockedSsrfHost('10.0.0.1'), true);
  assert.strictEqual(isBlockedSsrfHost('172.16.5.10'), true);
  assert.strictEqual(isBlockedSsrfHost('192.168.1.1'), true);
  assert.strictEqual(isBlockedSsrfHost('server.internal'), true);
  assert.strictEqual(isBlockedSsrfHost('api.example.com'), false);
  assert.strictEqual(isBlockedSsrfHost('images.unsplash.com'), false);
});

// ── Test 2: Image URL Validation ─────────────────────────────────────────────
test('Multimodal: Image URL validation handles URLs, Data URIs, and malformed inputs', () => {
  // Valid HTTPS URL
  const validUrlRes = validateImageUrl('https://example.com/photo.jpg');
  assert.strictEqual(validUrlRes.valid, true);
  assert.strictEqual(validUrlRes.isDataUri, false);
  assert.strictEqual(validUrlRes.normalizedUrl, 'https://example.com/photo.jpg');

  // Valid image_url object with detail
  const validObjRes = validateImageUrl({ url: 'https://example.com/photo.png', detail: 'high' });
  assert.strictEqual(validObjRes.valid, true);
  assert.strictEqual(validObjRes.detail, 'high');

  // Invalid protocol
  const ftpRes = validateImageUrl('ftp://example.com/photo.png');
  assert.strictEqual(ftpRes.valid, false);
  assert.strictEqual(ftpRes.code, 'unsupported_image_protocol');

  // SSRF blocked URL
  const ssrfRes = validateImageUrl('http://169.254.169.254/latest/meta-data/image.png');
  assert.strictEqual(ssrfRes.valid, false);
  assert.strictEqual(ssrfRes.code, 'ssrf_prohibited_host');

  // Valid Base64 data URI
  const validDataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const dataUriRes = validateImageUrl(validDataUri);
  assert.strictEqual(dataUriRes.valid, true);
  assert.strictEqual(dataUriRes.isDataUri, true);
  assert.strictEqual(dataUriRes.mimeType, 'image/png');

  // Unsupported MIME type
  const badMimeRes = validateImageUrl('data:application/pdf;base64,JVBERi0xLjUK');
  assert.strictEqual(badMimeRes.valid, false);
  assert.strictEqual(badMimeRes.code, 'unsupported_image_type');

  // Malformed data URI
  const malformedDataRes = validateImageUrl('data:image/png;something');
  assert.strictEqual(malformedDataRes.valid, false);
  assert.strictEqual(malformedDataRes.code, 'invalid_data_uri');

  // Oversized Base64 payload
  const hugeBase64 = 'data:image/png;base64,' + 'A'.repeat(MULTIMODAL_LIMITS.MAX_BASE64_CHARS + 10);
  const oversizedRes = validateImageUrl(hugeBase64);
  assert.strictEqual(oversizedRes.valid, false);
  assert.strictEqual(oversizedRes.code, 'image_too_large');
});

// ── Test 3: Content Structure Validation ─────────────────────────────────────
test('Multimodal: Message content validator handles string and content arrays', () => {
  // Plain string
  const strRes = validateContent('Hello world');
  assert.strictEqual(strRes.valid, true);
  assert.strictEqual(strRes.hasImages, false);

  // Valid multimodal array
  const multiRes = validateContent([
    { type: 'text', text: 'Describe this image' },
    { type: 'image_url', image_url: { url: 'https://example.com/test.jpg' } }
  ]);
  assert.strictEqual(multiRes.valid, true);
  assert.strictEqual(multiRes.hasImages, true);
  assert.strictEqual(multiRes.textParts.length, 1);
  assert.strictEqual(multiRes.imageParts.length, 1);

  // Missing type in part
  const noTypeRes = validateContent([{ text: 'No type' }]);
  assert.strictEqual(noTypeRes.valid, false);
  assert.strictEqual(noTypeRes.code, 'missing_part_type');

  // Unsupported part type
  const badTypeRes = validateContent([{ type: 'audio', audio: 'test' }]);
  assert.strictEqual(badTypeRes.valid, false);
  assert.strictEqual(badTypeRes.code, 'unsupported_part_type');
});

// ── Test 4: Image Count & Detection ──────────────────────────────────────────
test('Multimodal: Image counting and detection utilities', () => {
  const messages = [
    { role: 'user', content: 'text only' },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'image 1 and 2' },
        { type: 'image_url', image_url: { url: 'https://example.com/1.png' } },
        { type: 'image_url', image_url: { url: 'https://example.com/2.png' } }
      ]
    }
  ];

  assert.strictEqual(hasMultimodalContent(messages), true);
  assert.strictEqual(countImagesInMessages(messages), 2);

  const httpUrls = extractHttpImageUrls(messages);
  assert.deepStrictEqual(httpUrls, [
    'https://example.com/1.png',
    'https://example.com/2.png'
  ]);
});

// ── Test 5: Gemini Content Formatting ────────────────────────────────────────
test('Multimodal: Gemini prompt text formatting preserves text and annotates images', () => {
  const content = [
    { type: 'text', text: 'What is in this picture?' },
    { type: 'image_url', image_url: { url: 'https://example.com/sample.jpg' } },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw==' } }
  ];

  const formatted = formatContentToPromptText(content);
  assert.match(formatted, /What is in this picture\?/);
  assert.match(formatted, /\[Attached image: https:\/\/example\.com\/sample\.jpg\]/);
  assert.match(formatted, /\[Attached image \(image\/png, base64\)\]/);
});

// ── Test 6: Stop Sequences (Non-streaming & Streaming) ───────────────────────
test('Stop Sequences: Truncation for non-streaming and streaming filters', () => {
  // Non-streaming
  const fullText = 'The answer is 42. <STOP> Extra commentary here.';
  const stopped = applyStopSequences(fullText, ['<STOP>', 'END']);
  assert.strictEqual(stopped.stopped, true);
  assert.strictEqual(stopped.text, 'The answer is 42. ');
  assert.strictEqual(stopped.stopSequence, '<STOP>');

  // Streaming stop filter
  const emittedChunks = [];
  const filter = createStreamingStopFilter(['###', 'END'], (chunk) => {
    emittedChunks.push(chunk);
  });

  filter.push('Hello ');
  filter.push('world! #');
  filter.push('## This is discarded');
  filter.flush();

  assert.strictEqual(filter.isStopped(), true);
  assert.strictEqual(emittedChunks.join(''), 'Hello world! ');
});

// ── Test 7: Chat Completion Request Middleware Validation ───────────────────
test('Validation Middleware: Enforces parameter constraints and image limits', () => {
  const req = {
    body: {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: 'https://example.com/1.png' } },
            { type: 'image_url', image_url: { url: 'https://example.com/2.png' } },
            { type: 'image_url', image_url: { url: 'https://example.com/3.png' } },
            { type: 'image_url', image_url: { url: 'https://example.com/4.png' } },
            { type: 'image_url', image_url: { url: 'https://example.com/5.png' } },
            { type: 'image_url', image_url: { url: 'https://example.com/6.png' } },
            { type: 'image_url', image_url: { url: 'https://example.com/7.png' } },
            { type: 'image_url', image_url: { url: 'https://example.com/8.png' } },
            { type: 'image_url', image_url: { url: 'https://example.com/9.png' } },
            { type: 'image_url', image_url: { url: 'https://example.com/10.png' } },
            { type: 'image_url', image_url: { url: 'https://example.com/11.png' } } // 11 images > max 10
          ]
        }
      ]
    }
  };

  let statusCode = 0;
  let jsonResponse = null;
  const res = {
    status(code) {
      statusCode = code;
      return {
        json(data) {
          jsonResponse = data;
        }
      };
    }
  };

  validateChatCompletionRequest(req, res, () => {});
  assert.strictEqual(statusCode, 400);
  assert.strictEqual(jsonResponse?.error?.code, 'too_many_images');
});

// ── Test 8: Capability Enforcement: Non-vision model rejection ───────────────
test('Model Capabilities: Non-vision model (o3-mini) rejects image requests', async () => {
  const pRegistry = new ProviderRegistry();
  const mRegistry = new ModelRegistry();

  const mockOpenAI = new OpenAIProvider({ apiKey: 'sk-test-mock-key' });
  pRegistry.register(mockOpenAI);
  for (const m of mockOpenAI.getModels()) {
    mRegistry.registerModel({
      id: m.id,
      providerId: mockOpenAI.id,
      upstreamModelId: m.upstreamModelId,
      capabilities: m.capabilities
    });
  }

  const router = new ModelRouter(pRegistry, mRegistry);

  // Vision request against gpt-4o (vision: true) -> succeeds
  const gpt4oRes = router.resolve('gpt-4o', { requiredCapabilities: ['vision'] });
  assert.strictEqual(gpt4oRes.model.id, 'gpt-4o');

  // Vision request against o3-mini (vision: false) -> throws HTTP 400 capability_not_supported
  assert.throws(
    () => {
      router.resolve('o3-mini', { requiredCapabilities: ['vision'] });
    },
    (err) => {
      return err.status === 400 && err.code === 'capability_not_supported' && err.param === 'vision';
    }
  );
});

// ── Test 9: OpenAI Provider forwards parameters (stop, response_format) ──────
test('OpenAI Provider: Forwards stop and response_format in upstream payload', async () => {
  let capturedPayload = null;

  const mockServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      capturedPayload = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chatcmpl-mock-test',
        choices: [{ index: 0, message: { role: 'assistant', content: '{"status":"ok"}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
      }));
    });
  });

  await new Promise(resolve => mockServer.listen(0, resolve));
  const port = mockServer.address().port;

  try {
    const provider = new OpenAIProvider({
      apiKey: 'sk-test-mock-key',
      baseUrl: `http://127.0.0.1:${port}/v1`
    });

    const chunks = [];
    for await (const chunk of provider.chatComplete({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Give JSON' }],
      response_format: { type: 'json_object' },
      stop: ['END', 'STOP']
    })) {
      chunks.push(chunk);
    }

    assert.ok(capturedPayload);
    assert.deepStrictEqual(capturedPayload.stop, ['END', 'STOP']);
    assert.deepStrictEqual(capturedPayload.response_format, { type: 'json_object' });
    assert.strictEqual(chunks.some(c => c.text?.includes('{"status":"ok"}')), true);
  } finally {
    await new Promise(resolve => mockServer.close(resolve));
  }
});

// ── Test 10: Responses API Compatibility with multimodal input ───────────────
test('Responses API: Accepts multimodal input and maps to standard Responses schema', async () => {
  const req = {
    body: {
      model: 'gemini-flash',
      input: [
        { type: 'text', text: 'Analyze this chart' },
        { type: 'image_url', image_url: { url: 'https://example.com/chart.png' } }
      ]
    }
  };

  let statusCode = 200;
  let jsonResponse = null;
  const res = {
    status(code) {
      statusCode = code;
      return {
        json(data) {
          jsonResponse = data;
        }
      };
    },
    json(data) {
      jsonResponse = data;
    },
    on() {}
  };

  // Mock default provider on registry
  const { registry } = await import('../src/providers/index.js');
  const prevMock = registry._mockDefaultProvider;
  registry._mockDefaultProvider = {
    id: 'gemini',
    name: 'Mock Gemini',
    getCapabilities() {
      return { responses: true, vision: true };
    },
    async *chatComplete() {
      yield { type: 'content', text: 'Chart shows an upward trend.' };
    }
  };

  try {
    await handleResponses(req, res);
    assert.strictEqual(statusCode, 200);
    assert.ok(jsonResponse);
    assert.strictEqual(jsonResponse.object, 'response');
    assert.strictEqual(jsonResponse.status, 'completed');
    assert.strictEqual(jsonResponse.output[0].content[0].text, 'Chart shows an upward trend.');
    assert.ok(jsonResponse.usage.total_tokens > 0);
  } finally {
    registry._mockDefaultProvider = prevMock;
  }
});

// ── Test 11: End-to-End Chat Completion: Multimodal and Stop Sequences ───────
test('Chat Completions: Non-streaming applies stop sequences and processes image input', async () => {
  const { registry } = await import('../src/providers/index.js');
  const prevMock = registry._mockDefaultProvider;

  registry._mockDefaultProvider = {
    id: 'openai',
    name: 'Mock OpenAI',
    getCapabilities() {
      return { chat: true, vision: true, stream: true, tools: true };
    },
    async *chatComplete() {
      yield { type: 'content', text: 'Step 1: Inspect. Step 2: Fix. <HALT> Extra details that should be stopped.' };
    }
  };

  const req = {
    body: {
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Perform workflow' },
            { type: 'image_url', image_url: { url: 'https://example.com/diagram.png' } }
          ]
        }
      ],
      stop: ['<HALT>']
    }
  };

  let jsonResult = null;
  const res = {
    status() { return this; },
    json(data) { jsonResult = data; },
    setHeader() {},
    flushHeaders() {},
    on() {}
  };

  try {
    await handleChatCompletion(req, res);
    assert.ok(jsonResult);
    assert.strictEqual(jsonResult.choices[0].finish_reason, 'stop');
    assert.strictEqual(jsonResult.choices[0].message.content, 'Step 1: Inspect. Step 2: Fix. ');
  } finally {
    registry._mockDefaultProvider = prevMock;
  }
});

// ── Test 12: End-to-End Streaming Chat Completion: Stop Filter & Usage ────────
test('Chat Completions: Streaming applies stop filter and outputs SSE format', async () => {
  const { registry } = await import('../src/providers/index.js');
  const prevMock = registry._mockDefaultProvider;

  registry._mockDefaultProvider = {
    id: 'openai',
    name: 'Mock OpenAI',
    getCapabilities() {
      return { chat: true, vision: true, stream: true, tools: true };
    },
    async *chatComplete() {
      yield { type: 'content', text: 'Part 1. Part 2. ' };
      yield { type: 'content', text: 'STOP_HERE trailing discarded.' };
    }
  };

  const req = {
    body: {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Say hello' }],
      stream: true,
      stop: 'STOP_HERE',
      stream_options: { include_usage: true }
    }
  };

  const writtenChunks = [];
  let isEnded = false;
  const res = {
    status() { return this; },
    setHeader() {},
    flushHeaders() {},
    write(chunk) { writtenChunks.push(chunk); },
    end() { isEnded = true; },
    on() {}
  };

  try {
    await handleChatCompletion(req, res);
    assert.strictEqual(isEnded, true);
    const sseOutput = writtenChunks.join('');
    assert.ok(sseOutput.includes('data: [DONE]'));
    assert.ok(sseOutput.includes('"content":"Part 1. Part 2. "'));
    assert.ok(!sseOutput.includes('trailing discarded'));
    assert.ok(sseOutput.includes('"usage"'));
  } finally {
    registry._mockDefaultProvider = prevMock;
  }
});

// ── Test 13: End-to-End Chat Completion: Non-vision model rejection on images ─
test('Chat Completions: Non-vision model rejects multimodal request with 400', async () => {
  const { registry } = await import('../src/providers/index.js');
  const prevMock = registry._mockDefaultProvider;

  registry._mockDefaultProvider = {
    id: 'mock',
    name: 'Mock Provider',
    getCapabilities(model) {
      return { chat: true, vision: model === 'vision-model', stream: true, tools: true };
    },
    async *chatComplete() {
      yield { type: 'content', text: 'ok' };
    }
  };

  const req = {
    body: {
      model: 'text-only-model',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'look at this' },
            { type: 'image_url', image_url: { url: 'https://example.com/pic.png' } }
          ]
        }
      ]
    }
  };

  let statusCode = 0;
  let jsonResult = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(data) { jsonResult = data; },
    setHeader() {},
    flushHeaders() {},
    on() {}
  };

  try {
    await handleChatCompletion(req, res);
    assert.strictEqual(statusCode, 400);
    assert.strictEqual(jsonResult?.error?.code, 'capability_not_supported');
    assert.strictEqual(jsonResult?.error?.param, 'vision');
  } finally {
    registry._mockDefaultProvider = prevMock;
  }
});

