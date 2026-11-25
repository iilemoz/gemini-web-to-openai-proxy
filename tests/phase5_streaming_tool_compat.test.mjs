import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { app } from '../src/app.js';
import { registry, providerRegistry } from '../src/providers/index.js';
import { parseDSML } from '../src/utils/dsmlParser.js';
import { GeminiEngine } from '../src/providers/gemini/GeminiEngine.js';

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
  registry.defaultProvider = providerRegistry.getProvider('gemini');
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

// Helper to parse SSE stream text into structured events
function parseSSEEvents(rawText) {
  const events = [];
  const lines = rawText.split('\n');
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

// Client accumulator simulating standard OpenAI client stream accumulator
function accumulateToolCallsFromChunks(chunks) {
  const accumulatedTools = [];
  for (const event of chunks) {
    if (event.type !== 'chunk' || !event.data?.choices?.[0]?.delta?.tool_calls) continue;
    const toolCallDeltas = event.data.choices[0].delta.tool_calls;
    for (const delta of toolCallDeltas) {
      const idx = delta.index;
      if (typeof idx !== 'number') {
        throw new Error(`Streaming tool call missing required integer index: ${JSON.stringify(delta)}`);
      }
      if (!accumulatedTools[idx]) {
        accumulatedTools[idx] = {
          id: delta.id || '',
          type: delta.type || 'function',
          function: {
            name: delta.function?.name || '',
            arguments: delta.function?.arguments || ''
          }
        };
      } else {
        if (delta.id) accumulatedTools[idx].id = delta.id;
        if (delta.type) accumulatedTools[idx].type = delta.type;
        if (delta.function?.name) accumulatedTools[idx].function.name += delta.function.name;
        if (delta.function?.arguments) accumulatedTools[idx].function.arguments += delta.function.arguments;
      }
    }
  }
  return accumulatedTools;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. PARSER & CONTRACT UNIT TESTS
// ─────────────────────────────────────────────────────────────────────────────

test('DSML Parser: parses single <tool_call> and ensures non-streaming tool call has NO index field', () => {
  const input = 'Let me read the file.\n<tool_call>\n{"name": "read_file", "arguments": {"path": "README.md"}}\n</tool_call>';
  const parsed = parseDSML(input);

  assert.equal(parsed.content, 'Let me read the file.');
  assert.equal(parsed.toolCalls.length, 1);
  const tc = parsed.toolCalls[0];
  assert.equal(tc.function.name, 'read_file');
  assert.equal(tc.function.arguments, JSON.stringify({ path: 'README.md' }));
  assert.ok(tc.id.startsWith('call_'));
  assert.equal(tc.type, 'function');
  // Strict non-streaming requirement: NO index field
  assert.equal(tc.index, undefined);
});

test('DSML Parser: parses multiple tool calls (2 and 3 calls) with different names and payloads', () => {
  const input3 = `
<tool_call>
{"name": "read_file", "arguments": {"path": "file1.txt"}}
</tool_call>
<tool_call>
{"name": "write_file", "arguments": {"path": "file2.txt", "content": "hello world"}}
</tool_call>
<tool_call>
{"name": "execute_command", "arguments": {"command": "npm test"}}
</tool_call>
`;
  const parsed = parseDSML(input3);
  assert.equal(parsed.toolCalls.length, 3);
  assert.equal(parsed.toolCalls[0].function.name, 'read_file');
  assert.equal(parsed.toolCalls[1].function.name, 'write_file');
  assert.equal(parsed.toolCalls[2].function.name, 'execute_command');
  assert.notEqual(parsed.toolCalls[0].id, parsed.toolCalls[1].id);
  assert.notEqual(parsed.toolCalls[1].id, parsed.toolCalls[2].id);
});

test('DSML Parser: handles long JSON arguments, special characters, and escaped strings', () => {
  const payload = {
    code: 'function test() {\n  const str = "hello \\"world\\"";\n  const regex = /\\d+/g;\n  return true;\n}',
    unicode: '🚀 日本語 العربية',
    longArray: new Array(50).fill('item')
  };
  const input = `<tool_call>\n{"name": "write_file", "arguments": ${JSON.stringify(payload)}}\n</tool_call>`;
  const parsed = parseDSML(input);

  assert.equal(parsed.toolCalls.length, 1);
  const parsedArgs = JSON.parse(parsed.toolCalls[0].function.arguments);
  assert.equal(parsedArgs.code, payload.code);
  assert.equal(parsedArgs.unicode, payload.unicode);
  assert.equal(parsedArgs.longArray.length, 50);
});

test('DSML Parser: parses JSON array of tool calls in a single <tool_call> block', () => {
  const input = `<tool_call>
[
  {"name": "tool_a", "arguments": {"a": 1}},
  {"name": "tool_b", "arguments": {"b": 2}}
]
</tool_call>`;
  const parsed = parseDSML(input);
  assert.equal(parsed.toolCalls.length, 2);
  assert.equal(parsed.toolCalls[0].function.name, 'tool_a');
  assert.equal(parsed.toolCalls[1].function.name, 'tool_b');
});

test('DSML Parser: recovers gracefully from malformed or unclosed tool call tags without throwing', () => {
  const malformedInput = '<tool_call>\n{"name": "broken_tool", "arguments": \nSome other plain text';
  const parsed = parseDSML(malformedInput);
  // Must not throw, content preserved or handled safely
  assert.ok(Array.isArray(parsed.toolCalls));
});

test('GeminiEngine formatPrompt: respects tool_choice "none" by omitting tool definitions', () => {
  const engine = new GeminiEngine();
  const tools = [
    { type: 'function', function: { name: 'calculator', description: 'Does math', parameters: {} } }
  ];
  const messages = [{ role: 'user', content: 'What is 2 + 2?' }];

  // With tool_choice: "none"
  const promptNone = engine.formatPrompt(messages, tools, 'none');
  assert.ok(!promptNone.includes('[TOOL CALLING PIPELINE]'), 'Prompt should not advertise tools when tool_choice is none');
  assert.ok(!promptNone.includes('calculator'), 'Prompt should not mention tool names when tool_choice is none');

  // With default tool_choice: "auto"
  const promptAuto = engine.formatPrompt(messages, tools, 'auto');
  assert.ok(promptAuto.includes('[TOOL CALLING PIPELINE]'), 'Prompt should advertise tools when tool_choice is auto');
  assert.ok(promptAuto.includes('calculator'), 'Prompt should include tool definitions');
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. HTTP STREAMING SPEC ALIGNMENT TESTS
// ─────────────────────────────────────────────────────────────────────────────

test('GAP-01: Single streaming tool call has integer index 0, stable id, and finish_reason null', async () => {
  const mockProvider = {
    name: 'mock-gemini-stream-single',
    id: 'gemini',
    getModels() { return providerRegistry.getProvider('gemini').getModels(); },
    supportsModel() { return true; },
    getCapabilities() { return { chat: true, stream: true, tools: true, json: true, reasoning: false, responses: true }; },
    async *chatComplete() {
      yield 'Thinking about calling a tool... ';
      yield '<tool_call>\n{"name": "read_file", "arguments": {"path": "index.js"}}\n</tool_call>';
    }
  };
  registry.defaultProvider = mockProvider;

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-flash',
      stream: true,
      messages: [{ role: 'user', content: 'Read index.js' }],
      tools: [{ type: 'function', function: { name: 'read_file', parameters: {} } }]
    })
  });

  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');

  const rawText = await res.text();
  const events = parseSSEEvents(rawText);

  // 1. Initial role chunk
  assert.equal(events[0].type, 'chunk');
  assert.equal(events[0].data.choices[0].delta.role, 'assistant');
  assert.equal(events[0].data.choices[0].finish_reason, null);

  // 2. Pre-tool content chunk
  const contentChunk = events.find(e => e.type === 'chunk' && e.data?.choices?.[0]?.delta?.content);
  assert.ok(contentChunk, 'Pre-tool content was streamed');
  assert.equal(contentChunk.data.choices[0].finish_reason, null);

  // 3. Tool call chunk
  const toolChunk = events.find(e => e.type === 'chunk' && e.data?.choices?.[0]?.delta?.tool_calls);
  assert.ok(toolChunk, 'Tool call delta chunk was emitted');
  const deltaTools = toolChunk.data.choices[0].delta.tool_calls;
  assert.equal(deltaTools.length, 1);
  assert.equal(deltaTools[0].index, 0, 'First tool call MUST have integer index 0');
  assert.equal(deltaTools[0].function.name, 'read_file');
  assert.equal(toolChunk.data.choices[0].finish_reason, null, 'Tool call delta chunk must have finish_reason: null');

  // 4. GAP-02: Separate terminal chunk with finish_reason: "tool_calls"
  const terminalChunk = events.find(e => e.type === 'chunk' && e.data?.choices?.[0]?.finish_reason === 'tool_calls');
  assert.ok(terminalChunk, 'Terminal chunk with finish_reason: tool_calls was emitted');
  assert.deepEqual(terminalChunk.data.choices[0].delta, {}, 'Terminal chunk delta must be empty object');

  // 5. [DONE] terminator
  assert.equal(events[events.length - 1].type, 'done');

  // Verify client accumulator
  const accumulated = accumulateToolCallsFromChunks(events);
  assert.equal(accumulated.length, 1);
  assert.equal(accumulated[0].function.name, 'read_file');
  assert.deepEqual(JSON.parse(accumulated[0].function.arguments), { path: 'index.js' });
});

