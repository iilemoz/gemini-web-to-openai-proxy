import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AgentState } from '../dist/agent/core/AgentState.js';
import { AgentContext } from '../dist/agent/core/AgentContext.js';
import { Agent } from '../dist/agent/core/Agent.js';
import { Tool } from '../dist/agent/tools/Tool.js';
import { ToolRegistry } from '../dist/agent/tools/ToolRegistry.js';
import { StrictApprovalPolicy, AutoApprovalPolicy } from '../dist/agent/policies/ApprovalPolicy.js';
import { ExecutionPolicy } from '../dist/agent/policies/ExecutionPolicy.js';
import { LemoApiClient } from '../dist/api/index.js';
import { AgentExecutionError, ModelError } from '../dist/core/errors/index.js';

// Test mock tool
class TestEchoTool extends Tool {
  name = 'test_echo';
  description = 'Test echo tool';
  parameters = {
    type: 'object',
    properties: {
      text: { type: 'string' }
    },
    required: ['text']
  };
  permissions = ['read_only'];

  async execute(args) {
    return { success: true, data: `Echoed: ${args.text}` };
  }
}

test('AgentState: tracks state transitions and guards terminal states', () => {
  const state = new AgentState('idle');
  assert.equal(state.status, 'idle');
  assert.equal(state.isTerminal, false);
  assert.equal(state.isRunning, false);

  state.transitionTo('running');
  assert.equal(state.status, 'running');
  assert.equal(state.isRunning, true);

  state.transitionTo('executing_tool');
  assert.equal(state.status, 'executing_tool');

  state.transitionTo('completed');
  assert.equal(state.status, 'completed');
  assert.equal(state.isTerminal, true);

  // Attempting transition after terminal state throws
  assert.throws(() => {
    state.transitionTo('running');
  }, AgentExecutionError);
});

test('AgentContext: maintains chronological messages and records tool calls', () => {
  const ctx = new AgentContext({
    task: 'Solve the problem',
    model: 'gemini-flash',
    systemPrompt: 'You are an agent.'
  });

  const msgs = ctx.getMessages();
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, 'system');
  assert.equal(msgs[0].content, 'You are an agent.');
  assert.equal(msgs[1].role, 'user');
  assert.equal(msgs[1].content, 'Solve the problem');

  ctx.addMessage({ role: 'assistant', content: 'Working on it' });
  assert.equal(ctx.getMessages().length, 3);

  ctx.recordToolCall({
    id: 'call_1',
    type: 'function',
    function: { name: 'test_echo', arguments: '{}' }
  });
  assert.equal(ctx.totalToolCalls, 1);
  assert.equal(ctx.getExecutedToolCalls().length, 1);
});

test('Agent: normal assistant response without tools completes in 1 iteration', async () => {
  let requestCount = 0;
  const mockServer = http.createServer((req, res) => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        object: 'list',
        data: [{ id: 'gemini-flash', owned_by: 'gemini', capabilities: { tools: true } }]
      }));
      return;
    }

    if (req.url === '/v1/chat/completions') {
      requestCount++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chatcmpl-mock',
        object: 'chat.completion',
        created: Date.now(),
        model: 'gemini-flash',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'Task completed successfully!' },
          finish_reason: 'stop'
        }]
      }));
      return;
    }

    res.writeHead(404).end();
  });

  await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
  const port = mockServer.address().port;
  const client = new LemoApiClient({ baseUrl: `http://127.0.0.1:${port}/v1` });

  try {
    const events = [];
    const agent = new Agent({
      client,
      defaultModel: 'gemini-flash'
    });
    agent.on(e => events.push(e.type));

    const result = await agent.run('Hello agent');

    assert.equal(result.status, 'completed');
    assert.equal(result.finalResponse, 'Task completed successfully!');
    assert.equal(result.iterations, 1);
    assert.equal(result.totalToolCalls, 0);
    assert.equal(requestCount, 1);
    assert.ok(events.includes('model_request'));
    assert.ok(events.includes('agent_completed'));
  } finally {
    mockServer.close();
  }
});

