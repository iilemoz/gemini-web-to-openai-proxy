import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSseStream, extractDeltaText } from '../dist/api/client/stream-parser.js';

// Helper to convert string chunks to an AsyncIterable of Uint8Array
async function* createByteStream(chunks) {
  const encoder = new TextEncoder();
  for (const chunk of chunks) {
    yield encoder.encode(chunk);
  }
}

test('StreamParser: parses standard SSE chunks', async () => {
  const payload1 = {
    id: 'chatcmpl-1',
    object: 'chat.completion.chunk',
    created: 1700000000,
    model: 'gemini-flash',
    choices: [{ index: 0, delta: { role: 'assistant', content: 'Hello' }, finish_reason: null }]
  };
  const payload2 = {
    id: 'chatcmpl-1',
    object: 'chat.completion.chunk',
    created: 1700000000,
    model: 'gemini-flash',
    choices: [{ index: 0, delta: { content: ' world' }, finish_reason: null }]
  };

  const chunks = [
    `data: ${JSON.stringify(payload1)}\n\n`,
    `data: ${JSON.stringify(payload2)}\n\n`,
    'data: [DONE]\n\n'
  ];

  const results = [];
  for await (const chunk of parseSseStream(createByteStream(chunks))) {
    results.push(chunk);
  }

  assert.equal(results.length, 2);
  assert.equal(results[0].choices[0].delta.content, 'Hello');
  assert.equal(results[1].choices[0].delta.content, ' world');
});

test('StreamParser: correctly handles events split across network chunks', async () => {
  const payload = {
    id: 'chatcmpl-split',
    object: 'chat.completion.chunk',
    created: 1700000000,
    model: 'gemini-flash',
    choices: [{ index: 0, delta: { content: 'Fragmented data' }, finish_reason: null }]
  };

  const fullEvent = `data: ${JSON.stringify(payload)}\n\n`;
  // Split event arbitrarily across 3 network chunks
  const part1 = fullEvent.slice(0, 15);
  const part2 = fullEvent.slice(15, 35);
  const part3 = fullEvent.slice(35);

  const chunks = [part1, part2, part3, 'data: [DONE]\n\n'];

  const results = [];
  for await (const chunk of parseSseStream(createByteStream(chunks))) {
    results.push(chunk);
  }

  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'chatcmpl-split');
  assert.equal(results[0].choices[0].delta.content, 'Fragmented data');
});

test('StreamParser: handles multiple events in a single network chunk', async () => {
  const p1 = { id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { content: 'One' }, finish_reason: null }] };
  const p2 = { id: 'c2', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { content: 'Two' }, finish_reason: null }] };
  const p3 = { id: 'c3', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { content: 'Three' }, finish_reason: null }] };

  // All 3 events + termination in one single network packet
  const singlePacket = `data: ${JSON.stringify(p1)}\n\ndata: ${JSON.stringify(p2)}\n\ndata: ${JSON.stringify(p3)}\n\ndata: [DONE]\n\n`;

  const results = [];
  for await (const chunk of parseSseStream(createByteStream([singlePacket]))) {
    results.push(chunk);
  }

  assert.equal(results.length, 3);
  assert.equal(results[0].choices[0].delta.content, 'One');
  assert.equal(results[1].choices[0].delta.content, 'Two');
  assert.equal(results[2].choices[0].delta.content, 'Three');
});

test('StreamParser: ignores comments, empty lines, and carriage returns', async () => {
  const p1 = { id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { content: 'Data' }, finish_reason: null }] };

  const raw = [
    ': this is an SSE comment line\r\n',
    '\r\n\r\n',
    ': another comment\n',
    `data: ${JSON.stringify(p1)}\r\n\r\n`,
    '\n\n',
    'data: [DONE]\r\n\r\n'
  ];

  const results = [];
  for await (const chunk of parseSseStream(createByteStream(raw))) {
    results.push(chunk);
  }

  assert.equal(results.length, 1);
  assert.equal(results[0].choices[0].delta.content, 'Data');
});

test('StreamParser: recovers safely from malformed JSON without crashing stream', async () => {
  const validPayload = { id: 'valid', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { content: 'Valid' }, finish_reason: null }] };

  const chunks = [
    'data: { this is corrupt json !!!\n\n',
    `data: ${JSON.stringify(validPayload)}\n\n`,
    'data: not-even-json\n\n',
    'data: [DONE]\n\n'
  ];

  const results = [];
  for await (const chunk of parseSseStream(createByteStream(chunks))) {
    results.push(chunk);
  }

  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'valid');
  assert.equal(results[0].choices[0].delta.content, 'Valid');
});

test('StreamParser: terminates immediately upon encountering [DONE]', async () => {
  const p1 = { id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { content: 'First' }, finish_reason: null }] };
  const p2 = { id: 'c2', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { content: 'After Done' }, finish_reason: null }] };

  const chunks = [
    `data: ${JSON.stringify(p1)}\n\n`,
    'data: [DONE]\n\n',
    `data: ${JSON.stringify(p2)}\n\n`
  ];

  const results = [];
  for await (const chunk of parseSseStream(createByteStream(chunks))) {
    results.push(chunk);
  }

  assert.equal(results.length, 1);
  assert.equal(results[0].choices[0].delta.content, 'First');
});

test('StreamParser: supports cancellation via AbortSignal', async () => {
  const controller = new AbortController();
  const p1 = { id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { content: 'Initial' }, finish_reason: null }] };

  async function* infiniteStream() {
    const encoder = new TextEncoder();
    yield encoder.encode(`data: ${JSON.stringify(p1)}\n\n`);
    // Hangs or produces more until cancelled
    while (!controller.signal.aborted) {
      await new Promise(r => setTimeout(r, 20));
      yield encoder.encode(`data: ${JSON.stringify(p1)}\n\n`);
    }
  }

  const results = [];
  for await (const chunk of parseSseStream(infiniteStream(), controller.signal)) {
    results.push(chunk);
    controller.abort();
  }

  // Loop terminated cleanly on abort
  assert.ok(results.length >= 1);
});

test('StreamParser: extractDeltaText yields text tokens', async () => {
  const p1 = { id: '1', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }] };
  const p2 = { id: '2', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { content: ' from' }, finish_reason: null }] };
  const p3 = { id: '3', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { content: ' Lemo' }, finish_reason: null }] };
  const p4 = { id: '4', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };

  const chunks = [
    `data: ${JSON.stringify(p1)}\n\n`,
    `data: ${JSON.stringify(p2)}\n\n`,
    `data: ${JSON.stringify(p3)}\n\n`,
    `data: ${JSON.stringify(p4)}\n\n`,
    'data: [DONE]\n\n'
  ];

  const stream = parseSseStream(createByteStream(chunks));
  const tokens = [];
  for await (const text of extractDeltaText(stream)) {
    tokens.push(text);
  }

  assert.deepEqual(tokens, ['Hello', ' from', ' Lemo']);
});
