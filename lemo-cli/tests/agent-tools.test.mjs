import test from 'node:test';
import assert from 'node:assert/strict';
import { Tool } from '../dist/agent/tools/Tool.js';
import { ToolRegistry } from '../dist/agent/tools/ToolRegistry.js';
import { ToolExecutor } from '../dist/agent/tools/ToolExecutor.js';
import {
  StrictApprovalPolicy,
  AutoApprovalPolicy,
  CallbackApprovalPolicy
} from '../dist/agent/policies/ApprovalPolicy.js';
import { ExecutionPolicy } from '../dist/agent/policies/ExecutionPolicy.js';
import { ToolError } from '../dist/core/errors/index.js';

// Test-only mock tool
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

// Test-only dangerous tool
class TestDangerousTool extends Tool {
  name = 'test_delete';
  description = 'Mock dangerous deletion tool';
  parameters = {
    type: 'object',
    properties: {
      target: { type: 'string' }
    },
    required: ['target']
  };
  permissions = ['file_delete', 'destructive'];

  async execute(args) {
    return { success: true, data: { deleted: args.target } };
  }
}

// Test-only failing tool
class TestFailingTool extends Tool {
  name = 'test_fail';
  description = 'Tool that throws an internal error';
  parameters = { type: 'object' };
  permissions = ['read_only'];

  async execute() {
    throw new Error('Simulated runtime failure inside tool');
  }
}

test('Tool: schema validation checks required fields and types', () => {
  const tool = new TestEchoTool();

  // Valid args
  const validRes = tool.validateArgs({ message: 'hello', repeat: 2 });
  assert.equal(validRes.valid, true);
  assert.equal(validRes.errors, undefined);

  // Missing required field
  const missingRes = tool.validateArgs({ repeat: 2 });
  assert.equal(missingRes.valid, false);
  assert.ok(missingRes.errors.some(e => e.includes("Missing required parameter: 'message'")));

  // Wrong type for message
  const wrongTypeRes = tool.validateArgs({ message: 12345 });
  assert.equal(wrongTypeRes.valid, false);
  assert.ok(wrongTypeRes.errors.some(e => e.includes("Parameter 'message' must be of type 'string'")));

  // Wrong type for integer repeat
  const floatRepeatRes = tool.validateArgs({ message: 'hi', repeat: 2.5 });
  assert.equal(floatRepeatRes.valid, false);
  assert.ok(floatRepeatRes.errors.some(e => e.includes("Parameter 'repeat' must be an integer")));

  // Non-object args
  const nonObjRes = tool.validateArgs('invalid');
  assert.equal(nonObjRes.valid, false);
});

test('Tool: toOpenAITool formats specification correctly', () => {
  const tool = new TestEchoTool();
  const openAITool = tool.toOpenAITool();

  assert.equal(openAITool.type, 'function');
  assert.equal(openAITool.function.name, 'test_echo');
  assert.equal(openAITool.function.description, 'Echoes back a provided text message for testing');
  assert.deepEqual(openAITool.function.parameters.required, ['message']);
});

test('ToolRegistry: registers tools and rejects duplicate names', () => {
  const registry = new ToolRegistry();
  const tool1 = new TestEchoTool();
  const tool2 = new TestEchoTool();

  registry.register(tool1);
  assert.equal(registry.has('test_echo'), true);
  assert.equal(registry.get('test_echo'), tool1);
  assert.equal(registry.list().length, 1);

  // Duplicate name rejection
  assert.throws(() => {
    registry.register(tool2);
  }, (err) => {
    return err instanceof ToolError && err.message.includes("is already registered");
  });

  // Invalid registration
  assert.throws(() => {
    registry.register(null);
  }, ToolError);

  // Unregister
  const unregSuccess = registry.unregister('test_echo');
  assert.equal(unregSuccess, true);
  assert.equal(registry.has('test_echo'), false);
});

test('ToolRegistry: toOpenAITools converts all registered tools', () => {
  const registry = new ToolRegistry();
  registry.register(new TestEchoTool());
  registry.register(new TestDangerousTool());

  const openAITools = registry.toOpenAITools();
  assert.equal(openAITools.length, 2);
  assert.ok(openAITools.some(t => t.function.name === 'test_echo'));
  assert.ok(openAITools.some(t => t.function.name === 'test_delete'));
});

