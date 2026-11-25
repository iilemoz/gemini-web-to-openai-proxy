import { BaseProvider } from '../BaseProvider.js';
import { logger } from '../../utils/logger.js';

/**
 * Standard OpenAI model definitions with verified native capabilities.
 */
export const OPENAI_MODELS = [
  {
    id: 'gpt-4o',
    upstreamModelId: 'gpt-4o',
    name: 'GPT-4o',
    owned_by: 'openai',
    description: 'OpenAI GPT-4o Flagship Omnimodel (High intelligence & multi-modal)',
    capabilities: {
      chat: true,
      stream: true,
      tools: true,
      vision: true,
      json: true,
      reasoning: false,
      responses: true
    }
  },
  {
    id: 'gpt-4o-mini',
    upstreamModelId: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    owned_by: 'openai',
    description: 'OpenAI GPT-4o Mini (Fast, lightweight & cost-efficient)',
    capabilities: {
      chat: true,
      stream: true,
      tools: true,
      vision: true,
      json: true,
      reasoning: false,
      responses: true
    }
  },
  {
    id: 'o1',
    upstreamModelId: 'o1',
    name: 'o1',
    owned_by: 'openai',
    description: 'OpenAI o1 Reasoning Model (Deep thinking for math, science & coding)',
    capabilities: {
      chat: true,
      stream: true,
      tools: true,
      vision: true,
      json: true,
      reasoning: true,
      responses: true
    }
  },
  {
    id: 'o3-mini',
    upstreamModelId: 'o3-mini',
    name: 'o3-mini',
    owned_by: 'openai',
    description: 'OpenAI o3-mini (High-speed reasoning model for coding & STEM)',
    capabilities: {
      chat: true,
      stream: true,
      tools: true,
      vision: false,
      json: true,
      reasoning: true,
      responses: true
    }
  }
];

/**
 * Native OpenAI Provider Adapter.
 * Direct HTTP-based provider implementing standard OpenAI Chat Completions,
 * streaming SSE, tool calling, and error normalization.
 */
export class OpenAIProvider extends BaseProvider {
  /**
   * @param {Object} options
   * @param {string} options.apiKey - OpenAI API key (required for requests)
   * @param {string} [options.baseUrl] - Base URL (default: 'https://api.openai.com/v1')
   * @param {number} [options.timeoutMs] - Request timeout in ms (default: 60000)
   * @param {number} [options.maxRetries] - Max retry attempts (default: 2)
   * @param {string} [options.organization] - Optional OpenAI organization ID
   * @param {string} [options.project] - Optional OpenAI project ID
   */
  constructor(options = {}) {
    super({ id: 'openai', name: 'OpenAI Native API' });

    this.apiKey = typeof options.apiKey === 'string' ? options.apiKey.trim() : '';
    const rawBaseUrl = typeof options.baseUrl === 'string' && options.baseUrl.trim()
      ? options.baseUrl.trim()
      : 'https://api.openai.com/v1';
    this.baseUrl = rawBaseUrl.replace(/\/+$/, '');
    this.timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : 60000;
    this.maxRetries = Number.isInteger(options.maxRetries) && options.maxRetries >= 0
      ? options.maxRetries
      : 2;
    this.organization = typeof options.organization === 'string' ? options.organization.trim() : '';
    this.project = typeof options.project === 'string' ? options.project.trim() : '';

    this.isInitialized = true;
  }

  /**
   * Validate provider configuration without leaking credentials.
   * @returns {{ valid: boolean, errors?: string[] }}
   */
  validateConfig() {
    const errors = [];

    if (!this.apiKey) {
      errors.push('OpenAI API key is missing or empty.');
    }

    try {
      const parsed = new URL(this.baseUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        errors.push(`Invalid OpenAI base URL protocol: '${parsed.protocol}'. Must be http or https.`);
      }
    } catch {
      errors.push(`Invalid OpenAI base URL format: '${this.baseUrl}'.`);
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined
    };
  }

  /**
   * Returns supported genuine OpenAI models.
   * @returns {Array<typeof OPENAI_MODELS[0]>}
   */
  getModels() {
    return OPENAI_MODELS.map(m => ({
      ...m,
      created: 1715500000,
      permission: []
    }));
  }

