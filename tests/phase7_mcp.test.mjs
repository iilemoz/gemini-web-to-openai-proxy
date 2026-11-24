import test from 'node:test';
import assert from 'node:assert/strict';
import { mcpServer, MCPClient } from '../src/integrations/mcp/index.js';
import { toolRegistry, toolDispatcher } from '../src/tools/index.js';
import { app } from '../src/app.js';
import http from 'node:http';

test('MCPServer handles initialize, ping, and tools/list via JSON-RPC 2.0', async () => {
  // 1. initialize
  const initRes = await mcpServer.handleMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {}
  });
  assert.equal(initRes.jsonrpc, '2.0');
  assert.equal(initRes.id, 1);
  assert.equal(initRes.result.serverInfo.name, 'gemini-web-openai-proxy-mcp');
  assert.ok(initRes.result.capabilities.tools);

  // 2. ping
  const pingRes = await mcpServer.handleMessage({
    jsonrpc: '2.0',
    id: 2,
    method: 'ping'
  });
  assert.equal(pingRes.id, 2);
  assert.deepEqual(pingRes.result, {});

  // 3. tools/list
  const listRes = await mcpServer.handleMessage({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/list'
  });
  assert.equal(listRes.id, 3);
  assert.ok(Array.isArray(listRes.result.tools));
  assert.ok(listRes.result.tools.some(t => t.name === 'calculator'));
});

test('MCPServer handles tools/call and returns formatted result', async () => {
  const callRes = await mcpServer.handleMessage({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'calculator',
      arguments: { expression: '100 / 4' }
    }
  });

  assert.equal(callRes.id, 4);
  assert.equal(callRes.result.isError, false);
  assert.ok(callRes.result.content[0].text.includes('25'));
});

test('MCPClient connects to MCP server and imports remote tools', async () => {
  // Mock remote server transport
  const mockTransport = {
    send: async (msg) => {
      if (msg.method === 'initialize') {
        return { jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05' } };
      }
      if (msg.method === 'tools/list') {
        return {
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            tools: [
              {
                name: 'remote_weather',
                description: 'Fetches mock weather for city',
                inputSchema: {
                  type: 'object',
                  properties: { city: { type: 'string' } }
                }
              }
            ]
          }
        };
      }
      if (msg.method === 'tools/call') {
        return {
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            content: [{ type: 'text', text: `Weather for ${msg.params.arguments.city}: 22C Sunny` }]
          }
        };
      }
      return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Not found' } };
    }
  };

  const client = new MCPClient({ name: 'MockWeatherServer', transport: mockTransport });
  await client.connect();

  assert.equal(client.connected, true);
  assert.equal(client.tools.length, 1);

  // Verify tool was registered in global registry
  const registered = toolRegistry.get('remote_weather');
  assert.ok(registered);

  // Dispatch tool through toolDispatcher
  const dispatchRes = await toolDispatcher.dispatch({
    name: 'remote_weather',
    arguments: { city: 'Cairo' }
  });

  assert.equal(dispatchRes.is_error, false);
  assert.ok(dispatchRes.content.includes('Cairo: 22C Sunny'));
});

test('HTTP POST /v1/mcp endpoint handles JSON-RPC 2.0 requests', async () => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: {
          name: 'echo',
          arguments: { message: 'hello mcp http' }
        }
      })
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.id, 10);
    assert.equal(body.result.isError, false);
    assert.ok(body.result.content[0].text.includes('hello mcp http'));

  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
