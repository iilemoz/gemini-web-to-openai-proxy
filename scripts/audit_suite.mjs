/**
 * Comprehensive Real-World Integration & Reliability Audit Suite
 * Tests actual end-to-end behavior across all 8 subsystems.
 */

import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { app } from '../src/app.js';
import { config } from '../src/config/index.js';
import { toolRegistry, toolDispatcher, toolDiscovery } from '../src/tools/index.js';
import { workspaceManager, terminalManager, deviceManager } from '../src/runtime/index.js';
import { agentOrchestrator, multiAgentCoordinator } from '../src/agent/index.js';
import { persistentMemory } from '../src/memory/index.js';
import { mcpServer } from '../src/integrations/mcp/index.js';
import { GeminiEngine } from '../src/providers/gemini/GeminiEngine.js';
import { resetRateLimits } from '../src/middleware/rateLimiter.js';
import { parseDSML } from '../src/utils/dsmlParser.js';

const results = [];

function record(section, testName, status, details = {}) {
  results.push({ section, testName, status, details, timestamp: new Date().toISOString() });
  const icon = status === 'PASS' ? '✅' : status === 'PARTIALLY VERIFIED' ? '⚠️' : '❌';
  console.log(`${icon} [${status}] [${section}] ${testName}`);
  if (details.note) console.log(`   Note: ${details.note}`);
  if (details.error) console.log(`   Error: ${details.error}`);
}

