/**
 * Text-only validator utility.
 * Enforces strict text-only payloads across all endpoints (/v1/chat/completions and /v1/responses).
 * Strictly rejects image payloads, base64 data URIs, markdown image embeds, and non-text modalities,
 * while cleanly permitting legitimate text containing image URLs, CSS, HTML, and file paths.
 */

const BASE64_IMAGE_DATA_URI_REGEX = /data:image\/[a-zA-Z0-9.+_-]+;base64,[A-Za-z0-9+/=]+/i;
const MARKDOWN_IMAGE_REGEX = /!\[.*?\]\(\s*(?:https?:\/\/[^\s)"]+|data:image\/[^\s)"]+)(?:\s+["'][^"']*["'])?\s*\)/i;

/**
 * Checks if a string or object represents an image payload.
 * Does NOT reject legitimate text merely mentioning http(s) URLs with image extensions.
 *
 * @param {*} value
 * @returns {boolean}
 */
export function isImagePayload(value) {
  if (!value) return false;

  if (typeof value === 'string') {
    // 1. Standalone or embedded base64 image data URI
    if (BASE64_IMAGE_DATA_URI_REGEX.test(value)) {
      return true;
    }
    // 2. Explicit markdown image syntax: ![alt](url)
    if (MARKDOWN_IMAGE_REGEX.test(value)) {
      return true;
    }
    return false;
  }

  if (typeof value === 'object') {
    if (
      value.type === 'image_url' ||
      value.type === 'image' ||
      Boolean(value.image_url) ||
      Boolean(value.image)
    ) {
      return true;
    }
    // Check if object has url that is a data:image URI
    if (typeof value.url === 'string' && BASE64_IMAGE_DATA_URI_REGEX.test(value.url)) {
      return true;
    }
  }

  return false;
}

/**
 * Standard error response builders
 */
export function buildImageUnsupportedError(param = 'messages') {
  return {
    status: 400,
    body: {
      error: {
        message: 'Image and multimodal inputs are not supported. This proxy only accepts text-based requests.',
        type: 'invalid_request_error',
        param,
        code: 'image_input_unsupported'
      }
    }
  };
}

export function buildUnsupportedContentTypeError(type = 'unknown', param = 'messages') {
  return {
    status: 400,
    body: {
      error: {
        message: `Unsupported content part type '${type}'. This proxy only accepts text-based requests.`,
        type: 'invalid_request_error',
        param,
        code: 'unsupported_content_type'
      }
    }
  };
}

/**
 * Validates a single content part.
 * Returns null if valid, or an error object { status, body } if invalid.
 *
 * @param {*} part
 * @param {string} paramPrefix
 * @returns {{ status: number, body: Object } | null}
 */
export function validateContentPart(part, paramPrefix = 'messages') {
  if (typeof part === 'string') {
    if (isImagePayload(part)) {
      return buildImageUnsupportedError(paramPrefix);
    }
    return null;
  }

  if (!part || typeof part !== 'object') {
    return {
      status: 400,
      body: {
        error: {
          message: `Invalid content part at ${paramPrefix}: must be an object or string.`,
          type: 'invalid_request_error',
          param: paramPrefix,
          code: 'invalid_content_part'
        }
      }
    };
  }

  // Check structured image types first
  if (isImagePayload(part)) {
    return buildImageUnsupportedError(paramPrefix);
  }

  // Check content type
  if (part.type !== 'text') {
    return buildUnsupportedContentTypeError(part.type || 'unknown', `${paramPrefix}.type`);
  }

  // Check part.text
  if (typeof part.text !== 'string') {
    return {
      status: 400,
      body: {
        error: {
          message: `Invalid text part at ${paramPrefix}: 'text' must be a string.`,
          type: 'invalid_request_error',
          param: `${paramPrefix}.text`,
          code: 'invalid_content'
        }
      }
    };
  }

  if (isImagePayload(part.text)) {
    return buildImageUnsupportedError(`${paramPrefix}.text`);
  }

  return null;
}

