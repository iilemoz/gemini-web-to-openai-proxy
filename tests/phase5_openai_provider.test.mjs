import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { OpenAIProvider, OPENAI_MODELS } from '../src/providers/openai/index.js';
import {
  ProviderRegistry,
  ModelRegistry,
  ModelRouter,
  registerOpenAIProvider,
  providerRegistry as defaultProviderRegistry,
  modelRegistry as defaultModelRegistry,
  modelRouter as defaultModelRouter
} from '../src/providers/index.js';
import { handleChatCompletion } from '../src/controllers/chatController.js';
import { handleResponses } from '../src/controllers/responsesController.js';
import { listModels, getModel } from '../src/controllers/modelsController.js';

// Helper to create a local mock HTTP server
function createMockUpstream(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const baseUrl = `http://127.0.0.1:${port}/v1`;
      resolve({
        server,
        baseUrl,
        close: () => new Promise(r => server.close(r))
      });
    });
  });
}

test('Phase 5.0B - OpenAIProvider: Configuration & Validation', async () => {
  // Missing API key
  const invalidProvider = new OpenAIProvider({ apiKey: '' });
  const validation1 = invalidProvider.validateConfig();
  assert.equal(validation1.valid, false);
  assert.match(validation1.errors[0], /API key is missing/i);

  // Invalid protocol
  const invalidUrlProvider = new OpenAIProvider({ apiKey: 'sk-test-12345678', baseUrl: 'ftp://api.openai.com' });
  const validation2 = invalidUrlProvider.validateConfig();
  assert.equal(validation2.valid, false);
  assert.match(validation2.errors[0], /protocol/i);

  // Valid configuration
  const validProvider = new OpenAIProvider({
    apiKey: 'sk-valid-test-key-12345678',
    baseUrl: 'https://api.openai.com/v1',
    organization: 'org-test1234',
    project: 'proj-test1234'
  });
  const validation3 = validProvider.validateConfig();
  assert.equal(validation3.valid, true);

  const health = await validProvider.checkHealth();
  assert.equal(health.status, 'ok');
  assert.equal(health.provider, 'openai');
});

test('Phase 5.0B - OpenAIProvider: Secret Sanitization & Error Normalization', () => {
  const secretKey = 'sk-proj-1234567890abcdef1234567890';
  const textWithSecret = `Failed to authorize with key ${secretKey} using Bearer token abc.def.ghi`;
  const sanitized = OpenAIProvider.sanitizeSecret(textWithSecret);

  assert.ok(!sanitized.includes(secretKey));
  assert.ok(sanitized.includes('sk-***'));
  assert.ok(!sanitized.includes('Bearer token'));

  const provider = new OpenAIProvider({ apiKey: secretKey });

  // 401 error
  const err401 = provider.normalizeError({
    status: 401,
    message: `Invalid key: ${secretKey}`,
    code: 'invalid_api_key'
  });
  assert.equal(err401.status, 401);
  assert.equal(err401.code, 'invalid_api_key');
  assert.ok(!err401.message.includes(secretKey));

  // 429 error
  const err429 = provider.normalizeError({
    status: 429,
    message: 'Rate limit reached',
    code: 'rate_limit_exceeded'
  });
  assert.equal(err429.status, 429);
  assert.equal(err429.code, 'rate_limit_exceeded');

  // 500 error mapped to 502 upstream_error
  const err500 = provider.normalizeError({
    status: 500,
    message: 'Internal server error'
  });
  assert.equal(err500.status, 502);
  assert.equal(err500.code, 'upstream_error');
});

test('Phase 5.0B - OpenAIProvider: Model Definitions & Truthful Ownership', () => {
  const provider = new OpenAIProvider({ apiKey: 'sk-test-key-12345678' });
  const models = provider.getModels();

  assert.equal(models.length, 4);
  const ids = models.map(m => m.id);
  assert.ok(ids.includes('gpt-4o'));
  assert.ok(ids.includes('gpt-4o-mini'));
  assert.ok(ids.includes('o1'));
  assert.ok(ids.includes('o3-mini'));

  for (const m of models) {
    assert.equal(m.owned_by, 'openai');
    assert.ok(m.capabilities.chat);
    assert.ok(m.capabilities.stream);
    assert.ok(m.capabilities.tools);
    assert.ok(m.capabilities.responses);
  }

  const gpt4o = models.find(m => m.id === 'gpt-4o');
  assert.equal(gpt4o.capabilities.vision, true);
  assert.equal(gpt4o.capabilities.reasoning, false);

  const o1 = models.find(m => m.id === 'o1');
  assert.equal(o1.capabilities.vision, true);
  assert.equal(o1.capabilities.reasoning, true);

  const o3Mini = models.find(m => m.id === 'o3-mini');
  assert.equal(o3Mini.capabilities.vision, false);
  assert.equal(o3Mini.capabilities.reasoning, true);
});

