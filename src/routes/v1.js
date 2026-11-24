import { Router } from 'express';
import { handleChatCompletion } from '../controllers/chatController.js';
import { listModels, getModel } from '../controllers/modelsController.js';
import { handleResponses } from '../controllers/responsesController.js';
import { authMiddleware } from '../middleware/auth.js';
import { validateChatCompletionRequest } from '../middleware/validation.js';
import { rateLimiter } from '../middleware/rateLimiter.js';

export const v1Router = Router();

// Apply auth and rate limiting to all /v1 routes
v1Router.use(authMiddleware);
v1Router.use(rateLimiter);

// ── Chat Completions ─────────────────────────────────────────────────────────
v1Router.post('/chat/completions', validateChatCompletionRequest, handleChatCompletion);

// ── Responses API ────────────────────────────────────────────────────────────
v1Router.post('/responses', handleResponses);

// ── Models ───────────────────────────────────────────────────────────────────
v1Router.get('/models', listModels);
v1Router.get('/models/:model', getModel);

// ── Tools ────────────────────────────────────────────────────────────────────
v1Router.get('/tools', async (req, res) => {
  const { toolRegistry } = await import('../tools/index.js');
  res.json({
    object: 'list',
    data: toolRegistry.list()
  });
});

// ── Runtime Devices & Sessions ───────────────────────────────────────────────
v1Router.get('/runtime/devices', async (req, res) => {
  const { deviceManager } = await import('../runtime/index.js');
  res.json({ object: 'list', data: deviceManager.listDevices() });
});

v1Router.post('/runtime/devices/pair', async (req, res) => {
  const { deviceManager } = await import('../runtime/index.js');
  const { token, name, platform } = req.body || {};
  if (!token) {
    // Generate a new pairing token
    const newToken = deviceManager.createPairingToken({ name, platform });
    return res.json({ token: newToken, expires_in: 600 });
  }
  try {
    const device = deviceManager.pairDevice(token, { name, platform });
    res.json({ status: 'paired', device });
  } catch (err) {
    res.status(400).json({ error: { message: err.message, type: 'invalid_request_error' } });
  }
});

v1Router.post('/runtime/devices/:id/revoke', async (req, res) => {
  const { deviceManager } = await import('../runtime/index.js');
  const success = deviceManager.revokeDevice(req.params.id);
  res.json({ status: success ? 'revoked' : 'not_found' });
});

v1Router.get('/runtime/sessions', async (req, res) => {
  const { sessionManager } = await import('../runtime/index.js');
  res.json({ object: 'list', data: sessionManager.listSessions() });
});

v1Router.post('/runtime/sessions', async (req, res) => {
  const { sessionManager } = await import('../runtime/index.js');
  const session = sessionManager.createSession(req.body);
  res.json(session);
});

v1Router.get('/runtime/sessions/:id', async (req, res) => {
  const { sessionManager } = await import('../runtime/index.js');
  const session = sessionManager.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: { message: 'Session not found' } });
  res.json(session);
});

v1Router.delete('/runtime/sessions/:id', async (req, res) => {
  const { sessionManager } = await import('../runtime/index.js');
  const deleted = sessionManager.deleteSession(req.params.id);
  res.json({ status: deleted ? 'deleted' : 'not_found' });
});

// ── Cloud Runtime ────────────────────────────────────────────────────────────
v1Router.get('/runtime/cloud/status', async (req, res) => {
  const { cloudRuntime } = await import('../runtime/index.js');
  res.json(await cloudRuntime.checkStatus());
});

v1Router.post('/runtime/cloud/sandboxes', async (req, res) => {
  const { cloudRuntime } = await import('../runtime/index.js');
  try {
    const sandbox = await cloudRuntime.createSandbox(req.body);
    res.status(201).json(sandbox);
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

v1Router.post('/runtime/cloud/sandboxes/:id/exec', async (req, res) => {
  const { cloudRuntime } = await import('../runtime/index.js');
  try {
    const result = await cloudRuntime.execute(req.params.id, req.body?.command, req.body);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: { message: err.message } });
  }
});

v1Router.delete('/runtime/cloud/sandboxes/:id', async (req, res) => {
  const { cloudRuntime } = await import('../runtime/index.js');
  const destroyed = await cloudRuntime.destroy(req.params.id);
  res.json({ status: destroyed ? 'destroyed' : 'not_found' });
});

// ── Agent Orchestrator API ──────────────────────────────────────────────────
v1Router.get('/agents', (req, res) => {
  res.json({
    object: 'list',
    data: [
      { id: 'architect', name: 'Software Architect', description: 'System design, diagrams, and architectural specifications' },
      { id: 'developer', name: 'Software Developer', description: 'Full-stack development, bug fixing, and feature implementation' },
      { id: 'debugger', name: 'Debugger & Diagnostics', description: 'Root-cause analysis, log investigation, and test fixing' },
      { id: 'reviewer', name: 'Code Reviewer', description: 'Code quality audits, security checks, and standard enforcement' },
      { id: 'tester', name: 'Quality Assurance Tester', description: 'Unit testing, integration testing, and test automation' }
    ]
  });
});

v1Router.get('/agent/runs', async (req, res) => {
  const { agentOrchestrator } = await import('../agent/index.js');
  res.json({ object: 'list', data: agentOrchestrator.listRuns() });
});

v1Router.post('/agent/runs', async (req, res) => {
  const { agentOrchestrator } = await import('../agent/index.js');
  try {
    const run = agentOrchestrator.createRun(req.body || {});
    // If client requested synchronous execution (default is async start)
    const runPromise = agentOrchestrator.startRun(run.id);
    if (req.query.wait === 'true') {
      await runPromise;
      return res.json(agentOrchestrator.getRun(run.id));
    }
    res.status(202).json({ id: run.id, status: run.status });
  } catch (err) {
    res.status(400).json({ error: { message: err.message, type: 'invalid_request_error' } });
  }
});

v1Router.get('/agent/runs/:id', async (req, res) => {
  const { agentOrchestrator } = await import('../agent/index.js');
  const run = agentOrchestrator.getRun(req.params.id);
  if (!run) return res.status(404).json({ error: { message: 'Agent run not found' } });
  res.json(run);
});

v1Router.post('/agent/runs/:id/cancel', async (req, res) => {
  const { agentOrchestrator } = await import('../agent/index.js');
  try {
    const success = agentOrchestrator.cancelRun(req.params.id, req.body?.reason);
    res.json({ status: success ? 'cancelled' : 'failed' });
  } catch (err) {
    res.status(404).json({ error: { message: err.message } });
  }
});

v1Router.post('/agent/runs/:id/approve', async (req, res) => {
  const { agentOrchestrator } = await import('../agent/index.js');
  try {
    const success = agentOrchestrator.approveToolCall(req.params.id, req.body?.approved !== false);
    res.json({ status: success ? 'approved' : 'no_pending_tool' });
  } catch (err) {
    res.status(404).json({ error: { message: err.message } });
  }
});

