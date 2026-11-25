import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
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

  // Provider & Model Identity Configuration
  enableLegacyProviderAliases: process.env.ENABLE_LEGACY_CROSS_PROVIDER_ALIASES === 'true',

  // Genuine Google Gemini model definitions
  models: [
    {
      id: 'gemini-flash',
      object: 'model',
      created: 1715500000,
      owned_by: 'google',
      permission: [],
      root: 'gemini-flash',
      parent: null,
      description: 'Google Gemini 2.5 Flash / Gemini 3 Flash (Fast & Pure HTTP)'
    },
    {
      id: 'gemini-2.5-flash',
      object: 'model',
      created: 1715500000,
      owned_by: 'google',
      permission: [],
      root: 'gemini-2.5-flash',
      parent: null,
      description: 'Google Gemini 2.5 Flash Flagship Speed Alias'
    },
    {
      id: 'gemini-pro',
      object: 'model',
      created: 1715500000,
      owned_by: 'google',
      permission: [],
      root: 'gemini-pro',
      parent: null,
      description: 'Google Gemini 2.5 Pro / Gemini 3 Pro (Complex Reasoning & Deep Knowledge)'
    },
    {
      id: 'gemini-2.5-pro',
      object: 'model',
      created: 1715500000,
      owned_by: 'google',
      permission: [],
      root: 'gemini-2.5-pro',
      parent: null,
      description: 'Google Gemini 2.5 Pro Alias'
    },
    {
      id: 'gemini-thinking',
      object: 'model',
      created: 1715500000,
      owned_by: 'google',
      permission: [],
      root: 'gemini-thinking',
      parent: null,
      description: 'Google Gemini Thinking with Deep Reasoning stream'
    },
    {
      id: 'gemini-2.5-thinking',
      object: 'model',
      created: 1715500000,
      owned_by: 'google',
      permission: [],
      root: 'gemini-2.5-thinking',
      parent: null,
      description: 'Google Gemini 2.5 Thinking Model'
    },
    {
      id: 'gemini-lite',
      object: 'model',
      created: 1715500000,
      owned_by: 'google',
      permission: [],
      root: 'gemini-lite',
      parent: null,
      description: 'Google Gemini Lite'
    }
  ]
};
