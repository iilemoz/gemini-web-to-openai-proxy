/**
 * Leveled Logger with Automatic Secret Redaction for Lemo CLI
 */

import pc from 'picocolors';
import type { LogLevel } from '../types/config.js';

const LOG_LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 99
};

/**
 * Redacts API keys, tokens, and authorization headers from logs.
 */
export function redactSecrets(input: unknown): string {
  if (input === null || input === undefined) return '';

  let str = typeof input === 'string' ? input : JSON.stringify(input);

  // Redact Bearer tokens
  str = str.replace(/Bearer\s+[A-Za-z0-9_\-.~+/]+=*/gi, 'Bearer [REDACTED]');

  // Redact sk-... style API keys
  str = str.replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/gi, '[REDACTED_KEY]');

  // Redact apiKey / token / password JSON fields
  str = str.replace(
    /("(?:apiKey|token|password|secret|geminiCookie|authorization)"\s*:\s*")[^"]+(")/gi,
    '$1[REDACTED]$2'
  );

  return str;
}

export class Logger {
  private level: LogLevel = 'info';

  constructor(level: LogLevel = 'info') {
    this.level = level;
  }

  public setLevel(level: LogLevel): void {
    this.level = level;
  }

  public getLevel(): LogLevel {
    return this.level;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_WEIGHT[level] >= LOG_LEVEL_WEIGHT[this.level];
  }

  public debug(...args: unknown[]): void {
    if (!this.shouldLog('debug')) return;
    const msg = args.map(a => redactSecrets(a)).join(' ');
    console.debug(pc.gray(`[DEBUG] ${msg}`));
  }

  public info(...args: unknown[]): void {
    if (!this.shouldLog('info')) return;
    const msg = args.map(a => redactSecrets(a)).join(' ');
    console.log(pc.cyan(`ℹ ${msg}`));
  }

  public success(...args: unknown[]): void {
    if (!this.shouldLog('info')) return;
    const msg = args.map(a => redactSecrets(a)).join(' ');
    console.log(pc.green(`✔ ${msg}`));
  }

  public warn(...args: unknown[]): void {
    if (!this.shouldLog('warn')) return;
    const msg = args.map(a => redactSecrets(a)).join(' ');
    console.warn(pc.yellow(`⚠ ${msg}`));
  }

  public error(...args: unknown[]): void {
    if (!this.shouldLog('error')) return;
    const msg = args.map(a => redactSecrets(a)).join(' ');
    console.error(pc.red(`✖ ${msg}`));
  }

  public raw(text: string): void {
    if (this.level === 'silent') return;
    console.log(text);
  }
}

export const logger = new Logger('info');
