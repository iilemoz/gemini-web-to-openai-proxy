import crypto from 'node:crypto';
import { registry, modelRouter } from '../providers/index.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { isUpstreamErrorText } from '../utils/upstreamErrors.js';
import { requestTracker } from '../utils/requestTracker.js';
import { executeWithRetry } from '../utils/retry.js';

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
  
  // ── Resolve Provider via ModelRouter ──────────────────────────────────────
  let provider;
  if (registry._mockDefaultProvider) {
    provider = registry._mockDefaultProvider;
  } else {
    try {
      const resolution = modelRouter.resolve(model, {
        requiredCapability: 'responses'
      });
      provider = resolution.provider;
    } catch (routingErr) {
      return res.status(routingErr.status || 404).json({
        error: {
          message: routingErr.message,
          type:    routingErr.type || 'invalid_request_error',
          code:    routingErr.code || 'model_not_found',
          param:   routingErr.param || 'model'
        }
      });
    }
  }

  const responseId = `resp-${crypto.randomUUID()}`;

  const abortController = new AbortController();
  const { signal } = abortController;

  if (!requestTracker.track(responseId, abortController)) {
    return res.status(503).json({
      error: {
        message: 'Server is shutting down and cannot accept new requests.',
        type:    'service_unavailable',
        code:    'server_shutting_down'
      }
    });
  }

  let timeoutTimer = null;
  if (config.requestTimeoutMs > 0) {
    timeoutTimer = setTimeout(() => {
      abortController.abort(new Error(`Request timed out after ${config.requestTimeoutMs}ms`));
    }, config.requestTimeoutMs);
  }

  res.on('close', () => {
    if (!res.writableEnded) {
      logger.info(`[Responses API] Client disconnected – aborting ${responseId}.`);
      abortController.abort();
    }
  });

  try {
    const fullContent = await executeWithRetry(
      async () => {
        let content = '';
        const generator = provider.chatComplete({
          model,
          messages,
          stream: false,
          token,
          tools,
          signal
        });

        for await (const chunk of generator) {
          if (signal.aborted) {
            const abortErr = new Error('Aborted');
            abortErr.name = 'AbortError';
            throw abortErr;
          }
          if (!chunk) continue;
          const text = typeof chunk === 'object' ? chunk.text : chunk;
          content += text;
        }

        const isGemini = provider.id === 'gemini' || provider.name === 'gemini';
        if (isGemini && isUpstreamErrorText(content)) {
          logger.warn(`[Responses API] Upstream Gemini returned internal error text: "${content}"`);
          const err = new Error(`Upstream model error: ${content}`);
          err.status = 502;
          err.code = 'model_error';
          throw err;
        }

        if (!content || content.trim().length === 0) {
          const err = new Error('Upstream model returned an empty response.');
          err.status = 502;
          err.code = 'empty_response';
          throw err;
        }

        return content;
      },
      {
        maxAttempts: config.retryMaxAttempts,
        initialDelayMs: config.retryInitialDelayMs,
        maxDelayMs: config.retryMaxDelayMs,
        jitter: config.retryJitter,
        signal
      }
    );

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
    if (signal.aborted || err.name === 'AbortError') {
      logger.info('[Responses API] Request was aborted cleanly.');
      if (!res.writableEnded) res.end();
      return;
    }

    logger.error('[Responses API] Error generating response:', err);
    const status = err.status || 500;
    res.status(status).json({
      error: {
        message: err.message || 'Error processing response',
        type:    status === 502 ? 'upstream_error' : 'api_error',
        code:    err.code || 'internal_error'
      }
    });
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    requestTracker.untrack(responseId);
  }
}