  /**
   * Check provider health/readiness.
   * @returns {Promise<{ status: 'ok' | 'degraded' | 'error', message?: string }>}
   */
  async checkHealth() {
    const validation = this.validateConfig();
    if (!validation.valid) {
      return {
        status: 'error',
        message: validation.errors?.join(' ') || 'OpenAI configuration is invalid.'
      };
    }
    return { status: 'ok', provider: this.id };
  }

  /**
   * Mask sensitive tokens from error strings or logs.
   * @param {string} text
   * @returns {string}
   */
  static sanitizeSecret(text) {
    if (typeof text !== 'string') return '';
    return text
      .replace(/sk-[a-zA-Z0-9_\-]{8,}/g, 'sk-***')
      .replace(/Bearer\s+[a-zA-Z0-9_\.\-]+/gi, 'Bearer ***');
  }

  /**
   * Normalizes provider-specific errors into standard OpenAI error structures.
   * Strictly sanitizes sensitive API keys or headers.
   * @param {any} err
   * @returns {Error & { status: number, code: string, type: string }}
   */
  normalizeError(err) {
    const rawMessage = OpenAIProvider.sanitizeSecret(err?.message || 'OpenAI upstream error');
    const status = err?.status || 502;
    const normalized = new Error(rawMessage);
    normalized.status = status;

    if (status === 401) {
      normalized.code = 'invalid_api_key';
      normalized.type = 'authentication_error';
    } else if (status === 403) {
      normalized.code = 'permission_denied';
      normalized.type = 'permission_error';
    } else if (status === 404) {
      normalized.code = 'model_not_found';
      normalized.type = 'invalid_request_error';
    } else if (status === 429) {
      normalized.code = 'rate_limit_exceeded';
      normalized.type = 'rate_limit_error';
    } else if (status >= 500) {
      normalized.status = 502;
      normalized.code = 'upstream_error';
      normalized.type = 'upstream_error';
    } else {
      normalized.code = err?.code || 'api_error';
      normalized.type = err?.type || 'invalid_request_error';
    }

    return normalized;
  }

  /**
   * Execute chat completion against native OpenAI API.
   * Yields typed delta chunks for both streaming and non-streaming modes:
   *  - { type: 'content', text: string }
   *  - { type: 'thinking', text: string }
   *  - { type: 'tool_calls', tool_calls: Array }
   *  - { type: 'usage', usage: Object }
   *
   * @param {Object} params
   * @param {string} params.model
   * @param {Array<{role: string, content: string|Array}>} params.messages
   * @param {boolean} [params.stream=false]
   * @param {Array} [params.tools]
   * @param {*} [params.tool_choice]
   * @param {Object} [params.response_format]
   * @param {number} [params.temperature]
   * @param {number} [params.top_p]
   * @param {number} [params.max_tokens]
   * @param {number} [params.max_completion_tokens]
   * @param {AbortSignal} [params.signal]
   */
  async *chatComplete(params) {
    const configCheck = this.validateConfig();
    if (!configCheck.valid) {
      const err = new Error(configCheck.errors?.[0] || 'OpenAI API key is missing or not configured.');
      err.status = 401;
      err.code = 'missing_api_key';
      err.type = 'authentication_error';
      throw this.normalizeError(err);
    }

    const {
      model,
      messages,
      stream = false,
      tools,
      tool_choice,
      response_format,
      temperature,
      top_p,
      max_tokens,
      max_completion_tokens,
      signal
    } = params;

    // Resolve upstream model identifier
    const matchingModel = this.getModels().find(
      m => m.id.toLowerCase() === (model || '').toLowerCase() ||
           m.upstreamModelId?.toLowerCase() === (model || '').toLowerCase()
    );
    const upstreamModel = matchingModel ? matchingModel.upstreamModelId : model;

    // Determine reasoning model capabilities
    const isReasoning = upstreamModel.startsWith('o1') || upstreamModel.startsWith('o3');

    // Build OpenAI upstream payload
    const payload = {
      model: upstreamModel,
      messages,
      stream: Boolean(stream)
    };

    if (Array.isArray(tools) && tools.length > 0) {
      payload.tools = tools;
      if (tool_choice !== undefined) {
        payload.tool_choice = tool_choice;
      }
    }

    if (response_format && typeof response_format === 'object') {
      payload.response_format = response_format;
    }

    if (stream) {
      payload.stream_options = { include_usage: true };
    }

    if (isReasoning) {
      // OpenAI reasoning models (o1/o3) require max_completion_tokens and reject temperature
      if (max_completion_tokens !== undefined) {
        payload.max_completion_tokens = max_completion_tokens;
      } else if (max_tokens !== undefined) {
        payload.max_completion_tokens = max_tokens;
      }
    } else {
      if (max_tokens !== undefined) {
        payload.max_tokens = max_tokens;
      }
      if (max_completion_tokens !== undefined) {
        payload.max_completion_tokens = max_completion_tokens;
      }
      if (temperature !== undefined) {
        payload.temperature = temperature;
      }
      if (top_p !== undefined) {
        payload.top_p = top_p;
      }
    }

    // Build headers
    const headers = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'gemini-web-to-openai-proxy/5.0b'
    };
    if (this.organization) {
      headers['OpenAI-Organization'] = this.organization;
    }
    if (this.project) {
      headers['OpenAI-Project'] = this.project;
    }

