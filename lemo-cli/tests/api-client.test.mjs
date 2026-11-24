import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { LemoApiClient } from '../dist/api/client/LemoApiClient.js';
import {
  ValidationError,
  AuthenticationError,
  ModelError,
  NetworkError
} from '../dist/core/errors/index.js';

/** Helper to create an ephemeral HTTP test server */
function createMockServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise(res => server.close(res))
      });
    });
  });
}

test('LemoApiClient: Base URL normalization and validation', () => {
  // Trailing slash stripped
  const client1 = new LemoApiClient({ baseUrl: 'http://localhost:8080/' });
  assert.equal(client1.resolveEndpoint('/models'), 'http://localhost:8080/v1/models');

  // BaseUrl already containing /v1
  const client2 = new LemoApiClient({ baseUrl: 'http://localhost:8080/v1' });
  assert.equal(client2.resolveEndpoint('/models'), 'http://localhost:8080/v1/models');
  assert.equal(client2.resolveEndpoint('chat/completions'), 'http://localhost:8080/v1/chat/completions');

  // Endpoint containing leading /v1
  assert.equal(client2.resolveEndpoint('/v1/models'), 'http://localhost:8080/v1/models');

  // Invalid protocol
  assert.throws(
    () => new LemoApiClient({ baseUrl: 'ftp://localhost:8080' }),
    ValidationError
  );

  // Malformed URL
  assert.throws(
    () => new LemoApiClient({ baseUrl: 'not-a-valid-url' }),
    ValidationError
  );
});

test('LemoApiClient: listModels() successfully parses backend model list', async () => {
  const mockModels = {
    object: 'list',
    data: [
      {
        id: 'gemini-2.5-flash',
        object: 'model',
        created: 1700000000,
        owned_by: 'google',
        capabilities: { chat: true, stream: true, tools: true }
      },
      {
        id: 'deepseek-chat',
        object: 'model',
        created: 1700000000,
        owned_by: 'deepseek',
        capabilities: { chat: true, stream: true }
      }
    ]
  };

  const mock = await createMockServer((req, res) => {
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(mockModels));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  try {
    const client = new LemoApiClient({ baseUrl: mock.url });
    const models = await client.listModels();

    assert.equal(models.length, 2);
    assert.equal(models[0].id, 'gemini-2.5-flash');
    assert.equal(models[0].capabilities?.tools, true);
    assert.equal(models[1].id, 'deepseek-chat');
  } finally {
    await mock.close();
  }
});

test('LemoApiClient: listModels() throws AuthenticationError on 401', async () => {
  const mock = await createMockServer((req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: {
        message: 'Incorrect API key provided.',
        code: 'invalid_api_key'
      }
    }));
  });

  try {
    const client = new LemoApiClient({ baseUrl: mock.url, apiKey: 'sk-bad-key' });
    await assert.rejects(
      async () => client.listModels(),
      (err) => {
        assert.ok(err instanceof AuthenticationError);
        assert.match(err.message, /Incorrect API key provided/);
        return true;
      }
    );
  } finally {
    await mock.close();
  }
});

test('LemoApiClient: listModels() throws NetworkError on malformed backend schema', async () => {
  const mock = await createMockServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ object: 'error_unexpected' }));
  });

  try {
    const client = new LemoApiClient({ baseUrl: mock.url });
    await assert.rejects(
      async () => client.listModels(),
      (err) => {
        assert.ok(err instanceof NetworkError);
        assert.match(err.message, /Invalid model list response format/);
        return true;
      }
    );
  } finally {
    await mock.close();
  }
});

test('LemoApiClient: createChatCompletion() non-streaming handles success and headers', async () => {
  let receivedAuth = '';
  let receivedBody = null;

  const mockResponse = {
    id: 'chatcmpl-test-123',
    object: 'chat.completion',
    created: 1700000000,
    model: 'gemini-flash',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'Testing non-streaming response' },
        finish_reason: 'stop'
      }
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
  };

  const mock = await createMockServer((req, res) => {
    receivedAuth = req.headers['authorization'] || '';
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      receivedBody = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(mockResponse));
    });
  });

  try {
    const secretKey = 'sk-secret-token-12345';
    const client = new LemoApiClient({ baseUrl: mock.url, apiKey: secretKey });

    const result = await client.createChatCompletion({
      model: 'gemini-flash',
      messages: [{ role: 'user', content: 'Hello' }],
      temperature: 0.7
    });

    assert.equal(receivedAuth, `Bearer ${secretKey}`);
    assert.equal(receivedBody.stream, false);
    assert.equal(receivedBody.temperature, 0.7);
    assert.equal(result.id, 'chatcmpl-test-123');
    assert.equal(result.choices[0].message.content, 'Testing non-streaming response');
  } finally {
    await mock.close();
  }
});

