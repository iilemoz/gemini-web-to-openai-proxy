import { BaseProvider } from '../BaseProvider.js';
import { GeminiEngine } from './GeminiEngine.js';
import { logger } from '../../utils/logger.js';

/**
 * Google Gemini Provider.
 * Supports both Guest Mode (instant, no login) and Account Mode (via cookies).
 * Delegates all generation work to GeminiEngine.
 */
export class GeminiProvider extends BaseProvider {
  constructor() {
    super('gemini');
    this.engine = new GeminiEngine();
  }

  /**
   * Gemini is our sole primary provider and handles all models.
   * @param {string} _modelId
   * @returns {boolean}
   */
  supportsModel(_modelId) {
    return true;
  }

  /**
   * Execute chat completion and yield typed text delta chunks.
   *
   * @param {Object}      params
   * @param {string}      params.model
   * @param {Array}       params.messages
   * @param {boolean}     params.stream
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
}
