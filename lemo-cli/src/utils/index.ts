/**
 * Common Utilities for Lemo CLI
 */

/**
 * Normalizes file paths for cross-platform consistency.
 */
export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}