test('GAP-01 & GAP-02: Multiple streaming tool calls have distinct indexes (0, 1, 2) and separate terminal chunk', async () => {
  const mockProvider = {
    name: 'mock-gemini-stream-multi',
    id: 'gemini',
    getModels() { return providerRegistry.getProvider('gemini').getModels(); },
    supportsModel() { return true; },
    getCapabilities() { return { chat: true, stream: true, tools: true, json: true, reasoning: false, responses: true }; },
    async *chatComplete() {
      yield '<tool_call>\n{"name": "tool_zero", "arguments": {"step": 0}}\n</tool_call>\n';
      yield '<tool_call>\n{"name": "tool_one", "arguments": {"step": 1}}\n</tool_call>\n';
      yield '<tool_call>\n{"name": "tool_two", "arguments": {"step": 2}}\n</tool_call>';
    }
  };
  registry.defaultProvider = mockProvider;

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-flash',
      stream: true,
      messages: [{ role: 'user', content: 'Run 3 steps' }],
      tools: [
        { type: 'function', function: { name: 'tool_zero' } },
        { type: 'function', function: { name: 'tool_one' } },
        { type: 'function', function: { name: 'tool_two' } }
      ]
    })
  });

  assert.equal(res.status, 200);
  const rawText = await res.text();
  const events = parseSSEEvents(rawText);

  // Collect all tool call chunks
  const toolChunks = events.filter(e => e.type === 'chunk' && e.data?.choices?.[0]?.delta?.tool_calls);
  assert.equal(toolChunks.length, 3, 'Three tool call chunks emitted');

  assert.equal(toolChunks[0].data.choices[0].delta.tool_calls[0].index, 0);
  assert.equal(toolChunks[0].data.choices[0].delta.tool_calls[0].function.name, 'tool_zero');
  assert.equal(toolChunks[0].data.choices[0].finish_reason, null);

  assert.equal(toolChunks[1].data.choices[0].delta.tool_calls[0].index, 1);
  assert.equal(toolChunks[1].data.choices[0].delta.tool_calls[0].function.name, 'tool_one');
  assert.equal(toolChunks[1].data.choices[0].finish_reason, null);

  assert.equal(toolChunks[2].data.choices[0].delta.tool_calls[0].index, 2);
  assert.equal(toolChunks[2].data.choices[0].delta.tool_calls[0].function.name, 'tool_two');
  assert.equal(toolChunks[2].data.choices[0].finish_reason, null);

  // Terminal chunk
  const terminalChunk = events.find(e => e.type === 'chunk' && e.data?.choices?.[0]?.finish_reason === 'tool_calls');
  assert.ok(terminalChunk);
  assert.deepEqual(terminalChunk.data.choices[0].delta, {});

  // Accumulate
  const accumulated = accumulateToolCallsFromChunks(events);
  assert.equal(accumulated.length, 3);
  assert.equal(accumulated[0].function.name, 'tool_zero');
  assert.equal(accumulated[1].function.name, 'tool_one');
  assert.equal(accumulated[2].function.name, 'tool_two');
});

