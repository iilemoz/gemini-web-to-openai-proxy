import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

/**
 * Authentication Middleware for OpenAI API Gateway.
 *
 * Rules:
 * 1. If `config.proxyApiKey` is configured, all requests to protected routes
 *    MUST provide a matching Bearer token in the Authorization header or x-api-key.
 * 2. If `config.proxyApiKey` is NOT set, requests proceed in open development mode.
 * 3. Separate proxy API authentication from Gemini Account cookie passthrough:
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
  if (authHeader.startsWith('Bearer ')) {
    bearerToken = authHeader.slice(7).trim();
  } else if (apiKeyHeader) {
    bearerToken = apiKeyHeader.trim();
  }

  // Enforce PROXY_API_KEY if configured
  if (config.proxyApiKey) {
    if (!bearerToken || bearerToken !== config.proxyApiKey) {
      logger.warn(`[Auth] Unauthorized access attempt from ${req.ip} to ${req.originalUrl}`);
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
    logger.warn(`[Auth] Unauthenticated request permitted in development mode from ${req.ip} to ${req.originalUrl}`);
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
