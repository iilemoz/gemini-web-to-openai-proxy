/**
 * Multimodal & Media Content Utilities.
 * Handles validation, SSRF checks, normalization, and conversion of OpenAI-compatible
 * multimodal message content blocks (text and image_url parts).
 */

export const MULTIMODAL_LIMITS = {
  MAX_IMAGES_PER_REQUEST: 10,
  MAX_BASE64_BYTES: 20 * 1024 * 1024, // 20 MB
  MAX_BASE64_CHARS: Math.ceil((20 * 1024 * 1024) * 4 / 3) + 256,
  ALLOWED_IMAGE_MIME_TYPES: new Set([
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/gif'
  ]),
  ALLOWED_IMAGE_DETAILS: new Set(['auto', 'low', 'high'])
};

/**
 * Checks if a given hostname or IP is a reserved, loopback, or cloud-metadata address (SSRF guard).
 * @param {string} hostname
 * @returns {boolean}
 */
export function isBlockedSsrfHost(hostname) {
  if (!hostname || typeof hostname !== 'string') return true;
  const host = hostname.trim().toLowerCase();

  // Loopback and local hostnames
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') {
    return true;
  }

  // AWS/GCP/Azure link-local metadata endpoint
  if (host === '169.254.169.254' || host.startsWith('169.254.')) {
    return true;
  }

  // IPv4 Private addresses
  // 10.0.0.0 - 10.255.255.255
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  // 172.16.0.0 - 172.31.255.255
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  // 192.168.0.0 - 192.168.255.255
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;

  // Local domains
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan')) {
    return true;
  }

  return false;
}

/**
 * Validate an image_url string or object.
 * @param {string|{ url: string, detail?: string }} imageUrlValue
 * @returns {{ valid: boolean, error?: string, code?: string, normalizedUrl?: string, isDataUri?: boolean, mimeType?: string, detail?: string }}
 */
export function validateImageUrl(imageUrlValue) {
  let urlStr = '';
  let detail = 'auto';

  if (typeof imageUrlValue === 'string') {
    urlStr = imageUrlValue.trim();
  } else if (imageUrlValue && typeof imageUrlValue === 'object') {
    if (typeof imageUrlValue.url !== 'string') {
      return {
        valid: false,
        error: 'Missing or invalid "url" in image_url object.',
        code: 'invalid_image_url'
      };
    }
    urlStr = imageUrlValue.url.trim();

    if (imageUrlValue.detail !== undefined) {
      if (!MULTIMODAL_LIMITS.ALLOWED_IMAGE_DETAILS.has(imageUrlValue.detail)) {
        return {
          valid: false,
          error: `Invalid image detail '${imageUrlValue.detail}'. Must be one of: auto, low, high.`,
          code: 'invalid_image_detail'
        };
      }
      detail = imageUrlValue.detail;
    }
  } else {
    return {
      valid: false,
      error: 'image_url must be a string or an object with a "url" property.',
      code: 'invalid_image_url'
    };
  }

  if (!urlStr) {
    return {
      valid: false,
      error: 'image_url cannot be empty.',
      code: 'empty_image_url'
    };
  }

  // Handle data URI
  if (urlStr.startsWith('data:')) {
    const dataUriMatch = urlStr.match(/^data:([^;,]+);base64,(.+)$/s);
    if (!dataUriMatch) {
      return {
        valid: false,
        error: 'Invalid data URI: must follow "data:image/<type>;base64,<data>" format.',
        code: 'invalid_data_uri'
      };
    }

    const mimeType = dataUriMatch[1].toLowerCase();
    const base64Data = dataUriMatch[2].replace(/\s+/g, '');

    if (!MULTIMODAL_LIMITS.ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
      return {
        valid: false,
        error: `Unsupported image MIME type '${mimeType}'. Supported: ${Array.from(MULTIMODAL_LIMITS.ALLOWED_IMAGE_MIME_TYPES).join(', ')}.`,
        code: 'unsupported_image_type'
      };
    }

    if (base64Data.length > MULTIMODAL_LIMITS.MAX_BASE64_CHARS) {
      return {
        valid: false,
        error: `Image payload exceeds maximum allowed size of ${MULTIMODAL_LIMITS.MAX_BASE64_BYTES / (1024 * 1024)}MB.`,
        code: 'image_too_large'
      };
    }

    // Basic base64 character set validation
    if (!/^[A-Za-z0-9+/=]+$/.test(base64Data)) {
      return {
        valid: false,
        error: 'Invalid base64 payload in data URI.',
        code: 'invalid_base64_payload'
      };
    }

    return {
      valid: true,
      normalizedUrl: `data:${mimeType};base64,${base64Data}`,
      isDataUri: true,
      mimeType,
      detail
    };
  }

  // Handle HTTP / HTTPS URL
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    return {
      valid: false,
      error: `Invalid URL format: '${urlStr}'.`,
      code: 'invalid_url_format'
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      valid: false,
      error: `Unsupported protocol '${parsed.protocol}' in image URL. Only http and https are allowed.`,
      code: 'unsupported_image_protocol'
    };
  }

  if (isBlockedSsrfHost(parsed.hostname)) {
    return {
      valid: false,
      error: `Invalid image URL host '${parsed.hostname}': private, local, and metadata addresses are prohibited.`,
      code: 'ssrf_prohibited_host'
    };
  }

  return {
    valid: true,
    normalizedUrl: parsed.href,
    isDataUri: false,
    mimeType: null,
    detail
  };
}

