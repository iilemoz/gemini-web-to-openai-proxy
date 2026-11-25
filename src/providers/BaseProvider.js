/**
 * Unified Provider Adapter Contract.
 * Abstract base class for Google Gemini Web provider integration.
 *
 * Standardized lifecycle:
 * - Identification & metadata
 * - Lifecycle initialization & configuration validation
 * - Model discovery & capability negotiation
 * - Streaming & non-streaming text completions
 * - Usage & error normalization
 * - Cancellation & health checks
 */
export class BaseProvider {
  /**
   * @param {string|{ id: string, name?: string }} options - Provider ID or options object
   */
  constructor(options) {
    if (new.target === BaseProvider) {
      throw new TypeError('Cannot construct BaseProvider instances directly.');
    }

    if (typeof options === 'string') {
      this.id = options;
      this.name = options;
    } else if (options && typeof options === 'object') {
      this.id = options.id || options.name;
      this.name = options.name || options.id;
    } else {
      throw new TypeError('Provider constructor requires an id string or options object.');
    }

    if (!this.id || typeof this.id !== 'string') {
      throw new TypeError('Provider id must be a non-empty string.');
    }

    /** @type {boolean} Lifecycle initialization flag */
    this.isInitialized = false;
  }

  /**
   * Initialize provider resources or validate credentials.
   * Can be overridden by subclasses for async setup.
   * @returns {Promise<void>}
   */
  async initialize() {
    this.isInitialized = true;
  }

  /**
   * Validate provider configuration without logging or leaking secrets.
   * @returns {{ valid: boolean, errors?: string[] }}
   */
  validateConfig() {
    return { valid: true };
  }

  /**
   * Returns an array of model definitions natively supported by this provider.
   * Override in subclasses to declare models.
   * @returns {Array<{
   *   id: string,
   *   upstreamModelId?: string,
   *   name?: string,
   *   description?: string,
   *   aliases?: string[],
   *   capabilities?: {
   *     chat?: boolean,
   *     stream?: boolean,
   *     tools?: boolean,
   *     json?: boolean,
   *     reasoning?: boolean,
   *     responses?: boolean
   *   }
   * }>}
   */
  getModels() {
    return [];
  }

  /**
   * Checks whether this provider supports the requested model.
   * Performs case-insensitive matching against model ID, upstreamModelId, and aliases.
   * @param {string} modelId
   * @returns {boolean}
   */
  supportsModel(modelId) {
    if (!modelId || typeof modelId !== 'string') return false;
    const lower = modelId.toLowerCase();
    const models = this.getModels();
    if (!models || models.length === 0) return false;
    return models.some(m =>
      (m.id && m.id.toLowerCase() === lower) ||
      (m.upstreamModelId && m.upstreamModelId.toLowerCase() === lower) ||
      (Array.isArray(m.aliases) && m.aliases.some(a => a.toLowerCase() === lower))
    );
  }

  /**
   * Returns capabilities for a given model.
   * @param {string} modelId
   * @returns {{
   *   chat: boolean,
   *   stream: boolean,
   *   tools: boolean,
   *   json: boolean,
   *   reasoning: boolean,
   *   responses: boolean
   * }}
   */
  getCapabilities(modelId) {
    const models = this.getModels();
    let found = null;
    if (Array.isArray(models) && models.length > 0 && modelId) {
      const lower = modelId.toLowerCase();
      found = models.find(m =>
        (m.id && m.id.toLowerCase() === lower) ||
        (m.upstreamModelId && m.upstreamModelId.toLowerCase() === lower) ||
        (Array.isArray(m.aliases) && m.aliases.some(a => a.toLowerCase() === lower))
      );
    }
    return {
      chat: true,
      stream: true,
      tools: true,
      json: false,
      reasoning: false,
      responses: true,
      ...(found?.capabilities || {})
    };
  }

  /**
   * Check provider health/availability.
   * @returns {Promise<{ status: 'ok' | 'degraded' | 'error', message?: string }>}
   */
  async checkHealth() {
    return { status: 'ok' };
  }

  /**
   * Execute a chat completion and yield typed text delta chunks:
   *
   * @param {Object}      params
   * @param {string}      params.model
   * @param {Array<{role: string, content: string|Array}>} params.messages
   * @param {boolean}     [params.stream]
   * @param {string}      [params.token]   - Optional client-supplied cookie / token.
   * @param {Array}       [params.tools]   - OpenAI-format tool definitions.
   * @param {*}           [params.tool_choice]
   * @param {AbortSignal} [params.signal]  - Abort signal for early cancellation.
   * @yields {{ type: 'content' | 'thinking', text: string }}
   */
  async *chatComplete(params) { // eslint-disable-line no-unused-vars
    throw new Error('chatComplete() must be implemented by the provider subclass.');
  }

  /**
   * Convenience non-streaming helper that aggregates chunks from chatComplete.
   * @param {Object} params
   * @returns {Promise<string>}
   */
  async complete(params) {
    let content = '';
    for await (const chunk of this.chatComplete({ ...params, stream: false })) {
      if (params.signal?.aborted) {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        throw err;
      }
      if (chunk) {
        content += (typeof chunk === 'object' ? chunk.text : chunk) || '';
      }
    }
    return content;
  }

  /**
   * Normalizes provider-specific errors into standard OpenAI error structures.
   * @param {any} err
   * @returns {Error & { status: number, code: string, type: string }}
   */
  normalizeError(err) {
    if (err && typeof err === 'object' && err.status && err.code) {
      return err;
    }
    const normalized = new Error(err?.message || 'Upstream provider error');
    normalized.status = err?.status || 502;
    normalized.code = err?.code || 'upstream_error';
    normalized.type = err?.type || 'api_error';
    return normalized;
  }
}

/** Alias export for modern architectural clarity */
export const ProviderAdapter = BaseProvider;
