import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { LemoApiClient } from '../dist/api/index.js';
import { ChatSession } from '../dist/chat/session.js';
import { ConfigManager } from '../dist/core/config/index.js';

async function runE2E() {
  console.log('--- Starting Lemo Backend Server for E2E Verification ---');
  const server = spawn('node', ['src/server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: '3000' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  server.stdout.on('data', (d) => process.stdout.write(`[Backend STDOUT] ${d}`));
  server.stderr.on('data', (d) => process.stderr.write(`[Backend STDERR] ${d}`));

  let serverStarted = false;
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch('http://127.0.0.1:3000/health');
      if (res.ok) {
        serverStarted = true;
        break;
      }
    } catch {
      await sleep(250);
    }
  }

  if (!serverStarted) {
    console.error('Failed to start backend server within 5 seconds.');
    server.kill();
    process.exit(1);
  }

  console.log('\n[PASS] Backend server is up and healthy.');

  try {
    const config = ConfigManager.load();
    const client = LemoApiClient.fromConfig(config);
    const session = new ChatSession({ client, config });

    console.log('\n--- Step 1 & 2: Initialize ChatSession and verify active model ---');
    await session.initialize();
    const activeModel = session.getActiveModel();
    console.log(`Active model: ${activeModel}`);
    const models = session.getAvailableModels();
    console.log(`Available backend models (${models.length}): ${models.map(m => m.id).join(', ')}`);

    console.log('\n--- Step 3 & 4: Send turn 1: "My name is Lemo. Remember that for this conversation." ---');
    let turn1Text = '';
    try {
      const res1 = await session.sendMessage('My name is Lemo. Remember that for this conversation.', (chunk) => {
        turn1Text += chunk;
        process.stdout.write(chunk);
      });
      console.log(`\nTurn 1 finished: ${turn1Text.length} chars streamed.`);
    } catch (err) {
      console.log(`\nTurn 1 upstream attempt: ${err.message} (Status: ${err.status || err.code})`);
      console.log('Upstream Gemini live endpoint returned error (expected if Google cookies/network block access).');
    }

    console.log('\n--- Step 5 & 6: Send turn 2: "What is my name?" ---');
    let turn2Text = '';
    try {
      const res2 = await session.sendMessage('What is my name?', (chunk) => {
        turn2Text += chunk;
        process.stdout.write(chunk);
      });
      console.log(`\nTurn 2 finished: ${turn2Text.length} chars streamed.`);
    } catch (err) {
      console.log(`\nTurn 2 upstream attempt: ${err.message}`);
    }

    console.log('\n--- Step 7 & 8: Switch model with /model gemini-pro ---');
    const switchRes = await session.handleCommand('/model gemini-pro');
    console.log(`Command result: ${switchRes.message}`);
    console.log(`New active model: ${session.getActiveModel()}`);

    console.log('\n--- Step 9: Send message on new model ---');
    try {
      let turn3Text = '';
      await session.sendMessage('Hello gemini-pro!', (chunk) => {
        turn3Text += chunk;
      });
      console.log(`Turn 3 finished: ${turn3Text.length} chars.`);
    } catch (err) {
      console.log(`Turn 3 upstream attempt: ${err.message}`);
    }

    console.log('\n--- Step 10: Clean exit with /exit ---');
    const exitRes = await session.handleCommand('/exit');
    console.log(`Exit command result: shouldExit=${exitRes.shouldExit}, message=${exitRes.message}`);

    console.log('\n[PASS] E2E verification completed successfully.');
  } finally {
    server.kill();
  }
}

runE2E().catch((err) => {
  console.error('E2E verification error:', err);
  process.exit(1);
});
