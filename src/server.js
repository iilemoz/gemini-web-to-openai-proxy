import http from 'node:http';
import { app } from './app.js';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';

const banner = `
===========================================================
🚀 Google Gemini Web to OpenAI API Proxy (Pure HTTP)
===========================================================
⚡ Mode: ${config.geminiSecure1psid ? 'Account Mode (Logged In)' : 'Guest Mode (No Login Required)'}
📡 Local Endpoint : http://localhost:${config.port}/v1
🌐 Chat Endpoint  : http://localhost:${config.port}/v1/chat/completions
📋 Models Endpoint: http://localhost:${config.port}/v1/models
🤖 Default Model  : ${config.defaultModel}
===========================================================
`;

const server = http.createServer(app);

server.listen(config.port, () => {
  console.log(banner);
  logger.success(`Server listening on port ${config.port} (IPv4 & IPv6 dual-stack)`);
});

process.on('SIGINT', () => {
  logger.info('Shutting down server...');
  server.close(() => {
    logger.info('Server closed. Goodbye!');
    process.exit(0);
  });
});
