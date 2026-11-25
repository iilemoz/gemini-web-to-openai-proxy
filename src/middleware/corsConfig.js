import cors from 'cors';
import { config } from '../config/index.js';

/**
 * Creates a production-hardened CORS middleware.
 *
 * Rules:
 * 1. Development Mode (`NODE_ENV !== 'production'`):
 *    - Defaults to `*` to facilitate rapid local IDE and browser client prototyping.
 * 2. Production Mode (`NODE_ENV === 'production'`):
 *    - If `CORS_ORIGIN` is explicitly set to an origin or comma-separated list of origins:
 *      Validates `req.headers.origin` and reflects ONLY approved origins with `Vary: Origin`.
 *    - If `CORS_ORIGIN` is not configured (or set to empty):
 *      Denies arbitrary browser cross-origin requests (no Access-Control-Allow-Origin header).
 *    - If `CORS_ORIGIN` is explicitly `*`:
 *      Permits wildcard with `credentials: false`.
 * 3. Non-Browser Clients (IDE extensions Continue, Cline, Roo Code, curl, backend scripts):
 *    - Do not send an `Origin` header. Allowed unconditionally.
 * 4. Never combines wildcard origins with `credentials: true`.
 *
 * @returns {import('express').RequestHandler}
 */
export function createCorsMiddleware() {
  const corsOriginConfig = (typeof config.corsOrigin === 'string') ? config.corsOrigin.trim() : '';

  // In development, default to wildcard if unspecified
  const effectiveOrigin = corsOriginConfig || (config.isProduction ? '' : '*');

  if (effectiveOrigin === '*') {
    return cors({
      origin: '*',
      credentials: false
    });
  }

  if (!effectiveOrigin) {
    // In production with no CORS origin configured:
    // Allow non-browser requests (no Origin header), disallow browser cross-origin requests
    return cors({
      origin: (origin, callback) => {
        if (!origin) {
          return callback(null, true);
        }
        return callback(null, false);
      },
      credentials: false
    });
  }

  const allowedOrigins = effectiveOrigin
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);

  return cors({
    origin: (origin, callback) => {
      // Non-browser client (no Origin header)
      if (!origin) {
        return callback(null, true);
      }
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: false
  });
}
