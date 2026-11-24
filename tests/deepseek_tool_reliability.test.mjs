import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDSML, containsDSML } from '../src/utils/dsmlParser.js';
import { toolDispatcher, toolRegistry } from '../src/tools/index.js';

test('containsDSML detects both standard <tool_call> and DSML syntax', () => {
  assert.equal(containsDSML('I will now call: <tool_call>{"name": "test"}</tool_call>'), true);
  assert.equal(containsDSML('<｜DSML｜｜calls><｜tool_call｜>write_file<｜/tool_call｜></｜DSML｜｜calls>'), true);
  assert.equal(containsDSML('Just ordinary assistant text without tools.'), false);
  assert.equal(containsDSML(''), false);
  assert.equal(containsDSML(null), false);
});

test('parseDSML handles multiple tool calls in a single assistant response', () => {
  const input = `I will read the file and check the status.
<tool_call>
{"name": "read_file", "arguments": {"filePath": "src/app.js"}}
</tool_call>
Also checking git:
<tool_call>
{"name": "git_status", "arguments": {}}
</tool_call>
Let me know if you need more.`;

  const { content, toolCalls } = parseDSML(input);
  assert.equal(toolCalls.length, 2);
  assert.equal(toolCalls[0].function.name, 'read_file');
  assert.deepEqual(JSON.parse(toolCalls[0].function.arguments), { filePath: 'src/app.js' });
  assert.equal(toolCalls[1].function.name, 'git_status');
  assert.deepEqual(JSON.parse(toolCalls[1].function.arguments), {});

  // Crucial: Ensure tool call tags are NOT leaked into plain text content
  assert.doesNotMatch(content, /<tool_call>/i);
  assert.doesNotMatch(content, /<\/tool_call>/i);
  assert.match(content, /I will read the file and check the status/);
  assert.match(content, /Let me know if you need more/);
});

test('parseDSML handles malformed JSON and unclosed <tool_call> tags gracefully', () => {
  // Case A: Unclosed tag at the end of streaming or prompt truncation
  const unclosed = `Starting work:
<tool_call>
{"name": "execute_command", "arguments": {"command": "npm test"}}`;

  const resA = parseDSML(unclosed);
  assert.equal(resA.toolCalls.length, 1);
  assert.equal(resA.toolCalls[0].function.name, 'execute_command');
  assert.deepEqual(JSON.parse(resA.toolCalls[0].function.arguments), { command: 'npm test' });
  assert.doesNotMatch(resA.content, /<tool_call>/);

  // Case B: Markdown code block wrapped JSON
  const wrapped = `Executing:
<tool_call>
\`\`\`json
{
  "name": "calculator",
  "arguments": { "expression": "10 * 5" }
}
\`\`\`
</tool_call>`;

  const resB = parseDSML(wrapped);
  assert.equal(resB.toolCalls.length, 1);
  assert.equal(resB.toolCalls[0].function.name, 'calculator');
  assert.deepEqual(JSON.parse(resB.toolCalls[0].function.arguments), { expression: '10 * 5' });
});

test('parseDSML validates and preserves arguments structure without silent discard', () => {
  const raw = `<tool_call>
{"tool": "write_file", "parameters": {"path": "test.txt", "content": "hello world"}}
</tool_call>`;

  const res = parseDSML(raw);
  assert.equal(res.toolCalls.length, 1);
  assert.equal(res.toolCalls[0].function.name, 'write_file');
  const args = JSON.parse(res.toolCalls[0].function.arguments);
  assert.equal(args.path, 'test.txt');
  assert.equal(args.content, 'hello world');
});

test('parseDSML parses official DSML <｜DSML｜｜calls> syntax with multiple calls', () => {
  const dsmlText = `Thinking completed.
<｜DSML｜｜calls>
<｜DSML｜｜invoke name="system_info">
<｜/DSML｜｜invoke>
<｜DSML｜｜invoke name="echo">
<｜DSML｜｜parameter name="message">hello dsml<｜/DSML｜｜parameter>
<｜/DSML｜｜invoke>
<｜/DSML｜｜calls>
Done calling tools.`;

  const { content, toolCalls } = parseDSML(dsmlText);
  assert.equal(toolCalls.length, 2);
  assert.equal(toolCalls[0].function.name, 'system_info');
  assert.equal(toolCalls[1].function.name, 'echo');
  assert.doesNotMatch(content, /<｜DSML｜｜calls>/);
  assert.match(content, /Thinking completed/);
});

test('ToolDispatcher handles tool execution failure and returns structured error without throwing', async () => {
  // Call read_file on non-existent file
  const result = await toolDispatcher.dispatch({
    name: 'read_file',
    arguments: { path: 'completely_nonexistent_file_xyz_123.txt' },
    grantedPermissions: ['none', 'all']
  });

  // Must not throw unhandled exception; must return is_error: true and informative message
  assert.equal(result.is_error, true);
  assert.ok(result.content);
  assert.match(result.content, /ENOENT|EISDIR|does not exist|Security Exception/i);
});

test('Tool argument validation rejects invalid types and missing required fields', async () => {
  // calculate tool requires 'expression'
  const result = await toolDispatcher.dispatch({
    name: 'calculator',
    arguments: {}, // missing required 'expression'
    grantedPermissions: ['none', 'all']
  });

  assert.equal(result.is_error, true);
  assert.match(result.content, /missing required parameter/i);
});
