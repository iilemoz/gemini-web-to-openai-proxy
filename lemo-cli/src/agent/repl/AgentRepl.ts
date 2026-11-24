/**
 * Interactive Terminal REPL for Lemo CLI Agent Mode
 */

import readline from 'node:readline';
import pc from 'picocolors';
import { AgentSession } from '../session/AgentSession.js';
import { LemoApiClient } from '../../api/client/LemoApiClient.js';
import { ConfigManager } from '../../core/config/index.js';
import { printBanner } from '../../cli/interface/banner.js';
import { CallbackApprovalPolicy, type ApprovalPolicy } from '../policies/ApprovalPolicy.js';
import type { Tool } from '../tools/Tool.js';
import type { ApprovalDecision, AgentEvent, ToolExecutionContext } from '../types/index.js';
import type { LemoConfig } from '../../core/types/config.js';

export interface AgentReplOptions {
  config?: LemoConfig | undefined;
  client?: LemoApiClient | undefined;
  session?: AgentSession | undefined;
  modelOverride?: string | undefined;
  workspace?: string | undefined;
  approvalPolicy?: ApprovalPolicy | undefined;
  input?: NodeJS.ReadableStream | undefined;
  output?: NodeJS.WritableStream | undefined;
}

export class AgentRepl {
  private readonly session: AgentSession;
  private readonly config: LemoConfig;
  private readonly input: NodeJS.ReadableStream;
  private readonly output: NodeJS.WritableStream;
  private activeAbortController: AbortController | null = null;
  private rl: readline.Interface | null = null;
  private lineIterator: AsyncIterator<string> | null = null;
  private shouldExit = false;

  constructor(options: AgentReplOptions = {}) {
    this.config = options.config || ConfigManager.load();
    const client = options.client || LemoApiClient.fromConfig(this.config);
    this.input = options.input || process.stdin;
    this.output = options.output || process.stdout;

    const approvalPolicy = options.approvalPolicy || this.createDefaultApprovalPolicy();

    this.session = options.session || new AgentSession({
      client,
      config: this.config,
      modelOverride: options.modelOverride,
      workspace: options.workspace,
      approvalPolicy
    });

    // Wire up event listener to render agent steps
    this.session.getAgent().on((event) => {
      this.handleAgentEvent(event);
    });
  }

  public getSession(): AgentSession {
    return this.session;
  }

  /**
   * Constructs approval policy conforming to user configuration (always, action, never).
   */
  private createDefaultApprovalPolicy(): ApprovalPolicy {
    return new CallbackApprovalPolicy(
      async (tool: Tool, args: Record<string, unknown>, context?: ToolExecutionContext): Promise<ApprovalDecision> => {
        const mode = this.config.approvalMode || 'action';

        // Check if aborted prior to prompt
        if (context?.signal?.aborted || this.activeAbortController?.signal.aborted) {
          return { approved: false, reason: 'Operation cancelled by user' };
        }

        if (mode === 'never') {
          return { approved: true };
        }

        if (mode === 'action') {
          const perms = tool.permissions || [];
          const isReadOnly = perms.every((p) => p === 'read_only') || perms.length === 0;
          if (isReadOnly) {
            return { approved: true };
          }
        }

        // 'always' mode or 'action' with mutating/privileged permissions requires interactive user prompt
        return this.promptApproval(tool, args, context);
      }
    );
  }

  /**
   * Interactively prompts user in terminal for tool execution approval.
   */
  private async promptApproval(
    tool: Tool,
    args: Record<string, unknown>,
    context?: ToolExecutionContext
  ): Promise<ApprovalDecision> {
    const isTTY = Boolean((this.input as { isTTY?: boolean }).isTTY);

    const perms = tool.permissions && tool.permissions.length > 0
      ? tool.permissions.join(', ')
      : 'none (safe)';

    let previewSection: string;
    try {
      if (typeof tool.prepareApproval === 'function') {
        const prep = await tool.prepareApproval(args, context);
        if (prep?.preview) {
          previewSection = `  ${pc.bold('Proposed Changes / Diff:')}\n` +
            prep.preview
              .split('\n')
              .map((line) => `    ${line}`)
              .join('\n');
        } else {
          previewSection = `  ${pc.bold('Arguments:')}\n` +
            JSON.stringify(args, null, 2)
              .split('\n')
              .map((line) => `    ${pc.gray(line)}`)
              .join('\n');
        }
      } else {
        previewSection = `  ${pc.bold('Arguments:')}\n` +
          JSON.stringify(args, null, 2)
            .split('\n')
            .map((line) => `    ${pc.gray(line)}`)
            .join('\n');
      }
    } catch {
      previewSection = `  ${pc.bold('Arguments:')}\n` +
        JSON.stringify(args, null, 2)
          .split('\n')
          .map((line) => `    ${pc.gray(line)}`)
          .join('\n');
    }

    const promptCard = [
      '',
      pc.yellow('╭────────────────────────────────────────────────────────╮'),
      pc.yellow('│ ⚠  TOOL EXECUTION APPROVAL REQUIRED                    │'),
      pc.yellow('╰────────────────────────────────────────────────────────╯'),
      `  ${pc.bold('Tool:')}        ${pc.cyan(tool.name)}`,
      `  ${pc.bold('Permissions:')} ${pc.yellow(perms)}`,
      previewSection,
      ''
    ].join('\n');

    this.output.write(promptCard + '\n');

    // In non-interactive environments without explicit approval, deny safely
    if (!isTTY) {
      this.output.write(pc.red('  ✖ Non-interactive terminal: auto-denied privileged operation.\n\n'));
      return { approved: false, reason: 'Non-interactive environment requires explicit pre-approval' };
    }

    const answer = await this.nextLine(pc.bold(pc.yellow('Approve this operation? [y/N]: ')));
    if (answer === null) {
      return { approved: false, reason: 'Input stream closed before approval' };
    }

    const normalized = answer.trim().toLowerCase();
    const approved = normalized === 'y' || normalized === 'yes';

    if (approved) {
      this.output.write(pc.green('  ✔ Approved by user\n\n'));
      return { approved: true };
    } else {
      this.output.write(pc.red('  ✖ Denied by user\n\n'));
      return { approved: false, reason: 'Tool execution denied by user.' };
    }
  }

