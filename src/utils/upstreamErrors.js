/**
 * Utility for detecting internal upstream Google Gemini Web error fallback strings
 * and formatting standardized upstream operational errors.
 *
 * When Gemini Web has a transient session or guest failure, it yields an apologetic
 * error sentence instead of throwing an HTTP error.
 */

export const UPSTREAM_ERROR_PATTERNS = [
  /I seem to be encountering an error/i,
  /I encountered an error doing what you asked/i,
  /Something went wrong on our end/i,
  /An internal error occurred/i,
  /I cannot process this request right now/i,
  /I'm sorry, but I'm unable to process this request/i
];

/**
 * Checks whether text matches a generic upstream model failure message.
 * Guarded by length check so genuine user discussions about errors are not rejected.
 * @param {string} text
 * @returns {boolean}
 */
export function isUpstreamErrorText(text) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 300) return false;
  return UPSTREAM_ERROR_PATTERNS.some(p => p.test(trimmed));
}

/**
 * Maps upstream provider errors to OpenAI-compatible error objects without
 * conflating proxy-level API key failures with upstream Gemini session failures (Finding H32-04).
 *
 * @param {Error|any} err
 * @returns {{ status: number, body: { error: { message: string, type: string, code: string } } }}
 */
export function mapUpstreamError(err) {
  const status = err?.status || (err?.code === 'upstream_unavailable' ? 502 : 500);
  const errMsg = err?.message || 'Error communicating with upstream Gemini provider';

  // Session / Authentication Failure with Google Gemini Web
  if (status === 401 || err?.code === 'AUTH_FAILED' || /auth|cookie|session|login/i.test(errMsg)) {
    return {
      status: 502,
      body: {
        error: {
          message: 'Upstream Google Gemini Web session authentication failed. Please update GEMINI_SECURE_1PSID or session cookies.',
          type: 'upstream_error',
          code: 'gemini_session_expired'
        }
      }
    };
  }

  // Rate Limiting from Google
  if (status === 429 || /rate limit|quota/i.test(errMsg)) {
    return {
      status: 429,
      body: {
        error: {
          message: 'Upstream Google Gemini rate limit exceeded. Please retry after a brief moment.',
          type: 'insufficient_quota',
          code: 'rate_limit_exceeded'
        }
      }
    };
  }

  // Timeout / Gateway
  if (status === 504 || /timeout/i.test(errMsg)) {
    return {
      status: 504,
      body: {
        error: {
          message: 'Upstream Google Gemini request timed out.',
          type: 'upstream_error',
          code: 'request_timeout'
        }
      }
    };
  }

  // Anti-bot 405 error
  if (status === 405) {
    return {
      status: 502,
      body: {
        error: {
          message: 'Upstream Google Gemini request rejected (anti-bot gate). Please refresh session cookies.',
          type: 'upstream_error',
          code: 'upstream_rejected'
        }
      }
    };
  }

  // Generic upstream error
  return {
    status: status >= 400 && status < 600 ? status : 500,
    body: {
      error: {
        message: errMsg,
        type: status === 502 ? 'upstream_error' : 'api_error',
        code: err?.code || 'internal_error'
      }
    }
  };
}