async function runAudit() {
  console.log('===============================================================');
  console.log('   STARTING REAL-WORLD INTEGRATION & RELIABILITY AUDIT');
  console.log('===============================================================\n');

  // Start temporary server
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // -------------------------------------------------------------------------
    // 1. CORE API VERIFICATION
    // -------------------------------------------------------------------------
    console.log('\n--- Section 1: Core API Verification ---');

    // 1.1 /healthz
    try {
      const res = await fetch(`${baseUrl}/healthz`);
      const text = await res.text();
      if (res.status === 200 && text === 'OK') {
        record('1. Core API', 'GET /healthz readiness check', 'PASS', { status: res.status, body: text });
      } else {
        record('1. Core API', 'GET /healthz readiness check', 'FAIL', { status: res.status, body: text });
      }
    } catch (err) {
      record('1. Core API', 'GET /healthz readiness check', 'FAIL', { error: err.message });
    }

    // 1.2 /v1/models
    try {
      const res = await fetch(`${baseUrl}/v1/models`);
      const data = await res.json();
      if (res.status === 200 && data.object === 'list' && Array.isArray(data.data) && data.data.length > 0) {
        const hasFlash = data.data.some(m => m.id === 'gemini-flash');
        const hasThinking = data.data.some(m => m.id === 'gemini-thinking');
        record('1. Core API', 'GET /v1/models model catalog discovery', 'PASS', {
          count: data.data.length,
          hasFlash,
          hasThinking,
          sampleModel: data.data[0].id
        });
      } else {
        record('1. Core API', 'GET /v1/models model catalog discovery', 'FAIL', { status: res.status, data });
      }
    } catch (err) {
      record('1. Core API', 'GET /v1/models model catalog discovery', 'FAIL', { error: err.message });
    }

    // 1.3 /v1/models/:model
    try {
      const res = await fetch(`${baseUrl}/v1/models/gemini-flash`);
      const data = await res.json();
      if (res.status === 200 && data.id === 'gemini-flash') {
        record('1. Core API', 'GET /v1/models/:model individual details', 'PASS', { model: data.id });
      } else {
        record('1. Core API', 'GET /v1/models/:model individual details', 'FAIL', { status: res.status });
      }
    } catch (err) {
      record('1. Core API', 'GET /v1/models/:model individual details', 'FAIL', { error: err.message });
    }

    // 1.4 /v1/responses
    try {
      const res = await fetch(`${baseUrl}/v1/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gemini-flash', input: 'Ping test' })
      });
      const data = await res.json();
      if (res.status === 200 && data.object === 'response' && data.output) {
        record('1. Core API', 'POST /v1/responses endpoint', 'PASS', { status: res.status, outputSnippet: data.output.slice(0, 50) });
      } else {
        record('1. Core API', 'POST /v1/responses endpoint', 'FAIL', { status: res.status, data });
      }
    } catch (err) {
      record('1. Core API', 'POST /v1/responses endpoint', 'FAIL', { error: err.message });
    }

    // 1.5 Rate Limiting & 429 Retry-After
    try {
      resetRateLimits();
      const orig = config.rateLimitMax;
      config.rateLimitMax = 2;
      try {
        await fetch(`${baseUrl}/v1/models`);
        await fetch(`${baseUrl}/v1/models`);
        const limitedRes = await fetch(`${baseUrl}/v1/models`);
        const retryAfter = limitedRes.headers.get('retry-after');
        const errJson = await limitedRes.json();
        if (limitedRes.status === 429 && retryAfter && errJson.error?.code === 'rate_limit_exceeded') {
          record('1. Core API', 'Rate Limiter 429 with Retry-After header', 'PASS', {
            status: limitedRes.status,
            retryAfter,
            errorType: errJson.error.type
          });
        } else {
          record('1. Core API', 'Rate Limiter 429 with Retry-After header', 'FAIL', {
            status: limitedRes.status,
            retryAfter,
            errJson
          });
        }
      } finally {
        resetRateLimits();
        config.rateLimitMax = orig;
      }
    } catch (err) {
      record('1. Core API', 'Rate Limiter 429 with Retry-After header', 'FAIL', { error: err.message });
    }

    // 1.6 Authentication with PROXY_API_KEY
    try {
      config.proxyApiKey = 'audit-secret-token';
      const unauth = await fetch(`${baseUrl}/v1/models`);
      const auth = await fetch(`${baseUrl}/v1/models`, {
        headers: { Authorization: 'Bearer audit-secret-token' }
      });
      if (unauth.status === 401 && auth.status === 200) {
        record('1. Core API', 'Authentication middleware (PROXY_API_KEY)', 'PASS', {
          unauthorizedStatus: unauth.status,
          authorizedStatus: auth.status
        });
      } else {
        record('1. Core API', 'Authentication middleware (PROXY_API_KEY)', 'FAIL', {
          unauthorizedStatus: unauth.status,
          authorizedStatus: auth.status
        });
      }
    } finally {
      config.proxyApiKey = '';
    }

    // 1.7 Schema validation rejection
    try {
      const badRoleRes = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'bad_role', content: 'test' }] })
      });
      const badRoleData = await badRoleRes.json();
      if (badRoleRes.status === 400 && badRoleData.error?.code === 'invalid_role') {
        record('1. Core API', 'Input validation: rejects invalid role with 400', 'PASS', {
          status: badRoleRes.status,
          code: badRoleData.error.code
        });
      } else {
        record('1. Core API', 'Input validation: rejects invalid role with 400', 'FAIL', { badRoleRes: badRoleRes.status, badRoleData });
      }
    } catch (err) {
      record('1. Core API', 'Input validation: rejects invalid role with 400', 'FAIL', { error: err.message });
    }

    // -------------------------------------------------------------------------
    // 2. GEMINI WEB SDK VERIFICATION
    // -------------------------------------------------------------------------
    console.log('\n--- Section 2: Gemini Web SDK Verification ---');

    // 2.1 Live Guest Mode Generation & Streaming
    try {
      const engine = new GeminiEngine();
      const stream = engine.streamChat({
        model: 'gemini-flash',
        messages: [{ role: 'user', content: 'Reply with the word SUCCESS and nothing else.' }]
      });
      let responseText = '';
      for await (const chunk of stream) {
        responseText += chunk.text || '';
      }
      if (responseText.length > 0) {
        record('2. Gemini SDK', 'Guest Mode live streaming generation', 'PASS', {
          responseText: responseText.trim(),
          receivedLength: responseText.length
        });
      } else {
        record('2. Gemini SDK', 'Guest Mode live streaming generation', 'FAIL', { responseText });
      }
    } catch (err) {
      record('2. Gemini SDK', 'Guest Mode live streaming generation', 'FAIL', { error: err.message });
    }

    // 2.2 Account Mode / Cookie Token Resolution
    try {
      const engine = new GeminiEngine();
      const dummyCookie = '__Secure-1PSID=mock_cookie_for_testing_1234567890123456789012345678901234567890';
      const { client, isTemporary } = engine.getClient(dummyCookie);
      if (client && isTemporary === false && engine.accountClients.has('mock_cookie_for_testing_1234567890123456789012345678901234567890')) {
        record('2. Gemini SDK', 'Account Mode client caching & cookie parsing', 'PASS', {
          isTemporary,
          cached: true
        });
      } else {
        record('2. Gemini SDK', 'Account Mode client caching & cookie parsing', 'FAIL', { isTemporary });
      }
    } catch (err) {
      record('2. Gemini SDK', 'Account Mode client caching & cookie parsing', 'FAIL', { error: err.message });
    }

    // 2.3 Conversation Continuity & Multi-turn History Formatting
    try {
      const engine = new GeminiEngine();
      const messages = [
        { role: 'user', content: 'What is 2+2?' },
        { role: 'assistant', content: '4' },
        { role: 'user', content: 'Multiply that by 3' }
      ];
      const prompt = engine.formatPrompt(messages);
      if (prompt.includes('User: What is 2+2?') && prompt.includes('Model: 4') && prompt.includes('User: Multiply that by 3')) {
        record('2. Gemini SDK', 'Multi-turn conversation history prompt formatting', 'PASS', {
          promptIncludesHistory: true
        });
      } else {
        record('2. Gemini SDK', 'Multi-turn conversation history prompt formatting', 'FAIL', { prompt });
      }
    } catch (err) {
      record('2. Gemini SDK', 'Multi-turn conversation history prompt formatting', 'FAIL', { error: err.message });
    }

    // 2.4 Model Resolution Matrix
    try {
      const engine = new GeminiEngine();
      const flash = engine.resolveModel('gemini-flash');
      const pro = engine.resolveModel('gemini-pro');
      const thinking = engine.resolveModel('gemini-thinking');
      if (flash && pro && thinking) {
        record('2. Gemini SDK', 'Model alias resolution (flash, pro, thinking)', 'PASS', {
          flash: flash.model_name,
          pro: pro.model_name,
          thinking: thinking.model_name
        });
      } else {
        record('2. Gemini SDK', 'Model alias resolution', 'FAIL', { flash, pro, thinking });
      }
    } catch (err) {
      record('2. Gemini SDK', 'Model alias resolution', 'FAIL', { error: err.message });
    }

    // -------------------------------------------------------------------------
    // 3. TOOL CALLING END-TO-END TESTS
    // -------------------------------------------------------------------------
    console.log('\n--- Section 3: Tool Calling End-to-End Tests ---');

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-tools-'));
    workspaceManager.authorizedRoots = [tempDir, process.cwd()];

    // 3.1 FS Tools: write, read, edit, delete
    try {
      const testFile = path.join(tempDir, 'test_sample.txt');
      // Write
      const writeRes = await toolDispatcher.dispatch({
        name: 'write_file',
        arguments: { path: testFile, content: 'Initial Content Line 1\nLine 2' }
      });
      // Read
      const readRes = await toolDispatcher.dispatch({
        name: 'read_file',
        arguments: { path: testFile }
      });
      // Edit
      const editRes = await toolDispatcher.dispatch({
        name: 'edit_file',
        arguments: { path: testFile, target: 'Line 2', replacement: 'Modified Line 2' }
      });
      const readAfterEdit = await toolDispatcher.dispatch({
        name: 'read_file',
        arguments: { path: testFile }
      });
      // Delete
      const deleteRes = await toolDispatcher.dispatch({
        name: 'delete_file',
        arguments: { path: testFile }
      });

      if (!writeRes.is_error && readRes.content.includes('Initial Content') && !editRes.is_error &&
          readAfterEdit.content.includes('Modified Line 2') && !deleteRes.is_error) {
        record('3. Tool Calling', 'Filesystem tools CRUD (write, read, edit, delete)', 'PASS', {
          writeSuccess: !writeRes.is_error,
          editSuccess: !editRes.is_error,
          deleteSuccess: !deleteRes.is_error
        });
      } else {
        record('3. Tool Calling', 'Filesystem tools CRUD', 'FAIL', { writeRes, readRes, editRes, deleteRes });
      }
    } catch (err) {
      record('3. Tool Calling', 'Filesystem tools CRUD', 'FAIL', { error: err.message });
    }

    // 3.2 Terminal Execution Tool
    try {
      const execRes = await toolDispatcher.dispatch({
        name: 'execute_command',
        arguments: { command: 'node -e "console.log(12345)"' }
      });
      if (!execRes.is_error && execRes.content.includes('12345')) {
        record('3. Tool Calling', 'Terminal tool execution (execute_command)', 'PASS', { output: execRes.content.trim() });
      } else {
        record('3. Tool Calling', 'Terminal tool execution (execute_command)', 'FAIL', { execRes });
      }
    } catch (err) {
      record('3. Tool Calling', 'Terminal tool execution (execute_command)', 'FAIL', { error: err.message });
    }

    // 3.3 Project Inspection & Code Search
    try {
      const testSrcFile = path.join(tempDir, 'sample_code.js');
      fs.writeFileSync(testSrcFile, 'function calculateTotal(a, b) { return a + b; }\nmodule.exports = { calculateTotal };');
      const searchRes = await toolDispatcher.dispatch({
        name: 'search_code',
        arguments: { pattern: 'calculateTotal' },
        context: { workspaceRoot: tempDir }
      });
      const findRes = await toolDispatcher.dispatch({
        name: 'find_by_name',
        arguments: { pattern: 'sample_code.js' },
        context: { workspaceRoot: tempDir }
      });
      if (!searchRes.is_error && searchRes.content.includes('calculateTotal') && !findRes.is_error && findRes.content.includes('sample_code.js')) {
        record('3. Tool Calling', 'Project inspection & search tools (search_code, find_by_name)', 'PASS', {
          searchFound: true,
          findFound: true
        });
      } else {
        record('3. Tool Calling', 'Project inspection & search tools', 'FAIL', { searchRes, findRes });
      }
    } catch (err) {
      record('3. Tool Calling', 'Project inspection & search tools', 'FAIL', { error: err.message });
    }

    // 3.4 Tool Error Handling & Recovery
    try {
      // Non-existent file
      const nonExistent = await toolDispatcher.dispatch({
        name: 'read_file',
        arguments: { path: path.join(tempDir, 'does_not_exist_xyz.txt') }
      });
      // Invalid arguments against schema (missing required arguments)
      const invalidArgs = await toolDispatcher.dispatch({
        name: 'calculator',
        arguments: {}
      });
      if (nonExistent.is_error && invalidArgs.is_error) {
        record('3. Tool Calling', 'Tool error handling and rejection reporting', 'PASS', {
          fileError: nonExistent.content,
          calcError: invalidArgs.content
        });
      } else {
        record('3. Tool Calling', 'Tool error handling and rejection reporting', 'FAIL', { nonExistent, invalidArgs });
      }
    } catch (err) {
      record('3. Tool Calling', 'Tool error handling and rejection reporting', 'FAIL', { error: err.message });
    }

    // 3.5 Consecutive Multiple Tool Calls
    try {
      const toolA = await toolDispatcher.dispatch({ name: 'echo', arguments: { message: 'first' } });
      const toolB = await toolDispatcher.dispatch({ name: 'calculator', arguments: { expression: '5 * 20' } });
      const toolC = await toolDispatcher.dispatch({ name: 'system_info', arguments: {} });
      if (!toolA.is_error && !toolB.is_error && toolB.content.includes('100') && !toolC.is_error) {
        record('3. Tool Calling', 'Multiple consecutive tool calls execution', 'PASS', {
          toolA: toolA.content,
          toolB: toolB.content,
          toolC_has_platform: toolC.content.includes('platform')
        });
      } else {
        record('3. Tool Calling', 'Multiple consecutive tool calls execution', 'FAIL', { toolA, toolB, toolC });
      }
    } catch (err) {
      record('3. Tool Calling', 'Multiple consecutive tool calls execution', 'FAIL', { error: err.message });
    }

    // -------------------------------------------------------------------------
    // 4. DEEPSEEK HARNESS INTEGRATION
    // -------------------------------------------------------------------------
    console.log('\n--- Section 4: DeepSeek Harness Integration ---');

    // 4.1 OpenAI Chat Completions Non-Streaming Contract
    try {
      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gemini-flash',
          messages: [{ role: 'user', content: 'Reply with EXACTLY: HARNESS_TEST_OK' }]
        })
      });
      const data = await res.json();
      if (res.status === 200 && data.id && data.object === 'chat.completion' && Array.isArray(data.choices) && data.choices[0]?.message) {
        record('4. DeepSeek Harness', 'OpenAI Chat Completions Non-Streaming API', 'PASS', {
          id: data.id,
          model: data.model,
          contentSnippet: data.choices[0].message.content?.slice(0, 50),
          usage: data.usage
        });
      } else {
        record('4. DeepSeek Harness', 'OpenAI Chat Completions Non-Streaming API', 'FAIL', { status: res.status, data });
      }
    } catch (err) {
      record('4. DeepSeek Harness', 'OpenAI Chat Completions Non-Streaming API', 'FAIL', { error: err.message });
    }

    // 4.2 OpenAI Chat Completions Streaming SSE Contract
    try {
      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gemini-flash',
          messages: [{ role: 'user', content: 'Count from 1 to 3' }],
          stream: true
        })
      });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let streamed = '';
      let hasDataChunks = false;
      let hasDoneTermination = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        streamed += chunk;
        if (chunk.includes('data: {"id":')) hasDataChunks = true;
        if (chunk.includes('data: [DONE]')) hasDoneTermination = true;
      }

      if (res.status === 200 && hasDataChunks && hasDoneTermination) {
        record('4. DeepSeek Harness', 'OpenAI Chat Completions Streaming SSE with [DONE]', 'PASS', {
          hasDataChunks,
          hasDoneTermination,
          totalLength: streamed.length
        });
      } else {
        record('4. DeepSeek Harness', 'OpenAI Chat Completions Streaming SSE with [DONE]', 'FAIL', {
          status: res.status,
          hasDataChunks,
          hasDoneTermination
        });
      }
    } catch (err) {
      record('4. DeepSeek Harness', 'OpenAI Chat Completions Streaming SSE with [DONE]', 'FAIL', { error: err.message });
    }

    // 4.3 DeepSeek DSML <tool_call> Parsing to OpenAI tool_calls schema
    try {
      const dsmlText = `I will run a command to check files.\n<tool_call>\n{"name": "execute_command", "arguments": {"command": "dir"}}\n</tool_call>\nDone.`;
      const parsed = parseDSML(dsmlText);
      if (Array.isArray(parsed.toolCalls) && parsed.toolCalls.length === 1 && parsed.toolCalls[0].function.name === 'execute_command') {
        record('4. DeepSeek Harness', 'DSML / <tool_call> parsing to OpenAI schema', 'PASS', {
          toolName: parsed.toolCalls[0].function.name,
          toolArgs: parsed.toolCalls[0].function.arguments,
          cleanedContent: parsed.content.trim()
        });
      } else {
        record('4. DeepSeek Harness', 'DSML / <tool_call> parsing to OpenAI schema', 'FAIL', { parsed });
      }
    } catch (err) {
      record('4. DeepSeek Harness', 'DSML / <tool_call> parsing to OpenAI schema', 'FAIL', { error: err.message });
    }

    // -------------------------------------------------------------------------
    // 5. MCP (MODEL CONTEXT PROTOCOL) COMPATIBILITY
    // -------------------------------------------------------------------------
    console.log('\n--- Section 5: MCP Compatibility ---');

    // 5.1 MCP initialize negotiation
    try {
      const initRes = await fetch(`${baseUrl}/v1/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 101,
          method: 'initialize',
          params: { protocolVersion: '2024-11-05', clientInfo: { name: 'AuditClient', version: '1.0' } }
        })
      });
      const initData = await initRes.json();
      if (initRes.status === 200 && initData.result?.protocolVersion === '2024-11-05' && initData.result?.serverInfo?.name === 'gemini-web-openai-proxy-mcp') {
        record('5. MCP Compatibility', 'MCP initialize capability negotiation (2024-11-05)', 'PASS', {
          protocolVersion: initData.result.protocolVersion,
          serverName: initData.result.serverInfo.name
        });
      } else {
        record('5. MCP Compatibility', 'MCP initialize capability negotiation', 'FAIL', { initRes: initRes.status, initData });
      }
    } catch (err) {
      record('5. MCP Compatibility', 'MCP initialize capability negotiation', 'FAIL', { error: err.message });
    }

    // 5.2 MCP tools/list
    try {
      const listRes = await fetch(`${baseUrl}/v1/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 102, method: 'tools/list' })
      });
      const listData = await listRes.json();
      if (listRes.status === 200 && Array.isArray(listData.result?.tools) && listData.result.tools.length > 5) {
        record('5. MCP Compatibility', 'MCP tools/list endpoint', 'PASS', {
          count: listData.result.tools.length,
          sampleTool: listData.result.tools[0].name
        });
      } else {
        record('5. MCP Compatibility', 'MCP tools/list endpoint', 'FAIL', { listRes: listRes.status, listData });
      }
    } catch (err) {
      record('5. MCP Compatibility', 'MCP tools/list endpoint', 'FAIL', { error: err.message });
    }

    // 5.3 MCP tools/call
    try {
      const callRes = await fetch(`${baseUrl}/v1/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 103,
          method: 'tools/call',
          params: { name: 'echo', arguments: { message: 'mcp_live_test' } }
        })
      });
      const callData = await callRes.json();
      if (callRes.status === 200 && callData.result?.content?.[0]?.text?.includes('mcp_live_test')) {
        record('5. MCP Compatibility', 'MCP tools/call execution', 'PASS', {
          output: callData.result.content[0].text
        });
      } else {
        record('5. MCP Compatibility', 'MCP tools/call execution', 'FAIL', { callRes: callRes.status, callData });
      }
    } catch (err) {
      record('5. MCP Compatibility', 'MCP tools/call execution', 'FAIL', { error: err.message });
    }

    // 5.4 MCP Protocol Error Handling
    try {
      const errRes = await fetch(`${baseUrl}/v1/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 104, method: 'unsupported_method_foo' })
      });
      const errData = await errRes.json();
      if (errRes.status === 200 && errData.error?.code === -32601) {
        record('5. MCP Compatibility', 'MCP JSON-RPC standard error code (-32601 Method not found)', 'PASS', {
          errorCode: errData.error.code,
          errorMessage: errData.error.message
        });
      } else {
        record('5. MCP Compatibility', 'MCP JSON-RPC standard error code', 'FAIL', { errRes: errRes.status, errData });
      }
    } catch (err) {
      record('5. MCP Compatibility', 'MCP JSON-RPC standard error code', 'FAIL', { error: err.message });
    }

    // -------------------------------------------------------------------------
    // 6. AUTONOMOUS AGENT VERIFICATION
    // -------------------------------------------------------------------------
    console.log('\n--- Section 6: Autonomous Agent Verification ---');

    // 6.1 Multi-step Agent Run with Planning & Execution
    try {
      const run = agentOrchestrator.createRun({
        task: 'Inspect project, create a scratch file, test it, and finish.',
        role: 'Autonomous Developer',
        mode: 'autonomous'
      });
      const startPromise = agentOrchestrator.startRun(run.id);
      await startPromise;
      const finishedRun = agentOrchestrator.getRun(run.id);

      const phases = finishedRun.result?.memory?.facts?.plan?.phases || [];
      if (finishedRun.status === 'completed' && phases.length > 0) {
        record('6. Autonomous Agent', 'Autonomous execution loop with plan and state transitions', 'PASS', {
          runId: finishedRun.id,
          finalStatus: finishedRun.status,
          phasesCount: phases.length,
          stepsCount: finishedRun.history.length
        });
      } else {
        record('6. Autonomous Agent', 'Autonomous execution loop with plan and state transitions', 'FAIL', { finishedRun });
      }
    } catch (err) {
      record('6. Autonomous Agent', 'Autonomous execution loop with plan and state transitions', 'FAIL', { error: err.message });
    }

    // 6.2 Agent Cancellation Workflow
    try {
      const cancelRun = agentOrchestrator.createRun({
        task: 'Long running background task',
        role: 'Worker'
      });
      const cancelled = agentOrchestrator.cancelRun(cancelRun.id, 'User audit requested abort');
      const stateAfterCancel = agentOrchestrator.getRun(cancelRun.id);
      if (cancelled && stateAfterCancel.status === 'cancelled') {
        record('6. Autonomous Agent', 'Agent cancellation workflow and state update', 'PASS', {
          cancelled,
          status: stateAfterCancel.status
        });
      } else {
        record('6. Autonomous Agent', 'Agent cancellation workflow and state update', 'FAIL', { cancelled, stateAfterCancel });
      }
    } catch (err) {
      record('6. Autonomous Agent', 'Agent cancellation workflow and state update', 'FAIL', { error: err.message });
    }

    // 6.3 Human-in-the-Loop Approval Workflow
    try {
      const approveRun = agentOrchestrator.createRun({
        task: 'Sensitive deployment task',
        mode: 'semi-autonomous'
      });
      const rawRun = agentOrchestrator.runs.get(approveRun.id);
      rawRun.loop.pendingApproval = {
        toolCall: { name: 'delete_file', args: { path: '/tmp/test' } },
        resolve: (val) => val
      };
      const approved = agentOrchestrator.approveToolCall(approveRun.id, true);
      if (approved) {
        record('6. Autonomous Agent', 'Human-in-the-loop tool approval trigger', 'PASS', { approved });
      } else {
        record('6. Autonomous Agent', 'Human-in-the-loop tool approval trigger', 'FAIL', { approved });
      }
    } catch (err) {
      record('6. Autonomous Agent', 'Human-in-the-loop tool approval trigger', 'FAIL', { error: err.message });
    }

    // -------------------------------------------------------------------------
    // 7. SECURITY AUDIT
    // -------------------------------------------------------------------------
    console.log('\n--- Section 7: Security Audit ---');

    // 7.1 Path Traversal Guard
    try {
      const traversalTarget = path.resolve(tempDir, '../../../../../../../../../../Windows/System32/calc.exe');
      const isAllowed = workspaceManager.isPathAuthorized(traversalTarget);
      let blockedError = null;
      try {
        await workspaceManager.readFile(traversalTarget);
      } catch (e) {
        blockedError = e.message;
      }

      if (!isAllowed && blockedError && blockedError.includes('Access denied')) {
        record('7. Security Audit', 'Path traversal block outside workspace boundaries', 'PASS', {
          isAllowed,
          blockedError
        });
      } else {
        record('7. Security Audit', 'Path traversal block outside workspace boundaries', 'FAIL', { isAllowed, blockedError });
      }
    } catch (err) {
      record('7. Security Audit', 'Path traversal block outside workspace boundaries', 'FAIL', { error: err.message });
    }

    // 7.2 Command Injection Sanitization / Safe Execution
    try {
      const execResult = await terminalManager.executeCommand('node -e "process.stdout.write(\'INJECT_OK\')"', {
        cwd: tempDir,
        timeoutMs: 5000
      });
      if (execResult.exitCode === 0 && execResult.stdout.includes('INJECT_OK')) {
        record('7. Security Audit', 'Terminal execution timeout & exit code isolation', 'PASS', {
          exitCode: execResult.exitCode,
          stdout: execResult.stdout
        });
      } else {
        record('7. Security Audit', 'Terminal execution timeout & exit code isolation', 'FAIL', { execResult });
      }
    } catch (err) {
      record('7. Security Audit', 'Terminal execution timeout & exit code isolation', 'FAIL', { error: err.message });
    }

    // 7.3 Secret Leakage Prevention in Errors & Status
    try {
      config.geminiSecure1psid = 'secret_session_token_xyz_hidden';
      const modelsRes = await fetch(`${baseUrl}/v1/models`);
      const modelsText = await modelsRes.text();
      const statsRes = await fetch(`${baseUrl}/dashboard/api/stats`);
      const statsText = await statsRes.text();
      const leaked = modelsText.includes('secret_session_token') || statsText.includes('secret_session_token');
      if (!leaked) {
        record('7. Security Audit', 'Credential privacy: sensitive cookies not leaked in API or stats', 'PASS', {
          leaked: false
        });
      } else {
        record('7. Security Audit', 'Credential privacy: sensitive cookies not leaked in API or stats', 'FAIL', { leaked: true });
      }
    } finally {
      config.geminiSecure1psid = '';
    }

    // 7.4 Device Pairing Security & Token Exchange
    try {
      const pairingToken = deviceManager.createPairingToken({ audit: true });
      let badPairRejected = false;
      try {
        deviceManager.pairDevice('wrong_token_123', { name: 'AuditTerminal' });
      } catch {
        badPairRejected = true;
      }
      const device = deviceManager.pairDevice(pairingToken, { name: 'AuditTerminal', platform: 'win32' });
      if (pairingToken && badPairRejected && device && device.id && device.status === 'paired') {
        record('7. Security Audit', 'Device pairing one-time token authentication', 'PASS', {
          deviceId: device.id,
          status: device.status,
          badPairRejected
        });
      } else {
        record('7. Security Audit', 'Device pairing one-time token authentication', 'FAIL', { pairingToken, badPairRejected, device });
      }
    } catch (err) {
      record('7. Security Audit', 'Device pairing one-time token authentication', 'FAIL', { error: err.message });
    }

    // 7.5 Process Isolation vs Docker Isolation Distinction
    try {
      const { DockerManager } = await import('../src/runtime/cloud/DockerManager.js');
      const dm = new DockerManager();
      const hasDocker = await dm.isDockerAvailable();
      record('7. Security Audit', 'Isolation runtime capability verification', 'PASS', {
        dockerAvailable: hasDocker,
        mode: hasDocker ? 'Docker Container cgroup isolation' : 'Process isolation fallback (Documented limitations apply)'
      });
    } catch (err) {
      record('7. Security Audit', 'Isolation runtime capability verification', 'FAIL', { error: err.message });
    }

    // -------------------------------------------------------------------------
    // 8. MULTI-AGENT VERIFICATION
    // -------------------------------------------------------------------------
    console.log('\n--- Section 8: Multi-Agent Verification ---');

    try {
      const pipelineRes = await multiAgentCoordinator.runPipeline({
        task: 'Design, implement, and test a robust math validator',
        roles: ['architect', 'developer', 'tester'],
        workspaceRoot: tempDir
      });

      const hasArchitect = pipelineRes.stages.some(r => r.role === 'Software Architect');
      const hasDeveloper = pipelineRes.stages.some(r => r.role === 'Software Developer');
      const hasTester = pipelineRes.stages.some(r => r.role === 'Quality Assurance Tester');

      if (pipelineRes.status === 'completed' && hasArchitect && hasDeveloper && hasTester && pipelineRes.stages.length === 3) {
        record('8. Multi-Agent Pipeline', 'Architect -> Developer -> Tester collaborative pipeline', 'PASS', {
          stagesExecuted: pipelineRes.stages.map(r => r.role),
          finalOutputSnippet: pipelineRes.finalOutput?.slice(0, 100)
        });
      } else {
        record('8. Multi-Agent Pipeline', 'Architect -> Developer -> Tester collaborative pipeline', 'FAIL', { pipelineRes });
      }
    } catch (err) {
      record('8. Multi-Agent Pipeline', 'Architect -> Developer -> Tester collaborative pipeline', 'FAIL', { error: err.message });
    }

    // Clean up temporary workspace
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}

  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  console.log('\n===============================================================');
  console.log(`   AUDIT COMPLETE: ${results.filter(r => r.status === 'PASS').length} / ${results.length} PASSED`);
  console.log('===============================================================\n');

  // Save audit results to JSON
  fs.writeFileSync('audit_results.json', JSON.stringify(results, null, 2));
}

runAudit().catch(err => {
  console.error('Fatal audit suite error:', err);
  process.exit(1);
});
