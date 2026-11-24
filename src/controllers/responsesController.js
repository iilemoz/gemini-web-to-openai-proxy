import crypto from 'node:crypto';
import { registry } from '../providers/index.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { isUpstreamErrorText } from '../utils/upstreamErrors.js';

/**
 * POST /v1/responses
 * OpenAI Responses API specification endpoint.
 * Accepts: { model, input: string | array, instructions?: string, tools?: array }
 */
export async function handleResponses(req, res) {
  const {
    model = config.defaultModel,
    input,
    instructions = '',
    tools = []
  } = req.body || {};

  if (!input) {
    return res.status(400).json({
      error: {
        message: 'Invalid request: "input" is required.',
        type: 'invalid_request_error',
        param: 'input',
        code: 'missing_input'
      }
    });
  }

  const messages = [];
  if (instructions) {
    messages.push({ role: 'system', content: instructions });
  }

  if (typeof input === 'string') {
    messages.push({ role: 'user', content: input });
  } else if (Array.isArray(input)) {
    for (const item of input) {
      if (typeof item === 'string') {
        messages.push({ role: 'user', content: item });
      } else if (item && typeof item === 'object') {
        messages.push(item);
      }
    }
  }

  const token = req.geminiCookie || null;
  const provider = registry.getProviderForModel(model);
  const responseId = `resp-${crypto.randomUUID()}`;

  try {
    let fullContent = '';
    const generator = provider.chatComplete({
      model,
      messages,
      stream: false,
      token,
      tools
    });

    for await (const chunk of generator) {
      if (!chunk) continue;
      const text = typeof chunk === 'object' ? chunk.text : chunk;
      fullContent += text;
    }

    if (isUpstreamErrorText(fullContent)) {
      logger.warn(`[Responses API] Upstream Gemini returned internal error text: "${fullContent}"`);
      return res.status(502).json({
        error: {
          message: `Upstream model error: ${fullContent}`,
          type: 'upstream_error',
          code: 'model_error'
        }
      });
    }

    if (!fullContent || fullContent.trim().length === 0) {
      return res.status(502).json({
        error: {
          message: 'Upstream model returned an empty response.',
          type: 'upstream_error',
          code: 'empty_response'
        }
      });
    }

    res.json({
      id: responseId,
      object: 'response',
      created_at: Math.floor(Date.now() / 1000),
      model,
      status: 'completed',
      output: [
        {
          id: `msg-${crypto.randomUUID()}`,
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: fullContent
            }
          ]
        }
      ],
      usage: {
        input_tokens: Math.ceil(JSON.stringify(messages).length / 4),
        output_tokens: Math.ceil(fullContent.length / 4),
        total_tokens: Math.ceil((JSON.stringify(messages).length + fullContent.length) / 4)
      }
    });
  } catch (err) {
    logger.error('[Responses API] Error generating response:', err);
    res.status(500).json({
      error: {
        message: err.message || 'Error processing response',
        type: 'api_error',
        code: 'internal_error'
      }
    });
  }
}