test('Agent: handles tool-calling round-trip and returns final answer', async () => {
  let callIndex = 0;
  let receivedToolResult = null;

  const mockServer = http.createServer((req, res) => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        object: 'list',
        data: [{ id: 'gemini-flash', owned_by: 'gemini', capabilities: { tools: true } }]
      }));
      return;
    }

    if (req.url === '/v1/chat/completions') {
      callIndex++;
      let bodyStr = '';
      req.on('data', chunk => { bodyStr += chunk; });
      req.on('end', () => {
        const body = JSON.parse(bodyStr);

        if (callIndex === 1) {
          // First turn: model requests tool call
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            id: 'chatcmpl-turn1',
            object: 'chat.completion',
            created: Date.now(),
            model: 'gemini-flash',
            choices: [{
              index: 0,
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [{
                  id: 'call_echo_1',
                  type: 'function',
                  function: {
                    name: 'test_echo',
                    arguments: JSON.stringify({ text: 'Hello Lemo' })
                  }
                }]
              },
              finish_reason: 'tool_calls'
            }]
          }));
        } else {
          // Second turn: model receives tool result and responds
          const toolMsg = body.messages.find(m => m.role === 'tool');
          receivedToolResult = toolMsg ? toolMsg.content : null;

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            id: 'chatcmpl-turn2',
            object: 'chat.completion',
            created: Date.now(),
            model: 'gemini-flash',
            choices: [{
              index: 0,
              message: {
                role: 'assistant',
                content: 'I executed the tool and the result is: Echoed: Hello Lemo'
              },
              finish_reason: 'stop'
            }]
          }));
        }
      });
      return;
    }

    res.writeHead(404).end();
  });

  await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
  const port = mockServer.address().port;
  const client = new LemoApiClient({ baseUrl: `http://127.0.0.1:${port}/v1` });

  try {
    const registry = new ToolRegistry();
    registry.register(new TestEchoTool());

    const agent = new Agent({
      client,
      registry,
      approvalPolicy: new AutoApprovalPolicy(['read_only']),
      defaultModel: 'gemini-flash'
    });

    const result = await agent.run('Please echo Hello Lemo');

    assert.equal(result.status, 'completed');
    assert.equal(result.iterations, 2);
    assert.equal(result.totalToolCalls, 1);
    assert.ok(result.finalResponse.includes('Echoed: Hello Lemo'));
    assert.ok(receivedToolResult.includes('Echoed: Hello Lemo'));
  } finally {
    mockServer.close();
  }
});

test('Agent: executes multiple tool calls in a single turn', async () => {
  let callIndex = 0;

  const mockServer = http.createServer((req, res) => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        object: 'list',
        data: [{ id: 'gemini-flash', owned_by: 'gemini', capabilities: { tools: true } }]
      }));
      return;
    }

    if (req.url === '/v1/chat/completions') {
      callIndex++;
      if (callIndex === 1) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'chatcmpl-multi',
          object: 'chat.completion',
          created: Date.now(),
          model: 'gemini-flash',
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'test_echo', arguments: JSON.stringify({ text: 'First' }) }
                },
                {
                  id: 'call_2',
                  type: 'function',
                  function: { name: 'test_echo', arguments: JSON.stringify({ text: 'Second' }) }
                }
              ]
            },
            finish_reason: 'tool_calls'
          }]
        }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'chatcmpl-done',
          object: 'chat.completion',
          created: Date.now(),
          model: 'gemini-flash',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: 'Both tools executed.' },
            finish_reason: 'stop'
          }]
        }));
      }
      return;
    }

    res.writeHead(404).end();
  });

  await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
  const port = mockServer.address().port;
  const client = new LemoApiClient({ baseUrl: `http://127.0.0.1:${port}/v1` });

  try {
    const registry = new ToolRegistry();
    registry.register(new TestEchoTool());

    const agent = new Agent({
      client,
      registry,
      approvalPolicy: new AutoApprovalPolicy(['read_only']),
      defaultModel: 'gemini-flash'
    });

    const result = await agent.run('Run two echoes');

    assert.equal(result.status, 'completed');
    assert.equal(result.totalToolCalls, 2);
    assert.equal(result.iterations, 2);

    const toolMessages = result.messages.filter(m => m.role === 'tool');
    assert.equal(toolMessages.length, 2);
    assert.equal(toolMessages[0].tool_call_id, 'call_1');
    assert.equal(toolMessages[1].tool_call_id, 'call_2');
  } finally {
    mockServer.close();
  }
});

