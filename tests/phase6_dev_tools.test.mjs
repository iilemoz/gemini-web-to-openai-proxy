import test from 'node:test';
import assert from 'node:assert/strict';
import { toolRegistry, toolDispatcher } from '../src/tools/index.js';

test('DevTools are registered in ToolRegistry', () => {
  const tools = toolRegistry.list();
  const toolNames = tools.map(t => t.name);

  assert.ok(toolNames.includes('search_code'));
  assert.ok(toolNames.includes('find_by_name'));
  assert.ok(toolNames.includes('git_branch'));
  assert.ok(toolNames.includes('run_diagnostics'));
});

test('DevTools: search_code finds code matches in workspace', async () => {
  const result = await toolDispatcher.dispatch({
    name: 'search_code',
    arguments: { pattern: 'gemini-web-to-openai-proxy', maxResults: 300 }
  });

  assert.equal(result.is_error, false);
  const parsed = JSON.parse(result.content);
  assert.ok(parsed.totalMatches > 0);
  assert.ok(parsed.matches.some(m => m.file.includes('package.json')));
});

test('DevTools: find_by_name finds files by substring', async () => {
  const result = await toolDispatcher.dispatch({
    name: 'find_by_name',
    arguments: { pattern: 'package.json' }
  });

  assert.equal(result.is_error, false);
  const parsed = JSON.parse(result.content);
  assert.ok(parsed.totalFound >= 1);
  assert.ok(parsed.items.some(i => i.path === 'package.json'));
});

test('DevTools: run_diagnostics validates package.json and workspace syntax', async () => {
  const result = await toolDispatcher.dispatch({
    name: 'run_diagnostics',
    arguments: { targetFile: 'src/app.js' }
  });

  assert.equal(result.is_error, false);
  const parsed = JSON.parse(result.content);
  assert.equal(parsed.passed, true);
  assert.ok(parsed.checks.length > 0);
});
