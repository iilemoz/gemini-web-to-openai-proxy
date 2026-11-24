/**
 * Builtin Test Echo Tool
 * Harmless read-only tool for testing and demonstrating agent tool calling.
 */

import { Tool } from '../Tool.js';
import type { ToolPermission, ToolResult } from '../../types/index.js';

export class EchoTool extends Tool {
  public readonly name = 'test_echo';
  public readonly description = 'Echoes back a provided text message for testing agent tool calling';
  public readonly permissions: ToolPermission[] = ['read_only'];

  public readonly parameters = {
    type: 'object' as const,
    properties: {
      message: {
        type: 'string',
        description: 'The text message to echo back'
      },
      repeat: {
        type: 'integer',
        description: 'Optional number of times to repeat the message (default: 1)'
      }
    },
    required: ['message']
  };

  public async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const message = String(args['message'] || '');
    const repeatCount = typeof args['repeat'] === 'number' && args['repeat'] > 0 ? Math.min(args['repeat'], 10) : 1;
    const echoed = Array(repeatCount).fill(message).join(' ');

    return {
      success: true,
      data: {
        echoed,
        length: echoed.length,
        repeats: repeatCount
      }
    };
  }
}
