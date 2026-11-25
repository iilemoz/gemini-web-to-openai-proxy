import { Gemini, Model } from 'gemini-web-sdk';
import { logger } from '../../utils/logger.js';
import { config } from '../../config/index.js';

/**
 * Engine for Google Gemini Web (Guest & Account Modes).
 * Operates purely via HTTP requests with no browser or Puppeteer.
 * Text-only input and output.
 */
export class GeminiEngine {
  constructor() {
    // Account-mode clients are cached by their __Secure-1PSID token.
    // Guest-mode clients are created fresh per-request and closed after use.
    this.accountClients = new Map();
  }

  // ---------------------------------------------------------------------------
  // Client management
  // ---------------------------------------------------------------------------

  /**
   * Returns { client, isTemporary }.
   * - Account mode: returns a cached, long-lived Gemini client.
   * - Guest mode:   returns a brand-new Gemini client that the caller MUST
   *                 close after use to prevent memory / socket leaks.
   *
   * @param {string} [token] - Optional client-provided __Secure-1PSID or full cookie.
   * @returns {{ client: Gemini, isTemporary: boolean }}
   */
  getClient(token) {
    const envPsid = config.geminiSecure1psid || '';
    let secure1psid = envPsid;

    // Only treat the token as a Google cookie if it looks like one
    if (!secure1psid && token) {
      if (token.startsWith('g.a.') || token.includes('__Secure-1PSID') || token.length > 60) {
        secure1psid = token.replace(/.*?__Secure-1PSID=([^;]+).*/, '$1').trim();
      }
    }

    const secure1psidts = config.geminiSecure1psidts || '';

    // ── Account Mode ──────────────────────────────────────────────────────────
    if (secure1psid) {
      if (this.accountClients.has(secure1psid)) {
        return { client: this.accountClients.get(secure1psid), isTemporary: false };
      }

      logger.info('[GeminiEngine] Initializing Account Mode client');
      const clientOptions = { secure_1psid: secure1psid, autoClose: false };
      if (config.upstreamProxy) clientOptions.proxy = config.upstreamProxy;
      const client = new Gemini(clientOptions);

      if (secure1psidts) {
        client.cookies['__Secure-1PSIDTS'] = secure1psidts;
      }

      this.accountClients.set(secure1psid, client);
      return { client, isTemporary: false };
    }

    // ── Guest Mode ────────────────────────────────────────────────────────────
    const guestOptions = { autoClose: false };
    if (config.upstreamProxy) guestOptions.proxy = config.upstreamProxy;
    return {
      client: new Gemini(guestOptions),
      isTemporary: true
    };
  }

  // ---------------------------------------------------------------------------
  // Model resolution
  // ---------------------------------------------------------------------------

  /**
   * Resolves a user-facing model string to a gemini-web-sdk ModelDef.
   * @param {string} modelName
   * @returns {import('gemini-web-sdk').ModelDef}
   */
  resolveModel(modelName = '') {
    const lower = String(modelName).toLowerCase();

    if (lower.includes('think')) {
      return Model.BASIC_THINKING;
    }

    if (lower.includes('pro') || lower.includes('advanced')) {
      return Model.BASIC_PRO;
    }

    if (lower.includes('lite')) {
      return Model.BASIC_LITE;
    }

    // Default to the fast Flash model
    return Model.BASIC_FLASH;
  }

  // ---------------------------------------------------------------------------
  // Prompt / message formatting
  // ---------------------------------------------------------------------------

  /**
   * Formats tool definitions into a system-level instruction block that
   * instructs Gemini to respond with <tool_call> JSON when needed.
   * @param {Array<Object>} tools - OpenAI-format tool definitions.
   * @returns {string}
   */
  formatToolsInstruction(tools) {
    if (!Array.isArray(tools) || tools.length === 0) return '';

    const toolDefs = tools.map(t => {
      const fn = t.function || t;
      return {
        name: fn.name,
        description: fn.description || '',
        parameters: fn.parameters || {}
      };
    });

    return `\n[TOOL CALLING PIPELINE]
You are an autonomous AI coding assistant integrated with an active tool execution pipeline in VS Code.
All tools listed below are 100% AVAILABLE, ACTIVE, AND READY for you to use in this workspace.
NEVER say or claim that tools, file editing, or terminal commands are "not available in this session" or unavailable. You have full autonomous permission to write, edit, and read files.
Available tools:
${JSON.stringify(toolDefs, null, 2)}

Instructions for tool calling:
- When the user asks you to create, write, edit, shorten, modify, or delete files, or run commands, you MUST invoke the matching tool from the list above.
- If the user asks to modify an existing file (e.g. shorten lines, fix code, or make it exactly 100 lines), invoke write_file or edit_file directly to update that file!
- If the user asks to create, build, or write code/scripts without specifying an exact filename, choose an appropriate default filename (e.g. script.js, server.js, index.js) and invoke write_file to save it.
- NEVER ask the user to manually copy-paste code or manually create files.
- Output your tool call in this exact format:
<tool_call>
{"name": "tool_name", "arguments": {"param1": "value1"}}
</tool_call>
- You may include a brief sentence before or after the tool call explaining what you are doing.`;
  }

