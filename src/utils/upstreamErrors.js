/**
 * Utility for detecting internal upstream Google Gemini Web error fallback strings.
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
