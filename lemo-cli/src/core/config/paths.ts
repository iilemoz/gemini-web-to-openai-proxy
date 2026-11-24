/**
 * Cross-platform Configuration Path Resolution
 */

import os from 'node:os';
import path from 'node:path';

/**
 * Resolves the configuration directory for Lemo CLI in a cross-platform manner.
 * - Windows: %APPDATA%\lemo (or %USERPROFILE%\.lemo)
 * - Linux / macOS: $XDG_CONFIG_HOME/lemo (or ~/.config/lemo or ~/.lemo)
 * - Overridden if LEMO_CONFIG_DIR or LEMO_CONFIG_PATH is set.
 */
export function getConfigDir(): string {
  if (process.env['LEMO_CONFIG_DIR']) {
    return path.resolve(process.env['LEMO_CONFIG_DIR']);
  }

  const isWindows = process.platform === 'win32';

  if (isWindows) {
    const appData = process.env['APPDATA'];
    if (appData) {
      return path.join(appData, 'lemo');
    }
    return path.join(os.homedir(), '.lemo');
  }

  // POSIX (macOS, Linux)
  const xdgConfig = process.env['XDG_CONFIG_HOME'];
  if (xdgConfig) {
    return path.join(xdgConfig, 'lemo');
  }

  return path.join(os.homedir(), '.config', 'lemo');
}

/**
 * Returns the absolute path to the configuration file (config.json).
 */
export function getConfigPath(): string {
  if (process.env['LEMO_CONFIG_PATH']) {
    return path.resolve(process.env['LEMO_CONFIG_PATH']);
  }
  return path.join(getConfigDir(), 'config.json');
}