  /**
   * Formats a single message's content into a plain text string for the prompt.
   * Handles:
   *   - Plain string content.
   *   - Content arrays with 'text' parts.
   *   - Assistant messages carrying previous tool_calls.
   * @param {Object} msg
   * @returns {string}
   */
  formatMessageContent(msg) {
    let text = '';
    if (typeof msg.content === 'string') {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      text = msg.content
        .map(p => (typeof p === 'string' ? p : p?.text || ''))
        .filter(Boolean)
        .join('\n');
    }

    // If the assistant message carries previous tool_calls, replay them so the
    // model understands the conversation history.
    if (msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      for (const tc of msg.tool_calls) {
        const fnName = tc.function?.name || 'tool';
        let fnArgs = tc.function?.arguments || '{}';
        try {
          if (typeof fnArgs === 'string') fnArgs = JSON.parse(fnArgs);
        } catch { /* leave as-is if unparseable */ }
        text += `\n<tool_call>\n${JSON.stringify({ name: fnName, arguments: fnArgs }, null, 2)}\n</tool_call>`;
      }
    }

    return text.trim();
  }

  /**
   * Formats an OpenAI messages array into a single prompt string consumed by
   * the Gemini Web SDK. System messages are hoisted to the top; conversation
   * turns follow in User / Model / Tool Result order.
   * @param {Array<{role: string, content: string|Array}>} messages
   * @param {Array<Object>} [tools]
   * @returns {string}
   */
  formatPrompt(messages, tools = []) {
    if (!Array.isArray(messages) || messages.length === 0) return '';

    // Drop empty / invalid messages
    const validMessages = messages.filter(m => m && (
      (typeof m.content === 'string' && m.content.trim().length > 0) ||
      (Array.isArray(m.content) && m.content.length > 0) ||
      (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) ||
      (m.role === 'tool' || m.role === 'function')
    ));

    if (validMessages.length === 0) return '';

    const systemMessages  = validMessages.filter(m => m.role === 'system' || m.role === 'developer');
    const conversation    = validMessages.filter(m => m.role !== 'system' && m.role !== 'developer');

    const hasTools        = Array.isArray(tools) && tools.length > 0;
    const baseInstruction = hasTools
      ? 'Do not output audio widget links or media tokens.'
      : 'Respond in plain text or markdown directly. Do not output audio widget links or media tokens.';
    const toolsInstruction = this.formatToolsInstruction(tools);

    const systemParts = [baseInstruction];
    if (systemMessages.length > 0) {
      systemParts.push(...systemMessages.map(m => this.formatMessageContent(m)));
    }
    if (toolsInstruction) {
      systemParts.push(toolsInstruction);
    }

    let prompt = `${systemParts.join('\n\n')}\n\n`;

    for (const msg of conversation) {
      let role = 'User';
      if (msg.role === 'assistant') {
        role = 'Model';
      } else if (msg.role === 'tool' || msg.role === 'function') {
        role = `Tool Result (${msg.name || msg.tool_call_id || 'function'})`;
      }
      prompt += `${role}: ${this.formatMessageContent(msg)}\n\n`;
    }

    prompt += 'Model:';
    return prompt.trim();
  }

  // ---------------------------------------------------------------------------
  // Fallback and guest execution helpers
  // ---------------------------------------------------------------------------

  /**
   * Factory method to create a Guest Gemini client instance.
   * Can be overridden or spied on in tests to inspect invocation arguments.
   * @returns {import('gemini-web-sdk').Gemini}
   */
  createGuestClient() {
    return new Gemini({ autoClose: false });
  }

  /**
   * Executes Guest Mode fallback on account quota exhaustion with strict model identity enforcement.
   * If requested model is Model.BASIC_FLASH, falls back to Guest Mode with exact Model.BASIC_FLASH.
   * If requested model is any non-Flash model (e.g. Pro, Thinking), fails closed with HTTP 429 insufficient_quota.
   *
   * @param {Object} params
   * @param {import('gemini-web-sdk').ModelDef} params.resolvedModel
   * @param {boolean} params.isGuest
   * @param {Object} params.generateOpts
   * @param {AbortSignal} [params.signal]
   * @param {Error} params.err
   * @returns {AsyncGenerator<Object>}
   */
  async *executeWithFallback({ resolvedModel, isGuest, generateOpts, signal, err }) {
    const isLimitErr =
      !isGuest && (
        err.name === 'UsageLimitExceeded' ||
        err.message?.includes('not available for your account plan') ||
        err.message?.includes('Usage limit exceeded')
      );

    if (!isLimitErr) {
      throw err;
    }

    // Enforce model identity integrity: only allow Guest fallback if the requested model is BASIC_FLASH
    if (resolvedModel === Model.BASIC_FLASH) {
      logger.warn(`[GeminiEngine] Account plan restriction for Flash (${err.message}). Falling back to Guest Mode (same model)…`);

      const guestClient = this.createGuestClient();
      try {
        const guestChat = guestClient.newChat({ model: Model.BASIC_FLASH });
        const guestStream = await guestChat.generateContentStream(generateOpts);

        for await (const chunk of guestStream) {
          if (signal?.aborted) return;

          const candidate = chunk.candidates?.find(c => c.index === 0) || chunk.candidates?.[0];
          if (!candidate) continue;

          if (candidate.thoughts_delta) {
            yield { type: 'thinking', text: candidate.thoughts_delta };
          }

          if (candidate.text_delta) {
            const clean = candidate.text_delta.replace(/https?:\/\/googleusercontent\.com\/[^\s\n]+/gi, '');
            if (clean) {
              yield { type: 'content', text: clean };
            }
          }
        }
      } finally {
        guestClient.close().catch(() => {});
      }
    } else {
      // Requested model is Pro, Thinking, Lite, etc.
      // Silently downgrading to Flash is strictly forbidden. Fail closed!
      logger.error(
        `[GeminiEngine] Account quota exceeded for requested model '${resolvedModel.model_name}'. ` +
        `Silent downgrade to Flash is prohibited.`
      );
      const quotaErr = new Error(
        `Account quota or plan limit exceeded for model '${resolvedModel.model_name}'. ` +
        `Automatic downgrade to another model is disabled to maintain model identity integrity.`
      );
      quotaErr.status = 429;
      quotaErr.code = 'insufficient_quota';
      quotaErr.type = 'insufficient_quota';
      throw quotaErr;
    }
  }

