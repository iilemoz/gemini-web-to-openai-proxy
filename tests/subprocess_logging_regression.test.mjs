import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverPath = path.resolve(__dirname, '../src/server.js');

test('Subprocess Logging & Lifecyle: server child process runs, handles requests without pipe deadlock', async (t) => {
  const testPort = 3125;
  const env = {
    ...process.env,
    PORT: String(testPort),
    RATE_LIMIT_ENABLED: 'false'
  };

  // Spawn node server with piped streams
  const child = spawn(process.execPath, [serverPath], {
    env,
    cwd: path.resolve(__dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe']
  });

  // Attach continuous draining listeners to avoid OS buffer deadlock
  let stdoutChunks = [];
  let stderrChunks = [];
  child.stdout.on('data', (chunk) => stdoutChunks.push(chunk.toString()));
  child.stderr.on('data', (chunk) => stderrChunks.push(chunk.toString()));

  const baseUrl = `http://127.0.0.1:${testPort}`;

  // Helper: wait for server readiness
  async function waitForReady(maxAttempts = 30) {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const res = await fetch(`${baseUrl}/healthz`);
        if (res.ok) return true;
      } catch {
        // Retry
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  }

  try {
    const isReady = await waitForReady();
    assert.ok(isReady, 'Server child process should start and respond to /healthz');

    // Make parallel requests to test concurrent logging throughput
    const requests = Array.from({ length: 15 }, (_, i) =>
      fetch(`${baseUrl}/v1/models`).then(async (r) => {
        assert.equal(r.status, 200);
        const data = await r.json();
        assert.ok(Array.isArray(data.data));
        return data.data.length;
      })
    );

    const results = await Promise.all(requests);
    assert.equal(results.length, 15);
    assert.ok(results.every((count) => count > 0));

    // Verify stdout received log entries without deadlock
    assert.ok(stdoutChunks.length > 0, 'Server should have emitted stdout logs');
  } finally {
    // Terminate child cleanly
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 3000);
      child.on('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
});
