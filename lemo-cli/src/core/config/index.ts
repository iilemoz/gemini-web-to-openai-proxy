/**
 * Configuration Manager for Lemo CLI
 */

import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CONFIG, validateConfig } from './schema.js';
import { getConfigPath } from './paths.js';
import { ConfigError } from '../errors/index.js';
import type { LemoConfig } from '../types/config.js';

export class ConfigManager {
  /**
   * Returns active configuration file path.
   */
  public static getConfigPath(): string {
    return getConfigPath();
  }
  /**
   * Loads configuration from disk, creating default configuration if missing.
   */
  public static load(customPath?: string): LemoConfig {
    const targetPath = customPath || getConfigPath();

    if (!fs.existsSync(targetPath)) {
      // Create defaults on disk
      this.save(DEFAULT_CONFIG, targetPath);
      return { ...DEFAULT_CONFIG };
    }

    try {
      const raw = fs.readFileSync(targetPath, 'utf-8');
      const parsed = JSON.parse(raw);

      // Merge defaults with loaded data to handle added fields gracefully
      const merged: LemoConfig = {
        ...DEFAULT_CONFIG,
        ...parsed
      };

      const validation = validateConfig(merged);
      if (!validation.valid) {
        throw new ConfigError(
          `Invalid configuration in ${targetPath}:\n- ${validation.errors.join('\n- ')}`
        );
      }

      return merged;
    } catch (err) {
      if (err instanceof ConfigError) throw err;
      throw new ConfigError(`Failed to read configuration from ${targetPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Validates and saves configuration to disk safely.
   */
  public static save(config: LemoConfig, customPath?: string): void {
    const targetPath = customPath || getConfigPath();
    const dir = path.dirname(targetPath);

    const validation = validateConfig(config);
    if (!validation.valid) {
      throw new ConfigError(
        `Cannot save invalid configuration:\n- ${validation.errors.join('\n- ')}`
      );
    }

    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      }

      const content = JSON.stringify(config, null, 2) + '\n';
      // Write atomically via temporary file
      const tempPath = `${targetPath}.tmp.${Date.now()}`;
      fs.writeFileSync(tempPath, content, { encoding: 'utf-8', mode: 0o600 });
      fs.renameSync(tempPath, targetPath);
    } catch (err) {
      throw new ConfigError(`Failed to save configuration to ${targetPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Updates partial configuration keys, validates, and persists.
   */
  public static update(updates: Partial<LemoConfig>, customPath?: string): LemoConfig {
    const current = this.load(customPath);
    const updated: LemoConfig = {
      ...current,
      ...updates
    };

    const validation = validateConfig(updated);
    if (!validation.valid) {
      throw new ConfigError(
        `Configuration update rejected:\n- ${validation.errors.join('\n- ')}`
      );
    }

    this.save(updated, customPath);
    return updated;
  }

  /**
   * Resets configuration to DEFAULT_CONFIG.
   */
  public static reset(customPath?: string): LemoConfig {
    const targetPath = customPath || getConfigPath();
    this.save(DEFAULT_CONFIG, targetPath);
    return { ...DEFAULT_CONFIG };
  }

  /**
   * Returns a copy of the configuration with sensitive fields masked.
   */
  public static getRedacted(config: LemoConfig): Record<string, unknown> {
    const copy: Record<string, unknown> = { ...config };
    if (copy['apiKey']) {
      const keyStr = String(copy['apiKey']);
      copy['apiKey'] = keyStr.length > 8
        ? `${keyStr.slice(0, 3)}...${keyStr.slice(-4)}`
        : '***REDACTED***';
    } else {
      copy['apiKey'] = '(not set)';
    }
    return copy;
  }
}

export * from './schema.js';
export * from './paths.js';
