/**
 * Builtin Tool: list_files
 * Lists files and directories inside a specified workspace directory with metadata.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { Tool } from '../Tool.js';
import type { ToolPermission, ToolResult, ToolExecutionContext } from '../../types/index.js';
import { WorkspaceManager } from '../../workspace/WorkspaceManager.js';
import { SecurityError } from '../../../core/errors/index.js';

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  size?: number | null | undefined;
  modifiedTime?: string | undefined;
}

export class ListFilesTool extends Tool {
  public readonly name = 'list_files';
  public readonly description = 'Lists files and directories inside a specified workspace directory with size and type metadata';
  public readonly permissions: ToolPermission[] = ['read_only'];

  public readonly parameters = {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'Directory path relative to workspace root (defaults to workspace root "." if omitted)'
      },
      recursive: {
        type: 'boolean',
        description: 'Whether to list subdirectories recursively (default: false)'
      },
      max_depth: {
        type: 'integer',
        description: 'Maximum recursion depth when recursive is true (default: 3, max: 10)'
      },
      include_hidden: {
        type: 'boolean',
        description: 'Whether to include hidden files (starting with "."). Sensitive files remain protected (default: false)'
      }
    }
  };

  constructor(private readonly workspaceManager?: WorkspaceManager) {
    super();
  }

  public async execute(args: Record<string, unknown>, context?: ToolExecutionContext): Promise<ToolResult> {
    const ws = this.workspaceManager || new WorkspaceManager(context?.workspace || process.cwd());
    const relPathArg = typeof args['path'] === 'string' ? args['path'] : '.';
    const recursive = Boolean(args['recursive']);
    const maxDepth = typeof args['max_depth'] === 'number' && args['max_depth'] > 0
      ? Math.min(Math.floor(args['max_depth']), 10)
      : 3;
    const includeHidden = Boolean(args['include_hidden']);

    try {
      const resolvedDir = ws.resolvePath(relPathArg);

      // Verify directory exists
      let dirStat;
      try {
        dirStat = await fs.stat(resolvedDir);
      } catch (err: unknown) {
        if ((err as { code?: string }).code === 'ENOENT') {
          return { success: false, error: `Directory not found: '${relPathArg}'` };
        }
        throw err;
      }

      if (!dirStat.isDirectory()) {
        return { success: false, error: `Path is a file, not a directory: '${relPathArg}'` };
      }

      const entries: FileEntry[] = [];
      const MAX_ENTRIES = 500;
      let truncated = false;

      const scan = async (currentDir: string, currentDepth: number): Promise<void> => {
        if (entries.length >= MAX_ENTRIES) {
          truncated = true;
          return;
        }

        if (context?.signal?.aborted) {
          return;
        }

        let dirEntries;
        try {
          dirEntries = await fs.readdir(currentDir, { withFileTypes: true });
        } catch (err: unknown) {
          // If permission denied or inaccessible, skip quietly
          return;
        }

        // Sort: directories first, then alphabetical
        dirEntries.sort((a, b) => {
          if (a.isDirectory() === b.isDirectory()) {
            return a.name.localeCompare(b.name);
          }
          return a.isDirectory() ? -1 : 1;
        });

        for (const entry of dirEntries) {
          if (entries.length >= MAX_ENTRIES) {
            truncated = true;
            break;
          }

          const entryName = entry.name;

          // Always skip node_modules and .git by default
          if (entryName === 'node_modules' || entryName === '.git') {
            continue;
          }

          // Handle hidden files
          if (!includeHidden && entryName.startsWith('.')) {
            continue;
          }

          const fullPath = path.join(currentDir, entryName);

          // Prevent symlink escape or sensitive file exposure
          try {
            ws.resolvePath(fullPath);
            if (ws.isSensitive(fullPath)) {
              continue;
            }
          } catch {
            continue;
          }

          let size: number | null = null;
          let modifiedTime: string | undefined;

          try {
            const stat = await fs.stat(fullPath);
            if (!entry.isDirectory()) {
              size = stat.size;
            }
            modifiedTime = stat.mtime.toISOString();
          } catch {
            // Ignore stat failures on unreadable entries
          }

          entries.push({
            name: entryName,
            path: ws.toRelative(fullPath),
            isDirectory: entry.isDirectory(),
            isFile: entry.isFile(),
            size,
            modifiedTime
          });

          if (recursive && entry.isDirectory() && currentDepth < maxDepth) {
            await scan(fullPath, currentDepth + 1);
          }
        }
      };

      await scan(resolvedDir, 1);

      return {
        success: true,
        data: {
          path: ws.toRelative(resolvedDir),
          entries,
          totalCount: entries.length,
          truncated
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
