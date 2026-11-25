/**
 * Request validation middleware for /v1/chat/completions.
 * Enforces text-only inputs, OpenAI schema conformance, and strict rejection of all image/multimodal payloads.
 */

/**
 * Checks if a string or object represents or contains image content.
 * @param {*} value
 * @returns {boolean}
 */
function isImagePayload(value) {
  if (!value) return false;
  if (typeof value === 'string') {
    return (
      value.includes('data:image/') ||
      /^data:image\/[a-zA-Z0-9.+_-]+;base64,/i.test(value.trim()) ||
      /!\[.*?\]\((https?:\/\/[^\s)]+)\)/i.test(value) ||
      /https?:\/\/[^\s]+\.(png|jpe?g|gif|webp|bmp|svg)(\?[^\s]*)?/i.test(value)
    );
  }
  if (typeof value === 'object') {
    if (value.type === 'image_url' || value.type === 'image' || value.image_url || value.image) {
      return true;
    }
  }
  return false;
}

export function validateChatCompletionRequest(req, res, next) {
  const {
    messages,
    temperature,
    max_tokens,
    max_completion_tokens,
    stop,
    response_format,
    model
  } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      error: {
        message: 'Invalid request: "messages" field is required and must be a non-empty array.',
        type: 'invalid_request_error',
        param: 'messages',
        code: 'missing_messages'
      }
    });
  }

  // Validate message roles and content structure
  const validRoles = new Set(['system', 'user', 'assistant', 'tool', 'function', 'developer']);
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || typeof msg !== 'object') {
      return res.status(400).json({
        error: {
          message: `Invalid message at index ${i}: message must be an object.`,
          type: 'invalid_request_error',
          param: `messages[${i}]`,
          code: 'invalid_message_format'
        }
      });
    }

    if (!validRoles.has(msg.role)) {
      return res.status(400).json({
        error: {
          message: `Invalid message role '${msg.role}' at index ${i}. Expected one of: ${Array.from(validRoles).join(', ')}.`,
          type: 'invalid_request_error',
          param: `messages[${i}].role`,
          code: 'invalid_role'
        }
      });
    }

    // Assistant messages carrying tool_calls may have null/empty content
    const hasToolCalls = (msg.role === 'assistant' && (Array.isArray(msg.tool_calls) || msg.function_call));
    if (!hasToolCalls || (msg.content !== undefined && msg.content !== null)) {
      if (msg.content === undefined || msg.content === null) {
        return res.status(400).json({
          error: {
            message: `Invalid message at index ${i}: 'content' is required.`,
            type: 'invalid_request_error',
            param: `messages[${i}].content`,
            code: 'missing_content'
          }
        });
      }

      // Check for image content in string content
      if (typeof msg.content === 'string') {
        if (isImagePayload(msg.content)) {
          return res.status(400).json({
            error: {
              message: 'Image and multimodal inputs are not supported. This proxy only accepts text-based requests.',
              type: 'invalid_request_error',
              param: `messages[${i}].content`,
              code: 'image_input_unsupported'
            }
          });
        }
      } else if (Array.isArray(msg.content)) {
        if (msg.content.length === 0) {
          return res.status(400).json({
            error: {
              message: `Invalid message content at index ${i}: array must not be empty.`,
              type: 'invalid_request_error',
              param: `messages[${i}].content`,
              code: 'empty_content_array'
            }
          });
        }

        for (let j = 0; j < msg.content.length; j++) {
          const part = msg.content[j];
          if (!part || typeof part !== 'object') {
            return res.status(400).json({
              error: {
                message: `Invalid content part at index ${j} in message ${i}: must be an object.`,
                type: 'invalid_request_error',
                param: `messages[${i}].content[${j}]`,
                code: 'invalid_content_part'
              }
            });
          }

          // Strict rejection of image/multimodal content parts
          if (isImagePayload(part)) {
            return res.status(400).json({
              error: {
                message: 'Image and multimodal inputs are not supported. This proxy only accepts text-based requests.',
                type: 'invalid_request_error',
                param: `messages[${i}].content[${j}]`,
                code: 'image_input_unsupported'
              }
            });
          }

          if (part.type !== 'text') {
            return res.status(400).json({
              error: {
                message: `Unsupported content part type '${part.type}' at index ${j}. This proxy only accepts text-based requests.`,
                type: 'invalid_request_error',
                param: `messages[${i}].content[${j}].type`,
                code: 'unsupported_content_type'
              }
            });
          }

          if (typeof part.text !== 'string') {
            return res.status(400).json({
              error: {
                message: `Invalid text part at index ${j} in message ${i}: 'text' must be a string.`,
                type: 'invalid_request_error',
                param: `messages[${i}].content[${j}].text`,
                code: 'invalid_content'
              }
            });
          }

          if (isImagePayload(part.text)) {
            return res.status(400).json({
              error: {
                message: 'Image and multimodal inputs are not supported. This proxy only accepts text-based requests.',
                type: 'invalid_request_error',
                param: `messages[${i}].content[${j}].text`,
                code: 'image_input_unsupported'
              }
            });
          }
        }
      } else {
        return res.status(400).json({
          error: {
            message: `Invalid message content at index ${i}: content must be a string or array of text objects.`,
            type: 'invalid_request_error',
            param: `messages[${i}].content`,
            code: 'invalid_content'
          }
        });
      }
    }
  }

  if (temperature !== undefined && (typeof temperature !== 'number' || temperature < 0 || temperature > 2)) {
    return res.status(400).json({
      error: {
        message: 'Invalid temperature: must be a number between 0 and 2.',
        type: 'invalid_request_error',
        param: 'temperature',
        code: 'invalid_temperature'
      }
    });
  }

  if (max_tokens !== undefined && (!Number.isInteger(max_tokens) || max_tokens <= 0)) {
    return res.status(400).json({
      error: {
        message: 'Invalid max_tokens: must be a positive integer.',
        type: 'invalid_request_error',
        param: 'max_tokens',
        code: 'invalid_max_tokens'
      }
    });
  }

  if (max_completion_tokens !== undefined && (!Number.isInteger(max_completion_tokens) || max_completion_tokens <= 0)) {
    return res.status(400).json({
      error: {
        message: 'Invalid max_completion_tokens: must be a positive integer.',
        type: 'invalid_request_error',
        param: 'max_completion_tokens',
        code: 'invalid_max_completion_tokens'
      }
    });
  }

  // Stop sequences validation
  if (stop !== undefined && stop !== null) {
    if (typeof stop === 'string') {
      if (stop.length === 0) {
        return res.status(400).json({
          error: {
            message: 'Stop sequence cannot be empty.',
            type: 'invalid_request_error',
            param: 'stop',
            code: 'invalid_stop'
          }
        });
      }
    } else if (Array.isArray(stop)) {
      if (stop.length > 4) {
        return res.status(400).json({
          error: {
            message: 'Too many stop sequences: maximum allowed is 4.',
            type: 'invalid_request_error',
            param: 'stop',
            code: 'invalid_stop'
          }
        });
      }
      for (let sIdx = 0; sIdx < stop.length; sIdx++) {
        if (typeof stop[sIdx] !== 'string' || stop[sIdx].length === 0) {
          return res.status(400).json({
            error: {
              message: `Stop sequence at index ${sIdx} must be a non-empty string.`,
              type: 'invalid_request_error',
              param: `stop[${sIdx}]`,
              code: 'invalid_stop'
            }
          });
        }
      }
    } else {
      return res.status(400).json({
        error: {
          message: 'Invalid stop: must be a string or array of strings.',
          type: 'invalid_request_error',
          param: 'stop',
          code: 'invalid_stop'
        }
      });
    }
  }

  // Response format validation
  if (response_format !== undefined && response_format !== null) {
    if (typeof response_format !== 'object' || Array.isArray(response_format) || !response_format.type || !['text', 'json_object', 'json_schema'].includes(response_format.type)) {
      return res.status(400).json({
        error: {
          message: "Invalid response_format: 'type' must be 'text', 'json_object', or 'json_schema'.",
          type: 'invalid_request_error',
          param: 'response_format',
          code: 'invalid_response_format'
        }
      });
    }
  }

  next();
}
