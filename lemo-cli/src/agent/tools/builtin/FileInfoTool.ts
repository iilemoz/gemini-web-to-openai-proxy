/**
 * Builtin Tool: file_info
 * Returns safe metadata about a workspace file or directory.
 * Hardened to prevent leaking host absolute paths, external symlink targets,
 * or metadata for sensitive/out-of-workspace files.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Tool } from '../Tool.js';
import type { ToolPermission, ToolResult, ToolExecutionContext } from '../../types/index.js';
import { WorkspaceManager } from '../../workspace/WorkspaceManager.js';
import { SecurityError } from '../../../core/errors/index.js';

export class FileInfoTool extends Tool {
  public readonly name = 'file_info';
  public readonly description = 'Returns safe metadata about a workspace file or directory';
  public readonly permissions: ToolPermission[] = ['read_only'];

  public readonly parameters = {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'File or directory path relative to workspace root'
      }
    },
    required: ['path']
  };

  constructor(private readonly workspaceManager?: WorkspaceManager) {
    super();
  }

  public async execute(args: Record<string, unknown>, context?: ToolExecutionContext): Promise<ToolResult> {
    const ws = this.workspaceManager || new WorkspaceManager(context?.workspace || process.cwd());
    const targetPath = String(args['path'] || '');

    try {
      // 1. Resolve and verify canonical path containment.
      // Rejects paths escaping workspace, null-bytes, and symlinks pointing outside.
      const resolved = ws.resolvePath(targetPath);

      // 2. Reject sensitive files before inspecting metadata (fails closed).
      ws.assertNotSensitive(resolved);

      let lstat;
      try {
        lstat = await fs.promises.lstat(resolved);
      } catch (err: unknown) {
        if ((err as { code?: string }).code === 'ENOENT') {
          return {
            success: true,
            data: {
              path: ws.toRelative(resolved),
              exists: false
            }
          };
        }
        throw err;
      }

      let stat = lstat;
      if (lstat.isSymbolicLink()) {
        try {
          stat = await fs.promises.stat(resolved);
        } catch {
          // Dead symlink - retain lstat information
        }
      }

      const isBinary = stat.isFile() ? await ws.isBinary(resolved) : false;

      // Ensure all reported paths are strictly relative to the workspace root.
      // Host absolute paths and out-of-workspace symlink targets are never exposed.
      return {
        success: true,
        data: {
          path: ws.toRelative(resolved),
          exists: true,
          isFile: stat.isFile(),
          isDirectory: stat.isDirectory(),
          isSymbolicLink: lstat.isSymbolicLink(),
          size: stat.size,
          createdTime: stat.birthtime.toISOString(),
          modifiedTime: stat.mtime.toISOString(),
          extension: path.extname(resolved),
          isBinary
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
