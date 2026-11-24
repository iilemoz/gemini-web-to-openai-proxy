import { config } from '../config/index.js';

const ipHits = new Map();

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
  if (!record || now - record.startTime > windowMs) {
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
