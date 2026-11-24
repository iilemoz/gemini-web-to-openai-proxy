import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatSession } from '../dist/chat/session.js';
import { DEFAULT_CONFIG } from '../dist/core/config/schema.js';

// Helper to create a mock LemoApiClient
function createMockClient({
  models = [
    { id: 'gemini-flash', object: 'model', owned_by: 'google', capabilities: { chat: true, stream: true } },
    { id: 'gemini-pro', object: 'model', owned_by: 'google', capabilities: { chat: true, stream: true } }
  ],
  streamChunks = ['Hello', ' from', ' Gemini!'],
  failListModels = false,
  failStream = false
} = {}) {
  return {
    listModels: async () => {
      if (failListModels) throw new Error('Backend connection failed');
      return models;
    },
    createChatCompletionStream: async (req, opts) => {
      if (failStream) throw new Error('Stream request failed');
      return (async function* () {
        for (const token of streamChunks) {
          if (opts?.signal?.aborted) return;
          yield {
            id: 'c-1',
            object: 'chat.completion.chunk',
            created: 1,
            model: req.model,
            choices: [{ index: 0, delta: { content: token }, finish_reason: null }]
          };
        }
      })();
    }
  };
}

test('ChatSession: initializes with configured default model', async () => {
  const client = createMockClient();
  const session = new ChatSession({ client, config: DEFAULT_CONFIG });

  const res = await session.initialize();
  assert.equal(res.success, true);
  assert.equal(session.getActiveModel(), 'gemini-flash');
  assert.equal(session.getAvailableModels().length, 2);
});

test('ChatSession: fallback model selection when default model is not in list', async () => {
  const client = createMockClient({
    models: [{ id: 'gemini-custom', object: 'model', owned_by: 'google' }]
  });
  const session = new ChatSession({
    client,
    config: { ...DEFAULT_CONFIG, defaultModel: 'gemini-nonexistent' }
  });

  const res = await session.initialize();
  assert.equal(res.success, true);
  assert.equal(session.getActiveModel(), 'gemini-custom');
});

test('ChatSession: handles backend connection failure gracefully on init', async () => {
  const client = createMockClient({ failListModels: true });
  const session = new ChatSession({ client, config: DEFAULT_CONFIG });

  const res = await session.initialize();
  assert.equal(res.success, false);
  assert.match(res.error, /Backend connection failed/);
});

test('ChatSession: model override takes precedence if present', async () => {
  const client = createMockClient();
  const session = new ChatSession({
    client,
    config: DEFAULT_CONFIG,
    modelOverride: 'gemini-pro'
  });

  const res = await session.initialize('gemini-pro');
  assert.equal(res.success, true);
  assert.equal(session.getActiveModel(), 'gemini-pro');
});

test('ChatSession: switchModel allows switching to valid models', () => {
  const client = createMockClient();
  const session = new ChatSession({ client, config: DEFAULT_CONFIG });
  session['availableModels'] = [
    { id: 'gemini-flash', object: 'model', owned_by: 'google' },
    { id: 'gemini-pro', object: 'model', owned_by: 'google' }
  ];

  const res = session.switchModel('gemini-pro');
  assert.equal(res.success, true);
  assert.equal(session.getActiveModel(), 'gemini-pro');

  const invalid = session.switchModel('unknown-model');
  assert.equal(invalid.success, false);
  assert.equal(session.getActiveModel(), 'gemini-pro');
  assert.match(invalid.message, /not recognized by the backend/);
});

