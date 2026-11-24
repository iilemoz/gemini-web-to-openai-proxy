/**
 * ChatSession: Manages conversation state, model selection, and slash commands.
 */

import pc from 'picocolors';
import type { LemoApiClient } from '../api/client/LemoApiClient.js';
import type { LemoConfig } from '../core/types/config.js';
import type { BackendModel } from '../core/types/models.js';
import type { ChatMessage } from '../api/types/request.js';
import type { CommandResult, SendMessageResult, ChatSessionOptions } from './types.js';

export class ChatSession {
  private readonly client: LemoApiClient;
  private readonly config: LemoConfig;
  private activeModel: string;
  private availableModels: BackendModel[] = [];
  private messages: ChatMessage[] = [];

  constructor(options: ChatSessionOptions) {
    this.client = options.client;
    this.config = options.config;
    this.activeModel = options.modelOverride?.trim() || options.config.defaultModel || 'gemini-flash';
  }

  /**
   * Initializes the session by querying backend models and resolving active model.
   */
  public async initialize(modelOverride?: string): Promise<{ success: boolean; activeModel: string; error?: string }> {
    try {
      this.availableModels = await this.client.listModels();

      if (this.availableModels.length === 0) {
        return {
          success: false,
          activeModel: this.activeModel,
          error: 'Backend returned an empty list of models.'
        };
      }

      const target = (modelOverride?.trim() || this.activeModel).toLowerCase();
      const matched = this.availableModels.find(
        m => m.id.toLowerCase() === target || m.root?.toLowerCase() === target
      );

      if (matched) {
        this.activeModel = matched.id;
      } else {
        // If configured model not found, pick the first available model
        const fallback = this.availableModels[0];
        if (fallback) {
          const prev = this.activeModel;
          this.activeModel = fallback.id;
          console.log(pc.yellow(`ℹ Configured model '${prev}' not in backend list. Using available model '${this.activeModel}'.`));
        }
      }

      return {
        success: true,
        activeModel: this.activeModel
      };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        activeModel: this.activeModel,
        error: errMsg
      };
    }
  }

  public getActiveModel(): string {
    return this.activeModel;
  }

  public getConfig(): LemoConfig {
    return this.config;
  }

  public getAvailableModels(): BackendModel[] {
    return [...this.availableModels];
  }

  public getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  public clearHistory(): void {
    this.messages = [];
  }

  /**
   * Switches the active model if it exists in the available models list.
   */
  public switchModel(modelId: string): { success: boolean; message: string } {
    const trimmed = modelId.trim();
    if (!trimmed) {
      return { success: false, message: 'Please specify a model ID: /model <model-id>' };
    }

    const matched = this.availableModels.find(
      m => m.id.toLowerCase() === trimmed.toLowerCase() || m.root?.toLowerCase() === trimmed.toLowerCase()
    );

    if (!matched) {
      return {
        success: false,
        message: `Model '${trimmed}' is not recognized by the backend. Run /models to see available models.`
      };
    }

    this.activeModel = matched.id;
    return {
      success: true,
      message: `Active model switched to: ${pc.green(pc.bold(this.activeModel))}`
    };
  }

  /**
   * Refreshes the available models list from the backend.
   */
  public async refreshModels(): Promise<{ success: boolean; count: number; error?: string }> {
    try {
      this.availableModels = await this.client.listModels();
      return {
        success: true,
        count: this.availableModels.length
      };
    } catch (err: unknown) {
      return {
        success: false,
        count: 0,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }

  /**
   * Sends a user message and streams assistant tokens as they arrive.
   */
  public async sendMessage(
    userText: string,
    onToken: (token: string) => void,
    signal?: AbortSignal
  ): Promise<SendMessageResult> {
    const trimmed = userText.trim();
    if (!trimmed) {
      return { content: '' };
    }

    // Append user message to active history
    const userMsg: ChatMessage = { role: 'user', content: trimmed };
    this.messages.push(userMsg);

    let assistantContent = '';
    let wasAborted = false;

    try {
      const stream = await this.client.createChatCompletionStream(
        {
          model: this.activeModel,
          messages: this.messages
        },
        { signal }
      );

      for await (const chunk of stream) {
        if (signal?.aborted) {
          wasAborted = true;
          break;
        }

        const delta = chunk.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta.length > 0) {
          assistantContent += delta;
          onToken(delta);
        }
      }

      if (wasAborted || signal?.aborted) {
        if (assistantContent.length > 0) {
          this.messages.push({
            role: 'assistant',
            content: `${assistantContent} [Response cancelled]`
          });
        } else {
          // Remove the orphaned user message if aborted before any token arrived
          this.messages.pop();
        }
        return { content: assistantContent, aborted: true };
      }

      // Persist complete assistant response
      this.messages.push({
        role: 'assistant',
        content: assistantContent
      });

      return { content: assistantContent };
    } catch (err: unknown) {
      if (signal?.aborted) {
        if (assistantContent.length > 0) {
          this.messages.push({
            role: 'assistant',
            content: `${assistantContent} [Response cancelled]`
          });
        } else {
          this.messages.pop();
        }
        return { content: assistantContent, aborted: true };
      }

      // On error, remove the unresolved user prompt to keep conversation clean
      this.messages.pop();
      throw err;
    }
  }

  /**
   * Parses and executes slash commands.
   */
  public async handleCommand(input: string): Promise<CommandResult> {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) {
      return { handled: false };
    }

    const parts = trimmed.split(/\s+/);
    const command = parts[0]?.toLowerCase();
    const args = parts.slice(1).join(' ').trim();

    switch (command) {
      case '/help': {
        const text = [
          pc.bold(pc.cyan('Available Slash Commands:')),
          `  ${pc.bold('/help')}              Display this help message`,
          `  ${pc.bold('/models')}            List all models returned by the backend`,
          `  ${pc.bold('/model')}             Display the currently active model`,
          `  ${pc.bold('/model <model-id>')}  Switch active model to <model-id>`,
          `  ${pc.bold('/refresh')}           Refresh available models from backend`,
          `  ${pc.bold('/clear')}             Clear active conversation history`,
          `  ${pc.bold('/exit')}              Exit the chat session`
        ].join('\n');
        return { handled: true, message: text };
      }

      case '/models': {
        if (this.availableModels.length === 0) {
          return { handled: true, message: pc.yellow('No models found on backend. Run /refresh to query again.') };
        }
        const lines = [
          pc.bold(pc.cyan(`Available Models (${this.availableModels.length}):`))
        ];
        for (const m of this.availableModels) {
          const isActive = m.id.toLowerCase() === this.activeModel.toLowerCase();
          const marker = isActive ? pc.green(pc.bold(' * ')) : '   ';
          const capList: string[] = [];
          if (m.capabilities?.tools) capList.push('tools');
          if (m.capabilities?.stream) capList.push('stream');
          if (m.capabilities?.vision) capList.push('vision');
          const capStr = capList.length > 0 ? pc.gray(`[${capList.join(', ')}]`) : '';
          const activeLabel = isActive ? pc.green('(active)') : '';
          const desc = m.description ? pc.gray(`- ${m.description}`) : '';
          lines.push(`${marker}${pc.bold(m.id)} ${activeLabel} ${capStr} ${desc}`);
        }
        return { handled: true, message: lines.join('\n') };
      }

      case '/model': {
        if (args) {
          const res = this.switchModel(args);
          return { handled: true, message: res.message };
        }
        const current = this.availableModels.find(m => m.id.toLowerCase() === this.activeModel.toLowerCase());
        const desc = current?.description ? ` (${current.description})` : '';
        return {
          handled: true,
          message: `Active model: ${pc.green(pc.bold(this.activeModel))}${pc.gray(desc)}`
        };
      }

      case '/refresh': {
        const res = await this.refreshModels();
        if (res.success) {
          return {
            handled: true,
            message: pc.green(`✔ Refreshed models list. Found ${res.count} available models.`)
          };
        }
        return {
          handled: true,
          message: pc.red(`✖ Failed to refresh models: ${res.error}`)
        };
      }

      case '/clear': {
        this.clearHistory();
        return {
          handled: true,
          message: pc.yellow('✔ Conversation history cleared.')
        };
      }

      case '/exit':
      case '/quit': {
        return { handled: true, shouldExit: true, message: pc.cyan('Goodbye!') };
      }

      default: {
        return {
          handled: true,
          message: pc.yellow(`Unknown command '${command}'. Type ${pc.bold('/help')} for available commands.`)
        };
      }
    }
  }
}