    const targetUrl = `${this.baseUrl}/chat/completions`;

    // Execute upstream fetch
    let res;
    try {
      res = await fetch(targetUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal
      });
    } catch (fetchErr) {
      if (signal?.aborted || fetchErr.name === 'AbortError') {
        const abortErr = new Error('Aborted');
        abortErr.name = 'AbortError';
        throw abortErr;
      }
      const err = new Error(`Failed to connect to OpenAI API: ${fetchErr.message}`);
      err.status = 502;
      err.code = 'network_error';
      throw this.normalizeError(err);
    }

    // Handle HTTP error responses
    if (!res.ok) {
      let errorBody = '';
      let parsedError = null;
      try {
        errorBody = await res.text();
        parsedError = JSON.parse(errorBody);
      } catch {
        // use raw text
      }

      const errMsg = parsedError?.error?.message || errorBody || `OpenAI API returned HTTP ${res.status}`;
      const err = new Error(errMsg);
      err.status = res.status;
      err.code = parsedError?.error?.code || 'openai_api_error';
      err.type = parsedError?.error?.type || 'api_error';
      throw this.normalizeError(err);
    }

    // ── Non-Streaming Mode ──────────────────────────────────────────────────
    if (!stream) {
      const data = await res.json();
      const choice = data?.choices?.[0];

      if (choice?.message) {
        const msg = choice.message;
        if (msg.reasoning_content) {
          yield { type: 'thinking', text: msg.reasoning_content };
        }
        if (msg.content) {
          yield { type: 'content', text: msg.content };
        }
        if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
          yield { type: 'tool_calls', tool_calls: msg.tool_calls };
        }
      }

      if (data?.usage) {
        yield { type: 'usage', usage: data.usage };
      }
      return;
    }

    // ── Streaming SSE Mode ──────────────────────────────────────────────────
    if (!res.body) {
      throw this.normalizeError(new Error('OpenAI returned empty response body for streaming request.'));
    }

    const decoder = new TextDecoder('utf-8');
    let lineBuffer = '';

    for await (const chunk of res.body) {
      if (signal?.aborted) {
        const abortErr = new Error('Aborted');
        abortErr.name = 'AbortError';
        throw abortErr;
      }

      lineBuffer += decoder.decode(chunk, { stream: true });
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop(); // Retain partial trailing line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) {
          continue; // SSE comment or ping
        }

        if (trimmed === 'data: [DONE]') {
          return;
        }

        if (trimmed.startsWith('data: ')) {
          const jsonStr = trimmed.slice(6).trim();
          if (!jsonStr) continue;

          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta;

            if (delta) {
              if (delta.reasoning_content) {
                yield { type: 'thinking', text: delta.reasoning_content };
              }
              if (delta.content) {
                yield { type: 'content', text: delta.content };
              }
              if (delta.tool_calls) {
                yield { type: 'tool_calls', tool_calls: delta.tool_calls };
              }
            }

            if (parsed.usage) {
              yield { type: 'usage', usage: parsed.usage };
            }
          } catch {
            // Silently ignore incomplete or unparseable SSE lines
          }
        }
      }
    }

    // Process any remaining tail in lineBuffer
    if (lineBuffer.trim().startsWith('data: ') && lineBuffer.trim() !== 'data: [DONE]') {
      try {
        const parsed = JSON.parse(lineBuffer.trim().slice(6).trim());
        const delta = parsed.choices?.[0]?.delta;
        if (delta?.content) {
          yield { type: 'content', text: delta.content };
        }
        if (parsed.usage) {
          yield { type: 'usage', usage: parsed.usage };
        }
      } catch {
        // Ignore
      }
    }
  }
}