test('Tool Argument Fragments: Native provider tool call chunks with argument deltas accumulate correctly', async () => {
  const mockProvider = {
    name: 'mock-gemini-stream-fragments',
    id: 'gemini',
    getModels() { return providerRegistry.getProvider('gemini').getModels(); },
    supportsModel() { return true; },
    getCapabilities() { return { chat: true, stream: true, tools: true, json: true, reasoning: false, responses: true }; },
    async *chatComplete() {
      // Chunk 1: Tool call announcement with first argument fragment
      yield {
        type: 'tool_calls',
        tool_calls: [
          {
            index: 0,
            id: 'call_frag_123',
            type: 'function',
            function: { name: 'save_data', arguments: '{"key":' }
          }
        ]
      };
      // Chunk 2: Second argument fragment for same tool index
      yield {
        type: 'tool_calls',
        tool_calls: [
          {
            index: 0,
            function: { arguments: ' "value"}' }
          }
        ]
      };
    }
  };
  registry.defaultProvider = mockProvider;

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-flash',
      stream: true,
      messages: [{ role: 'user', content: 'Save' }],
      tools: [{ type: 'function', function: { name: 'save_data' } }]
    })
  });

  assert.equal(res.status, 200);
  const rawText = await res.text();
  const events = parseSSEEvents(rawText);

  const accumulated = accumulateToolCallsFromChunks(events);
  assert.equal(accumulated.length, 1);
  assert.equal(accumulated[0].id, 'call_frag_123');
  assert.equal(accumulated[0].function.name, 'save_data');
  assert.equal(accumulated[0].function.arguments, '{"key": "value"}');
  assert.deepEqual(JSON.parse(accumulated[0].function.arguments), { key: 'value' });
});

