import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: (process.env.NODE_ENV || 'development') === 'production',
  defaultModel: process.env.DEFAULT_MODEL || 'gemini-flash',
  geminiSecure1psid: process.env.GEMINI_SECURE_1PSID || '',
  geminiSecure1psidts: process.env.GEMINI_SECURE_1PSIDTS || '',
  proxyApiKey: process.env.PROXY_API_KEY || '',
  allowCookiePassthrough: process.env.ALLOW_COOKIE_PASSTHROUGH === 'true',
  rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== 'false',
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '120', 10),
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  upstreamProxy: process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.PROXY || '',

  // Reliability, Timeout, and Lifecycle Configurations
  connectionTimeoutMs: parseInt(process.env.UPSTREAM_CONNECT_TIMEOUT_MS || '15000', 10),
  requestTimeoutMs: parseInt(process.env.REQUEST_TIMEOUT_MS || '120000', 10),
  streamingIdleTimeoutMs: parseInt(process.env.STREAMING_IDLE_TIMEOUT_MS || '60000', 10),
  shutdownGracePeriodMs: parseInt(process.env.SHUTDOWN_GRACE_PERIOD_MS || '15000', 10),
  retryMaxAttempts: parseInt(process.env.RETRY_MAX_ATTEMPTS || '3', 10),
  retryInitialDelayMs: parseInt(process.env.RETRY_INITIAL_DELAY_MS || '500', 10),
  retryMaxDelayMs: parseInt(process.env.RETRY_MAX_DELAY_MS || '8000', 10),
  retryJitter: process.env.RETRY_JITTER !== 'false',

  // Genuine Google Gemini canonical model definitions
  models: [
    {
      id: 'gemini-flash',
      object: 'model',
      created: 1715500000,
      owned_by: 'google',
      permission: [],
      root: 'gemini-flash',
      parent: null,
      description: 'Google Gemini Flash (Web)'
    },
    {
      id: 'gemini-pro',
      object: 'model',
      created: 1715500000,
      owned_by: 'google',
      permission: [],
      root: 'gemini-pro',
      parent: null,
      description: 'Google Gemini Pro (Web)'
    },
    {
      id: 'gemini-thinking',
      object: 'model',
      created: 1715500000,
      owned_by: 'google',
      permission: [],
      root: 'gemini-thinking',
      parent: null,
      description: 'Google Gemini Thinking (Web)'
    },
    {
      id: 'gemini-lite',
      object: 'model',
      created: 1715500000,
      owned_by: 'google',
      permission: [],
      root: 'gemini-lite',
      parent: null,
      description: 'Google Gemini Lite (Web)'
    }
  ]
};
