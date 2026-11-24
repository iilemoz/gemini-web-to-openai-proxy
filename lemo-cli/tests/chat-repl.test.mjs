import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { ChatRepl } from '../dist/chat/repl.js';
import { DEFAULT_CONFIG } from '../dist/core/config/schema.js';

function createMockClient() {
  return {
    listModels: async () => [
      { id: 'gemini-flash', object: 'model', owned_by: 'google', capabilities: { chat: true, stream: true } }
    ],
    createChatCompletionStream: async (req) => {
      return (async function* () {
        yield {
          id: 'chunk-1',
          object: 'chat.completion.chunk',
          created: 1,
          model: req.model,
          choices: [{ index: 0, delta: { content: 'Mock response' }, finish_reason: null }]
        };
      })();
    }
  };
}

test('ChatRepl: runs chat loop with message and /exit', async () => {
  const client = createMockClient();

  // Simulate user typing "Hello Lemo" followed by "/exit"
  const inputStream = Readable.from([
    'Hello Lemo\n',
    '/exit\n'
  ]);

  let outputBuffer = '';
  const outputStream = new Writable({
    write(chunk, encoding, callback) {
      outputBuffer += chunk.toString();
      callback();
    }
  });

  const repl = new ChatRepl({
    client,
    config: DEFAULT_CONFIG,
    input: inputStream,
    output: outputStream
  });

  await repl.start();

  assert.ok(outputBuffer.includes('Connected to Lemo Universal AI API Backend'));
  assert.ok(outputBuffer.includes('Mock response'));
  assert.ok(outputBuffer.includes('Goodbye!'));
});

test('ChatRepl: handles backend connection failure and non-TTY exit', async () => {
  const failingClient = {
    listModels: async () => {
      throw new Error('Connection refused');
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

  const repl = new ChatRepl({
    client: failingClient,
    config: DEFAULT_CONFIG,
    input: inputStream,
    output: outputStream
  });

  await repl.start();

  assert.ok(outputBuffer.includes('Could not connect to backend'));
  assert.ok(outputBuffer.includes('Exiting chat.'));
});