test('Ordinary text streaming finishes with finish_reason: "stop"', async () => {
  const mockProvider = {
    name: 'mock-gemini-stream-text',
    id: 'gemini',
    getModels() { return providerRegistry.getProvider('gemini').getModels(); },
    supportsModel() { return true; },
    getCapabilities() { return { chat: true, stream: true, tools: true, json: true, reasoning: false, responses: true }; },
    async *chatComplete() {
      yield 'Hello, ';
      yield 'how can I help you today?';
    }
  };
  registry.defaultProvider = mockProvider;

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-flash',
      stream: true,
      messages: [{ role: 'user', content: 'Hello' }]
    })
  });

  assert.equal(res.status, 200);
  const rawText = await res.text();
  const events = parseSSEEvents(rawText);

  const terminalChunk = events.find(e => e.type === 'chunk' && e.data?.choices?.[0]?.finish_reason === 'stop');
  assert.ok(terminalChunk, 'Text response must finish with finish_reason: stop');
  assert.deepEqual(terminalChunk.data.choices[0].delta, {});
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. GAP-04: TOOL CHOICE NONE TESTS
// ─────────────────────────────────────────────────────────────────────────────

test('GAP-04: tool_choice "none" with NO tools supplied returns ordinary text with finish_reason "stop"', async () => {
  const mockProvider = {
    name: 'mock-gemini-none-no-tools',
    id: 'gemini',
    getModels() { return providerRegistry.getProvider('gemini').getModels(); },
    supportsModel() { return true; },
    getCapabilities() { return { chat: true, stream: true, tools: true, json: true, reasoning: false, responses: true }; },
    async *chatComplete() {
      yield 'I will answer without tools.';
    }
  };
  registry.defaultProvider = mockProvider;

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-flash',
      tool_choice: 'none',
      messages: [{ role: 'user', content: 'Explain gravity' }]
    })
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.choices[0].message.content, 'I will answer without tools.');
  assert.equal(data.choices[0].finish_reason, 'stop');
  assert.equal(data.choices[0].message.tool_calls, undefined);
});

test('GAP-04: tool_choice "none" with tools supplied returns ordinary text without tool calls', async () => {
  let capturedTools = null;
  let capturedToolChoice = null;

  const mockProvider = {
    name: 'mock-gemini-none-with-tools',
    id: 'gemini',
    getModels() { return providerRegistry.getProvider('gemini').getModels(); },
    supportsModel() { return true; },
    getCapabilities() { return { chat: true, stream: true, tools: true, json: true, reasoning: false, responses: true }; },
    async *chatComplete({ tools, tool_choice }) {
      capturedTools = tools;
      capturedToolChoice = tool_choice;
      yield 'Here is your direct answer.';
    }
  };
  registry.defaultProvider = mockProvider;

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-flash',
      tool_choice: 'none',
      tools: [{ type: 'function', function: { name: 'calculator', parameters: {} } }],
      messages: [{ role: 'user', content: 'What is 10 + 20?' }]
    })
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.choices[0].message.content, 'Here is your direct answer.');
  assert.equal(data.choices[0].finish_reason, 'stop');
  assert.equal(data.choices[0].message.tool_calls, undefined);
  // Provider received empty tools or explicit tool_choice: "none"
  assert.deepEqual(capturedTools, []);
  assert.equal(capturedToolChoice, 'none');
});