  /**
   * Reads next line from input stream using async line iterator.
   */
  private async nextLine(promptText?: string): Promise<string | null> {
    if (this.shouldExit || !this.lineIterator) {
      return null;
    }

    if (promptText) {
      this.output.write(promptText);
    }

    const res = await this.lineIterator.next();
    if (res.done) {
      this.shouldExit = true;
      return null;
    }
    return res.value;
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

      const answer = await this.nextLine(pc.cyan('Would you like to [r]etry connection or [e]xit? '));
      if (answer === null) {
        return false;
      }
      const choice = answer.trim().toLowerCase();
      if (choice === 'r' || choice === 'retry') {
        this.output.write(pc.cyan('Retrying connection...\n'));
        continue;
      }

      return false;
    }
  }

  /**
   * Event listener rendering Agent lifecycle transitions and tool steps.
   */
  private handleAgentEvent(event: AgentEvent): void {
    const { type, payload } = event;

    switch (type) {
      case 'turn_start': {
        const iter = payload['iteration'] ?? '?';
        this.output.write(pc.gray(`\n── Turn ${iter} ───────────────────────────────────────\n`));
        break;
      }

      case 'model_request': {
        const model = payload['model'] ?? this.session.getActiveModel();
        const toolsCount = payload['toolsCount'] ?? 0;
        this.output.write(pc.gray(`  [Request] Submitting task to ${pc.cyan(String(model))} (${toolsCount} tools available)...\n`));
        break;
      }

      case 'model_response': {
        if (payload['hasToolCalls']) {
          const count = payload['toolCallsCount'] ?? 0;
          this.output.write(pc.cyan(`  [Response] Model requested ${count} tool execution(s).\n`));
        } else {
          this.output.write(pc.gray(`  [Response] Model generated response.\n`));
        }
        break;
      }

      case 'tool_call_requested': {
        const toolName = String(payload['name'] || 'unknown');
        let argsStr = String(payload['arguments'] || '{}');
        try {
          const parsed = JSON.parse(argsStr);
          argsStr = JSON.stringify(parsed);
        } catch {
          // Keep raw string if not JSON
        }
        this.output.write(`  ${pc.yellow('⚙')} ${pc.bold('Tool Requested:')} ${pc.cyan(toolName)} ${pc.gray(argsStr)}\n`);
        break;
      }

      case 'tool_executing': {
        const toolName = String(payload['name'] || 'unknown');
        this.output.write(pc.gray(`    Executing ${toolName}...\n`));
        break;
      }

      case 'tool_executed': {
        const toolName = String(payload['name'] || 'unknown');
        const duration = payload['durationMs'] ? `${payload['durationMs']}ms` : '';
        if (payload['success']) {
          this.output.write(`    ${pc.green('✔')} ${pc.bold(toolName)} finished ${pc.gray(duration)}\n`);
          if (payload['result']) {
            const preview = this.formatDataPreview(payload['result']);
            this.output.write(`      ${pc.gray('Result:')} ${pc.white(preview)}\n`);
          }
        } else {
          this.output.write(`    ${pc.red('✖')} ${pc.bold(toolName)} failed ${pc.gray(duration)}: ${pc.red(String(payload['error'] || 'Unknown error'))}\n`);
        }
        break;
      }

      case 'tool_approval_granted': {
        this.output.write(pc.green(`    ✔ Operation approved for ${String(payload['name'])}\n`));
        break;
      }

      case 'tool_approval_denied': {
        this.output.write(pc.red(`    ✖ Operation denied: ${String(payload['reason'] || 'User rejected')}\n`));
        break;
      }

      case 'agent_completed': {
        const iters = payload['iterations'] ?? 1;
        this.output.write(pc.green(`\n✔ Agent task completed in ${iters} turn(s).\n`));
        break;
      }

      case 'agent_failed': {
        this.output.write(pc.red(`\n✖ Agent execution failed: ${String(payload['error'] || 'Unknown error')}\n`));
        break;
      }

      case 'agent_aborted': {
        this.output.write(pc.yellow(`\n⚠ Agent execution cancelled.\n`));
        break;
      }

      default:
        break;
    }
  }

  private formatDataPreview(data: unknown): string {
    if (typeof data === 'string') {
      const clean = data.replace(/\r?\n/g, ' ').trim();
      return clean.length > 100 ? clean.substring(0, 97) + '...' : clean;
    }
    if (typeof data === 'object' && data !== null) {
      try {
        const str = JSON.stringify(data);
        return str.length > 100 ? str.substring(0, 97) + '...' : str;
      } catch {
        return '[Object]';
      }
    }
    return String(data);
  }

  /**
   * Starts the interactive Agent Mode REPL.
   */
  public async start(): Promise<void> {
    printBanner();

    this.rl = readline.createInterface({
      input: this.input,
      output: this.output,
      terminal: Boolean((this.input as { isTTY?: boolean }).isTTY)
    });
    this.lineIterator = this.rl[Symbol.asyncIterator]();

    this.rl.on('SIGINT', () => {
      if (this.activeAbortController) {
        this.activeAbortController.abort();
        this.activeAbortController = null;
        this.output.write(pc.yellow('\n[Task cancelled by user]\n\n'));
      } else {
        this.output.write(pc.cyan('\nExiting Agent Mode. Goodbye!\n'));
        this.shouldExit = true;
        this.rl?.close();
      }
    });

    try {
      this.output.write(pc.cyan('Connecting to backend and initializing Agent Mode...\n'));
      const connected = await this.connectWithRetry();
      if (!connected) {
        this.output.write(pc.yellow('Exiting Agent Mode.\n'));
        return;
      }

      const activeModel = this.session.getActiveModel();
      const tools = this.session.getRegisteredTools();
      const workspace = this.session.getWorkspace();
      const approvalMode = this.config.approvalMode;

      const box = [
        pc.gray('┌────────────────────────────────────────────────────────┐'),
        `${pc.gray('│')}  ${pc.green('✔')} Connected to Lemo Universal AI API Backend          ${pc.gray('│')}`,
        `${pc.gray('│')}  Mode:            ${pc.bold(pc.magenta('Agent Mode (Autonomous Task Execution)'))} ${pc.gray('│')}`,
        `${pc.gray('│')}  Active Model:    ${pc.bold(pc.cyan(activeModel.padEnd(38)))} ${pc.gray('│')}`,
        `${pc.gray('│')}  Approval Policy: ${pc.bold(pc.yellow(approvalMode.padEnd(38)))} ${pc.gray('│')}`,
        `${pc.gray('│')}  Workspace Root:  ${pc.gray(workspace.length > 38 ? '...' + workspace.slice(-35) : workspace.padEnd(38))} ${pc.gray('│')}`,
        `${pc.gray('│')}  Active Tools:    ${pc.bold(pc.green(String(tools.length).padEnd(2)))} (${tools.map((t) => t.name).join(', ').padEnd(34)}) ${pc.gray('│')}`,
        `${pc.gray('│')}  Enter a task or ${pc.bold('/help')} for slash commands                ${pc.gray('│')}`,
        pc.gray('└────────────────────────────────────────────────────────┘\n')
      ].join('\n');

      this.output.write(box + '\n');

      while (!this.shouldExit) {
        const rawLine = await this.nextLine(pc.magenta(pc.bold('Agent Task > ')));
        if (rawLine === null || this.shouldExit) {
          break;
        }

        const line = rawLine.trim();

        // Empty line -> prompt again
        if (!line) {
          continue;
        }

        // Check slash commands
        if (line.startsWith('/')) {
          const cmdRes = await this.session.handleCommand(line);
          if (cmdRes.message) {
            this.output.write(cmdRes.message + '\n\n');
          }
          if (cmdRes.shouldExit) {
            this.shouldExit = true;
            this.rl?.close();
            break;
          }
          continue;
        }

        // Regular task prompt
        const abortController = new AbortController();
        this.activeAbortController = abortController;

        try {
          const result = await this.session.runTask(line, {
            signal: abortController.signal
          });

          // Display final response cleanly
          if (result.finalResponse) {
            this.output.write('\n' + pc.bold(pc.magenta('Lemo Agent >\n')));
            this.output.write(result.finalResponse.trim() + '\n\n');
          }
        } catch (err: unknown) {
          if (!abortController.signal.aborted) {
            const errMsg = err instanceof Error ? err.message : String(err);
            this.output.write('\n' + pc.red(`✖ Agent Error: ${errMsg}`) + '\n\n');
          }
        } finally {
          this.activeAbortController = null;
        }
      }
    } finally {
      this.rl?.close();
      this.rl = null;
    }
  }
}

/**
 * CLI Entry helper for starting Agent Mode.
 */
export async function startAgentSession(options: AgentReplOptions = {}): Promise<void> {
  const repl = new AgentRepl(options);
  await repl.start();
}
