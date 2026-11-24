import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toolRegistry } from '../tools/index.js';
import { agentOrchestrator } from '../agent/index.js';
import { deviceManager, containerManager } from '../runtime/index.js';
import { config } from '../config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const dashboardRouter = Router();

// Serve the dashboard HTML UI
dashboardRouter.get('/', async (req, res) => {
  try {
    const html = await fs.readFile(path.join(__dirname, 'index.html'), 'utf8');
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    res.status(500).send(`Failed to load dashboard: ${err.message}`);
  }
});

// JSON stats API powering the dashboard
dashboardRouter.get('/api/stats', (req, res) => {
  const models = Object.keys(config.modelAliases || {}).map(alias => ({
    id: alias,
    object: 'model',
    created: 1700000000,
    owned_by: 'gemini'
  }));

  const tools = toolRegistry.list();
  const agentRuns = agentOrchestrator.listRuns();
  const devices = deviceManager.listDevices();
  const sandboxes = containerManager.listSandboxes();

  res.json({
    status: 'healthy',
    uptimeSeconds: Math.floor(process.uptime()),
    nodeVersion: process.version,
    platform: process.platform,
    models,
    tools,
    agentRuns,
    devices,
    sandboxes
  });
});