test('GAP-04: tool_choice "none" suppresses unexpected DSML tool-call syntax from Gemini (non-streaming & streaming)', async () => {
  const mockProvider = {
    name: 'mock-gemini-unexpected-dsml',
    id: 'gemini',
    getModels() { return providerRegistry.getProvider('gemini').getModels(); },
    supportsModel() { return true; },
    getCapabilities() { return { chat: true, stream: true, tools: true, json: true, reasoning: false, responses: true }; },
    async *chatComplete() {
      // Upstream unexpectedly emits <tool_call> even though tool_choice is none
      yield '<tool_call>\n{"name": "unexpected_tool", "arguments": {}}\n</tool_call>';
    }
  };
  registry.defaultProvider = mockProvider;

  // 1. Non-streaming
  const resNonStream = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-flash',
      tool_choice: 'none',
      tools: [{ type: 'function', function: { name: 'unexpected_tool' } }],
      messages: [{ role: 'user', content: 'Do something' }]
    })
  });

  assert.equal(resNonStream.status, 200);
  const data = await resNonStream.json();
  assert.equal(data.choices[0].finish_reason, 'stop');
  assert.equal(data.choices[0].message.tool_calls, undefined, 'Must NOT emit tool_calls when tool_choice is none');

  // 2. Streaming
  const resStream = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-flash',
      stream: true,
      tool_choice: 'none',
      tools: [{ type: 'function', function: { name: 'unexpected_tool' } }],
      messages: [{ role: 'user', content: 'Do something' }]
    })
  });

  assert.equal(resStream.status, 200);
  const streamText = await resStream.text();
  const events = parseSSEEvents(streamText);
  const toolChunk = events.find(e => e.type === 'chunk' && e.data?.choices?.[0]?.delta?.tool_calls);
  assert.equal(toolChunk, undefined, 'Must NOT emit tool_calls stream chunk when tool_choice is none');
  const term = events.find(e => e.type === 'chunk' && e.data?.choices?.[0]?.finish_reason);
  assert.equal(term.data.choices[0].finish_reason, 'stop');
});

test('Validation: invalid tool_choice returns HTTP 400 with invalid_request_error', async () => {
  // 1. tool_choice is a number
  const res1 = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-flash',
      tool_choice: 12345,
      messages: [{ role: 'user', content: 'test' }]
    })
  });
  assert.equal(res1.status, 400);
  const err1 = await res1.json();
  assert.equal(err1.error.code, 'invalid_tool_choice');

  // 2. tool_choice: "required" without tools
  const res2 = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-flash',
      tool_choice: 'required',
      messages: [{ role: 'user', content: 'test' }]
    })
  });
  assert.equal(res2.status, 400);
  const err2 = await res2.json();
  assert.equal(err2.error.code, 'invalid_tool_choice');

  // 3. tool_choice specifying a function not in tools list
  const res3 = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-flash',
      tool_choice: { type: 'function', function: { name: 'non_existent_tool' } },
      tools: [{ type: 'function', function: { name: 'actual_tool' } }],
      messages: [{ role: 'user', content: 'test' }]
    })
  });
  assert.equal(res3.status, 400);
  const err3 = await res3.json();
  assert.equal(err3.error.code, 'invalid_tool_choice');
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. MULTI-TURN TOOL INTERACTION REGRESSION TESTS
// ─────────────────────────────────────────────────────────────────────────────

