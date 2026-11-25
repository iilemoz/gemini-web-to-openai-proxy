import crypto from 'node:crypto';
import { config } from '../config/index.js';

const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m'
};

function timestamp() {
  return new Date().toISOString().substring(11, 19);
}

// Case-insensitive list of sensitive header names to redact
const SENSITIVE_HEADER_KEYS = new Set([
  'authorization',
  'x-api-key',
  'x-gemini-cookie',
  'x-google-cookie',
  'cookie',
  'set-cookie',
  'proxy-authorization'
]);

// Known sensitive token patterns
const SENSITIVE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /__Secure-1PSID=[^;\s&"']+/gi,
  /__Secure-1PSIDTS=[^;\s&"']+/gi,
  /\bg\.a\.[A-Za-z0-9._-]{30,}\b/gi,
  /\bsk-[A-Za-z0-9_-]{20,}\b/gi
];

/**
 * Redacts known sensitive substring patterns from a string.
 * @param {string} str
 * @returns {string}
 */
export function redactSensitiveText(str) {
  if (typeof str !== 'string') return str;
  let result = str;

  // Redact configured secrets if present and sufficiently long (> 4 chars to avoid false positives)
  const secretsToRedact = [
    config?.proxyApiKey,
    config?.geminiSecure1psid,
    config?.geminiSecure1psidts
  ].filter(s => typeof s === 'string' && s.length > 4);

  for (const secret of secretsToRedact) {
    if (result.includes(secret)) {
      result = result.replaceAll(secret, '[REDACTED_SECRET]');
    }
  }

  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, (match) => {
      if (match.toLowerCase().startsWith('bearer ')) {
        return 'Bearer [REDACTED_TOKEN]';
      }
      if (match.includes('__Secure-1PSID=')) {
        return '__Secure-1PSID=[REDACTED]';
      }
      if (match.includes('__Secure-1PSIDTS=')) {
        return '__Secure-1PSIDTS=[REDACTED]';
      }
      return '[REDACTED_CREDENTIAL]';
    });
  }

  return result;
}

/**
 * Recursively sanitizes any JavaScript value (objects, errors, arrays, strings)
 * to ensure sensitive credentials and tokens are redacted.
 * @param {*} value
 * @param {Set<any>} [seen] - Cycle prevention set
 * @returns {*}
 */
export function sanitizeLogValue(value, seen = new Set()) {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return redactSensitiveText(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value;
  }

  if (typeof value === 'function') {
    return `[Function: ${value.name || 'anonymous'}]`;
  }

  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactSensitiveText(value.message || ''),
      code: value.code,
      status: value.status,
      stack: value.stack ? redactSensitiveText(value.stack) : undefined
    };
  }

  if (Array.isArray(value)) {
    return value.map(item => sanitizeLogValue(item, seen));
  }

  if (typeof value === 'object') {
    const cleanObj = {};
    for (const [key, val] of Object.entries(value)) {
      const lowerKey = key.toLowerCase();
      if (SENSITIVE_HEADER_KEYS.has(lowerKey)) {
        cleanObj[key] = '[REDACTED_HEADER]';
      } else {
        cleanObj[key] = sanitizeLogValue(val, seen);
      }
    }
    return cleanObj;
  }

  return String(value);
}

function formatLogArguments(args) {
  return args.map(arg => {
    const sanitized = sanitizeLogValue(arg);
    if (typeof sanitized === 'object' && sanitized !== null) {
      try {
        return JSON.stringify(sanitized);
      } catch {
        return String(sanitized);
      }
    }
    return sanitized;
  });
}

export const logger = {
  info(message, ...args) {
    const cleanMsg = redactSensitiveText(typeof message === 'string' ? message : JSON.stringify(sanitizeLogValue(message)));
    console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.cyan}INFO${colors.reset}  ${cleanMsg}`, ...formatLogArguments(args));
  },
  success(message, ...args) {
    const cleanMsg = redactSensitiveText(typeof message === 'string' ? message : JSON.stringify(sanitizeLogValue(message)));
    console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.green}PASS${colors.reset}  ${cleanMsg}`, ...formatLogArguments(args));
  },
  warn(message, ...args) {
    const cleanMsg = redactSensitiveText(typeof message === 'string' ? message : JSON.stringify(sanitizeLogValue(message)));
    console.warn(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.yellow}WARN${colors.reset}  ${cleanMsg}`, ...formatLogArguments(args));
  },
  error(message, ...args) {
    const cleanMsg = redactSensitiveText(typeof message === 'string' ? message : JSON.stringify(sanitizeLogValue(message)));
    console.error(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.red}ERR!${colors.reset}  ${cleanMsg}`, ...formatLogArguments(args));
  },
  debug(message, ...args) {
    if (process.env.DEBUG === 'true') {
      const cleanMsg = redactSensitiveText(typeof message === 'string' ? message : JSON.stringify(sanitizeLogValue(message)));
      console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.magenta}DBUG${colors.reset}  ${cleanMsg}`, ...formatLogArguments(args));
    }
  }
};
