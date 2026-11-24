/**
 * AgentSession: Manages interactive Agent Mode state, model routing,
 * tool capability verification, session history, and slash commands.
 */

import pc from 'picocolors';
import type { LemoApiClient } from '../../api/client/LemoApiClient.js';
import type { LemoConfig } from '../../core/types/config.js';
import type { BackendModel } from '../../core/types/models.js';
import type { ChatMessage } from '../../api/types/request.js';
import { Agent } from '../core/Agent.js';
import type { Tool } from '../tools/Tool.js';
import {
  EchoTool,
  ListFilesTool,
  ReadFileTool,
  SearchFilesTool,
  FileInfoTool,
  WriteFileTool,
  EditFileTool
} from '../tools/builtin/index.js';
import { WorkspaceManager } from '../workspace/WorkspaceManager.js';
import type { ApprovalPolicy } from '../policies/ApprovalPolicy.js';
import type { AgentRunResult } from '../types/index.js';
import type { CommandResult } from '../../chat/types.js';

export interface AgentSessionOptions {
  client?: LemoApiClient | undefined;
  config: LemoConfig;
  agent?: Agent | undefined;
  modelOverride?: string | undefined;
  workspace?: string | undefined;
  approvalPolicy?: ApprovalPolicy | undefined;
}

export class AgentSession {
  private readonly client: LemoApiClient;
  private readonly config: LemoConfig;
  private readonly agent: Agent;
  private readonly workspaceManager: WorkspaceManager;
  private activeModel: string;
  private workspace: string;
  private availableModels: BackendModel[] = [];
  private history: ChatMessage[] = [];

  constructor(options: AgentSessionOptions) {
    this.config = options.config;
    const rawWorkspace = options.workspace || options.config.defaultWorkspace || process.cwd();
    this.workspaceManager = new WorkspaceManager(rawWorkspace);
    this.workspace = this.workspaceManager.getRoot();

    this.agent = options.agent || new Agent({
      config: options.config,
      client: options.client,
      approvalPolicy: options.approvalPolicy,
      workspaceManager: this.workspaceManager
    });
    this.client = (this.agent as unknown as { client: LemoApiClient }).client || options.client!;
    this.activeModel = options.modelOverride?.trim() || options.config.defaultModel || 'gemini-flash';

    // Register built-in tools if not already present
    if (!this.agent.registry.has('test_echo')) {
      this.agent.registerTool(new EchoTool());
    }
    if (!this.agent.registry.has('list_files')) {
      this.agent.registerTool(new ListFilesTool(this.workspaceManager));
    }
    if (!this.agent.registry.has('read_file')) {
      this.agent.registerTool(new ReadFileTool(this.workspaceManager));
    }
    if (!this.agent.registry.has('search_files')) {
      this.agent.registerTool(new SearchFilesTool(this.workspaceManager));
    }
    if (!this.agent.registry.has('file_info')) {
      this.agent.registerTool(new FileInfoTool(this.workspaceManager));
    }
    if (!this.agent.registry.has('write_file')) {
      this.agent.registerTool(new WriteFileTool(this.workspaceManager, this.agent.approvalManager));
    }
    if (!this.agent.registry.has('edit_file')) {
      this.agent.registerTool(new EditFileTool(this.workspaceManager, this.agent.approvalManager));
    }
  }

