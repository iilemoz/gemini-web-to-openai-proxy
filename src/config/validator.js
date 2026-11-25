/**
 * Validates application startup configuration.
 * Safe for operational diagnostics without leaking sensitive secret values.
 *
 * @param {import('./index.js').config} cfg
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateStartupConfig(cfg) {
  const errors = [];

  // Port validation
  if (!Number.isInteger(cfg.port) || cfg.port <= 0 || cfg.port > 65535) {
    errors.push(`Invalid PORT configuration: "${cfg.port}". Must be an integer between 1 and 65535.`);
  }

  // Host validation
  if (!cfg.host || typeof cfg.host !== 'string' || cfg.host.trim().length === 0) {
    errors.push(`Invalid HOST configuration: "${cfg.host}". Must be a non-empty string.`);
  }

  // Production API key enforcement
  if (cfg.isProduction && (!cfg.proxyApiKey || typeof cfg.proxyApiKey !== 'string' || cfg.proxyApiKey.trim().length === 0)) {
    errors.push('CRITICAL: PROXY_API_KEY must be configured when running in production mode (NODE_ENV=production).');
  }

  // Timeout validations
  if (typeof cfg.connectionTimeoutMs === 'number' && cfg.connectionTimeoutMs < 0) {
    errors.push(`Invalid UPSTREAM_CONNECT_TIMEOUT_MS: "${cfg.connectionTimeoutMs}". Must be >= 0.`);
  }

  if (typeof cfg.requestTimeoutMs === 'number' && cfg.requestTimeoutMs < 0) {
    errors.push(`Invalid REQUEST_TIMEOUT_MS: "${cfg.requestTimeoutMs}". Must be >= 0.`);
  }

  if (typeof cfg.streamingIdleTimeoutMs === 'number' && cfg.streamingIdleTimeoutMs < 0) {
    errors.push(`Invalid STREAMING_IDLE_TIMEOUT_MS: "${cfg.streamingIdleTimeoutMs}". Must be >= 0.`);
  }

  if (typeof cfg.shutdownGracePeriodMs === 'number' && cfg.shutdownGracePeriodMs < 0) {
    errors.push(`Invalid SHUTDOWN_GRACE_PERIOD_MS: "${cfg.shutdownGracePeriodMs}". Must be >= 0.`);
  }

  // Model definitions validation
  if (!Array.isArray(cfg.models) || cfg.models.length === 0) {
    errors.push('Configuration must define at least one valid canonical model.');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
