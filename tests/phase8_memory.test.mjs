import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { PersistentMemory } from '../src/memory/index.js';
import { multiAgentCoordinator } from '../src/agent/index.js';
import { app } from '../src/app.js';
import http from 'node:http';

test('PersistentMemory saves, loads, searches facts, and persists across instances', async () => {
  const testStorage = path.join(os.tmpdir(), `test_memory_${Date.now()}.json`);
  const mem1 = new PersistentMemory({ storagePath: testStorage });

  await mem1.setFact('database_choice', 'PostgreSQL', { tags: ['db', 'backend'] });
  await mem1.setFact('frontend_framework', 'React', { tags: ['ui', 'frontend'] });

  const val = await mem1.getFact('database_choice');
  assert.equal(val, 'PostgreSQL');

  const searchResults = await mem1.searchFacts('React');
  assert.equal(searchResults.length, 1);
  assert.equal(searchResults[0].key, 'frontend_framework');

  // Verify reload in a fresh instance
  const mem2 = new PersistentMemory({ storagePath: testStorage });
  const loadedVal = await mem2.getFact('database_choice');
  assert.equal(loadedVal, 'PostgreSQL');

  await mem1.clear();
});

test('MultiAgentCoordinator executes collaborative multi-agent pipeline', async () => {
  let stepIndex = 0;
  const mockProvider = {
    generateTurn: async ({ messages }) => {
      stepIndex++;
      const lastMsg = messages[messages.length - 1]?.content || '';
      return {
        content: `Completed stage #${stepIndex}: processed task input [${lastMsg.slice(0, 30)}...]`,
        toolCalls: []
      };
    }
  };

  const pipelineRes = await multiAgentCoordinator.runPipeline({
    task: 'Design and build authentication microservice',
    roles: ['architect', 'developer', 'tester'],
    modelProvider: mockProvider
  });

  assert.equal(pipelineRes.status, 'completed');
  assert.equal(pipelineRes.stages.length, 3);
  assert.equal(pipelineRes.stages[0].role, 'Software Architect');
  assert.equal(pipelineRes.stages[1].role, 'Software Developer');
  assert.equal(pipelineRes.stages[2].role, 'Quality Assurance Tester');
  assert.ok(pipelineRes.finalOutput.includes('Completed stage'));
});

test('HTTP POST /v1/agent/pipeline executes pipeline over API', async () => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/agent/pipeline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: 'Refactor logger module',
        roles: ['developer', 'tester']
      })
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'completed');
    assert.equal(body.stages.length, 2);

  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
