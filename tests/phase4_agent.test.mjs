import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentStateMachine, AgentState } from '../src/agent/AgentState.js';
import { AgentMemory } from '../src/agent/AgentMemory.js';
import { AgentCancellation } from '../src/agent/AgentCancellation.js';
import { AgentPlanner } from '../src/agent/AgentPlanner.js';
import { AgentOrchestrator } from '../src/agent/AgentOrchestrator.js';
import { app } from '../src/app.js';
import http from 'node:http';

test('AgentStateMachine transitions and validates state graph', () => {
  const sm = new AgentStateMachine(AgentState.QUEUED);
  assert.equal(sm.state, AgentState.QUEUED);

  sm.transition(AgentState.PLANNING);
  assert.equal(sm.state, AgentState.PLANNING);

  sm.transition(AgentState.RUNNING);
  assert.equal(sm.state, AgentState.RUNNING);

  sm.transition(AgentState.COMPLETED);
  assert.equal(sm.state, AgentState.COMPLETED);
  assert.equal(sm.isTerminal(), true);

  // Terminal state transition must throw
  assert.throws(() => {
    sm.transition(AgentState.RUNNING);
  }, /Cannot transition from terminal state/);
});

test('AgentMemory tracks steps, facts, and tool history', () => {
  const memory = new AgentMemory();
  memory.addStep({ step: 1, action: 'scan workspace' });
  memory.setFact('language', 'JavaScript');
  memory.recordToolResult({ id: 'c1', name: 'echo' }, { is_error: false, content: 'hello' });

  const summary = memory.getSummary();
  assert.equal(summary.totalSteps, 1);
  assert.equal(summary.totalToolCalls, 1);
  assert.equal(summary.successfulTools, 1);
  assert.equal(summary.failedTools, 0);
  assert.equal(summary.facts.language, 'JavaScript');
});

test('AgentCancellation cancels execution with reason and signal', () => {
  const cancellation = new AgentCancellation();
  assert.equal(cancellation.isCancelled, false);

  cancellation.cancel('User stopped');
  assert.equal(cancellation.isCancelled, true);
  assert.throws(() => {
    cancellation.throwIfCancelled();
  }, /Agent run was cancelled: User stopped/);
});

test('AgentPlanner creates initial 4-phase structured plan', () => {
  const planner = new AgentPlanner();
  const plan = planner.createInitialPlan('Refactor auth module', [{ name: 'read_file' }, { name: 'edit_file' }]);

  assert.equal(plan.task, 'Refactor auth module');
  assert.equal(plan.phases.length, 4);
  assert.ok(plan.suggestedTools.includes('read_file'));
});

test('AgentOrchestrator runs multi-step loop with tool calls to completion', async () => {
  const orchestrator = new AgentOrchestrator();

  let turns = 0;
  const mockModelProvider = {
    generateTurn: async () => {
      turns++;
      if (turns === 1) {
        // First turn: invoke calculator tool
        return {
          content: 'Let me calculate 15 * 4',
          toolCalls: [
            {
              id: 'call_calc_1',
              function: {
                name: 'calculator',
                arguments: { expression: '15 * 4' }
              }
            }
          ]
        };
      } else {
        // Second turn: task complete
        return {
          content: 'The calculation result is 60. Task finished.',
          toolCalls: []
        };
      }
    }
  };

  const run = orchestrator.createRun({
    task: 'Calculate 15 * 4',
    modelProvider: mockModelProvider,
    autonomyMode: 'autonomous'
  });

  assert.equal(run.status, AgentState.QUEUED);

  await orchestrator.startRun(run.id);

  const finalRun = orchestrator.getRun(run.id);
  assert.equal(finalRun.status, AgentState.COMPLETED);
  assert.equal(finalRun.summary.totalToolCalls, 1);
  assert.equal(finalRun.summary.successfulTools, 1);
  assert.ok(finalRun.result.summary.includes('60'));
});

test('AgentOrchestrator handles cancellation during execution', async () => {
  const orchestrator = new AgentOrchestrator();

  const mockModelProvider = {
    generateTurn: async () => {
      // Simulate delay
      await new Promise(r => setTimeout(r, 50));
      return { content: 'Working...', toolCalls: [] };
    }
  };

  const run = orchestrator.createRun({
    task: 'Long running task',
    modelProvider: mockModelProvider
  });

  const runPromise = orchestrator.startRun(run.id);
  orchestrator.cancelRun(run.id, 'Stopped early');

  try {
    await runPromise;
  } catch (err) {
    // Expected abort error
  }

  const finalRun = orchestrator.getRun(run.id);
  assert.equal(finalRun.status, AgentState.CANCELLED);
});

test('Agent HTTP endpoints: /v1/agents and /v1/agent/runs', async () => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  try {
    // 1. GET /v1/agents
    const resAgents = await fetch(`http://127.0.0.1:${port}/v1/agents`);
    assert.equal(resAgents.status, 200);
    const agentsData = await resAgents.json();
    assert.equal(agentsData.object, 'list');
    assert.ok(agentsData.data.length >= 5);

    // 2. POST /v1/agent/runs (synchronous wait)
    const resCreate = await fetch(`http://127.0.0.1:${port}/v1/agent/runs?wait=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: 'Provide a greeting report'
      })
    });
    assert.equal(resCreate.status, 200);
    const runData = await resCreate.json();
    assert.equal(runData.status, AgentState.COMPLETED);

    // 3. GET /v1/agent/runs
    const resList = await fetch(`http://127.0.0.1:${port}/v1/agent/runs`);
    assert.equal(resList.status, 200);
    const listData = await resList.json();
    assert.ok(listData.data.length >= 1);

    // 4. GET /v1/agent/runs/:id
    const resGet = await fetch(`http://127.0.0.1:${port}/v1/agent/runs/${runData.id}`);
    assert.equal(resGet.status, 200);
    const detailData = await resGet.json();
    assert.equal(detailData.id, runData.id);

  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
