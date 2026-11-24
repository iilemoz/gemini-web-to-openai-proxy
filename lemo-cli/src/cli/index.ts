/**
 * Lemo CLI Main Program Definition and Entry Point
 */

import { Command } from 'commander';
import pc from 'picocolors';
import { printBanner, CLI_VERSION } from './interface/banner.js';
import { createConfigCommand } from './commands/config.js';
import { logger } from '../core/logging/index.js';
import { formatErrorMessage } from '../core/errors/index.js';

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
    });

  // Attach configuration subcommands
  program.addCommand(createConfigCommand());

  // Architectural boundary placeholder: Chat Mode (Phase 4.1)
  program
    .command('chat')
    .description('Interactive AI Chat Mode with streaming (Scheduled for Phase 4.1)')
    .option('-m, --model <model>', 'Model override (e.g. gemini-flash, gemini-pro)')
    .action(() => {
      printBanner();
      logger.info(pc.cyan('Chat Mode is scheduled for implementation in Phase 4.1.'));
      logger.info('Please run "lemo config show" or "lemo --help" to inspect current options.');
    });

  // Architectural boundary placeholder: Agent Mode (Phase 4.2)
  program
    .command('agent')
    .description('Autonomous AI Coding Agent Mode with tools (Scheduled for Phase 4.2)')
    .option('-w, --workspace <dir>', 'Target workspace directory')
    .option('-m, --model <model>', 'Model override')
    .action(() => {
      printBanner();
      logger.info(pc.cyan('Agent Mode is scheduled for implementation in Phase 4.2.'));
      logger.info('Please run "lemo config show" or "lemo --help" to inspect current options.');
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
    // If no arguments provided, show banner and help
    if (argv.length <= 2) {
      printBanner();
      program.outputHelp();
      return;
    }

    await program.parseAsync(argv);
  } catch (err) {
    logger.error(formatErrorMessage(err));
    process.exitCode = 1;
  }
}
