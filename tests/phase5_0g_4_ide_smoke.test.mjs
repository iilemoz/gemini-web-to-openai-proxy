import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { app } from '../src/app.js';
import { config } from '../src/config/index.js';
import { registry, providerRegistry, modelRegistry } from '../src/providers/index.js';
import { BaseProvider } from '../src/providers/BaseProvider.js';

let server;
let baseUrl;

// Mock Gemini Provider for deterministic local smoke testing
class MockSmokeProvider extends BaseProvider {
  constructor() {
    super({ id: 'mock-smoke', name: 'Mock Smoke Gemini Web Provider' });
  }

  supportsModel(modelId) {
    const canonicals = ['gemini-flash', 'gemini-pro', 'gemini-thinking', 'gemini-lite'];
    return canonicals.includes(modelId.toLowerCase());
  }

  getCapabilities(modelId) {
    const isThinking = modelId.includes('think');
    const isLite = modelId.includes('lite');
    return {
      chat: true,
      stream: true,
      tools: !isThinking && !isLite,
      json: !isThinking && !isLite,
      reasoning: isThinking,
      responses: true
    };
  }

  async *chatComplete({ model, messages, tools, tool_choice }) {
    const lastMsg = messages[messages.length - 1];
    const isToolChoiceNone = tool_choice === 'none';

    // If tools are provided and not suppressed, emit tool call if requested
    if (Array.isArray(tools) && tools.length > 0 && !isToolChoiceNone) {
      if (lastMsg.role === 'tool') {
        // Multi-turn step 2: return final text answer incorporating tool result
        yield { type: 'text', text: `Project name is gemini-web-to-openai-proxy (version 1.0.0).` };
        return;
      }

      if (lastMsg.content?.includes('read package.json') || lastMsg.content?.includes('inspect')) {
        yield {
          type: 'text',
          text: '<tool_call>\n{"name": "read_file", "arguments": {"path": "package.json"}}\n</tool_call>'
        };
        return;
      }
    }

    if (model === 'gemini-thinking') {
      yield { type: 'thought', text: 'Analyzing the user request carefully step by step...\n' };
    }

    yield { type: 'text', text: `Hello from ${model}! This is a verified text response.` };
  }
}

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
  registry.defaultProvider = providerRegistry.getProvider('gemini');
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

// Helper for SSE parsing
function parseSSE(raw) {
  const events = [];
  const lines = raw.split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const dataStr = line.slice(6).trim();
      if (dataStr === '[DONE]') {
        events.push({ type: 'done' });
      } else {
        try {
          events.push({ type: 'chunk', data: JSON.parse(dataStr) });
        } catch {
          events.push({ type: 'raw', data: dataStr });
        }
      }
    }
  }
  return events;
}

