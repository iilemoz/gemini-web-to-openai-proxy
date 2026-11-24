/**
 * Abstract base class for LLM providers.
 * Any new provider (e.g. Gemini, Claude, Mistral) should extend this class
 * and implement chatComplete().
 */
export class BaseProvider {
  constructor(name) {
    if (new.target === BaseProvider) {
      throw new TypeError('Cannot construct BaseProvider instances directly.');
    }
    /** @type {string} Provider identifier used in the registry. */
    this.name = name;
  }

  /**
   * Check whether this provider supports the requested model.
   * Override in subclasses to restrict handling to specific model IDs.
   * @param {string} _modelId
   * @returns {boolean}
   */
  supportsModel(_modelId) {
    return true;
  }

  /**
   * Execute a chat completion and yield typed text delta chunks.
   *
   * @param {Object}      params
   * @param {string}      params.model
   * @param {Array<{role: string, content: string}>} params.messages
   * @param {boolean}     params.stream
   * @param {string}      [params.token]   - Access token / Google cookie if provided by the client.
   * @param {Array}       [params.tools]   - OpenAI-format tool definitions.
   * @param {*}           [params.tool_choice]
   * @param {AbortSignal} [params.signal]  - Abort signal; stop generation when aborted.
   * @yields {{ type: 'content' | 'thinking', text: string }}
   */
  async *chatComplete(params) { // eslint-disable-line no-unused-vars
    throw new Error('chatComplete() must be implemented by the subclass.');
  }
}
