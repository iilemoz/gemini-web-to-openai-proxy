import { logger } from './logger.js';

/**
 * Calculates exponential backoff with optional full jitter.
 * @param {number} attempt - Current attempt (1-based)
 * @param {number} initialDelayMs - Base delay in ms
 * @param {number} maxDelayMs - Maximum delay cap in ms
 * @param {boolean} [withJitter=true] - Add random jitter to prevent thundering herd
 * @returns {number} Delay in milliseconds
 */
export function calculateBackoff(attempt, initialDelayMs = 500, maxDelayMs = 8000, withJitter = true) {
  const exponential = initialDelayMs * Math.pow(2, attempt - 1);
  const capped = Math.min(exponential, maxDelayMs);
  if (!withJitter) {
    return capped;
  }
  // Full jitter: uniformly distributed between 0.5 * capped and 1.5 * capped
  const min = capped * 0.5;
  const max = capped * 1.5;
  return Math.floor(min + Math.random() * (max - min));
}

/**
 * Parses HTTP Retry-After header value into milliseconds.
 * Supports both delta-seconds (e.g. "30") and HTTP-date formats.
 * @param {string|number|undefined|null} headerValue
 * @returns {number|null} Delay in ms, or null if invalid/unspecified
 */
export function parseRetryAfter(headerValue) {
  if (headerValue == null || headerValue === '') {
    return null;
  }

  // Delta-seconds (numeric)
  const seconds = Number(headerValue);
  if (!Number.isNaN(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 60000); // Cap at 60 seconds
  }

  // HTTP-date format
  const dateMs = Date.parse(String(headerValue));
  if (!Number.isNaN(dateMs)) {
    const diff = dateMs - Date.now();
    return diff > 0 ? Math.min(diff, 60000) : 0;
  }

  return null;
}

/**
 * Determines whether an HTTP status code is safe and appropriate to retry.
 * @param {number} status
 * @returns {boolean}
 */
export function isRetryableStatusCode(status) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

/**
 * Determines whether an error is transient and safe to retry.
 * Permanent client errors (400, 401, 403, 404, 422) and user AbortErrors are NEVER retried.
 * @param {Error|Object} err
 * @returns {boolean}
 */
export function isRetryableError(err) {
  if (!err) return false;

  // Never retry user cancellations or intentional aborts
  if (err.name === 'AbortError' || err.message?.includes('aborted') || err.message?.includes('cancelled')) {
    return false;
  }

  // Check HTTP status code
  const status = err.status || err.statusCode || err.response?.status;
  if (typeof status === 'number') {
    if (status === 400 || status === 401 || status === 403 || status === 404 || status === 422 || err.code === 'insufficient_quota') {
      return false; // Permanent client / quota exhaustion errors
    }
    return isRetryableStatusCode(status);
  }

  // Network / socket level transient errors
  const code = err.code || err.cause?.code;
  const transientCodes = new Set([
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'EAI_AGAIN',
    'ENOTFOUND',
    'UND_ERR_SOCKET',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT'
  ]);
  if (code && transientCodes.has(code)) {
    return true;
  }

  // Rate limit or capacity error message patterns
  const msg = String(err.message || '').toLowerCase();
  if (
    msg.includes('429') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('overloaded') ||
    msg.includes('503 service unavailable') ||
    msg.includes('502 bad gateway') ||
    msg.includes('socket hang up')
  ) {
    return true;
  }

  return false;
}

/**
 * Executes an async operation with exponential backoff and jitter.
 *
 * @template T
 * @param {function(number): Promise<T>} operation - Function receiving attempt index (1-based)
 * @param {Object} [options]
 * @param {number} [options.maxAttempts=3] - Maximum retry attempts
 * @param {number} [options.initialDelayMs=500] - Base delay in ms
 * @param {number} [options.maxDelayMs=8000] - Maximum delay cap in ms
 * @param {boolean} [options.jitter=true] - Apply full jitter
 * @param {AbortSignal} [options.signal] - Abort signal to cancel retry loop
 * @param {function(number, number, Error): void} [options.onRetry] - Observability hook on retry
 * @returns {Promise<T>}
 */
export async function executeWithRetry(operation, options = {}) {
  const {
    maxAttempts = 3,
    initialDelayMs = 500,
    maxDelayMs = 8000,
    jitter = true,
    signal,
    onRetry
  } = options;

  let attempt = 1;

  while (attempt <= maxAttempts) {
    if (signal?.aborted) {
      const abortError = new Error('Operation aborted prior to execution');
      abortError.name = 'AbortError';
      throw abortError;
    }

    try {
      return await operation(attempt);
    } catch (err) {
      // Check if we can retry
      const isLastAttempt = attempt >= maxAttempts;
      const canRetry = !isLastAttempt && !signal?.aborted && isRetryableError(err);

      if (!canRetry) {
        if (signal?.aborted && err.name !== 'AbortError') {
          const abortError = new Error(signal.reason?.message || 'Operation aborted');
          abortError.name = 'AbortError';
          abortError.cause = err;
          throw abortError;
        }
        throw err;
      }

      // Check for Retry-After header on error response if present
      const retryAfterHeader = err.response?.headers?.get?.('retry-after') || err.retryAfter;
      const retryAfterMs = parseRetryAfter(retryAfterHeader);

      const delayMs = retryAfterMs != null
        ? retryAfterMs
        : calculateBackoff(attempt, initialDelayMs, maxDelayMs, jitter);

      const statusCode = err.status || err.statusCode || err.response?.status || 'network';
      logger.warn(
        `[Retry] Attempt ${attempt}/${maxAttempts} failed (${statusCode}: ${err.message || 'error'}). Retrying in ${delayMs}ms...`
      );

      if (typeof onRetry === 'function') {
        try {
          onRetry(attempt, delayMs, err);
        } catch {
          // Ignore logger/hook errors
        }
      }

      // Sleep with abort signal support
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, delayMs);
        if (signal) {
          const onAbort = () => {
            clearTimeout(timer);
            const abortError = new Error('Operation aborted during backoff delay');
            abortError.name = 'AbortError';
            reject(abortError);
          };
          signal.addEventListener('abort', onAbort, { once: true });
        }
      });

      attempt++;
    }
  }

  throw new Error(`Exhausted maximum retry attempts (${maxAttempts})`);
}