/**
 * Validates a message content value (string or array of parts).
 * @param {string|Array<Object>} content
 * @returns {{
 *   valid: boolean,
 *   error?: string,
 *   code?: string,
 *   param?: string,
 *   textParts: string[],
 *   imageParts: Array<{ url: string, isDataUri: boolean, mimeType?: string, detail: string }>,
 *   hasImages: boolean
 * }}
 */
export function validateContent(content) {
  if (typeof content === 'string') {
    return {
      valid: true,
      textParts: [content],
      imageParts: [],
      hasImages: false
    };
  }

  if (!Array.isArray(content)) {
    return {
      valid: false,
      error: 'Message content must be either a string or an array of content parts.',
      code: 'invalid_content_type',
      param: 'content',
      textParts: [],
      imageParts: [],
      hasImages: false
    };
  }

  const textParts = [];
  const imageParts = [];

  for (let j = 0; j < content.length; j++) {
    const part = content[j];
    if (!part || typeof part !== 'object') {
      return {
        valid: false,
        error: `Content part at index ${j} must be an object.`,
        code: 'invalid_content_part',
        param: `content[${j}]`,
        textParts: [],
        imageParts: [],
        hasImages: false
      };
    }

    if (!part.type || typeof part.type !== 'string') {
      return {
        valid: false,
        error: `Content part at index ${j} is missing required 'type' field.`,
        code: 'missing_part_type',
        param: `content[${j}].type`,
        textParts: [],
        imageParts: [],
        hasImages: false
      };
    }

    if (part.type === 'text') {
      if (typeof part.text !== 'string') {
        return {
          valid: false,
          error: `Content part at index ${j} of type 'text' must have a string 'text' property.`,
          code: 'invalid_text_part',
          param: `content[${j}].text`,
          textParts: [],
          imageParts: [],
          hasImages: false
        };
      }
      textParts.push(part.text);

    } else if (part.type === 'image_url' || part.type === 'image') {
      const imgVal = part.image_url || part.image;
      const valRes = validateImageUrl(imgVal);
      if (!valRes.valid) {
        return {
          valid: false,
          error: `Content part at index ${j}: ${valRes.error}`,
          code: valRes.code || 'invalid_image_part',
          param: `content[${j}].image_url`,
          textParts: [],
          imageParts: [],
          hasImages: false
        };
      }
      imageParts.push({
        url: valRes.normalizedUrl,
        isDataUri: valRes.isDataUri,
        mimeType: valRes.mimeType,
        detail: valRes.detail
      });

    } else {
      return {
        valid: false,
        error: `Unsupported content part type '${part.type}' at index ${j}. Expected 'text' or 'image_url'.`,
        code: 'unsupported_part_type',
        param: `content[${j}].type`,
        textParts: [],
        imageParts: [],
        hasImages: false
      };
    }
  }

  return {
    valid: true,
    textParts,
    imageParts,
    hasImages: imageParts.length > 0
  };
}

/**
 * Check if an array of messages contains any multimodal (image) content.
 * @param {Array<Object>} messages
 * @returns {boolean}
 */
