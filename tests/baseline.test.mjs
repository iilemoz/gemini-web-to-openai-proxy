import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { app } from '../src/app.js';
import { config } from '../src/config/index.js';
import { GeminiEngine } from '../src/providers/gemini/GeminiEngine.js';
import { parseDSML } from '../src/utils/dsmlParser.js';
import { formatSSEChunk, formatSSEUsageChunk, formatSSEDone, formatFullResponse } from '../src/utils/sse.js';

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
});

test('GET /health returns status ok', async () => {
  const res = await fetch(`${baseUrl}/health`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.status, 'ok');
  assert.ok(data.service.includes('Gemini'));
});

test('GET /v1/models returns OpenAI-compliant model list', async () => {
  const res = await fetch(`${baseUrl}/v1/models`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.object, 'list');
  assert.ok(Array.isArray(data.data));
  assert.ok(data.data.some((m) => m.id === 'gemini-flash'));
  assert.ok(data.data.some((m) => m.id === 'gemini-pro'));
});

test('GET /v1/models/:model returns individual model details', async () => {
  const res = await fetch(`${baseUrl}/v1/models/gemini-flash`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.id, 'gemini-flash');
  assert.equal(data.object, 'model');

  const notFound = await fetch(`${baseUrl}/v1/models/non-existent-model-xyz`);
  assert.equal(notFound.status, 404);
  const errData = await notFound.json();
  assert.equal(errData.error.code, 'model_not_found');
});

test('POST /v1/chat/completions rejects empty messages array', async () => {
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [] })
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.error.code, 'missing_messages');
});

test('GeminiEngine client lifecycle & guest cleanup', async () => {
  const engine = new GeminiEngine();
  const { client, isTemporary } = engine.getClient();
  assert.equal(isTemporary, true, 'Default guest client must be temporary');
  assert.ok(client, 'Client instance must be created');
  await client.close();
});

test('GeminiEngine model resolution', () => {
  const engine = new GeminiEngine();
  assert.ok(engine.resolveModel('gemini-thinking').model_name.includes('thinking'));
  assert.ok(engine.resolveModel('gemini-pro').model_name.includes('pro'));
  assert.ok(engine.resolveModel('gemini-flash').model_name.includes('flash'));
});

test('DSML Parser parses <tool_call> blocks properly', () => {
  const raw = `I will now create the file.
<tool_call>
{"name": "write_file", "arguments": {"path": "test.txt", "content": "hello world"}}
</tool_call>`;
  const parsed = parseDSML(raw);
  assert.equal(parsed.content, 'I will now create the file.');
  assert.equal(parsed.toolCalls.length, 1);
  assert.equal(parsed.toolCalls[0].function.name, 'write_file');
  const args = JSON.parse(parsed.toolCalls[0].function.arguments);
  assert.equal(args.path, 'test.txt');
  assert.equal(args.content, 'hello world');
});

test('SSE Formatter formats chunks and usage correctly', () => {
  const chunk = formatSSEChunk('cmpl-1', 'gemini-flash', { content: 'chunk1' });
  assert.ok(chunk.startsWith('data: '));
  assert.ok(chunk.includes('chunk1'));

  const usageChunk = formatSSEUsageChunk('cmpl-1', 'gemini-flash', { promptTokens: 10, completionTokens: 25 });
  assert.ok(usageChunk.includes('"total_tokens":35'));
  assert.ok(usageChunk.includes('"choices":[]'));

  const done = formatSSEDone();
  assert.equal(done, 'data: [DONE]\n\n');

  const full = formatFullResponse('cmpl-2', 'gemini-flash', { content: 'hello world' });
  assert.equal(full.object, 'chat.completion');
  assert.equal(full.choices[0].message.content, 'hello world');
});
