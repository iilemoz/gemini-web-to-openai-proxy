import express from 'express';
import cors from 'cors';
import { v1Router } from './routes/v1.js';
import { logger } from './utils/logger.js';

export const app = express();

// Middlewares
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.originalUrl}`);
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'Google Gemini Web to OpenAI Proxy', timestamp: new Date().toISOString() });
});

// Mount OpenAI v1 compatible routes
app.use('/v1', v1Router);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: {
      message: `Endpoint not found: ${req.method} ${req.originalUrl}`,
      type: 'invalid_request_error',
      code: 'not_found'
    }
  });
});