export function hasMultimodalContent(messages) {
  if (!Array.isArray(messages)) return false;
  for (const msg of messages) {
    if (Array.isArray(msg?.content)) {
      for (const part of msg.content) {
        if (part && (part.type === 'image_url' || part.type === 'image')) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Count total number of images across an array of messages.
 * @param {Array<Object>} messages
 * @returns {number}
 */
export function countImagesInMessages(messages) {
  if (!Array.isArray(messages)) return 0;
  let count = 0;
  for (const msg of messages) {
    if (Array.isArray(msg?.content)) {
      for (const part of msg.content) {
        if (part && (part.type === 'image_url' || part.type === 'image')) {
          count++;
        }
      }
    }
  }
  return count;
}

/**
 * Extract all public HTTP/HTTPS image URLs from messages array.
 * @param {Array<Object>} messages
 * @returns {string[]}
 */
export function extractHttpImageUrls(messages) {
  const urls = [];
  if (!Array.isArray(messages)) return urls;

  for (const msg of messages) {
    if (!Array.isArray(msg?.content)) continue;
    for (const part of msg.content) {
      if (part?.type === 'image_url' || part?.type === 'image') {
        const rawUrl = part.image_url?.url || part.image_url || part.image?.url || part.image || '';
        if (typeof rawUrl === 'string' && (rawUrl.startsWith('http://') || rawUrl.startsWith('https://'))) {
          urls.push(rawUrl);
        }
      }
    }
  }

  return urls;
}

/**
 * Format message content into a text representation for Gemini prompt injection.
 * @param {string|Array<Object>} content
 * @returns {string}
 */
export function formatContentToPromptText(content) {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map(part => {
      if (!part) return '';
      if (part.type === 'text') return (part.text || '').trim();
      if (part.type === 'image_url' || part.type === 'image') {
        const rawUrl = part.image_url?.url || part.image_url || part.image?.url || part.image || '';
        if (!rawUrl) return '[Attached image]';
        if (rawUrl.startsWith('data:')) {
          const mimeMatch = rawUrl.match(/^data:([^;,]+);/);
          const mime = mimeMatch ? mimeMatch[1] : 'image';
          return `[Attached image (${mime}, base64)]`;
        }
        return `[Attached image: ${rawUrl}]`;
      }
      return JSON.stringify(part);
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

/**
 * Truncate text according to stop sequences.
 * @param {string} text
 * @param {string|string[]} stop
 * @returns {{ text: string, stopped: boolean, stopSequence: string|null }}
 */
export function applyStopSequences(text, stop) {
  if (!text || !stop) {
    return { text: text || '', stopped: false, stopSequence: null };
  }

  const stopList = Array.isArray(stop) ? stop : [stop];
  let earliestIndex = -1;
  let matchedSeq = null;

  for (const s of stopList) {
    if (!s || typeof s !== 'string') continue;
    const idx = text.indexOf(s);
    if (idx !== -1 && (earliestIndex === -1 || idx < earliestIndex)) {
      earliestIndex = idx;
      matchedSeq = s;
    }
  }

  if (earliestIndex !== -1) {
    return {
      text: text.slice(0, earliestIndex),
      stopped: true,
      stopSequence: matchedSeq
    };
  }

  return { text, stopped: false, stopSequence: null };
}

/**
 * Creates a streaming filter that buffers potential stop sequence prefixes and
 * truncates when a complete stop sequence is encountered.
 *
 * @param {string|string[]} stop
 * @param {(text: string) => void} onTextChunk
 * @returns {{ push: (chunk: string) => void, flush: () => void, isStopped: () => boolean }}
 */
export function createStreamingStopFilter(stop, onTextChunk) {
  if (!stop) {
    return {
      push: (text) => onTextChunk(text),
      flush: () => {},
      isStopped: () => false
    };
  }

  const stopList = (Array.isArray(stop) ? stop : [stop]).filter(s => typeof s === 'string' && s.length > 0);
  if (stopList.length === 0) {
    return {
      push: (text) => onTextChunk(text),
      flush: () => {},
      isStopped: () => false
    };
  }

  let buffer = '';
  let stopped = false;
  const maxStopLen = Math.max(...stopList.map(s => s.length));

  return {
    push: (chunk) => {
      if (stopped || !chunk) return;
      buffer += chunk;

      // Check if any stop sequence is fully present
      let earliestIdx = -1;
      for (const s of stopList) {
        const idx = buffer.indexOf(s);
        if (idx !== -1 && (earliestIdx === -1 || idx < earliestIdx)) {
          earliestIdx = idx;
        }
      }

      if (earliestIdx !== -1) {
        stopped = true;
        const textToEmit = buffer.slice(0, earliestIdx);
        if (textToEmit) onTextChunk(textToEmit);
        buffer = '';
        return;
      }

      // Check if tail matches prefix of any stop sequence
      let keepLen = 0;
      for (let len = Math.min(buffer.length, maxStopLen - 1); len > 0; len--) {
        const tail = buffer.slice(-len);
        if (stopList.some(s => s.startsWith(tail))) {
          keepLen = len;
          break;
        }
      }

      const emitLen = buffer.length - keepLen;
      if (emitLen > 0) {
        const textToEmit = buffer.slice(0, emitLen);
        onTextChunk(textToEmit);
        buffer = buffer.slice(emitLen);
      }
    },
    flush: () => {
      if (!stopped && buffer.length > 0) {
        onTextChunk(buffer);
        buffer = '';
      }
    },
    isStopped: () => stopped
  };
}

