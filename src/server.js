import http from 'node:http';
import { app } from './app.js';
import { config } from './config/index.js';
import { validateStartupConfig } from './config/validator.js';
import { logger } from './utils/logger.js';
import { requestTracker } from './utils/requestTracker.js';
import { readiness } from './utils/readiness.js';
import { stopRateLimiterCleanup } from './middleware/rateLimiter.js';

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
  if (requestTracker.isShuttingDown) return true;
  logger.info(`Starting graceful shutdown (grace period: ${gracePeriodMs}ms)...`);
  
  // Mark server as not ready and initiate request tracking shutdown
  readiness.setInitialized(false);
  requestTracker.startShutdown();
  stopRateLimiterCleanup();

  if (serverInstance && typeof serverInstance.close === 'function') {
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
  const validation = validateStartupConfig(config);
  if (!validation.valid) {
    for (const err of validation.errors) {
      logger.error(`[StartupValidation] ${err}`);
    }
    process.exit(1);
  }

  server.listen(config.port, config.host, () => {
    readiness.setInitialized(true);
    console.log(banner);
    logger.success(`Server listening on ${config.host}:${config.port} (IPv4 & IPv6 dual-stack)`);
  });

  let shutdownInProgress = false;
  const handleTermination = async (signal) => {
    if (shutdownInProgress) return;
    shutdownInProgress = true;
    logger.info(`Received ${signal}. Initiating graceful shutdown...`);
    await gracefulShutdown(server, config.shutdownGracePeriodMs);
    process.exit(0);
  };

  process.on('SIGINT', () => handleTermination('SIGINT'));
  process.on('SIGTERM', () => handleTermination('SIGTERM'));
}
