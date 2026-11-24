import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LemoApiClient } from '../dist/api/client/LemoApiClient.js';
import { Agent } from '../dist/agent/core/Agent.js';
import { Tool } from '../dist/agent/tools/Tool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../..');

class TestEchoTool extends Tool {
  name = 'test_echo';
  description = 'Echoes back a provided text message for testing';
  parameters = {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Message to echo back' },
      repeat: { type: 'integer', description: 'Number of times to repeat' }
    },
    required: ['message']
  };
  permissions = ['read_only'];

  async execute(args) {
    const msg = args.message;
    const count = args.repeat || 1;
    return {
      success: true,
      data: { result: Array(count).fill(msg).join(' ') }
    };
  }
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // not yet up
    }
    await sleep(250);
  }
  return false;
}

async function main() {
  console.log('--- Starting Live Tool Verification ---');
  const server = spawn(process.execPath, [path.join(ROOT_DIR, 'src/server.js')], {
    cwd: ROOT_DIR,
    env: { ...process.env, PORT: '3000' },
    stdio: 'pipe'
  });

  server.stdout.on('data', (d) => process.stdout.write(`[Server] ${d.toString()}`));
  server.stderr.on('data', (d) => process.stderr.write(`[Server ERR] ${d.toString()}`));

  try {
    const isReady = await waitForServer('http://127.0.0.1:3000/health', 15000);
    if (!isReady) {
      throw new Error('Server failed to start within 15 seconds');
    }
    console.log('[LiveTest] Server is healthy and listening on port 3000');

    const client = new LemoApiClient({ baseUrl: 'http://127.0.0.1:3000/v1' });
    const models = await client.listModels();
    console.log('[LiveTest] Backend models returned:', models.map((m) => `${m.id} (tools: ${m.capabilities?.tools})`));

    const agent = new Agent({
      client,
      defaultModel: 'gemini-flash'
    });

    agent.registerTool(new TestEchoTool());

    const events = [];
    agent.onEvent((event) => {
      events.push(event.type);
      console.log(`[Agent Event] ${event.type}:`, JSON.stringify(event.payload || {}));
    });

    console.log('[LiveTest] Executing agent task with live backend...');
    const result = await agent.run(
      'Use the test_echo tool with message "Lemo Agent Live Test" to test tool invocation. Do not answer directly without calling the tool first.'
    );

    console.log('[LiveTest] Agent Execution Completed:');
    console.log('  Status:', result.status);
    console.log('  Iterations:', result.iterations);
    console.log('  Total Tool Calls:', result.totalToolCalls);
    console.log('  Duration:', result.durationMs, 'ms');
    console.log('  Final Response:', result.finalResponse);
    if (result.error) {
      console.log('  Error:', result.error.message);
    }
    console.log('  Events captured:', events);
  } finally {
    console.log('[LiveTest] Shutting down server...');
    server.kill();
  }
}

main().catch((err) => {
  console.error('[LiveTest Error]:', err);
  process.exit(1);
});