  /**
   * Initializes session, queries backend models, and verifies tool capability.
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

      if (matched && matched.capabilities?.tools === true) {
        this.activeModel = matched.id;
      } else {
        // Find first model supporting tools
        const toolModel = this.availableModels.find(m => m.capabilities?.tools === true);
        if (toolModel) {
          const prev = this.activeModel;
          this.activeModel = toolModel.id;
          if (matched && matched.capabilities?.tools !== true) {
            console.log(pc.yellow(`ℹ Model '${prev}' does not support tool calling. Auto-selected tool-capable model '${this.activeModel}'.`));
          } else {
            console.log(pc.yellow(`ℹ Model '${prev}' not in backend list. Using tool-capable model '${this.activeModel}'.`));
          }
        } else {
          return {
            success: false,
            activeModel: this.activeModel,
            error: 'No backend models advertise tool support (capabilities.tools = true).'
          };
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

  public getWorkspace(): string {
    return this.workspace;
  }

  public getAvailableModels(): BackendModel[] {
    return [...this.availableModels];
  }

  public getHistory(): ChatMessage[] {
    return [...this.history];
  }

  public clearHistory(): void {
    this.history = [];
  }

  public getAgent(): Agent {
    return this.agent;
  }

  public getRegisteredTools(): Tool[] {
    return this.agent.registry.list();
  }

  /**
   * Switches the active model with tool capability validation.
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
      const available = this.availableModels
        .filter(m => m.capabilities?.tools === true)
        .map(m => pc.cyan(m.id))
        .join(', ');
      return {
        success: false,
        message: `Unknown model '${trimmed}'. Available tool-capable models: ${available}`
      };
    }

    if (matched.capabilities?.tools !== true) {
      return {
        success: false,
        message: pc.red(`✖ Model '${matched.id}' does not support tool calling. Agent Mode requires a model with tool capabilities (e.g. gemini-flash, gemini-pro).`)
      };
    }

    const prev = this.activeModel;
    this.activeModel = matched.id;
    return {
      success: true,
      message: `Active model changed: ${pc.gray(prev)} → ${pc.bold(pc.green(this.activeModel))}`
    };
  }

  /**
   * Dispatches and handles slash commands in Agent Mode.
   */
  public async handleCommand(input: string): Promise<CommandResult> {
    const trimmed = input.trim();
    const [rawCmd = '', ...argParts] = trimmed.split(/\s+/);
    const cmd = rawCmd.toLowerCase();
    const arg = argParts.join(' ');

    switch (cmd) {
      case '/help': {
        const helpText = [
          pc.bold(pc.cyan('\nLemo Agent Mode — Slash Commands:')),
          `  ${pc.bold('/help')}              Show this commands overview`,
          `  ${pc.bold('/models')}            List available models and tool support status`,
          `  ${pc.bold('/model <id>')}        Switch active agent model (requires tool capability)`,
          `  ${pc.bold('/tools')}             List registered agent tools and permissions`,
          `  ${pc.bold('/status')}            Display active agent configuration and session metrics`,
          `  ${pc.bold('/clear')}             Reset cumulative conversation history`,
          `  ${pc.bold('/exit')}              Exit Agent Mode cleanly`
        ].join('\n');
        return { handled: true, message: helpText };
      }

      case '/models': {
        if (this.availableModels.length === 0) {
          return { handled: true, message: pc.yellow('No models returned by backend.') };
        }
        const lines = [pc.bold(pc.cyan('\nAvailable Models:'))];
        for (const m of this.availableModels) {
          const isCurrent = m.id.toLowerCase() === this.activeModel.toLowerCase();
          const marker = isCurrent ? pc.green('● (active)') : pc.gray('○');
          const hasTools = m.capabilities?.tools === true;
          const toolBadge = hasTools ? pc.green('[tools: ready]') : pc.gray('[tools: none]');
          const provider = m.owned_by ? pc.gray(`(${m.owned_by})`) : '';
          lines.push(`  ${marker} ${pc.bold(m.id.padEnd(24))} ${toolBadge} ${provider}`);
        }
        return { handled: true, message: lines.join('\n') };
      }

      case '/model': {
        const switchRes = this.switchModel(arg);
        return { handled: true, message: switchRes.message };
      }

      case '/tools': {
        const tools = this.getRegisteredTools();
        if (tools.length === 0) {
          return { handled: true, message: pc.yellow('No tools currently registered in Agent.') };
        }
        const lines = [pc.bold(pc.cyan('\nRegistered Agent Tools:'))];
        for (const t of tools) {
          const perms = t.permissions.length > 0 ? pc.gray(`[permissions: ${t.permissions.join(', ')}]`) : pc.green('[safe]');
          lines.push(`  ${pc.green('✔')} ${pc.bold(t.name.padEnd(16))} ${perms}\n     ${pc.gray(t.description)}`);
        }
        return { handled: true, message: lines.join('\n') };
      }

      case '/status': {
        const tools = this.getRegisteredTools();
        const lines = [
          pc.bold(pc.cyan('\nAgent Mode Status:')),
          `  Active Model:       ${pc.bold(pc.green(this.activeModel))}`,
          `  Backend URL:        ${pc.gray(this.config.baseUrl)}`,
          `  Workspace Root:     ${pc.gray(this.workspace)}`,
          `  Approval Mode:      ${pc.bold(this.config.approvalMode)}`,
          `  Iteration Limit:    ${pc.bold(String(this.config.agentIterationLimit))}`,
          `  Registered Tools:   ${pc.bold(String(tools.length))} (${tools.map(t => t.name).join(', ')})`,
          `  History Messages:   ${pc.bold(String(this.history.length))}`
        ];
        return { handled: true, message: lines.join('\n') };
      }

      case '/clear': {
        this.clearHistory();
        return { handled: true, message: pc.green('✔ Agent conversation history cleared.') };
      }

      case '/exit':
      case '/quit': {
        return { handled: true, shouldExit: true, message: pc.cyan('Exiting Agent Mode. Goodbye!') };
      }

      default: {
        return {
          handled: false,
          message: pc.yellow(`Unknown command '${cmd}'. Type /help to see available commands.`)
        };
      }
    }
  }

  /**
   * Executes an autonomous agent task while updating session history.
   */
  public async runTask(
    task: string,
    options: { signal?: AbortSignal | undefined; systemPrompt?: string | undefined } = {}
  ): Promise<AgentRunResult> {
    const runResult = await this.agent.run(task, {
      modelOverride: this.activeModel,
      signal: options.signal,
      systemPrompt: options.systemPrompt,
      initialMessages: this.history,
      workspace: this.workspace
    });

    if (runResult.messages && runResult.messages.length > 0) {
      this.history = [...runResult.messages];
    }

    return runResult;
  }
}
