import crypto from 'node:crypto';
import { registry } from '../providers/index.js';
import {
  formatSSEChunk,
  formatSSEUsageChunk,
  formatSSEDone,
  formatFullResponse
} from '../utils/sse.js';
import { parseDSML } from '../utils/dsmlParser.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { isUpstreamErrorText } from '../utils/upstreamErrors.js';
import { requestTracker } from '../utils/requestTracker.js';
import { executeWithRetry } from '../utils/retry.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Rough token estimate: 1 token ≈ 4 characters. */
function estimateTokens(text = '') {
  return Math.ceil((text || '').length / 4) || 1;
}

/**
 * Estimates prompt tokens from an OpenAI-format messages array.
 * @param {Array} messages
 * @returns {number}
 */
function estimatePromptTokens(messages) {
  return messages.reduce((total, m) => {
    const content = typeof m.content === 'string'
      ? m.content
      : JSON.stringify(m.content || '');
    return total + estimateTokens(content);
  }, 0) || 10;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

/**
 * POST /v1/chat/completions
 * OpenAI-compatible chat completion endpoint.
 *
 * Key behaviours:
 *  - Streams via SSE when `stream: true`; returns a single JSON object otherwise.
 *  - Tracks client disconnect via AbortController; stops pulling from Gemini immediately.
 *  - Guest-mode Gemini clients are closed by GeminiEngine after each request.
 *  - Emits a trailing usage chunk when `stream_options.include_usage` is true.
 *  - Strips DSML / <tool_call> blocks and re-emits them as standard tool_calls.
 */
export async function handleChatCompletion(req, res) {
  const {
    model          = config.defaultModel,
    messages       = [],
    stream         = false,
    tools          = [],
    tool_choice,
    stream_options = {},
    functions,
    function_call
  } = req.body;

  // Normalize legacy OpenAI functions parameter into tools format if provided
  let effectiveTools = Array.isArray(tools) && tools.length > 0 ? tools : [];
  if (effectiveTools.length === 0 && Array.isArray(functions) && functions.length > 0) {
    effectiveTools = functions.map(fn => ({
      type: 'function',
      function: fn
    }));
  }

  // ── Basic validation ───────────────────────────────────────────────────────
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      error: {
        message: 'Invalid request: "messages" array is required and must not be empty.',
        type:    'invalid_request_error',
        code:    'missing_messages'
      }
    });
  }

  // ── Auth: extract Gemini cookie from request (separated from proxy API auth) ────────
  const token = req.geminiCookie || null;

  // ── Request tracking and abort controller ──────────────────────────────────
  const completionId  = `chatcmpl-${crypto.randomUUID()}`;
  const abortController = new AbortController();
  const { signal } = abortController;

  if (!requestTracker.track(completionId, abortController)) {
    return res.status(503).json({
      error: {
        message: 'Server is shutting down and cannot accept new requests.',
        type:    'service_unavailable',
        code:    'server_shutting_down'
      }
    });
  }

  // Request timeout timer
  let timeoutTimer = null;
  if (config.requestTimeoutMs > 0) {
    timeoutTimer = setTimeout(() => {
      abortController.abort(new Error(`Request timed out after ${config.requestTimeoutMs}ms`));
    }, config.requestTimeoutMs);
  }

  // Listen on `res` for disconnect detection.
  res.on('close', () => {
    if (!res.writableEnded) {
      logger.info(`[ChatController] Client disconnected – aborting completion ${completionId}.`);
      abortController.abort();
    }
  });

  // ── Feature flags ──────────────────────────────────────────────────────────
  const includeUsage  = stream_options?.include_usage === true;
  const hasTools      = effectiveTools.length > 0;
  const provider      = registry.getProviderForModel(model);
  const promptTokens  = estimatePromptTokens(messages);

  logger.info(
    `Incoming completion | Model: ${model} | Stream: ${stream} | ` +
    `Tools: ${hasTools ? effectiveTools.length : 0} | Usage: ${includeUsage} | Provider: ${provider.name}`
  );

  let hasStartedStreaming = false;
  let idleTimer = null;

  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    if (config.streamingIdleTimeoutMs > 0) {
      idleTimer = setTimeout(() => {
        logger.warn(`[ChatController] Streaming idle timeout reached (${config.streamingIdleTimeoutMs}ms without chunk)`);
        abortController.abort(new Error(`Streaming idle timeout of ${config.streamingIdleTimeoutMs}ms exceeded`));
      }, config.streamingIdleTimeoutMs);
    }
  };

  try {
    // ── STREAMING RESPONSE ─────────────────────────────────────────────────
    if (stream) {
      const generator = provider.chatComplete({
        model,
        messages,
        stream: true,
        token,
        tools: effectiveTools,
        tool_choice,
        signal
      });

      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();
      hasStartedStreaming = true;

      // Initial role delta (required by OpenAI spec)
      res.write(formatSSEChunk(completionId, model, { role: 'assistant' }));

      // Regex that detects the beginning of a tool-call block
      const toolTagRegex = /(?:[<＜]\s*[|｜]\s*(?:[|｜]\s*)?DSML\s*[|｜]\s*(?:[|｜]\s*)?calls|<tool_call>)/i;

      let chunkCount        = 0;
      let completionChars   = 0;  // accumulated for usage tracking
      let inDsmlMode        = false;
      let dsmlBuffer        = '';
      let pendingContent    = '';

      resetIdleTimer();

      for await (const rawChunk of generator) {
        resetIdleTimer();
        // Generator has already stopped if signal was aborted
        if (!rawChunk) continue;

        const chunkType = typeof rawChunk === 'object' ? rawChunk.type : 'content';
        const chunkText = typeof rawChunk === 'object' ? rawChunk.text : rawChunk;

        if (!chunkText) continue;

        // ── Thinking / reasoning tokens ─────────────────────────────────────
        if (chunkType === 'thinking') {
          completionChars += chunkText.length;
          res.write(formatSSEChunk(completionId, model, { reasoning_content: chunkText }));
          chunkCount++;
          continue;
        }

        completionChars += chunkText.length;

        // ── No tools → pass through directly (fastest path) ─────────────────
        if (!hasTools) {
          res.write(formatSSEChunk(completionId, model, { content: chunkText }));
          chunkCount++;
          continue;
        }

        // ── Tool-aware buffering: watch for <tool_call> / DSML blocks ────────
        if (inDsmlMode) {
          dsmlBuffer += chunkText;
        } else {
          pendingContent += chunkText;

          const match = pendingContent.match(toolTagRegex);
          if (match) {
            // Switch into DSML capture mode
            inDsmlMode = true;
            const beforeText = pendingContent.slice(0, match.index);
            if (beforeText) {
              res.write(formatSSEChunk(completionId, model, { content: beforeText }));
              chunkCount++;
            }
            dsmlBuffer    = pendingContent.slice(match.index);
            pendingContent = '';
          } else {
            // Buffer the tail if it might be the start of '<tool_call' or '< | DSML'
            const lastLt = pendingContent.search(/[<＜][^<＜]*$/);
            if (lastLt !== -1 && pendingContent.length - lastLt < 20) {
              const safeText = pendingContent.slice(0, lastLt);
              if (safeText) {
                res.write(formatSSEChunk(completionId, model, { content: safeText }));
                chunkCount++;
              }
              pendingContent = pendingContent.slice(lastLt);
            } else {
              res.write(formatSSEChunk(completionId, model, { content: pendingContent }));
              chunkCount++;
              pendingContent = '';
            }
          }
        }
      }

      if (idleTimer) clearTimeout(idleTimer);

      // ── Flush any remaining plain-text buffer ──────────────────────────────
      if (pendingContent) {
        res.write(formatSSEChunk(completionId, model, { content: pendingContent }));
      }

      // ── Emit parsed tool calls (or stop) ──────────────────────────────────
      if (dsmlBuffer) {
        const { content: afterContent, toolCalls } = parseDSML(dsmlBuffer);

        if (afterContent) {
          res.write(formatSSEChunk(completionId, model, { content: afterContent }));
        }

        if (toolCalls && toolCalls.length > 0) {
          logger.info(`Emitting ${toolCalls.length} parsed tool call(s) to client`);
          const streamingToolCalls = toolCalls.map((tc, idx) => ({
            index:    idx,
            id:       tc.id,
            type:     tc.type || 'function',
            function: tc.function
          }));
          res.write(formatSSEChunk(completionId, model, { tool_calls: streamingToolCalls }));
          res.write(formatSSEChunk(completionId, model, {}, 'tool_calls'));
        } else {
          if (!afterContent) {
            res.write(formatSSEChunk(completionId, model, { content: dsmlBuffer }));
          }
          res.write(formatSSEChunk(completionId, model, {}, 'stop'));
        }
      } else {
        res.write(formatSSEChunk(completionId, model, {}, 'stop'));
      }

      // ── Optional trailing usage chunk ──────────────────────────────────────
      if (includeUsage) {
        const completionTokens = estimateTokens(' '.repeat(completionChars));
        res.write(formatSSEUsageChunk(completionId, model, {
          promptTokens,
          completionTokens
        }));
      }

      res.write(formatSSEDone());
      res.end();

      logger.success(`Stream completed: ${chunkCount} chunks sent.`);

    // ── NON-STREAMING RESPONSE ───────────────────────────────────────────────
    } else {
      const { content, reasoning_content, toolCalls } = await executeWithRetry(
        async () => {
          const generator = provider.chatComplete({
            model,
            messages,
            stream: false,
            token,
            tools: effectiveTools,
            tool_choice,
            signal
          });

          let fullContent   = '';
          let fullReasoning = '';

          for await (const rawChunk of generator) {
            if (signal.aborted) {
              const abortErr = new Error('Aborted');
              abortErr.name = 'AbortError';
              throw abortErr;
            }
            if (!rawChunk) continue;
            const chunkType = typeof rawChunk === 'object' ? rawChunk.type : 'content';
            const chunkText = typeof rawChunk === 'object' ? rawChunk.text : rawChunk;

            if (chunkType === 'thinking') {
              fullReasoning += chunkText;
            } else {
              fullContent += chunkText;
            }
          }

          const parsed = parseDSML(fullContent);

          if (isUpstreamErrorText(parsed.content) && (!parsed.toolCalls || parsed.toolCalls.length === 0)) {
            logger.warn(`[ChatController] Upstream Gemini returned internal error text: "${parsed.content}"`);
            const err = new Error(`Upstream model error: ${parsed.content}`);
            err.status = 502;
            err.code = 'model_error';
            throw err;
          }

          return {
            content: parsed.content,
            reasoning_content: fullReasoning || null,
            toolCalls: parsed.toolCalls
          };
        },
        {
          maxAttempts: config.retryMaxAttempts,
          initialDelayMs: config.retryInitialDelayMs,
          maxDelayMs: config.retryMaxDelayMs,
          jitter: config.retryJitter,
          signal
        }
      );

      res.json(formatFullResponse(completionId, model, {
        content,
        reasoning_content,
        tool_calls:        toolCalls,
        promptTokens
      }));

      logger.success(
        `Non-stream completed: ${content.length} content chars, ` +
        `${(reasoning_content || '').length} reasoning chars, ${toolCalls.length} tool calls.`
      );
    }

  } catch (err) {
    // Ignore abort errors (expected when client disconnects or request cancelled)
    if (signal.aborted || err.name === 'AbortError') {
      logger.info('[ChatController] Request was aborted cleanly.');
      if (!res.writableEnded) res.end();
      return;
    }

    logger.error('Error handling chat completion:', err);

    if (!res.headersSent && !hasStartedStreaming) {
      const status = err.status || 500;
      res.status(status).json({
        error: {
          message: err.message || 'Internal server error while processing completion',
          type:    status === 502 ? 'upstream_error' : 'api_error',
          code:    err.code || 'internal_error'
        }
      });
    } else {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: { message: err.message, type: 'upstream_error' } })}\n\n`);
        res.write(formatSSEDone());
        res.end();
      }
    }
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    if (timeoutTimer) clearTimeout(timeoutTimer);
    requestTracker.untrack(completionId);
  }
}