test('ApprovalPolicy: StrictApprovalPolicy permits read_only and rejects dangerous tools', async () => {
  const policy = new StrictApprovalPolicy(['read_only']);
  const echoTool = new TestEchoTool();
  const deleteTool = new TestDangerousTool();

  const echoDecision = await policy.evaluate(echoTool, { message: 'hi' });
  assert.equal(echoDecision.approved, true);

  const deleteDecision = await policy.evaluate(deleteTool, { target: 'file.txt' });
  assert.equal(deleteDecision.approved, false);
  assert.ok(deleteDecision.reason.includes('requires permission'));
});

test('ApprovalPolicy: CallbackApprovalPolicy delegates evaluation to custom handler', async () => {
  let askedTool = '';
  const policy = new CallbackApprovalPolicy(async (tool) => {
    askedTool = tool.name;
    return tool.name === 'test_echo';
  });

  const echoTool = new TestEchoTool();
  const res1 = await policy.evaluate(echoTool, { message: 'test' });
  assert.equal(res1.approved, true);
  assert.equal(askedTool, 'test_echo');

  const deleteTool = new TestDangerousTool();
  const res2 = await policy.evaluate(deleteTool, { target: 'bad' });
  assert.equal(res2.approved, false);
});

test('ToolExecutor: executes registered tool successfully with parsed args', async () => {
  const registry = new ToolRegistry();
  registry.register(new TestEchoTool());
  const executor = new ToolExecutor(registry, new AutoApprovalPolicy(['read_only']));

  const result = await executor.execute({
    id: 'call_1',
    type: 'function',
    function: {
      name: 'test_echo',
      arguments: JSON.stringify({ message: 'Antigravity', repeat: 2 })
    }
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.data, { result: 'Antigravity Antigravity' });
  assert.ok(typeof result.durationMs === 'number');

  const formatted = executor.formatResultContent(result);
  assert.ok(formatted.includes('Antigravity Antigravity'));
});

test('ToolExecutor: safely handles malformed JSON arguments', async () => {
  const registry = new ToolRegistry();
  registry.register(new TestEchoTool());
  const executor = new ToolExecutor(registry, new AutoApprovalPolicy(['read_only']));

  const result = await executor.execute({
    id: 'call_bad_json',
    type: 'function',
    function: {
      name: 'test_echo',
      arguments: '{ message: unquoted_value }'
    }
  });

  assert.equal(result.success, false);
  assert.ok(result.error.includes('Malformed JSON arguments'));
});

test('ToolExecutor: safely handles unknown tools', async () => {
  const registry = new ToolRegistry();
  const executor = new ToolExecutor(registry, new AutoApprovalPolicy(['read_only']));

  const result = await executor.execute({
    id: 'call_unknown',
    type: 'function',
    function: {
      name: 'non_existent_tool',
      arguments: '{}'
    }
  });

  assert.equal(result.success, false);
  assert.ok(result.error.includes("Unknown tool: 'non_existent_tool'"));
});

test('ToolExecutor: safely handles invalid arguments schema', async () => {
  const registry = new ToolRegistry();
  registry.register(new TestEchoTool());
  const executor = new ToolExecutor(registry, new AutoApprovalPolicy(['read_only']));

  const result = await executor.execute({
    id: 'call_invalid_args',
    type: 'function',
    function: {
      name: 'test_echo',
      arguments: JSON.stringify({ repeat: 3 }) // missing required 'message'
    }
  });

  assert.equal(result.success, false);
  assert.ok(result.error.includes("Missing required parameter: 'message'"));
});

test('ToolExecutor: wraps runtime exceptions inside tool into ToolResult without crashing', async () => {
  const registry = new ToolRegistry();
  registry.register(new TestFailingTool());
  const executor = new ToolExecutor(registry, new AutoApprovalPolicy(['read_only']));

  const result = await executor.execute({
    id: 'call_fail',
    type: 'function',
    function: {
      name: 'test_fail',
      arguments: '{}'
    }
  });

  assert.equal(result.success, false);
  assert.ok(result.error.includes('Simulated runtime failure inside tool'));
});

test('ToolExecutor: rejects execution when policy denies approval', async () => {
  const registry = new ToolRegistry();
  registry.register(new TestDangerousTool());
  const executor = new ToolExecutor(registry, new StrictApprovalPolicy(['read_only']));

  const result = await executor.execute({
    id: 'call_deny',
    type: 'function',
    function: {
      name: 'test_delete',
      arguments: JSON.stringify({ target: 'secrets.txt' })
    }
  });

  assert.equal(result.success, false);
  assert.ok(result.error.includes('Execution denied by policy'));
});