/**
 * Validates message content (string or array of parts).
 *
 * @param {*} content
 * @param {string} paramPrefix
 * @returns {{ status: number, body: Object } | null}
 */
export function validateMessageContent(content, paramPrefix = 'messages') {
  if (typeof content === 'string') {
    if (isImagePayload(content)) {
      return buildImageUnsupportedError(paramPrefix);
    }
    return null;
  }

  if (Array.isArray(content)) {
    if (content.length === 0) {
      return {
        status: 400,
        body: {
          error: {
            message: `Invalid message content at ${paramPrefix}: array must not be empty.`,
            type: 'invalid_request_error',
            param: paramPrefix,
            code: 'empty_content_array'
          }
        }
      };
    }

    for (let j = 0; j < content.length; j++) {
      const err = validateContentPart(content[j], `${paramPrefix}[${j}]`);
      if (err) return err;
    }
    return null;
  }

  return {
    status: 400,
    body: {
      error: {
        message: `Invalid message content at ${paramPrefix}: content must be a string or array of text objects.`,
        type: 'invalid_request_error',
        param: paramPrefix,
        code: 'invalid_content'
      }
    }
  };
}

/**
 * Validates input for /v1/responses endpoint.
 * Accepts string, array of strings, array of messages/parts, or structured content.
 *
 * @param {*} input
 * @param {string} paramPrefix
 * @returns {{ status: number, body: Object } | null}
 */
export function validateResponsesInput(input, paramPrefix = 'input') {
  if (typeof input === 'string') {
    if (isImagePayload(input)) {
      return buildImageUnsupportedError(paramPrefix);
    }
    return null;
  }

  if (Array.isArray(input)) {
    if (input.length === 0) {
      return {
        status: 400,
        body: {
          error: {
            message: 'Invalid request: "input" array must not be empty.',
            type: 'invalid_request_error',
            param: paramPrefix,
            code: 'empty_input_array'
          }
        }
      };
    }

    for (let idx = 0; idx < input.length; idx++) {
      const item = input[idx];
      const itemParam = `${paramPrefix}[${idx}]`;

      if (typeof item === 'string') {
        if (isImagePayload(item)) {
          return buildImageUnsupportedError(itemParam);
        }
        continue;
      }

      if (item && typeof item === 'object') {
        if (isImagePayload(item)) {
          return buildImageUnsupportedError(itemParam);
        }

        // If it's a message-like object: { role, content }
        if (item.content !== undefined && item.content !== null) {
          const err = validateMessageContent(item.content, `${itemParam}.content`);
          if (err) return err;
          continue;
        }

        // If it's a part-like object: { type, text }
        if (item.type !== undefined) {
          const err = validateContentPart(item, itemParam);
          if (err) return err;
          continue;
        }
      } else {
        return {
          status: 400,
          body: {
            error: {
              message: `Invalid input item at ${itemParam}: must be a string or object.`,
              type: 'invalid_request_error',
              param: itemParam,
              code: 'invalid_input_item'
            }
          }
        };
      }
    }
    return null;
  }

  if (typeof input === 'object' && input !== null) {
    if (isImagePayload(input)) {
      return buildImageUnsupportedError(paramPrefix);
    }
    if (input.type && input.type !== 'text') {
      return buildUnsupportedContentTypeError(input.type, `${paramPrefix}.type`);
    }
    if (input.content !== undefined) {
      return validateMessageContent(input.content, `${paramPrefix}.content`);
    }
    if (input.text !== undefined) {
      return validateContentPart(input, paramPrefix);
    }
  }

  return {
    status: 400,
    body: {
      error: {
        message: 'Invalid request: "input" must be a string, array, or text object.',
        type: 'invalid_request_error',
        param: paramPrefix,
        code: 'invalid_input_type'
      }
    }
  };
}
