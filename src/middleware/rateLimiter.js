import { config } from '../config/index.js';

const ipHits = new Map();
let cleanupTimer = null;

/**
 * Cleans up expired rate-limit IP records.
 * Bounded operation that preserves active client windows.
 * @param {number} [now]
 * @returns {number} Number of expired entries removed
 */
export function cleanupExpiredRecords(now = Date.now()) {
  const windowMs = config.rateLimitWindowMs || 60000;
  let removedCount = 0;

  for (const [ip, record] of ipHits.entries()) {
    if (!record || (now - record.startTime) > windowMs) {
      ipHits.delete(ip);
      removedCount++;
    }
  }

  return removedCount;
}

/**
 * Starts the periodic rate limiter cleanup timer if not already running.
 * The timer is unref'd so it does not keep the Node.js process alive.
 * @param {number} [intervalMs]
 */
export function startRateLimiterCleanup(intervalMs = 60000) {
  if (cleanupTimer) {
    return; // Prevent duplicate timers
  }

  cleanupTimer = setInterval(() => {
    cleanupExpiredRecords();
  }, intervalMs);

  // Unref so test processes or background workers can exit cleanly
  if (typeof cleanupTimer.unref === 'function') {
    cleanupTimer.unref();
  }
}

/**
 * Stops the periodic rate limiter cleanup timer during shutdown or test teardown.
 */
export function stopRateLimiterCleanup() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

/**
 * Returns the current count of tracked IP records (useful for testing).
 * @returns {number}
 */
export function getRateLimitMapSize() {
  return ipHits.size;
}

// Automatically start background cleanup
startRateLimiterCleanup(config.rateLimitWindowMs || 60000);

/**
 * Lightweight in-memory rate limiter middleware.
 * Configured via RATE_LIMIT_MAX (default 120 requests) and RATE_LIMIT_WINDOW_MS (default 60000ms).
 */
export function rateLimiter(req, res, next) {
  if (!config.rateLimitEnabled) {
    return next();
  }

  const now = Date.now();
  const clientIp = req.ip || req.connection?.remoteAddress || '127.0.0.1';
  const windowMs = config.rateLimitWindowMs || 60000;
  const maxRequests = config.rateLimitMax || 120;

  let record = ipHits.get(clientIp);
  if (!record || (now - record.startTime) > windowMs) {
    record = { startTime: now, count: 0 };
    ipHits.set(clientIp, record);
  }

  record.count++;

  if (record.count > maxRequests) {
    res.setHeader('Retry-After', Math.ceil((record.startTime + windowMs - now) / 1000));
    return res.status(429).json({
      error: {
        message: 'Rate limit exceeded. Please slow down your requests.',
        type: 'rate_limit_error',
        param: null,
        code: 'rate_limit_exceeded'
      }
    });
  }

  next();
}

/** Reset rate limit records (useful for testing) */
export function resetRateLimits() {
  ipHits.clear();
}
