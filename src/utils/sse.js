import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Rough token estimate: 1 token ≈ 4 characters. */
function estimateTokens(text) {
  return Math.ceil((text || '').length / 4) || 1;
}

// ---------------------------------------------------------------------------
// Streaming SSE helpers (OpenAI-compatible)
// ---------------------------------------------------------------------------

/**
 * Formats a delta or finish reason into an OpenAI-compatible SSE chunk.
 *
 * @param {string}        id           - The completion ID.
 * @param {string}        model        - The model name.
 * @param {Object}        delta        - Delta object: { content, reasoning_content, tool_calls, role }.
 * @param {string|null}   finishReason - 'stop', 'tool_calls', or null.
 * @returns {string} Formatted SSE line ending with '\n\n'.
 */
export function formatSSEChunk(id, model, delta = {}, finishReason = null) {
  let deltaObj = {};

  if (typeof delta === 'string') {
    if (delta) deltaObj = { content: delta };
  } else if (delta && typeof delta === 'object') {
    deltaObj = delta;
  }

  const payload = {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: deltaObj,
        finish_reason: finishReason
      }
    ]
  };

  return `data: ${JSON.stringify(payload)}\n\n`;
}

/**
 * Formats a trailing usage chunk sent after the final content chunk when
 * `stream_options.include_usage` is true.
 * Per the OpenAI spec this chunk has an empty `choices` array.
 *
 * @param {string} id               - The completion ID.
 * @param {string} model            - The model name.
 * @param {Object} opts
 * @param {number} opts.promptTokens
 * @param {number} opts.completionTokens
 * @returns {string} Formatted SSE line ending with '\n\n'.
 */
export function formatSSEUsageChunk(id, model, { promptTokens = 0, completionTokens = 0 }) {
  const totalTokens = promptTokens + completionTokens;

  const payload = {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens
    }
  };

  return `data: ${JSON.stringify(payload)}\n\n`;
}

/**
 * Returns the final SSE terminator.
 * @returns {string}
 */
export function formatSSEDone() {
  return 'data: [DONE]\n\n';
}

// ---------------------------------------------------------------------------
// Non-streaming response helper
// ---------------------------------------------------------------------------

/**
 * Formats a complete text response into a standard OpenAI ChatCompletion object.
 *
 * @param {string} id  - Completion ID.
 * @param {string} model - Model name.
 * @param {Object} opts
 * @param {string}        opts.content
 * @param {string|null}   opts.reasoning_content
 * @param {Array|null}    opts.tool_calls
 * @returns {Object} Full OpenAI ChatCompletion JSON object.
 */
export function formatFullResponse(id, model, { content = '', reasoning_content = null, tool_calls = null, promptTokens = null, usage = null } = {}) {
  const hasTools = Array.isArray(tool_calls) && tool_calls.length > 0;

  const message = {
    role: 'assistant',
    content: content || null
  };

  if (reasoning_content) {
    message.reasoning_content = reasoning_content;
  }

  if (hasTools) {
    message.tool_calls = tool_calls;
  }

  const promptTokenCount     = usage?.prompt_tokens ?? (typeof promptTokens === 'number' ? promptTokens : (estimateTokens(content) || 10));
  const completionTokenCount = usage?.completion_tokens ?? (estimateTokens(reasoning_content || '') + estimateTokens(content || ''));
  const totalTokens          = usage?.total_tokens ?? (promptTokenCount + completionTokenCount);

  return {
    id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: hasTools ? 'tool_calls' : 'stop'
      }
    ],
    usage: {
      prompt_tokens:      promptTokenCount,
      completion_tokens:  completionTokenCount,
      total_tokens:       totalTokens
    }
  };
}