test('Phase 5.0B - OpenAIProvider: Non-Streaming Chat Completion with Native Usage', async () => {
  let receivedAuth = null;
  let receivedPayload = null;

  const mock = await createMockUpstream(async (req, res) => {
    receivedAuth = req.headers['authorization'];
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }
    receivedPayload = JSON.parse(body);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: 'chatcmpl-mock-123',
      object: 'chat.completion',
      created: 1715500000,
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'Hello from mock native OpenAI!'
          },
          finish_reason: 'stop'
        }
      ],
      usage: {
        prompt_tokens: 15,
        completion_tokens: 8,
        total_tokens: 23
      }
    }));
  });

  try {
    const provider = new OpenAIProvider({
      apiKey: 'sk-test-mock-key-12345',
      baseUrl: mock.baseUrl
    });

    const chunks = [];
    for await (const chunk of provider.chatComplete({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Say hello' }],
      stream: false
    })) {
      chunks.push(chunk);
    }

    assert.equal(receivedAuth, 'Bearer sk-test-mock-key-12345');
    assert.equal(receivedPayload.model, 'gpt-4o');
    assert.equal(receivedPayload.messages[0].content, 'Say hello');
    assert.equal(receivedPayload.stream, false);

    const contentChunk = chunks.find(c => c.type === 'content');
    assert.ok(contentChunk);
    assert.equal(contentChunk.text, 'Hello from mock native OpenAI!');

    const usageChunk = chunks.find(c => c.type === 'usage');
    assert.ok(usageChunk);
    assert.equal(usageChunk.usage.prompt_tokens, 15);
    assert.equal(usageChunk.usage.completion_tokens, 8);
    assert.equal(usageChunk.usage.total_tokens, 23);
  } finally {
    await mock.close();
  }
});

test('Phase 5.0B - OpenAIProvider: Streaming SSE Chat Completion', async () => {
  const mock = await createMockUpstream(async (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    res.write('data: {"choices":[{"index":0,"delta":{"content":"Hello "}}]}\n\n');
    res.write('data: {"choices":[{"index":0,"delta":{"content":"world!"}}]}\n\n');
    res.write('data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
  });

  try {
    const provider = new OpenAIProvider({
      apiKey: 'sk-test-mock-streaming-key',
      baseUrl: mock.baseUrl
    });

    const chunks = [];
    for await (const chunk of provider.chatComplete({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Stream test' }],
      stream: true
    })) {
      chunks.push(chunk);
    }

    const contents = chunks.filter(c => c.type === 'content').map(c => c.text).join('');
    assert.equal(contents, 'Hello world!');

    const usageChunk = chunks.find(c => c.type === 'usage');
    assert.ok(usageChunk);
    assert.equal(usageChunk.usage.total_tokens, 15);
  } finally {
    await mock.close();
  }
});

test('Phase 5.0B - OpenAIProvider: Reasoning Models Parameter Mapping & Stream', async () => {
  let receivedPayload = null;

  const mock = await createMockUpstream(async (req, res) => {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }
    receivedPayload = JSON.parse(body);

    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"choices":[{"index":0,"delta":{"reasoning_content":"Thinking deeply..."}}]}\n\n');
    res.write('data: {"choices":[{"index":0,"delta":{"content":"The answer is 42."}}]}\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
  });

  try {
    const provider = new OpenAIProvider({
      apiKey: 'sk-test-reasoning-key',
      baseUrl: mock.baseUrl
    });

    const chunks = [];
    for await (const chunk of provider.chatComplete({
      model: 'o1',
      messages: [{ role: 'user', content: 'What is the answer?' }],
      stream: true,
      max_tokens: 1000 // should be mapped to max_completion_tokens
    })) {
      chunks.push(chunk);
    }

    assert.equal(receivedPayload.model, 'o1');
    assert.equal(receivedPayload.max_completion_tokens, 1000);
    assert.equal(receivedPayload.max_tokens, undefined); // omitted for o1

    const thinkingChunk = chunks.find(c => c.type === 'thinking');
    assert.ok(thinkingChunk);
    assert.equal(thinkingChunk.text, 'Thinking deeply...');

    const contentChunk = chunks.find(c => c.type === 'content');
    assert.ok(contentChunk);
    assert.equal(contentChunk.text, 'The answer is 42.');
  } finally {
    await mock.close();
  }
});

test('Phase 5.0B - OpenAIProvider: Native Tool Calling', async () => {
  const toolCallsPayload = [
    {
      id: 'call_abc123',
      type: 'function',
      function: {
        name: 'get_weather',
        arguments: '{"location":"San Francisco, CA"}'
      }
    }
  ];

  const mock = await createMockUpstream(async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: 'chatcmpl-tools-123',
      object: 'chat.completion',
      created: 1715500000,
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: toolCallsPayload
          },
          finish_reason: 'tool_calls'
        }
      ]
    }));
  });

  try {
    const provider = new OpenAIProvider({
      apiKey: 'sk-test-tools-key',
      baseUrl: mock.baseUrl
    });

    const chunks = [];
    for await (const chunk of provider.chatComplete({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Weather in SF?' }],
      tools: [{ type: 'function', function: { name: 'get_weather' } }]
    })) {
      chunks.push(chunk);
    }

    const toolChunk = chunks.find(c => c.type === 'tool_calls');
    assert.ok(toolChunk);
    assert.deepEqual(toolChunk.tool_calls, toolCallsPayload);
  } finally {
    await mock.close();
  }
});