test('PHASE 5.0G.4 API SMOKE TEST SUITE', async (suite) => {
  const mockProvider = new MockSmokeProvider();
  registry.defaultProvider = mockProvider;

  await suite.test('Test A: Model Discovery (GET /v1/models and GET /v1/models/:model)', async () => {
    const res = await fetch(`${baseUrl}/v1/models`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type')?.includes('application/json'), true);

    const body = await res.json();
    assert.equal(body.object, 'list');
    assert.ok(Array.isArray(body.data));

    const modelIds = body.data.map(m => m.id);
    assert.deepEqual(
      modelIds.sort(),
      ['gemini-flash', 'gemini-lite', 'gemini-pro', 'gemini-thinking'].sort(),
      'Exposes exactly the 4 genuine Gemini Web canonical models'
    );

    for (const m of body.data) {
      assert.equal(m.object, 'model');
      assert.equal(m.owned_by, 'google');
      assert.ok(m.capabilities, `Model ${m.id} must declare capabilities`);
    }

    // Single model lookup
    const singleRes = await fetch(`${baseUrl}/v1/models/gemini-flash`);
    assert.equal(singleRes.status, 200);
    const singleBody = await singleRes.json();
    assert.equal(singleBody.id, 'gemini-flash');
    assert.equal(singleBody.capabilities.tools, true);

    // Non-existent model lookup
    const notFoundRes = await fetch(`${baseUrl}/v1/models/gpt-4o`);
    assert.equal(notFoundRes.status, 404);
  });

  await suite.test('Test B: Basic Text Chat (POST /v1/chat/completions non-streaming)', async () => {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-flash',
        messages: [{ role: 'user', content: 'Hello, how are you?' }],
        stream: false
      })
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.object, 'chat.completion');
    assert.ok(body.id.startsWith('chatcmpl-'));
    assert.equal(body.model, 'gemini-flash');
    assert.equal(body.choices.length, 1);
    assert.equal(body.choices[0].message.role, 'assistant');
    assert.ok(body.choices[0].message.content.includes('Hello from gemini-flash!'));
    assert.equal(body.choices[0].finish_reason, 'stop');
    assert.ok(body.usage, 'Must return usage object');
    assert.equal(body.choices[0].message.image, undefined, 'Must contain zero image fields');
  });

  await suite.test('Test C: Streaming (POST /v1/chat/completions stream: true)', async () => {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-pro',
        messages: [{ role: 'user', content: 'Stream this response.' }],
        stream: true
      })
    });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type')?.includes('text/event-stream'), true);

    const rawText = await res.text();
    const events = parseSSE(rawText);

    assert.ok(events.length >= 2, 'Stream must yield chunks and [DONE]');
    const chunks = events.filter(e => e.type === 'chunk');
    const doneEvent = events.find(e => e.type === 'done');
    assert.ok(doneEvent, 'Must emit data: [DONE]');

    const firstChunk = chunks[0].data;
    assert.equal(firstChunk.object, 'chat.completion.chunk');
    assert.equal(firstChunk.model, 'gemini-pro');
    assert.equal(firstChunk.choices[0].delta.role, 'assistant');

    // Terminal chunk finish_reason
    const terminalChunk = chunks[chunks.length - 1].data;
    assert.equal(terminalChunk.choices[0].finish_reason, 'stop');
  });

  await suite.test('Test D: Tool Calling (Non-streaming & Streaming deltas with index & terminal finish_reason)', async () => {
    const tools = [
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read file contents from workspace',
          parameters: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path']
          }
        }
      }
    ];

    // Non-streaming tool call
    const nonStreamRes = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-flash',
        messages: [{ role: 'user', content: 'Please read package.json' }],
        tools,
        stream: false
      })
    });

    assert.equal(nonStreamRes.status, 200);
    const nonStreamBody = await nonStreamRes.json();
    assert.equal(nonStreamBody.choices[0].finish_reason, 'tool_calls');
    const toolCalls = nonStreamBody.choices[0].message.tool_calls;
    assert.ok(Array.isArray(toolCalls) && toolCalls.length === 1);
    assert.equal(toolCalls[0].function.name, 'read_file');
    assert.equal(JSON.parse(toolCalls[0].function.arguments).path, 'package.json');
    assert.equal(toolCalls[0].index, undefined, 'Non-streaming tool call must not have index field');

    // Streaming tool call (GAP-01 integer index and GAP-02 finish_reason: "tool_calls")
    const streamRes = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-flash',
        messages: [{ role: 'user', content: 'Please read package.json' }],
        tools,
        stream: true
      })
    });

    assert.equal(streamRes.status, 200);
    const rawStream = await streamRes.text();
    const streamEvents = parseSSE(rawStream);
    const streamChunks = streamEvents.filter(e => e.type === 'chunk');

    // Verify index field on deltas
    let sawToolCallDelta = false;
    for (const chunk of streamChunks) {
      const tcDelta = chunk.data.choices[0]?.delta?.tool_calls;
      if (tcDelta && Array.isArray(tcDelta)) {
        sawToolCallDelta = true;
        for (const delta of tcDelta) {
          assert.equal(typeof delta.index, 'number', 'Streaming tool call delta must carry integer index');
          assert.equal(delta.index >= 0, true);
        }
      }
    }
    assert.equal(sawToolCallDelta, true, 'Stream must emit tool_calls delta');

    // Terminal chunk
    const terminalStreamChunk = streamChunks[streamChunks.length - 1].data;
    assert.equal(terminalStreamChunk.choices[0].finish_reason, 'tool_calls');
    assert.deepEqual(terminalStreamChunk.choices[0].delta, {});

    // tool_choice: "none" suppresses tool execution
    const noneRes = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-flash',
        messages: [{ role: 'user', content: 'Please read package.json' }],
        tools,
        tool_choice: 'none',
        stream: false
      })
    });

    assert.equal(noneRes.status, 200);
    const noneBody = await noneRes.json();
    assert.equal(noneBody.choices[0].finish_reason, 'stop');
    assert.equal(noneBody.choices[0].message.tool_calls, undefined);
  });

  await suite.test('Test E: Multi-Turn Tool History (User -> Assistant Tool Call -> Tool Result -> Assistant Followup)', async () => {
    const tools = [
      {
        type: 'function',
        function: {
          name: 'read_file',
          parameters: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path']
          }
        }
      }
    ];

    const messages = [
      { role: 'user', content: 'Please inspect package.json' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_test_12345',
            type: 'function',
            function: {
              name: 'read_file',
              arguments: JSON.stringify({ path: 'package.json' })
            }
          }
        ]
      },
      {
        role: 'tool',
        tool_call_id: 'call_test_12345',
        name: 'read_file',
        content: '{"name": "gemini-web-to-openai-proxy", "version": "1.0.0"}'
      }
    ];

    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-flash',
        messages,
        tools,
        stream: false
      })
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.choices[0].finish_reason, 'stop');
    assert.ok(body.choices[0].message.content.includes('gemini-web-to-openai-proxy (version 1.0.0)'));
  });

  await suite.test('Test F: Authentication & Credentials Handling', async () => {
    // 1. In open development mode (config.proxyApiKey is empty or unset for this test)
    const originalKey = config.proxyApiKey;

    try {
      // Test when proxyApiKey is set
      config.proxyApiKey = 'sk-test-proxy-secret-key-123';

      // Request without auth header -> 401
      const noAuthRes = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gemini-flash',
          messages: [{ role: 'user', content: 'hi' }]
        })
      });
      assert.equal(noAuthRes.status, 401);
      const noAuthBody = await noAuthRes.json();
      assert.equal(noAuthBody.error.code, 'invalid_api_key');

      // Request with wrong key -> 401
      const wrongAuthRes = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer wrong-key-xyz'
        },
        body: JSON.stringify({
          model: 'gemini-flash',
          messages: [{ role: 'user', content: 'hi' }]
        })
      });
      assert.equal(wrongAuthRes.status, 401);

      // Request with valid Bearer token -> 200
      const validBearerRes = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer sk-test-proxy-secret-key-123'
        },
        body: JSON.stringify({
          model: 'gemini-flash',
          messages: [{ role: 'user', content: 'hi' }]
        })
      });
      assert.equal(validBearerRes.status, 200);

      // Request with valid x-api-key header -> 200
      const validApiKeyHeaderRes = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'sk-test-proxy-secret-key-123'
        },
        body: JSON.stringify({
          model: 'gemini-flash',
          messages: [{ role: 'user', content: 'hi' }]
        })
      });
      assert.equal(validApiKeyHeaderRes.status, 200);

    } finally {
      config.proxyApiKey = originalKey;
    }
  });

  await suite.test('Test G: Model Capability Rejection (gemini-thinking rejects tool calling with HTTP 400)', async () => {
    // Reset to genuine Gemini router to verify model capability enforcement
    registry._mockDefaultProvider = null;

    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-thinking',
        messages: [{ role: 'user', content: 'Calculate something' }],
        tools: [
          {
            type: 'function',
            function: { name: 'calc', parameters: { type: 'object' } }
          }
        ]
      })
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'capability_not_supported');
    assert.ok(body.error.message.includes("Model 'gemini-thinking' does not support the 'tools' capability"));
  });

  await suite.test('Test H: Text-Only Guardrail (Strict rejection of image payloads with HTTP 400)', async () => {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-flash',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'What is this image?' },
              { type: 'image_url', image_url: { url: 'https://example.com/test.png' } }
            ]
          }
        ]
      })
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'image_input_unsupported');
  });
});
