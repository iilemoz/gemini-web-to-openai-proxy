import http from 'node:http';
import { app } from './app.js';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { requestTracker } from './utils/requestTracker.js';

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

export const server = http.createServer(app);

// Programmatic graceful shutdown function for production and automated testing
export async function gracefulShutdown(serverInstance = server, gracePeriodMs = config.shutdownGracePeriodMs) {
  if (requestTracker.isShuttingDown) return;
  logger.info(`Starting graceful shutdown (grace period: ${gracePeriodMs}ms)...`);
  requestTracker.startShutdown();

  if (serverInstance && serverInstance.close) {
    serverInstance.close(() => {
      logger.info('HTTP server closed to new connections.');
    });
  }

  const startTime = Date.now();
  while (requestTracker.getActiveCount() > 0 && (Date.now() - startTime) < gracePeriodMs) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  if (requestTracker.getActiveCount() > 0) {
    logger.warn(`Grace period expired with ${requestTracker.getActiveCount()} active requests. Aborting all remaining requests.`);
    requestTracker.abortAll('Shutdown grace period expired');
  } else {
    logger.info('All in-flight requests completed cleanly.');
  }

  return true;
}

// Only start listening if executed directly as entrypoint (not when imported in test suites)
const isDirectRun = Boolean(
  process.argv[1] &&
  (process.argv[1].endsWith('server.js') || process.argv[1].endsWith('server'))
);

if (isDirectRun && process.env.NODE_ENV !== 'test') {
  if (config.isProduction && !config.proxyApiKey) {
    logger.error('CRITICAL SECURITY ERROR: PROXY_API_KEY must be configured when running in production mode (NODE_ENV=production).');
    process.exit(1);
  }

  server.listen(config.port, config.host, () => {
    console.log(banner);
    logger.success(`Server listening on ${config.host}:${config.port} (IPv4 & IPv6 dual-stack)`);
  });

  const handleTermination = async (signal) => {
    logger.info(`Received ${signal}. Initiating graceful shutdown...`);
    await gracefulShutdown(server, config.shutdownGracePeriodMs);
    process.exit(0);
  };

  process.on('SIGINT', () => handleTermination('SIGINT'));
  process.on('SIGTERM', () => handleTermination('SIGTERM'));
}