test('Agent: rejects model without tool support with ModelError', async () => {
  const mockServer = http.createServer((req, res) => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        object: 'list',
        data: [{
          id: 'gemini-thinking',
          owned_by: 'gemini',
          capabilities: { tools: false, chat: true }
        }]
      }));
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
  const port = mockServer.address().port;
  const client = new LemoApiClient({ baseUrl: `http://127.0.0.1:${port}/v1` });

  try {
    const agent = new Agent({
      client,
      defaultModel: 'gemini-thinking'
    });

    const result = await agent.run('Do something');

    assert.equal(result.status, 'failed');
    assert.ok(result.error instanceof ModelError);
    assert.ok(result.error.message.includes('does not support tool calling'));
  } finally {
    mockServer.close();
  }
});

test('Agent: enforces execution iteration limits', async () => {
  const mockServer = http.createServer((req, res) => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        object: 'list',
        data: [{ id: 'gemini-flash', owned_by: 'gemini', capabilities: { tools: true } }]
      }));
      return;
    }

    if (req.url === '/v1/chat/completions') {
      // Endless tool request loop
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chatcmpl-loop',
        object: 'chat.completion',
        created: Date.now(),
        model: 'gemini-flash',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: `call_${Date.now()}`,
              type: 'function',
              function: { name: 'test_echo', arguments: JSON.stringify({ text: 'loop' }) }
            }]
          },
          finish_reason: 'tool_calls'
        }]
      }));
      return;
    }

    res.writeHead(404).end();
  });

  await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
  const port = mockServer.address().port;
  const client = new LemoApiClient({ baseUrl: `http://127.0.0.1:${port}/v1` });

  try {
    const registry = new ToolRegistry();
    registry.register(new TestEchoTool());

    const agent = new Agent({
      client,
      registry,
      approvalPolicy: new AutoApprovalPolicy(['read_only']),
      executionPolicy: new ExecutionPolicy({ maxIterations: 3 }),
      defaultModel: 'gemini-flash'
    });

    const result = await agent.run('Run endless tool loop');

    assert.equal(result.status, 'failed');
    assert.ok(result.error instanceof AgentExecutionError);
    assert.ok(result.error.message.includes('reached iteration limit'));
    assert.equal(result.iterations, 3);
  } finally {
    mockServer.close();
  }
});

test('Agent: supports external AbortSignal cancellation', async () => {
  const mockServer = http.createServer((req, res) => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        object: 'list',
        data: [{ id: 'gemini-flash', owned_by: 'gemini', capabilities: { tools: true } }]
      }));
      return;
    }

    if (req.url === '/v1/chat/completions') {
      // Simulate long latency
      setTimeout(() => {
        if (!res.writableEnded) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            id: 'chatcmpl-slow',
            choices: [{ message: { role: 'assistant', content: 'Late' } }]
          }));
        }
      }, 500);
      return;
    }

    res.writeHead(404).end();
  });

  await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
  const port = mockServer.address().port;
  const client = new LemoApiClient({ baseUrl: `http://127.0.0.1:${port}/v1` });

  try {
    const agent = new Agent({
      client,
      defaultModel: 'gemini-flash'
    });

    const abortController = new AbortController();
    setTimeout(() => abortController.abort(), 50);

    const result = await agent.run('Cancel me', { signal: abortController.signal });

    assert.equal(result.status, 'aborted');
    assert.equal(result.finalResponse, null);
  } finally {
    mockServer.close();
  }
});
