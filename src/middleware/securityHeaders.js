/**
 * Security headers middleware for the OpenAI-compatible proxy gateway.
 * Implements defensive HTTP response headers without requiring external dependencies
 * or interfering with Server-Sent Events (SSE) streaming.
 */

export function securityHeaders(req, res, next) {
  // Prevent MIME-type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Prevent clickjacking / framing
  res.setHeader('X-Frame-Options', 'DENY');

  // Do not leak referrer header to external origins
  res.setHeader('Referrer-Policy', 'no-referrer');

  // Restrict cross-origin resource loading
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

  // Modern XSS filter directive (disable buggy legacy audit mode)
  res.setHeader('X-XSS-Protection', '0');

  // Restrict browser features and sensors
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');

  // Restrict content security policy for API endpoints while permitting self resources
  res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");

  next();
}
