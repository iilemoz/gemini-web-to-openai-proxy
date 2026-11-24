/**
 * Builtin Tool: read_file
 * Reads the contents of a text file inside the workspace with pagination and byte limits.
 */

import fs from 'node:fs/promises';
import { Tool } from '../Tool.js';
import type { ToolPermission, ToolResult, ToolExecutionContext } from '../../types/index.js';
import { WorkspaceManager } from '../../workspace/WorkspaceManager.js';
import { SecurityError } from '../../../core/errors/index.js';

export class ReadFileTool extends Tool {
  public readonly name = 'read_file';
  public readonly description = 'Reads the contents of a text file inside the workspace with line range and size protection';
  public readonly permissions: ToolPermission[] = ['read_only'];

  public readonly parameters = {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'File path relative to workspace root'
      },
      start_line: {
        type: 'integer',
        description: '1-based starting line number to read from (optional, default: 1)'
      },
      line_count: {
        type: 'integer',
        description: 'Maximum number of lines to read (optional, default: 500, max: 2000)'
      },
      max_bytes: {
        type: 'integer',
        description: 'Maximum bytes to return before truncating (optional, default: 262144 [256KB], max: 1048576 [1MB])'
      }
    },
    required: ['path']
  };

  constructor(private readonly workspaceManager?: WorkspaceManager) {
    super();
  }

  public async execute(args: Record<string, unknown>, context?: ToolExecutionContext): Promise<ToolResult> {
    const ws = this.workspaceManager || new WorkspaceManager(context?.workspace || process.cwd());
    const filePathArg = String(args['path'] || '');
    const startLineArg = typeof args['start_line'] === 'number' && args['start_line'] > 0
      ? Math.floor(args['start_line'])
      : 1;
    const lineCountArg = typeof args['line_count'] === 'number' && args['line_count'] > 0
      ? Math.min(Math.floor(args['line_count']), 2000)
      : 500;
    const maxBytesArg = typeof args['max_bytes'] === 'number' && args['max_bytes'] > 0
      ? Math.min(Math.floor(args['max_bytes']), 1048576)
      : 262144;

    try {
      const resolved = ws.resolvePath(filePathArg);
      ws.assertNotSensitive(resolved);

      let stat;
      try {
        stat = await fs.stat(resolved);
      } catch (err: unknown) {
        if ((err as { code?: string }).code === 'ENOENT') {
          return { success: false, error: `File not found: '${filePathArg}'` };
        }
        throw err;
      }

      if (stat.isDirectory()) {
        return { success: false, error: `Path is a directory, not a file: '${filePathArg}'` };
      }

      // Check if file is binary
      if (await ws.isBinary(resolved)) {
        return { success: false, error: `Cannot read binary file '${filePathArg}' as text.` };
      }

      // Read file contents as UTF-8
      const rawContent = await fs.readFile(resolved, 'utf-8');
      const lines = rawContent.split(/\r?\n/);
      const totalLines = lines.length;

      // Extract requested line range (1-indexed)
      const startIndex = Math.max(0, startLineArg - 1);
      const endIndex = Math.min(startIndex + lineCountArg, totalLines);
      const selectedLines = lines.slice(startIndex, endIndex);

      let content = selectedLines.join('\n');
      let truncated = false;

      // Enforce byte limit
      if (Buffer.byteLength(content, 'utf-8') > maxBytesArg) {
        const buffer = Buffer.from(content, 'utf-8');
        content = buffer.subarray(0, maxBytesArg).toString('utf-8');
        truncated = true;
      } else if (endIndex < totalLines) {
        truncated = true;
      }

      return {
        success: true,
        data: {
          path: ws.toRelative(resolved),
          content,
          startLine: startLineArg,
          linesRead: selectedLines.length,
          totalLines,
          truncated,
          size: stat.size
        }
      };
    } catch (err: unknown) {
      if (err instanceof SecurityError) {
        return { success: false, error: `Security Exception: ${err.message}` };
      }
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
