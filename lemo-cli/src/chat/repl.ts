/**
 * Interactive Terminal REPL for Lemo CLI Chat Mode
 */

import readline from 'node:readline';
import pc from 'picocolors';
import { ChatSession } from './session.js';
import { LemoApiClient } from '../api/client/LemoApiClient.js';
import { ConfigManager } from '../core/config/index.js';
import { printBanner } from '../cli/interface/banner.js';
import type { ChatReplOptions } from './types.js';
import type { LemoConfig } from '../core/types/config.js';

export class ChatRepl {
  private readonly session: ChatSession;
  private readonly config: LemoConfig;
  private readonly input: NodeJS.ReadableStream;
  private readonly output: NodeJS.WritableStream;
  private activeAbortController: AbortController | null = null;

  constructor(options: ChatReplOptions = {}) {
    this.config = options.config || ConfigManager.load();
    const client = options.client || LemoApiClient.fromConfig(this.config);

    this.session = new ChatSession({
      client,
      config: this.config,
      modelOverride: options.modelOverride
    });

    this.input = options.input || process.stdin;
    this.output = options.output || process.stdout;
  }

  public getSession(): ChatSession {
    return this.session;
  }

  /**
   * Attempts connection to backend on startup.
   */
  private async connectWithRetry(): Promise<boolean> {
    const isTTY = Boolean((this.input as { isTTY?: boolean }).isTTY);

    while (true) {
      const initResult = await this.session.initialize();
      if (initResult.success) {
        return true;
      }

      const errText = [
        pc.red(`\n✖ Could not connect to backend at ${pc.bold(this.config.baseUrl)}`),
        pc.red(`  Reason: ${initResult.error || 'Unknown error'}`),
        '',
        pc.yellow('  Troubleshooting:'),
        pc.gray('   1. Ensure the Lemo Backend server is running (e.g. node src/server.js).'),
        pc.gray(`   2. Inspect current config: lemo config show`),
        pc.gray(`   3. Update base URL if needed: lemo config set baseUrl <url>`),
        ''
      ].join('\n');

      this.output.write(errText + '\n');

      if (!isTTY) {
        return false;
      }

      // Prompt user to retry or exit
      const answer = await this.askQuestion(pc.cyan('Would you like to [r]etry connection or [e]xit? '));
      const choice = answer.trim().toLowerCase();
      if (choice === 'r' || choice === 'retry') {
        this.output.write(pc.cyan('Retrying connection...\n'));
        continue;
      }

      return false;
    }
  }

  private askQuestion(query: string): Promise<string> {
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: this.input,
        output: this.output,
        terminal: false
      });
      rl.question(query, (ans) => {
        rl.close();
        resolve(ans);
      });
    });
  }

  /**
   * Starts the interactive REPL.
   */
  public async start(): Promise<void> {
    printBanner();

    this.output.write(pc.cyan('Connecting to backend...\n'));
    const connected = await this.connectWithRetry();
    if (!connected) {
      this.output.write(pc.yellow('Exiting chat.\n'));
      return;
    }

    const activeModel = this.session.getActiveModel();
    const box = [
      pc.gray('┌────────────────────────────────────────────────────────┐'),
      `${pc.gray('│')}  ${pc.green('✔')} Connected to Lemo Universal AI API Backend          ${pc.gray('│')}`,
      `${pc.gray('│')}  Active Model: ${pc.bold(pc.cyan(activeModel.padEnd(38)))} ${pc.gray('│')}`,
      `${pc.gray('│')}  Type your message or ${pc.bold('/help')} for slash commands         ${pc.gray('│')}`,
      pc.gray('└────────────────────────────────────────────────────────┘\n')
    ].join('\n');

    this.output.write(box + '\n');

    const rl = readline.createInterface({
      input: this.input,
      output: this.output,
      prompt: pc.cyan(pc.bold('You > ')),
      terminal: Boolean((this.input as { isTTY?: boolean }).isTTY)
    });

    // Handle Ctrl+C (SIGINT)
    rl.on('SIGINT', () => {
      if (this.activeAbortController) {
        this.activeAbortController.abort();
        this.activeAbortController = null;
        this.output.write(pc.yellow('\n[Response cancelled]\n\n'));
        rl.prompt();
      } else {
        this.output.write(pc.cyan('\nGoodbye!\n'));
        rl.close();
      }
    });

    rl.prompt();

    for await (const rawLine of rl) {
      const line = rawLine.trim();

      // Empty line -> prompt again
      if (!line) {
        rl.prompt();
        continue;
      }

      // Check slash commands
      if (line.startsWith('/')) {
        const cmdRes = await this.session.handleCommand(line);
        if (cmdRes.message) {
          this.output.write(cmdRes.message + '\n\n');
        }
        if (cmdRes.shouldExit) {
          rl.close();
          break;
        }
        rl.prompt();
        continue;
      }

      // Regular user chat prompt
      this.output.write('\n' + pc.green(pc.bold('Lemo > ')));

      const abortController = new AbortController();
      this.activeAbortController = abortController;

      try {
        await this.session.sendMessage(
          line,
          (token) => {
            this.output.write(token);
          },
          abortController.signal
        );
        this.output.write('\n\n');
      } catch (err: unknown) {
        if (!abortController.signal.aborted) {
          const errMsg = err instanceof Error ? err.message : String(err);
          this.output.write('\n' + pc.red(`✖ Error: ${errMsg}`) + '\n\n');
        }
      } finally {
        this.activeAbortController = null;
      }

      rl.prompt();
    }
  }
}

/**
 * CLI Entry helper for starting chat mode.
 */
export async function startChatSession(options: ChatReplOptions = {}): Promise<void> {
  const repl = new ChatRepl(options);
  await repl.start();
}