test('ChatSession: multi-turn conversation maintains order and messages', async () => {
  const client = createMockClient({ streamChunks: ['Sure', ' thing'] });
  const session = new ChatSession({ client, config: DEFAULT_CONFIG });
  await session.initialize();

  // Turn 1
  const tokens1 = [];
  const res1 = await session.sendMessage('My name is Lemo', (t) => tokens1.push(t));
  assert.equal(res1.content, 'Sure thing');
  assert.deepEqual(tokens1, ['Sure', ' thing']);

  let msgs = session.getMessages();
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, 'user');
  assert.equal(msgs[0].content, 'My name is Lemo');
  assert.equal(msgs[1].role, 'assistant');
  assert.equal(msgs[1].content, 'Sure thing');

  // Turn 2
  const tokens2 = [];
  const res2 = await session.sendMessage('What is my name?', (t) => tokens2.push(t));
  assert.equal(res2.content, 'Sure thing');

  msgs = session.getMessages();
  assert.equal(msgs.length, 4);
  assert.equal(msgs[2].role, 'user');
  assert.equal(msgs[2].content, 'What is my name?');
  assert.equal(msgs[3].role, 'assistant');
});

test('ChatSession: /clear resets conversation history', async () => {
  const client = createMockClient();
  const session = new ChatSession({ client, config: DEFAULT_CONFIG });
  await session.initialize();
  await session.sendMessage('Hello', () => {});

  assert.equal(session.getMessages().length, 2);
  session.clearHistory();
  assert.equal(session.getMessages().length, 0);
});

test('ChatSession: handles stream error cleanly and rolls back prompt', async () => {
  const client = createMockClient({ failStream: true });
  const session = new ChatSession({ client, config: DEFAULT_CONFIG });
  await session.initialize();

  await assert.rejects(
    async () => session.sendMessage('Failing request', () => {}),
    /Stream request failed/
  );

  // User message was rolled back to maintain valid conversation context
  assert.equal(session.getMessages().length, 0);
});

test('ChatSession: supports AbortSignal cancellation', async () => {
  const client = createMockClient({ streamChunks: ['Chunk1', 'Chunk2'] });
  const session = new ChatSession({ client, config: DEFAULT_CONFIG });
  await session.initialize();

  const controller = new AbortController();
  controller.abort();

  const res = await session.sendMessage('Cancelled request', () => {}, controller.signal);
  assert.equal(res.aborted, true);
});

test('ChatSession: Slash commands execution', async () => {
  const client = createMockClient();
  const session = new ChatSession({ client, config: DEFAULT_CONFIG });
  await session.initialize();

  // /help
  const helpRes = await session.handleCommand('/help');
  assert.equal(helpRes.handled, true);
  assert.ok(helpRes.message?.includes('/models'));

  // /models
  const modelsRes = await session.handleCommand('/models');
  assert.equal(modelsRes.handled, true);
  assert.ok(modelsRes.message?.includes('gemini-flash'));
  assert.ok(modelsRes.message?.includes('(active)'));

  // /model
  const modelRes = await session.handleCommand('/model');
  assert.equal(modelRes.handled, true);
  assert.ok(modelRes.message?.includes('gemini-flash'));

  // /model gemini-pro
  const switchRes = await session.handleCommand('/model gemini-pro');
  assert.equal(switchRes.handled, true);
  assert.equal(session.getActiveModel(), 'gemini-pro');

  // /refresh
  const refreshRes = await session.handleCommand('/refresh');
  assert.equal(refreshRes.handled, true);
  assert.ok(refreshRes.message?.includes('Refreshed models list'));

  // /clear
  const clearRes = await session.handleCommand('/clear');
  assert.equal(clearRes.handled, true);
  assert.ok(clearRes.message?.includes('cleared'));

  // /exit
  const exitRes = await session.handleCommand('/exit');
  assert.equal(exitRes.handled, true);
  assert.equal(exitRes.shouldExit, true);

  // Unknown slash command
  const unknownRes = await session.handleCommand('/unknown-cmd');
  assert.equal(unknownRes.handled, true);
  assert.ok(unknownRes.message?.includes("Unknown command '/unknown-cmd'"));

  // Not a slash command
  const nonCmd = await session.handleCommand('hello there');
  assert.equal(nonCmd.handled, false);
});