test('LemoApiClient: createChatCompletion() throws ModelError when model is not found', async () => {
  const mock = await createMockServer((req, res) => {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: {
        message: "The model 'unknown-model' does not exist.",
        type: 'invalid_request_error',
        code: 'model_not_found'
      }
    }));
  });

  try {
    const client = new LemoApiClient({ baseUrl: mock.url });
    await assert.rejects(
      async () => client.createChatCompletion({
        model: 'unknown-model',
        messages: [{ role: 'user', content: 'Hi' }]
      }),
      (err) => {
        assert.ok(err instanceof ModelError);
        assert.match(err.message, /unknown-model/);
        return true;
      }
    );
  } finally {
    await mock.close();
  }
});

test('LemoApiClient: createChatCompletionStream() streams SSE chunks', async () => {
  const chunk1 = {
    id: 'stream-1',
    object: 'chat.completion.chunk',
    created: 1700000000,
    model: 'gemini-flash',
    choices: [{ index: 0, delta: { content: 'Streamed ' }, finish_reason: null }]
  };
  const chunk2 = {
    id: 'stream-1',
    object: 'chat.completion.chunk',
    created: 1700000000,
    model: 'gemini-flash',
    choices: [{ index: 0, delta: { content: 'text' }, finish_reason: null }]
  };

  const mock = await createMockServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    res.write(`data: ${JSON.stringify(chunk1)}\n\n`);
    setTimeout(() => {
      res.write(`data: ${JSON.stringify(chunk2)}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }, 20);
  });

  try {
    const client = new LemoApiClient({ baseUrl: mock.url });
    const stream = await client.createChatCompletionStream({
      model: 'gemini-flash',
      messages: [{ role: 'user', content: 'Stream this' }]
    });

    const receivedChunks = [];
    for await (const chunk of stream) {
      receivedChunks.push(chunk);
    }

    assert.equal(receivedChunks.length, 2);
    assert.equal(receivedChunks[0].choices[0].delta.content, 'Streamed ');
    assert.equal(receivedChunks[1].choices[0].delta.content, 'text');
  } finally {
    await mock.close();
  }
});

test('LemoApiClient: createChatCompletionStream() throws error before stream if HTTP status is non-200', async () => {
  const mock = await createMockServer((req, res) => {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: {
        message: 'Invalid request: "messages" array is required and must not be empty.',
        code: 'missing_messages'
      }
    }));
  });

  try {
    const client = new LemoApiClient({ baseUrl: mock.url });
    await assert.rejects(
      async () => client.createChatCompletionStream({
        model: 'gemini-flash',
        messages: []
      }),
      (err) => {
        assert.ok(err instanceof NetworkError);
        assert.equal(err.status, 400);
        assert.match(err.message, /messages/);
        return true;
      }
    );
  } finally {
    await mock.close();
  }
});

test('LemoApiClient: handles request timeout safely', async () => {
  const mock = await createMockServer((req, res) => {
    // Deliberately delay response longer than client timeout
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    }, 150);
  });

  try {
    const client = new LemoApiClient({ baseUrl: mock.url, timeoutMs: 40 });
    await assert.rejects(
      async () => client.listModels(),
      (err) => {
        assert.ok(err instanceof NetworkError);
        assert.equal(err.status, 408);
        assert.match(err.message, /timed out after 40ms/);
        return true;
      }
    );
  } finally {
    await mock.close();
  }
});

test('LemoApiClient: supports external AbortSignal cancellation', async () => {
  const mock = await createMockServer((req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    }, 100);
  });

  try {
    const client = new LemoApiClient({ baseUrl: mock.url });
    const controller = new AbortController();

    setTimeout(() => controller.abort(), 20);

    await assert.rejects(
      async () => client.listModels({ signal: controller.signal }),
      (err) => {
        assert.ok(err instanceof NetworkError);
        assert.match(err.message, /aborted/);
        return true;
      }
    );
  } finally {
    await mock.close();
  }
});

test('LemoApiClient: handles connection failures cleanly without leaking secrets', async () => {
  // Port 59999 is highly likely unused and will refuse connection
  const client = new LemoApiClient({
    baseUrl: 'http://127.0.0.1:59999',
    apiKey: 'sk-super-secret-key-that-must-never-leak'
  });

  await assert.rejects(
    async () => client.listModels(),
    (err) => {
      assert.ok(err instanceof NetworkError);
      assert.match(err.message, /Failed to connect to backend/);
      // Ensure API key is NEVER in the error message
      assert.equal(err.message.includes('sk-super-secret'), false);
      return true;
    }
  );
});
