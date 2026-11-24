import os from 'node:os';
import { toolRegistry } from '../registry/ToolRegistry.js';

/**
 * Register core builtin tools.
 */
export function registerBuiltinTools() {
  // 1. Echo tool
  toolRegistry.register({
    schema: {
      name: 'echo',
      description: 'Echoes back the provided message. Useful for diagnostics and testing tool calling.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'The text message to echo' }
        },
        required: ['message']
      },
      requiredPermissions: ['none'],
      timeoutMs: 5000,
      executionTarget: 'any'
    },
    handler: async ({ message }) => {
      return { echoed: message, timestamp: new Date().toISOString() };
    }
  });

  // 2. Calculator tool
  toolRegistry.register({
    schema: {
      name: 'calculator',
      description: 'Performs basic mathematical calculations safely.',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: 'Math expression e.g. "25 * 4 + 10"' }
        },
        required: ['expression']
      },
      requiredPermissions: ['none'],
      timeoutMs: 5000,
      executionTarget: 'any'
    },
    handler: async ({ expression }) => {
      // Safe arithmetic evaluator
      if (!/^[0-9+\-*/().\s]+$/.test(expression)) {
        throw new Error('Invalid characters in arithmetic expression.');
      }
      // eslint-disable-next-line no-new-func
      const result = Function(`'use strict'; return (${expression})`)();
      return { expression, result };
    }
  });

  // 3. System info tool
  toolRegistry.register({
    schema: {
      name: 'system_info',
      description: 'Retrieves non-sensitive operating system and runtime environment metrics.',
      parameters: {
        type: 'object',
        properties: {}
      },
      requiredPermissions: ['read:system'],
      timeoutMs: 5000,
      executionTarget: 'local'
    },
    handler: async () => {
      return {
        platform: os.platform(),
        arch: os.arch(),
        nodeVersion: process.version,
        uptimeSeconds: Math.floor(process.uptime()),
        cpus: os.cpus().length,
        freeMemoryMB: Math.round(os.freemem() / (1024 * 1024)),
        totalMemoryMB: Math.round(os.totalmem() / (1024 * 1024))
      };
    }
  });
}
