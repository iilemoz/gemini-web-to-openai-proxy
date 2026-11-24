import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { AgentRepl } from '../dist/agent/repl/AgentRepl.js';
import { DEFAULT_CONFIG } from '../dist/core/config/schema.js';

const stripAnsi = (str) => str.replace(/\u001b\[[0-9;]*m/g, '');

function createMockClient({
  models = [
    { id: 'gemini-flash', object: 'model', owned_by: 'google', capabilities: { chat: true, stream: true, tools: true } }
  ],
  responses = []
} = {}) {
  let callIndex = 0;
  return {
    listModels: async () => models,
    createChatCompletion: async (req) => {
      const resp = responses[callIndex] || {
        id: `resp-${callIndex}`,
        object: 'chat.completion',
        created: Date.now(),
        model: req.model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Agent completed task successfully.' },
            finish_reason: 'stop'
          }
        ]
      };
      callIndex++;
      return resp;
    }
  };
}

test('AgentRepl: starts up, displays agent box, processes slash commands, and exits', async () => {
  const client = createMockClient();

  const inputStream = Readable.from([
    '/status\n',
    '/exit\n'
  ]);

  let outputBuffer = '';
  const outputStream = new Writable({
    write(chunk, encoding, callback) {
      outputBuffer += chunk.toString();
      callback();
    }
  });

  const repl = new AgentRepl({
    client,
    config: DEFAULT_CONFIG,
    input: inputStream,
    output: outputStream
  });

  await repl.start();

  assert.ok(outputBuffer.includes('Connected to Lemo Universal AI API Backend'));
  assert.ok(outputBuffer.includes('Mode:'));
  assert.ok(outputBuffer.includes('Agent Mode'));
  assert.ok(outputBuffer.includes('Active Model:'));
  assert.ok(outputBuffer.includes('Agent Mode Status:'));
  assert.ok(outputBuffer.includes('Exiting Agent Mode. Goodbye!'));
});

test('AgentRepl: executes task, renders lifecycle events, and prints final response', async () => {
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
                id: 'call_test_echo',
                type: 'function',
                function: {
                  name: 'test_echo',
                  arguments: JSON.stringify({ message: 'REPL Test', repeat: 1 })
                }
              }
            ]
          },
          finish_reason: 'tool_calls'
        }
      ]
    },
    // Turn 2: Model outputs final answer
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
            content: 'Task completed: echoed REPL Test.'
          },
          finish_reason: 'stop'
        }
      ]
    }
  ];

  const client = createMockClient({ responses });

  const inputStream = Readable.from([
    'Run test echo task\n',
    '/exit\n'
  ]);

  let outputBuffer = '';
  const outputStream = new Writable({
    write(chunk, encoding, callback) {
      outputBuffer += chunk.toString();
      callback();
    }
  });

  const repl = new AgentRepl({
    client,
    config: { ...DEFAULT_CONFIG, approvalMode: 'never' },
    input: inputStream,
    output: outputStream
  });

  await repl.start();

  const clean = stripAnsi(outputBuffer);

  // Verify event renderings
  assert.ok(clean.includes('Turn 1'));
  assert.ok(clean.includes('[Request] Submitting task'));
  assert.ok(clean.includes('[Response] Model requested 1 tool execution(s)'));
  assert.ok(clean.includes('Tool Requested:'));
  assert.ok(clean.includes('test_echo'));
  assert.ok(clean.includes('test_echo finished'));
  assert.ok(clean.includes('Lemo Agent >'));
  assert.ok(clean.includes('Task completed: echoed REPL Test.'));
  assert.ok(clean.includes('Agent task completed in 2 turn(s)'));
});

