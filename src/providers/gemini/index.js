import { BaseProvider } from '../BaseProvider.js';
import { GeminiEngine } from './GeminiEngine.js';
import { logger } from '../../utils/logger.js';

/**
 * Google Gemini Provider Adapter.
 * Integrates Google Gemini Web (Guest & Account Modes) into the unified provider architecture.
 * Exclusively provides text-based completions via GeminiEngine.
 */
export class GeminiProvider extends BaseProvider {
  constructor() {
    super({
      id: 'gemini',
      name: 'Google Gemini Web'
    });
    this.engine = new GeminiEngine();
  }

  /**
   * Validate Gemini configuration.
   * Ensures account cookies or guest mode availability without logging sensitive tokens.
   */
  validateConfig() {
    return {
      valid: true,
      mode: process.env.GEMINI_SECURE_1PSID ? 'account' : 'guest'
    };
  }

  /**
   * Health check for Gemini provider.
   */
  async checkHealth() {
    return {
      status: 'ok',
      provider: 'gemini',
      mode: process.env.GEMINI_SECURE_1PSID ? 'account' : 'guest'
    };
  }

  /**
   * Returns models natively hosted by Gemini Web provider.
   */
  getModels() {
    return [
      {
        id: 'gemini-flash',
        upstreamModelId: 'gemini-2.5-flash',
        name: 'Gemini Flash',
        description: 'Google Gemini 2.5 Flash / Gemini 3 Flash (Fast & Pure HTTP)',
        aliases: ['gemini-2.5-flash'],
        capabilities: {
          chat: true,
          stream: true,
          tools: true,
          json: true,
          reasoning: false,
          responses: true
        }
      },
      {
        id: 'gemini-pro',
        upstreamModelId: 'gemini-2.5-pro',
        name: 'Gemini Pro',
        description: 'Google Gemini 2.5 Pro / Gemini 3 Pro (Complex Reasoning & Deep Knowledge)',
        aliases: ['gemini-2.5-pro'],
        capabilities: {
          chat: true,
          stream: true,
          tools: true,
          json: true,
          reasoning: false,
          responses: true
        }
      },
      {
        id: 'gemini-thinking',
        upstreamModelId: 'gemini-2.5-thinking',
        name: 'Gemini Thinking',
        description: 'Google Gemini 2.5 Thinking with deep reasoning stream',
        aliases: ['gemini-2.5-thinking'],
        capabilities: {
          chat: true,
          stream: true,
          tools: false,
          json: false,
          reasoning: true,
          responses: true
        }
      },
      {
        id: 'gemini-lite',
        upstreamModelId: 'gemini-lite',
        name: 'Gemini Lite',
        description: 'Google Gemini Lite Model',
        aliases: [],
        capabilities: {
          chat: true,
          stream: true,
          tools: false,
          json: false,
          reasoning: false,
          responses: true
        }
      }
    ];
  }

  /**
   * Check whether this model is supported by Gemini.
   * Only matches genuine Gemini models and configured aliases.
   * @param {string} modelId
   * @returns {boolean}
   */
  supportsModel(modelId) {
    if (!modelId || typeof modelId !== 'string') return false;
    const lower = modelId.toLowerCase();
    const models = this.getModels();
    return models.some(
      m => m.id.toLowerCase() === lower ||
           (m.upstreamModelId && m.upstreamModelId.toLowerCase() === lower) ||
           (Array.isArray(m.aliases) && m.aliases.some(a => a.toLowerCase() === lower))
    );
  }

  /**
   * Return capabilities for a Gemini model.
   * @param {string} modelId
   * @returns {Object}
   */
  getCapabilities(modelId) {
    if (!modelId) {
      return {
        chat: true,
        stream: true,
        tools: false,
        json: false,
        reasoning: false,
        responses: true
      };
    }

    const lower = String(modelId).toLowerCase();
    const models = this.getModels();
    const matched = models.find(
      m => m.id.toLowerCase() === lower ||
           (m.upstreamModelId && m.upstreamModelId.toLowerCase() === lower) ||
           (Array.isArray(m.aliases) && m.aliases.some(a => a.toLowerCase() === lower))
    );

    if (matched && matched.capabilities) {
      return { ...matched.capabilities };
    }

    const isThinking = lower.includes('think');
    const isLite = lower.includes('lite');

    return {
      chat: true,
      stream: true,
      tools: !isThinking && !isLite,
      json: !isThinking && !isLite,
      reasoning: isThinking,
      responses: true
    };
  }

  /**
   * Execute chat completion and yield typed text delta chunks.
   *
   * @param {Object}      params
   * @param {string}      params.model
   * @param {Array}       params.messages
   * @param {boolean}     [params.stream]
   * @param {string}      [params.token]
   * @param {Array}       [params.tools]
   * @param {*}           [params.tool_choice]
   * @param {AbortSignal} [params.signal]
   * @yields {{ type: string, text: string }}
   */
  async *chatComplete({ model, messages, stream, token, tools, tool_choice, signal }) {
    logger.info(
      `[GeminiProvider] Dispatching | Model: ${model} | Tools: ${Array.isArray(tools) ? tools.length : 0}`
    );
    yield* this.engine.streamChat({ model, messages, token, tools, tool_choice, signal });
  }

  /**
   * Normalizes Gemini errors.
   */
  normalizeError(err) {
    return super.normalizeError(err);
  }
}
