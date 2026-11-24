/**
 * CLI Configuration Command Handlers
 */

import { Command } from 'commander';
import pc from 'picocolors';
import { ConfigManager } from '../../core/config/index.js';
import { logger } from '../../core/logging/index.js';
import { formatErrorMessage } from '../../core/errors/index.js';
import type { LemoConfig } from '../../core/types/config.js';

export function createConfigCommand(): Command {
  const configCmd = new Command('config')
    .description('Manage Lemo CLI configuration');

  // lemo config show
  configCmd
    .command('show')
    .description('Display current configuration settings')
    .action(() => {
      try {
        const cfg = ConfigManager.load();
        const redacted = ConfigManager.getRedacted(cfg);

        logger.raw(pc.bold('\nCurrent Configuration:'));
        logger.raw(pc.gray('─'.repeat(45)));
        for (const [key, val] of Object.entries(redacted)) {
          const formattedKey = pc.cyan(key.padEnd(22));
          logger.raw(`  ${formattedKey} : ${String(val)}`);
        }
        logger.raw(pc.gray('─'.repeat(45)));
      } catch (err) {
        logger.error(formatErrorMessage(err));
        process.exit(1);
      }
    });

  // lemo config path
  configCmd
    .command('path')
    .description('Display the active configuration file path')
    .action(() => {
      try {
        const path = ConfigManager.getConfigPath();
        logger.info(`Config file location: ${pc.bold(path)}`);
      } catch (err) {
        logger.error(formatErrorMessage(err));
        process.exit(1);
      }
    });

  // lemo config set <key> <value>
  configCmd
    .command('set <key> <value>')
    .description('Update a configuration setting (e.g. baseUrl, defaultModel, apiKey)')
    .action((key: string, value: string) => {
      try {
        let parsedValue: unknown = value;

        // Parse numbers
        if (key === 'agentIterationLimit' || key === 'timeoutMs') {
          const num = Number(value);
          if (isNaN(num)) {
            logger.error(`Field '${key}' must be a valid number.`);
            process.exit(1);
          }
          parsedValue = num;
        }

        const updates: Partial<LemoConfig> = { [key]: parsedValue };
        ConfigManager.update(updates);
        logger.success(`Updated configuration: ${pc.bold(key)} = ${value}`);
      } catch (err) {
        logger.error(formatErrorMessage(err));
        process.exit(1);
      }
    });

  // lemo config reset
  configCmd
    .command('reset')
    .description('Reset configuration to default values')
    .action(() => {
      try {
        ConfigManager.reset();
        logger.success('Configuration reset to factory defaults.');
      } catch (err) {
        logger.error(formatErrorMessage(err));
        process.exit(1);
      }
    });

  return configCmd;
}
