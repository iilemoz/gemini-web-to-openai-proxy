import { validateContent, countImagesInMessages, MULTIMODAL_LIMITS } from '../utils/multimodal.js';

/**
 * Request validation middleware for /v1/chat/completions.
 */
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

      const contentValidation = validateContent(msg.content);
      if (!contentValidation.valid) {
        return res.status(400).json({
          error: {
            message: `Invalid message content at index ${i}: ${contentValidation.error}`,
            type: 'invalid_request_error',
            param: contentValidation.param ? `messages[${i}].${contentValidation.param}` : `messages[${i}].content`,
            code: contentValidation.code || 'invalid_content'
          }
        });
      }
    }
  }

  // Enforce max images limit across request
  const totalImages = countImagesInMessages(messages);
  if (totalImages > MULTIMODAL_LIMITS.MAX_IMAGES_PER_REQUEST) {
    return res.status(400).json({
      error: {
        message: `Too many images in request: maximum allowed is ${MULTIMODAL_LIMITS.MAX_IMAGES_PER_REQUEST}, received ${totalImages}.`,
        type: 'invalid_request_error',
        param: 'messages',
        code: 'too_many_images'
      }
    });
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
