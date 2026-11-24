import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AgentSession } from '../dist/agent/session/AgentSession.js';
import { DEFAULT_CONFIG } from '../dist/core/config/schema.js';

function createTempDir(prefix = 'lemo-agent-int-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanTempDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup on busy files
  }
}

function createMockClient({ responses = [] } = {}) {
  let callIndex = 0;
  return {
    listModels: async () => [
      {
        id: 'gemini-flash',
        object: 'model',
        owned_by: 'google',
        capabilities: { chat: true, stream: true, tools: true }
      }
    ],
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

test('AgentSession: initializes with workspace and registers all read-only filesystem tools', async () => {
  const tempDir = createTempDir();
  try {
    const client = createMockClient();
    const session = new AgentSession({
      client,
      config: DEFAULT_CONFIG,
      workspace: tempDir
    });

    await session.initialize();
    const tools = session.getRegisteredTools();
    const names = tools.map((t) => t.name);

    assert.ok(names.includes('test_echo'));
    assert.ok(names.includes('list_files'));
    assert.ok(names.includes('read_file'));
    assert.ok(names.includes('search_files'));
    assert.ok(names.includes('file_info'));

    // Verify /tools command includes them
    const toolsCmd = await session.handleCommand('/tools');
    assert.equal(toolsCmd.handled, true);
    assert.ok(toolsCmd.message.includes('list_files'));
    assert.ok(toolsCmd.message.includes('read_file'));
    assert.ok(toolsCmd.message.includes('search_files'));
    assert.ok(toolsCmd.message.includes('file_info'));
  } finally {
    cleanTempDir(tempDir);
  }
});

test('AgentSession: executes list_files tool call and returns final model response', async () => {
  const tempDir = createTempDir();
  try {
    fs.writeFileSync(path.join(tempDir, 'demo.ts'), 'export const a = 42;');

    const client = createMockClient({
      responses: [
        // Turn 1: Model asks to list files
        {
          id: 'turn-1',
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
                    id: 'call_list_1',
                    type: 'function',
                    function: {
                      name: 'list_files',
                      arguments: JSON.stringify({ path: '.' })
                    }
                  }
                ]
              },
              finish_reason: 'tool_calls'
            }
          ]
        },
        // Turn 2: Model receives tool result and provides final answer
        {
          id: 'turn-2',
          object: 'chat.completion',
          created: Date.now(),
          model: 'gemini-flash',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Found 1 file in the workspace: demo.ts'
              },
              finish_reason: 'stop'
            }
          ]
        }
      ]
    });

    const session = new AgentSession({
      client,
      config: DEFAULT_CONFIG,
      workspace: tempDir
    });

    await session.initialize();
    const result = await session.runTask('What files are in this project?');

    assert.equal(result.status, 'completed');
    assert.equal(result.totalToolCalls, 1);
    assert.equal(result.finalResponse, 'Found 1 file in the workspace: demo.ts');
  } finally {
    cleanTempDir(tempDir);
  }
});

test('AgentSession: executes read_file tool call and handles sensitive file rejection safely', async () => {
  const tempDir = createTempDir();
  try {
    fs.writeFileSync(path.join(tempDir, '.env'), 'SECRET_TOKEN=xyz');

    let receivedMessages = [];
    const client = {
      listModels: async () => [
        { id: 'gemini-flash', object: 'model', owned_by: 'google', capabilities: { chat: true, stream: true, tools: true } }
      ],
      createChatCompletion: async (req) => {
        receivedMessages = req.messages;
        if (req.messages.some((m) => m.role === 'tool')) {
          return {
            id: 'resp-final',
            object: 'chat.completion',
            created: Date.now(),
            model: 'gemini-flash',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'Access to .env was blocked for security.' },
                finish_reason: 'stop'
              }
            ]
          };
        }
        return {
          id: 'resp-call',
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
                    id: 'call_read_env',
                    type: 'function',
                    function: {
                      name: 'read_file',
                      arguments: JSON.stringify({ path: '.env' })
                    }
                  }
                ]
              },
              finish_reason: 'tool_calls'
            }
          ]
        };
      }
    };

    const session = new AgentSession({
      client,
      config: DEFAULT_CONFIG,
      workspace: tempDir
    });

    await session.initialize();
    const result = await session.runTask('Read the .env file');

    assert.equal(result.status, 'completed');
    assert.equal(result.finalResponse, 'Access to .env was blocked for security.');

    // Verify the tool result returned to model indicated a Security Exception
    const toolMsg = receivedMessages.find((m) => m.role === 'tool');
    assert.ok(toolMsg);
    assert.ok(toolMsg.content.includes('Security Exception'));
  } finally {
    cleanTempDir(tempDir);
  }
});