test('Phase 5.0B - End-to-End Chat Controller with OpenAI Provider', async () => {
  const mock = await createMockUpstream(async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: 'chatcmpl-e2e-123',
      object: 'chat.completion',
      created: 1715500000,
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'End-to-end OpenAI proxy integration verified.'
          },
          finish_reason: 'stop'
        }
      ],
      usage: {
        prompt_tokens: 12,
        completion_tokens: 6,
        total_tokens: 18
      }
    }));
  });

  try {
    // Register mock OpenAI provider into registry
    const provider = registerOpenAIProvider({
      apiKey: 'sk-test-e2e-key',
      baseUrl: mock.baseUrl
    });
    assert.ok(provider);

    const app = express();
    app.use(express.json());
    app.post('/v1/chat/completions', handleChatCompletion);

    const response = await new Promise((resolve) => {
      const server = app.listen(0, '127.0.0.1', async () => {
        const port = server.address().port;
        const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-4o',
            messages: [{ role: 'user', content: 'Test integration' }]
          })
        });
        const json = await res.json();
        server.close(() => resolve({ status: res.status, body: json }));
      });
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.model, 'gpt-4o');
    assert.equal(response.body.choices[0].message.content, 'End-to-end OpenAI proxy integration verified.');
    assert.equal(response.body.usage.prompt_tokens, 12);
    assert.equal(response.body.usage.completion_tokens, 6);
    assert.equal(response.body.usage.total_tokens, 18);
  } finally {
    await mock.close();
  }
});

test('Phase 5.0B - Responses API with OpenAI Provider', async () => {
  const mock = await createMockUpstream(async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: 'chatcmpl-resp-123',
      object: 'chat.completion',
      created: 1715500000,
      model: 'gpt-4o-mini',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'Response generated via Responses API and OpenAI adapter.'
          },
          finish_reason: 'stop'
        }
      ]
    }));
  });

  try {
    registerOpenAIProvider({
      apiKey: 'sk-test-responses-api-key',
      baseUrl: mock.baseUrl
    });

    const app = express();
    app.use(express.json());
    app.post('/v1/responses', handleResponses);

    const response = await new Promise((resolve) => {
      const server = app.listen(0, '127.0.0.1', async () => {
        const port = server.address().port;
        const res = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            input: 'Generate response'
          })
        });
        const json = await res.json();
        server.close(() => resolve({ status: res.status, body: json }));
      });
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.object, 'response');
    assert.equal(response.body.model, 'gpt-4o-mini');
    assert.equal(response.body.status, 'completed');
    assert.equal(response.body.output[0].content[0].text, 'Response generated via Responses API and OpenAI adapter.');
  } finally {
    await mock.close();
  }
});

test('Phase 5.0B - Model Discovery: /v1/models reflects OpenAI genuine models', async () => {
  const app = express();
  app.get('/v1/models', listModels);
  app.get('/v1/models/:model', getModel);

  const response = await new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', async () => {
      const port = server.address().port;
      const res = await fetch(`http://127.0.0.1:${port}/v1/models`);
      const json = await res.json();

      const singleRes = await fetch(`http://127.0.0.1:${port}/v1/models/gpt-4o`);
      const singleJson = await singleRes.json();

      server.close(() => resolve({ list: json, single: singleJson }));
    });
  });

  const modelIds = response.list.data.map(m => m.id);
  assert.ok(modelIds.includes('gpt-4o'));
  assert.ok(modelIds.includes('gpt-4o-mini'));
  assert.ok(modelIds.includes('o1'));
  assert.ok(modelIds.includes('o3-mini'));

  assert.equal(response.single.id, 'gpt-4o');
  assert.equal(response.single.owned_by, 'openai');
  assert.equal(response.single.capabilities.chat, true);
  assert.equal(response.single.capabilities.vision, true);
});

test('Phase 5.0B - Fail Closed: Disabled OpenAI provider rejects requests without silent fallback', async () => {
  // Create an isolated router without OpenAI provider
  const pRegistry = new ProviderRegistry();
  const mRegistry = new ModelRegistry();
  const mRouter = new ModelRouter(pRegistry, mRegistry);

  assert.throws(() => {
    mRouter.resolve('gpt-4o');
  }, (err) => {
    assert.equal(err.status, 404);
    assert.equal(err.code, 'model_not_found');
    assert.match(err.message, /cross-provider fallback is disabled/i);
    return true;
  });
});
