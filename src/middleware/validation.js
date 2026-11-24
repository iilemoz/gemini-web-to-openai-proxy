/**
 * Request validation middleware for /v1/chat/completions.
 */
export function validateChatCompletionRequest(req, res, next) {
  const { messages, temperature, max_tokens, model } = req.body || {};

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

  // Validate message roles
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

  next();
}
