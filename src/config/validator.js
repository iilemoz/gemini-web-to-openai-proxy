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

  // Production API key enforcement (Finding H32-01)
  if (cfg.isProduction) {
    if (!cfg.proxyApiKey || typeof cfg.proxyApiKey !== 'string' || cfg.proxyApiKey.trim().length === 0) {
      errors.push('CRITICAL: PROXY_API_KEY must be configured when running in production mode (NODE_ENV=production).');
    } else if (cfg.proxyApiKey.trim().length < 16) {
      errors.push('CRITICAL: PROXY_API_KEY must be at least 16 characters in production mode.');
    }
  }

  // Timeout validations (Finding H32-02)
  const validateTimeout = (val, name, minMs = 1000) => {
    if (val === undefined || val === null) return;
    if (typeof val !== 'number' || !Number.isInteger(val) || Number.isNaN(val) || !Number.isFinite(val)) {
      errors.push(`Invalid ${name}: "${val}". Must be a valid integer number of milliseconds.`);
    } else if (val < minMs) {
      errors.push(`Invalid ${name}: "${val}". Must be at least ${minMs}ms.`);
    } else if (val > 86400000) {
      errors.push(`Invalid ${name}: "${val}". Exceeds maximum allowable duration of 86400000ms (24h).`);
    }
  };

  validateTimeout(cfg.connectionTimeoutMs, 'UPSTREAM_CONNECT_TIMEOUT_MS', 1000);
  validateTimeout(cfg.requestTimeoutMs, 'REQUEST_TIMEOUT_MS', 1000);
  validateTimeout(cfg.streamingIdleTimeoutMs, 'STREAMING_IDLE_TIMEOUT_MS', 1000);
  validateTimeout(cfg.shutdownGracePeriodMs, 'SHUTDOWN_TIMEOUT_MS', 1000);

  // Model definitions validation (Finding H32-03)
  const REQUIRED_CANONICAL_MODELS = ['gemini-flash', 'gemini-pro', 'gemini-thinking', 'gemini-lite'];
  if (!Array.isArray(cfg.models) || cfg.models.length === 0) {
    errors.push('Configuration must define at least one valid canonical model.');
  } else {
    const modelIds = new Set();
    for (const model of cfg.models) {
      if (!model || typeof model !== 'object' || !model.id || typeof model.id !== 'string') {
        errors.push('Each model entry must be an object with a non-empty "id" property.');
        continue;
      }
      if (modelIds.has(model.id)) {
        errors.push(`Duplicate canonical model identifier detected: "${model.id}".`);
      }
      modelIds.add(model.id);
    }

    // When in production mode or when configured with full canonical registry, ensure all canonical models exist
    if (cfg.isProduction) {
      for (const canonicalId of REQUIRED_CANONICAL_MODELS) {
        if (!modelIds.has(canonicalId)) {
          errors.push(`Missing required canonical model definition: "${canonicalId}".`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