  // ---------------------------------------------------------------------------
  // Core streaming
  // ---------------------------------------------------------------------------

  /**
   * Streams a text chat completion from Google Gemini Web.
   *
   * Yields:
   *   { type: 'thinking', text: string }  – reasoning / thinking tokens
   *   { type: 'content',  text: string }  – regular response tokens
   *
   * Lifecycle notes:
   *   - Guest-mode Gemini clients created here are **always closed** in the
   *     finally block to prevent HTTP socket and timer leaks.
   *   - If `signal` is aborted (client disconnected), generation stops
   *     immediately without throwing.
   *
   * @param {Object}      params
   * @param {string}      params.model
   * @param {Array}       params.messages
   * @param {string}      [params.token]
   * @param {Array}       [params.tools]
   * @param {AbortSignal} [params.signal]  - Abort signal for early cancellation.
   * @yields {{ type: string, text: string }}
   */
  async *streamChat({ model, messages, token, tools = [], signal }) {
    const { client, isTemporary } = this.getClient(token);
    const resolvedModel = this.resolveModel(model);
    const prompt = this.formatPrompt(messages, tools);

    if (!prompt) {
      logger.warn('[GeminiEngine] Prompt is empty after filtering messages.');
      return;
    }

    const isGuest = isTemporary;
    logger.info(
      `[GeminiEngine] Starting chat | Mode: ${isGuest ? 'Guest (Anonymous)' : 'Account'} | ` +
      `Model: ${resolvedModel.model_name}`
    );

    const generateOpts = { prompt };

    let hasYieldedContent = false;
    let chat;
    let abortListener = null;

    try {
      if (signal?.aborted) {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        throw err;
      }

      const abortPromise = new Promise((_, reject) => {
        abortListener = () => {
          if (isTemporary && client) {
            try { client.close(); } catch (_) {}
          }
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
        };
        signal?.addEventListener('abort', abortListener, { once: true });
      });

      chat = client.newChat({ model: resolvedModel });
      const stream = await Promise.race([
        chat.generateContentStream(generateOpts),
        abortPromise
      ]);

      for await (const chunk of stream) {
        // Respect client disconnect
        if (signal?.aborted) {
          logger.info('[GeminiEngine] Stream aborted by client.');
          return;
        }

        const candidate = chunk.candidates?.find(c => c.index === 0) || chunk.candidates?.[0];
        if (!candidate) continue;

        // Yield reasoning / thinking tokens (Gemini Thinking models)
        if (candidate.thoughts_delta) {
          yield { type: 'thinking', text: candidate.thoughts_delta };
        }

        // Yield content tokens; strip stray Google CDN URLs
        if (candidate.text_delta) {
          const clean = candidate.text_delta.replace(/https?:\/\/googleusercontent\.com\/[^\s\n]+/gi, '');
          if (clean) {
            hasYieldedContent = true;
            yield { type: 'content', text: clean };
          }
        }
      }

    } catch (err) {
      yield* this.executeWithFallback({ resolvedModel, isGuest, generateOpts, signal, err });
    } finally {
      if (abortListener && signal) {
        signal.removeEventListener('abort', abortListener);
      }

      // Safety fallback: if the stream ended without any deltas, yield lastOutput
      if (!hasYieldedContent && chat?.lastOutput?.text) {
        const fallback = chat.lastOutput.text
          .replace(/https?:\/\/googleusercontent\.com\/[^\s\n]+/gi, '')
          .trim();
        if (fallback) {
          logger.info('[GeminiEngine] Yielding fallback text from lastOutput');
          yield { type: 'content', text: fallback };
        }
      }

      if (isTemporary) {
        client.close().catch(() => {});
      }
    }
  }
}
