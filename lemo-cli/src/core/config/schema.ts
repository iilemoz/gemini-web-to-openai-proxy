/**
 * Configuration Schema & Validation for Lemo CLI
 */

import type { LemoConfig, ConfigValidationResult } from '../types/config.js';

export const DEFAULT_CONFIG: LemoConfig = {
  baseUrl: 'http://127.0.0.1:3000/v1',
  apiKey: '',
  defaultModel: 'gemini-flash',
  defaultMode: 'chat',
  defaultWorkspace: process.cwd(),
  agentIterationLimit: 25,
  approvalMode: 'action',
  logLevel: 'info',
  timeoutMs: 120000
};

/**
 * Validates a candidate configuration object against the LemoConfig specification.
 */
export function validateConfig(data: unknown): ConfigValidationResult {
  const errors: string[] = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Configuration must be a non-null object'] };
  }

  const cfg = data as Record<string, unknown>;

  // baseUrl validation
  if (typeof cfg['baseUrl'] !== 'string' || cfg['baseUrl'].trim() === '') {
    errors.push('baseUrl must be a non-empty string');
  } else {
    try {
      const parsed = new URL(cfg['baseUrl']);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        errors.push('baseUrl must use http: or https: protocol');
      }
    } catch {
      errors.push('baseUrl must be a valid URL (e.g. http://127.0.0.1:3000/v1)');
    }
  }

  // apiKey validation
  if (cfg['apiKey'] !== undefined && typeof cfg['apiKey'] !== 'string') {
    errors.push('apiKey must be a string if provided');
  }

  // defaultModel validation
  if (typeof cfg['defaultModel'] !== 'string' || cfg['defaultModel'].trim() === '') {
    errors.push('defaultModel must be a non-empty string');
  }

  // defaultMode validation
  if (!['chat', 'agent'].includes(cfg['defaultMode'] as string)) {
    errors.push(`defaultMode must be either 'chat' or 'agent', received '${cfg['defaultMode']}'`);
  }

  // defaultWorkspace validation
  if (typeof cfg['defaultWorkspace'] !== 'string' || cfg['defaultWorkspace'].trim() === '') {
    errors.push('defaultWorkspace must be a valid non-empty directory path');
  }

  // agentIterationLimit validation
  if (
    typeof cfg['agentIterationLimit'] !== 'number' ||
    !Number.isInteger(cfg['agentIterationLimit']) ||
    cfg['agentIterationLimit'] < 1 ||
    cfg['agentIterationLimit'] > 100
  ) {
    errors.push('agentIterationLimit must be an integer between 1 and 100');
  }

  // approvalMode validation
  if (!['always', 'action', 'never'].includes(cfg['approvalMode'] as string)) {
    errors.push(`approvalMode must be 'always', 'action', or 'never', received '${cfg['approvalMode']}'`);
  }

  // logLevel validation
  if (!['debug', 'info', 'warn', 'error', 'silent'].includes(cfg['logLevel'] as string)) {
    errors.push(`logLevel must be 'debug', 'info', 'warn', 'error', or 'silent', received '${cfg['logLevel']}'`);
  }

  // timeoutMs validation
  if (
    typeof cfg['timeoutMs'] !== 'number' ||
    !Number.isInteger(cfg['timeoutMs']) ||
    cfg['timeoutMs'] < 1000
  ) {
    errors.push('timeoutMs must be a positive integer >= 1000ms');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
