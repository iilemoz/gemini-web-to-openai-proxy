import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { AgentOrchestrator } from '../src/agent/AgentOrchestrator.js';
import { AgentState } from '../src/agent/AgentState.js';
import { workspaceManager } from '../src/runtime/local/WorkspaceManager.js';

let tempProjectDir;

test.before(async () => {
  tempProjectDir = path.join(os.tmpdir(), `auto_agent_project_${Date.now()}`);
  await fs.mkdir(tempProjectDir, { recursive: true });

  // Authorize temp project in workspace manager
  workspaceManager.addRoot(tempProjectDir);

  // Create buggy calc.js
  const calcContent = `export function add(a, b) {
  // Bug: subtraction instead of addition
  return a - b;
}
`;
  await fs.writeFile(path.join(tempProjectDir, 'calc.js'), calcContent);

  // Create test.js that validates add(2, 3) === 5
  const testContent = `import { add } from './calc.js';
if (add(2, 3) !== 5) {
  console.error('Assertion failed: add(2, 3) !== 5');
  process.exit(1);
}
console.log('ALL TESTS PASSING');
`;
  await fs.writeFile(path.join(tempProjectDir, 'test.js'), testContent);
});

test.after(async () => {
  try {
    await fs.rm(tempProjectDir, { recursive: true, force: true });
  } catch { /* cleanup */ }
});

test('Autonomous Agent executes complete real-world inspect-fix-test-verify pipeline', async () => {
  const orchestrator = new AgentOrchestrator();

  // Multi-step mock model provider driving the autonomous agent through real tool executions
  let step = 0;
  const modelProvider = {
    name: 'mock-agent-gemini',
    async generateTurn({ messages, tools }) {
      step++;
      if (step === 1) {
        // Step 1: Inspect files
        return {
          content: 'Inspecting workspace files',
          toolCalls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'list_files',
                arguments: JSON.stringify({ path: tempProjectDir.replace(/\\/g, '/') })
              }
            }
          ]
        };
      } else if (step === 2) {
        // Step 2: Read buggy calc.js
        return {
          content: 'Reading calc.js to investigate code',
          toolCalls: [
            {
              id: 'call_2',
              type: 'function',
              function: {
                name: 'read_file',
                arguments: JSON.stringify({ path: path.join(tempProjectDir, 'calc.js').replace(/\\/g, '/') })
              }
            }
          ]
        };
      } else if (step === 3) {
        // Step 3: Run test.js to observe failure
        return {
          content: 'Running test.js to reproduce failure',
          toolCalls: [
            {
              id: 'call_3',
              type: 'function',
              function: {
                name: 'execute_command',
                arguments: JSON.stringify({ command: `node "${path.join(tempProjectDir, 'test.js').replace(/\\/g, '/')}"` })
              }
            }
          ]
        };
      } else if (step === 4) {
        // Step 4: Fix bug by writing corrected calc.js
        const fixedContent = `export function add(a, b) {\n  return a + b;\n}\n`;
        return {
          content: 'Fixing bug in calc.js',
          toolCalls: [
            {
              id: 'call_4',
              type: 'function',
              function: {
                name: 'write_file',
                arguments: JSON.stringify({
                  path: path.join(tempProjectDir, 'calc.js').replace(/\\/g, '/'),
                  content: fixedContent
                })
              }
            }
          ]
        };
      } else if (step === 5) {
        // Step 5: Re-run test.js to confirm fix
        return {
          content: 'Re-running test.js to verify fix',
          toolCalls: [
            {
              id: 'call_5',
              type: 'function',
              function: {
                name: 'execute_command',
                arguments: JSON.stringify({ command: `node "${path.join(tempProjectDir, 'test.js').replace(/\\/g, '/')}"` })
              }
            }
          ]
        };
      } else {
        // Step 6: Final summary completion
        return {
          content: 'Inspection completed: Bug identified in calc.js (subtraction instead of addition). File updated on disk and verified with test.js. All tests are now passing.',
          toolCalls: []
        };
      }
    }
  };

  const run = orchestrator.createRun({
    task: 'Inspect project, identify test failure in calc.js, fix bug, and verify test passes.',
    role: 'Autonomous Developer',
    model: 'gemini-flash',
    autonomyMode: 'autonomous',
    workspaceRoot: tempProjectDir,
    permissions: ['none', 'all'],
    modelProvider
  });

  const completedRun = await orchestrator.startRun(run.id);

  assert.equal(completedRun.status, AgentState.COMPLETED);
  assert.ok(completedRun.result);
  assert.match(completedRun.result.summary, /All tests are now passing/i);

  // CRUCIAL: Verify disk state actually changed
  const diskContent = await fs.readFile(path.join(tempProjectDir, 'calc.js'), 'utf-8');
  assert.match(diskContent, /return a \+ b;/);
  assert.doesNotMatch(diskContent, /return a - b;/);
});
