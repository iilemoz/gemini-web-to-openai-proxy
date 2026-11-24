import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentSession } from '../dist/agent/session/AgentSession.js';
import { DEFAULT_CONFIG } from '../dist/core/config/schema.js';

function createMockClient({
  models = [
    { id: 'gemini-flash', object: 'model', owned_by: 'google', capabilities: { chat: true, stream: true, tools: true } },
    { id: 'gemini-pro', object: 'model', owned_by: 'google', capabilities: { chat: true, stream: true, tools: true } },
    { id: 'gemini-thinking', object: 'model', owned_by: 'google', capabilities: { chat: true, stream: true, tools: false } }
  ],
  responses = [],
  failListModels = false
} = {}) {
  let callIndex = 0;
  return {
    listModels: async () => {
      if (failListModels) throw new Error('Backend connection failed');
      return models;
    },
    createChatCompletion: async (req) => {
      const resp = responses[callIndex] || {
        id: `resp-${callIndex}`,
        object: 'chat.completion',
        created: Date.now(),
        model: req.model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Agent response' },
            finish_reason: 'stop'
          }
        ]
      };
      callIndex++;
      return resp;
    }
  };
}

test('AgentSession: initializes with configured tool-capable model', async () => {
  const client = createMockClient();
  const session = new AgentSession({ client, config: DEFAULT_CONFIG });

  const res = await session.initialize();
  assert.equal(res.success, true);
  assert.equal(session.getActiveModel(), 'gemini-flash');
  assert.equal(session.getAvailableModels().length, 3);
});

test('AgentSession: auto-selects tool-capable model when configured model lacks tool support', async () => {
  const client = createMockClient();
  const session = new AgentSession({
    client,
    config: { ...DEFAULT_CONFIG, defaultModel: 'gemini-thinking' }
  });

  const res = await session.initialize();
  assert.equal(res.success, true);
  // Auto-switched to gemini-flash because gemini-thinking has capabilities.tools = false
  assert.equal(session.getActiveModel(), 'gemini-flash');
});

test('AgentSession: fails cleanly when no models advertise tool support', async () => {
  const client = createMockClient({
    models: [
      { id: 'gemini-thinking', object: 'model', owned_by: 'google', capabilities: { tools: false } }
    ]
  });
  const session = new AgentSession({ client, config: DEFAULT_CONFIG });

  const res = await session.initialize();
  assert.equal(res.success, false);
  assert.match(res.error, /No backend models advertise tool support/);
});

test('AgentSession: handles backend connection error gracefully on init', async () => {
  const client = createMockClient({ failListModels: true });
  const session = new AgentSession({ client, config: DEFAULT_CONFIG });

  const res = await session.initialize();
  assert.equal(res.success, false);
  assert.match(res.error, /Backend connection failed/);
});

test('AgentSession: switchModel allows switching to tool-capable models and guards non-tool models', async () => {
  const client = createMockClient();
  const session = new AgentSession({ client, config: DEFAULT_CONFIG });
  await session.initialize();

  // Switch to valid tool-capable model
  const switchValid = session.switchModel('gemini-pro');
  assert.equal(switchValid.success, true);
  assert.equal(session.getActiveModel(), 'gemini-pro');

  // Attempt switch to model without tool support
  const switchNoTools = session.switchModel('gemini-thinking');
  assert.equal(switchNoTools.success, false);
  assert.match(switchNoTools.message, /does not support tool calling/);
  assert.equal(session.getActiveModel(), 'gemini-pro');

  // Attempt switch to nonexistent model
  const switchUnknown = session.switchModel('unknown-model');
  assert.equal(switchUnknown.success, false);
  assert.match(switchUnknown.message, /Unknown model 'unknown-model'/);
  assert.equal(session.getActiveModel(), 'gemini-pro');
});

