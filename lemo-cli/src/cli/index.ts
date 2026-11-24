/**
 * Lemo CLI Main Program Definition and Entry Point
 */

import { Command } from 'commander';
import { printBanner, CLI_VERSION } from './interface/banner.js';
import { createConfigCommand } from './commands/config.js';
import { logger } from '../core/logging/index.js';
import { formatErrorMessage } from '../core/errors/index.js';
import { ConfigManager } from '../core/config/index.js';
import { startChatSession } from '../chat/index.js';
import { startAgentSession } from '../agent/index.js';

export function buildProgram(): Command {
  const program = new Command();

  program
    .name('lemo')
    .description('Lemo CLI — Standalone Terminal AI Assistant & Autonomous Coding Agent')
    .version(CLI_VERSION, '-v, --version', 'Output the current version number')
    .helpOption('-h, --help', 'Display help for command')
    .option('-d, --debug', 'Enable debug diagnostic output')
    .option('--config <path>', 'Custom path to configuration file')
    .hook('preAction', (thisCommand) => {
      const opts = thisCommand.opts();
      if (opts['debug']) {
        logger.setLevel('debug');
        logger.debug('Debug logging enabled.');
      }
    })
    .action(async () => {
      const config = ConfigManager.load();
      if (config.defaultMode === 'agent') {
        await startAgentSession({ config });
      } else {
        await startChatSession({ config });
      }
    });

  // Attach configuration subcommands
  program.addCommand(createConfigCommand());

  // Interactive Chat Mode
  program
    .command('chat')
    .description('Start an interactive AI chat session with streaming')
    .option('-m, --model <model>', 'Model override (e.g. gemini-flash, gemini-pro)')
    .action(async (cmdOpts: { model?: string }) => {
      await startChatSession({ modelOverride: cmdOpts.model });
    });

  // Interactive Agent Mode
  program
    .command('agent')
    .description('Start interactive AI Coding Agent Mode with tools')
    .option('-w, --workspace <dir>', 'Target workspace directory')
    .option('-m, --model <model>', 'Model override (e.g. gemini-flash, gemini-pro)')
    .action(async (cmdOpts: { workspace?: string; model?: string }) => {
      await startAgentSession({
        workspace: cmdOpts.workspace,
        modelOverride: cmdOpts.model
      });
    });

  // Custom help formatting
  program.addHelpText('before', () => {
    printBanner();
    return '';
  });

  return program;
}

export async function runCli(argv = process.argv): Promise<void> {
  const program = buildProgram();

  try {
    await program.parseAsync(argv);
  } catch (err) {
    logger.error(formatErrorMessage(err));
    process.exitCode = 1;
  }
}