test('Multi-turn Tool Interaction: Round 1 (Tool Call) -> Simulated Client Execution -> Round 2 (Tool Result)', async () => {
  let round = 1;
  let round2ReceivedPrompt = '';

  const mockProvider = {
    name: 'mock-gemini-multiturn',
    id: 'gemini',
    getModels() { return providerRegistry.getProvider('gemini').getModels(); },
    supportsModel() { return true; },
    getCapabilities() { return { chat: true, stream: true, tools: true, json: true, reasoning: false, responses: true }; },
    async *chatComplete({ messages, tools, tool_choice }) {
      if (round === 1) {
        // Round 1: Model outputs a tool call
        yield '<tool_call>\n{"name": "read_file", "arguments": {"path": "package.json"}}\n</tool_call>';
      } else {
        // Round 2: Capture formatted prompt and return final assistant text
        const engine = new GeminiEngine();
        round2ReceivedPrompt = engine.formatPrompt(messages, tools, tool_choice);
        yield 'The project name in package.json is "gemini-proxy" and version is 1.0.0.';
      }
    }
  };
  registry.defaultProvider = mockProvider;

  // ── Round 1: User asks question, proxy returns tool call ──
  const resRound1 = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-flash',
      messages: [{ role: 'user', content: 'What is the package name?' }],
      tools: [{ type: 'function', function: { name: 'read_file', parameters: { type: 'object', properties: { path: { type: 'string' } } } } }]
    })
  });

  assert.equal(resRound1.status, 200);
  const round1Data = await resRound1.json();
  assert.equal(round1Data.choices[0].finish_reason, 'tool_calls');
  const toolCall = round1Data.choices[0].message.tool_calls[0];
  assert.ok(toolCall.id.startsWith('call_'));
  assert.equal(toolCall.function.name, 'read_file');
  assert.deepEqual(JSON.parse(toolCall.function.arguments), { path: 'package.json' });

  // ── Simulated Client Execution ──
  const executedCallId = toolCall.id;
  const simulatedToolResult = JSON.stringify({ name: 'gemini-proxy', version: '1.0.0' });

  // ── Round 2: Client submits assistant message + tool result ──
  round = 2;
  const resRound2 = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-flash',
      messages: [
        { role: 'user', content: 'What is the package name?' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: executedCallId,
              type: 'function',
              function: {
                name: 'read_file',
                arguments: toolCall.function.arguments
              }
            }
          ]
        },
        {
          role: 'tool',
          tool_call_id: executedCallId,
          name: 'read_file',
          content: simulatedToolResult
        }
      ],
      tools: [{ type: 'function', function: { name: 'read_file', parameters: {} } }]
    })
  });

  assert.equal(resRound2.status, 200);
  const round2Data = await resRound2.json();
  assert.equal(round2Data.choices[0].finish_reason, 'stop');
  assert.ok(round2Data.choices[0].message.content.includes('gemini-proxy'));

  // Verify conversation formatting in Round 2 prompt:
  assert.ok(round2ReceivedPrompt.includes('User: What is the package name?'));
  assert.ok(round2ReceivedPrompt.includes('Model: <tool_call>'));
  assert.ok(round2ReceivedPrompt.includes('"name": "read_file"'));
  assert.ok(round2ReceivedPrompt.includes('Tool Result (read_file)'));
  assert.ok(round2ReceivedPrompt.includes('gemini-proxy'));
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. EXISTING STREAMING REGRESSION PRESERVATION
// ─────────────────────────────────────────────────────────────────────────────

test('Streaming Regression: include_usage emits trailing usage chunk with empty choices', async () => {
  const mockProvider = {
    name: 'mock-gemini-usage',
    id: 'gemini',
    getModels() { return providerRegistry.getProvider('gemini').getModels(); },
    supportsModel() { return true; },
    getCapabilities() { return { chat: true, stream: true, tools: true, json: true, reasoning: false, responses: true }; },
    async *chatComplete() {
      yield 'Usage test output.';
    }
  };
  registry.defaultProvider = mockProvider;

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-flash',
      stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: 'user', content: 'Testing usage' }]
    })
  });

  assert.equal(res.status, 200);
  const rawText = await res.text();
  const events = parseSSEEvents(rawText);

  const usageChunk = events.find(e => e.type === 'chunk' && e.data?.usage && e.data?.choices?.length === 0);
  assert.ok(usageChunk, 'Must emit trailing usage chunk with choices: []');
  assert.ok(usageChunk.data.usage.total_tokens > 0);
});

test('Streaming Regression: stop sequence halts streaming with finish_reason: "stop"', async () => {
  const mockProvider = {
    name: 'mock-gemini-stop',
    id: 'gemini',
    getModels() { return providerRegistry.getProvider('gemini').getModels(); },
    supportsModel() { return true; },
    getCapabilities() { return { chat: true, stream: true, tools: true, json: true, reasoning: false, responses: true }; },
    async *chatComplete() {
      yield 'Line 1\n';
      yield 'STOP_HERE\n';
      yield 'Line 2 should not be seen\n';
    }
  };
  registry.defaultProvider = mockProvider;

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-flash',
      stream: true,
      stop: ['STOP_HERE'],
      messages: [{ role: 'user', content: 'Count lines' }]
    })
  });

  assert.equal(res.status, 200);
  const rawText = await res.text();
  const events = parseSSEEvents(rawText);

  // Verify Line 2 was never emitted
  const contentEvents = events.filter(e => e.type === 'chunk' && e.data?.choices?.[0]?.delta?.content);
  const fullContent = contentEvents.map(e => e.data.choices[0].delta.content).join('');
  assert.ok(!fullContent.includes('Line 2'));

  const stopChunk = events.find(e => e.type === 'chunk' && e.data?.choices?.[0]?.finish_reason === 'stop');
  assert.ok(stopChunk, 'Stream must end with finish_reason: stop');
});