test('AgentSession: slash command /help returns overview', async () => {
  const client = createMockClient();
  const session = new AgentSession({ client, config: DEFAULT_CONFIG });
  await session.initialize();

  const res = await session.handleCommand('/help');
  assert.equal(res.handled, true);
  assert.ok(res.message.includes('Lemo Agent Mode — Slash Commands:'));
  assert.ok(res.message.includes('/models'));
  assert.ok(res.message.includes('/tools'));
  assert.ok(res.message.includes('/status'));
});

test('AgentSession: slash command /models lists models with tool readiness', async () => {
  const client = createMockClient();
  const session = new AgentSession({ client, config: DEFAULT_CONFIG });
  await session.initialize();

  const res = await session.handleCommand('/models');
  assert.equal(res.handled, true);
  assert.ok(res.message.includes('gemini-flash'));
  assert.ok(res.message.includes('[tools: ready]'));
  assert.ok(res.message.includes('[tools: none]'));
});

test('AgentSession: slash command /tools lists registered tools including test_echo', async () => {
  const client = createMockClient();
  const session = new AgentSession({ client, config: DEFAULT_CONFIG });
  await session.initialize();

  const res = await session.handleCommand('/tools');
  assert.equal(res.handled, true);
  assert.ok(res.message.includes('test_echo'));
  assert.ok(res.message.includes('Echoes back a provided text message'));
});

test('AgentSession: slash command /status displays active agent parameters', async () => {
  const client = createMockClient();
  const session = new AgentSession({ client, config: DEFAULT_CONFIG });
  await session.initialize();

  const res = await session.handleCommand('/status');
  assert.equal(res.handled, true);
  assert.ok(res.message.includes('Active Model:'));
  assert.ok(res.message.includes('gemini-flash'));
  assert.ok(res.message.includes('Approval Mode:'));
  assert.ok(res.message.includes('Iteration Limit:'));
  assert.ok(res.message.includes('Registered Tools:'));
});

test('AgentSession: slash command /clear resets history and /exit flags exit', async () => {
  const client = createMockClient();
  const session = new AgentSession({ client, config: DEFAULT_CONFIG });
  await session.initialize();

  const clearRes = await session.handleCommand('/clear');
  assert.equal(clearRes.handled, true);
  assert.equal(session.getHistory().length, 0);

  const exitRes = await session.handleCommand('/exit');
  assert.equal(exitRes.handled, true);
  assert.equal(exitRes.shouldExit, true);
});

test('AgentSession: executes task with tool round-trip and accumulates conversation history', async () => {
  const responses = [
    // Turn 1: Model requests test_echo tool call
    {
      id: 'resp-1',
      object: 'chat.completion',
      created: Date.now(),
      model: 'gemini-flash',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_test_1',
                type: 'function',
                function: {
                  name: 'test_echo',
                  arguments: JSON.stringify({ message: 'Hello Agent', repeat: 2 })
                }
              }
            ]
          },
          finish_reason: 'tool_calls'
        }
      ]
    },
    // Turn 2: Model returns final response
    {
      id: 'resp-2',
      object: 'chat.completion',
      created: Date.now(),
      model: 'gemini-flash',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'I have echoed: Hello Agent Hello Agent'
          },
          finish_reason: 'stop'
        }
      ]
    }
  ];

  const client = createMockClient({ responses });
  const session = new AgentSession({ client, config: DEFAULT_CONFIG });
  await session.initialize();

  const result = await session.runTask('Please echo "Hello Agent" twice');

  assert.equal(result.status, 'completed');
  assert.equal(result.iterations, 2);
  assert.equal(result.totalToolCalls, 1);
  assert.equal(result.finalResponse, 'I have echoed: Hello Agent Hello Agent');

  // Verify conversation history was accumulated in session
  const history = session.getHistory();
  assert.ok(history.length >= 3);
  assert.equal(history[0].role, 'user');
  assert.equal(history[1].role, 'assistant');
  assert.equal(history[2].role, 'tool');
});