test('AgentRepl: handles interactive tool approval grant (y)', async () => {
  const responses = [
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
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'test_echo',
                  arguments: JSON.stringify({ message: 'Approval test' })
                }
              }
            ]
          },
          finish_reason: 'tool_calls'
        }
      ]
    },
    {
      id: 'resp-2',
      object: 'chat.completion',
      created: Date.now(),
      model: 'gemini-flash',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Approved and finished.' },
          finish_reason: 'stop'
        }
      ]
    }
  ];

  const client = createMockClient({ responses });

  // Simulate user inputting task, then 'y' to approval prompt, then '/exit'
  const inputStream = Readable.from([
    'Task with approval\n',
    'y\n',
    '/exit\n'
  ]);
  // Mock isTTY on input stream
  inputStream.isTTY = true;

  let outputBuffer = '';
  const outputStream = new Writable({
    write(chunk, encoding, callback) {
      outputBuffer += chunk.toString();
      callback();
    }
  });

  const repl = new AgentRepl({
    client,
    config: { ...DEFAULT_CONFIG, approvalMode: 'always' }, // 'always' prompts for approval
    input: inputStream,
    output: outputStream
  });

  await repl.start();

  const clean = stripAnsi(outputBuffer);
  assert.ok(clean.includes('TOOL EXECUTION APPROVAL REQUIRED'));
  assert.ok(clean.includes('Approve this operation? [y/N]:'));
  assert.ok(clean.includes('Approved by user'));
  assert.ok(clean.includes('test_echo finished'));
  assert.ok(clean.includes('Approved and finished.'));
});

test('AgentRepl: handles interactive tool approval denial (n)', async () => {
  const responses = [
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
                id: 'call_denied',
                type: 'function',
                function: {
                  name: 'test_echo',
                  arguments: JSON.stringify({ message: 'Denial test' })
                }
              }
            ]
          },
          finish_reason: 'tool_calls'
        }
      ]
    },
    {
      id: 'resp-2',
      object: 'chat.completion',
      created: Date.now(),
      model: 'gemini-flash',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Tool execution was denied by user.' },
          finish_reason: 'stop'
        }
      ]
    }
  ];

  const client = createMockClient({ responses });

  // User submits task, then 'n' to approval prompt, then '/exit'
  const inputStream = Readable.from([
    'Task with denial\n',
    'n\n',
    '/exit\n'
  ]);
  inputStream.isTTY = true;

  let outputBuffer = '';
  const outputStream = new Writable({
    write(chunk, encoding, callback) {
      outputBuffer += chunk.toString();
      callback();
    }
  });

  const repl = new AgentRepl({
    client,
    config: { ...DEFAULT_CONFIG, approvalMode: 'always' },
    input: inputStream,
    output: outputStream
  });

  await repl.start();

  const clean = stripAnsi(outputBuffer);
  assert.ok(clean.includes('TOOL EXECUTION APPROVAL REQUIRED'));
  assert.ok(clean.includes('Approve this operation? [y/N]:'));
  assert.ok(clean.includes('Denied by user'));
  assert.ok(clean.includes('Operation denied: Tool execution denied by user.'));
  assert.ok(clean.includes('Tool execution was denied by user.'));
});

test('AgentRepl: handles backend connection failure on startup', async () => {
  const failingClient = {
    listModels: async () => {
      throw new Error('Connection refused at 127.0.0.1:3000');
    }
  };

  const inputStream = Readable.from([]);
  let outputBuffer = '';
  const outputStream = new Writable({
    write(chunk, encoding, callback) {
      outputBuffer += chunk.toString();
      callback();
    }
  });

  const repl = new AgentRepl({
    client: failingClient,
    config: DEFAULT_CONFIG,
    input: inputStream,
    output: outputStream
  });

  await repl.start();

  assert.ok(outputBuffer.includes('Could not connect to backend'));
  assert.ok(outputBuffer.includes('Exiting Agent Mode.'));
});

test('AgentRepl: handles runtime agent error gracefully', async () => {
  const failingClient = {
    listModels: async () => [
      { id: 'gemini-flash', object: 'model', owned_by: 'google', capabilities: { tools: true } }
    ],
    createChatCompletion: async () => {
      throw new Error('Internal Model Engine Error');
    }
  };

  const inputStream = Readable.from([
    'Failing task\n',
    '/exit\n'
  ]);

  let outputBuffer = '';
  const outputStream = new Writable({
    write(chunk, encoding, callback) {
      outputBuffer += chunk.toString();
      callback();
    }
  });

  const repl = new AgentRepl({
    client: failingClient,
    config: DEFAULT_CONFIG,
    input: inputStream,
    output: outputStream
  });

  await repl.start();

  assert.ok(outputBuffer.includes('Agent execution failed: Internal Model Engine Error'));
  assert.ok(outputBuffer.includes('Exiting Agent Mode. Goodbye!'));
});
