import express from 'express';
import cors from 'cors';
import { v1Router } from './routes/v1.js';
import { logger } from './utils/logger.js';
import { config } from './config/index.js';

export const app = express();

// Middlewares
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.originalUrl}`);
  next();
});

// Standard health endpoints
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Google Gemini Web to OpenAI Proxy',
    timestamp: new Date().toISOString()
  });
});

app.get('/healthz', (req, res) => {
  res.status(200).send('OK');
});

// Mount OpenAI v1 compatible routes
app.use('/v1', v1Router);

// Global 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: {
      message: `Endpoint not found: ${req.method} ${req.originalUrl}`,
      type: 'invalid_request_error',
      code: 'not_found'
    }
  });
});
