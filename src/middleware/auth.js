import crypto from 'node:crypto';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

/**
 * Constant-time string comparison using Node.js crypto.timingSafeEqual().
 * Prevents timing side-channel attacks by hashing both strings with SHA-256
 * into fixed 32-byte buffers before comparing.
 *
 * @param {string} suppliedToken
 * @param {string} expectedToken
 * @returns {boolean}
 */
export function safeCompareTokens(suppliedToken, expectedToken) {
  if (typeof suppliedToken !== 'string' || typeof expectedToken !== 'string') {
    return false;
  }

  // Pre-check for non-empty values
  if (!suppliedToken || !expectedToken) {
    return false;
  }

  // Hash both inputs using SHA-256 to produce fixed-length 32-byte buffers
  const hashA = crypto.createHash('sha256').update(suppliedToken, 'utf8').digest();
  const hashB = crypto.createHash('sha256').update(expectedToken, 'utf8').digest();

  // Perform constant-time buffer equality check
  const hashesMatch = crypto.timingSafeEqual(hashA, hashB);

  // Compare exact string lengths as an additional defensive safeguard
  return hashesMatch && (suppliedToken.length === expectedToken.length);
}

/**
 * Authentication Middleware for OpenAI API Gateway.
 *
 * Rules:
 * 1. If `config.proxyApiKey` is configured, all requests to protected routes
 *    MUST provide a matching Bearer token in the Authorization header or x-api-key.
 * 2. If `config.proxyApiKey` is NOT set, requests proceed in open development mode.
 * 3. In `NODE_ENV=production`, if `config.proxyApiKey` is empty, requests are
 *    rejected with HTTP 500 (`missing_production_api_key`) to fail closed.
 * 4. Separate proxy API authentication from Gemini Account cookie passthrough:
 *    - The proxy API token authorizes access to this server.
 *    - Gemini account cookies can be provided via `x-gemini-cookie` header,
 *      or via Bearer token ONLY when `ALLOW_COOKIE_PASSTHROUGH=true` and
 *      the token is a genuine Google __Secure-1PSID (starts with 'g.a.' or has length > 60).
 */
export function authMiddleware(req, res, next) {
  // If running in production mode and PROXY_API_KEY is not configured:
  // Refuse unauthenticated requests with HTTP 500 server_error.
  if (config.isProduction && !config.proxyApiKey) {
    logger.error('[Auth] Critical security configuration error: PROXY_API_KEY is not configured in production environment.');
    return res.status(500).json({
      error: {
        message: 'Proxy API key is not configured in production environment. Refusing unauthenticated requests.',
        type: 'server_error',
        code: 'missing_production_api_key'
      }
    });
  }

  const authHeader = req.headers['authorization'] || '';
  const apiKeyHeader = req.headers['x-api-key'] || '';

  let bearerToken = null;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    bearerToken = authHeader.slice(7).trim();
  } else if (typeof apiKeyHeader === 'string' && apiKeyHeader.trim()) {
    bearerToken = apiKeyHeader.trim();
  }

  // Enforce PROXY_API_KEY if configured
  if (config.proxyApiKey) {
    if (!bearerToken || !safeCompareTokens(bearerToken, config.proxyApiKey)) {
      logger.warn(`[Auth] Unauthorized access attempt from ${req.ip || 'unknown'} to ${req.originalUrl}`);
      return res.status(401).json({
        error: {
          message: 'Incorrect API key provided. You must provide a valid API key in the Authorization Bearer header.',
          type: 'invalid_request_error',
          param: null,
          code: 'invalid_api_key'
        }
      });
    }
  } else if (!config.isProduction) {
    // Development mode warning on unauthenticated request
    logger.warn(`[Auth] Unauthenticated request permitted in development mode from ${req.ip || 'unknown'} to ${req.originalUrl}`);
  }

  // Extract explicit Gemini cookie from custom headers if passed
  const customGeminiCookie = req.headers['x-gemini-cookie'] || req.headers['x-google-cookie'] || '';
  if (customGeminiCookie) {
    req.geminiCookie = customGeminiCookie;
  } else if (config.allowCookiePassthrough && bearerToken && (bearerToken.startsWith('g.a.') || bearerToken.includes('__Secure-1PSID'))) {
    req.geminiCookie = bearerToken;
  }

  next();
}
