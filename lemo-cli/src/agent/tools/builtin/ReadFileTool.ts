/**
 * Builtin Tool: read_file
 * Reads the contents of a text file inside the workspace with line range and size protection.
 * Hardened against TOCTOU race conditions and symlink swaps using atomic file descriptor access.
 */

import fs from 'node:fs';
import { Tool } from '../Tool.js';
import type { ToolPermission, ToolResult, ToolExecutionContext } from '../../types/index.js';
import { WorkspaceManager, isPathInside } from '../../workspace/WorkspaceManager.js';
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

    let handle: fs.promises.FileHandle | null = null;

    try {
      // 1. Initial canonical resolution and sensitive check
      const resolved = ws.resolvePath(filePathArg);
      ws.assertNotSensitive(resolved);

      // 2. Open file descriptor atomically
      // On POSIX platforms, apply O_NOFOLLOW to reject symlink dereferencing at the kernel level.
      // On Windows, O_NOFOLLOW is unsupported by libuv/NTFS CreateFile, so we perform post-open
      // canonical containment checks on the opened target.
      const openFlags = fs.constants.O_RDONLY | (process.platform !== 'win32' ? (fs.constants.O_NOFOLLOW ?? 0) : 0);

      try {
        handle = await fs.promises.open(resolved, openFlags);
      } catch (err: unknown) {
        const code = (err as { code?: string }).code;
        if (code === 'ENOENT') {
          return { success: false, error: `File not found: '${filePathArg}'` };
        }
        if (code === 'ELOOP') {
          return { success: false, error: `Security Exception: Symlink loop or unpermitted symlink dereferencing: '${filePathArg}'` };
        }
        throw err;
      }

      // 3. Validate file descriptor identity
      const stat = await handle.stat();
      if (stat.isDirectory()) {
        return { success: false, error: `Path is a directory, not a file: '${filePathArg}'` };
      }

      // 4. Post-open containment re-validation (TOCTOU defense)
      const currentCanonical = fs.realpathSync(resolved);
      if (!isPathInside(ws.getRoot(), currentCanonical)) {
        throw new SecurityError(`Security Exception: File path swapped with out-of-workspace link during access: '${filePathArg}'`);
      }
      ws.assertNotSensitive(currentCanonical);

      // 5. Binary file inspection using the open descriptor directly
      const headerBuffer = Buffer.alloc(4096);
      const { bytesRead: headerBytesRead } = await handle.read(headerBuffer, 0, 4096, 0);
      for (let i = 0; i < headerBytesRead; i++) {
        if (headerBuffer[i] === 0) {
          return { success: false, error: `Cannot read binary file '${filePathArg}' as text.` };
        }
      }

      // 6. Read content directly through the verified descriptor
      const fileSize = stat.size;
      const contentBuffer = Buffer.alloc(fileSize);
      await handle.read(contentBuffer, 0, fileSize, 0);
      const rawContent = contentBuffer.toString('utf-8');

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
    } finally {
      if (handle) {
        try {
          await handle.close();
        } catch {
          // File descriptor closed
        }
      }
    }
  }
}
