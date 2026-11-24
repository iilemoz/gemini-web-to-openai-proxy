/**
 * Builtin Tool: search_files
 * Searches for text or regular expression patterns across files within the workspace.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { Tool } from '../Tool.js';
import type { ToolPermission, ToolResult, ToolExecutionContext } from '../../types/index.js';
import { WorkspaceManager } from '../../workspace/WorkspaceManager.js';
import { SecurityError } from '../../../core/errors/index.js';

export interface SearchMatch {
  file: string;
  line: number;
  content: string;
}

export class SearchFilesTool extends Tool {
  public readonly name = 'search_files';
  public readonly description = 'Searches for text or regex patterns across files in the workspace';
  public readonly permissions: ToolPermission[] = ['read_only'];

  public readonly parameters = {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Text pattern or regular expression to search for'
      },
      path: {
        type: 'string',
        description: 'Directory path relative to workspace root to search within (default: ".")'
      },
      is_regex: {
        type: 'boolean',
        description: 'Whether query is a regular expression (default: false)'
      },
      case_sensitive: {
        type: 'boolean',
        description: 'Whether search is case-sensitive (default: false)'
      },
      file_pattern: {
        type: 'string',
        description: 'Optional file extension or substring to filter files (e.g. ".ts", ".js", "package.json")'
      },
      max_results: {
        type: 'integer',
        description: 'Maximum number of matching lines to return (default: 50, max: 200)'
      }
    },
    required: ['query']
  };

  constructor(private readonly workspaceManager?: WorkspaceManager) {
    super();
  }

  public async execute(args: Record<string, unknown>, context?: ToolExecutionContext): Promise<ToolResult> {
    const ws = this.workspaceManager || new WorkspaceManager(context?.workspace || process.cwd());
    const query = String(args['query'] || '');
    if (!query) {
      return { success: false, error: 'Search query cannot be empty' };
    }

    const relPath = typeof args['path'] === 'string' ? args['path'] : '.';
    const isRegex = Boolean(args['is_regex']);
    const caseSensitive = Boolean(args['case_sensitive']);
    const filePattern = typeof args['file_pattern'] === 'string' ? args['file_pattern'].toLowerCase().trim() : null;
    const maxResults = typeof args['max_results'] === 'number' && args['max_results'] > 0
      ? Math.min(Math.floor(args['max_results']), 200)
      : 50;

    let regex: RegExp;
    try {
      if (isRegex) {
        regex = new RegExp(query, caseSensitive ? 'g' : 'gi');
      } else {
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        regex = new RegExp(escaped, caseSensitive ? 'g' : 'gi');
      }
    } catch (err: unknown) {
      return { success: false, error: `Invalid regular expression query: ${err instanceof Error ? err.message : String(err)}` };
    }

    try {
      const searchRoot = ws.resolvePath(relPath);
      const matches: SearchMatch[] = [];
      let truncated = false;
      const MAX_FILES_SCANNED = 500;
      let filesScanned = 0;

      const scanDirectory = async (currentDir: string): Promise<void> => {
        if (matches.length >= maxResults || filesScanned >= MAX_FILES_SCANNED) {
          truncated = true;
          return;
        }

        if (context?.signal?.aborted) {
          return;
        }

        let entries;
        try {
          entries = await fs.readdir(currentDir, { withFileTypes: true });
        } catch {
          return;
        }

        for (const entry of entries) {
          if (matches.length >= maxResults || filesScanned >= MAX_FILES_SCANNED) {
            truncated = true;
            break;
          }

          if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') {
            continue;
          }

          const fullPath = path.join(currentDir, entry.name);

          try {
            ws.resolvePath(fullPath);
            if (ws.isSensitive(fullPath)) continue;
          } catch {
            continue;
          }

          if (entry.isDirectory()) {
            await scanDirectory(fullPath);
          } else if (entry.isFile()) {
            // Apply file_pattern filter if provided
            if (filePattern && !entry.name.toLowerCase().includes(filePattern)) {
              continue;
            }

            filesScanned++;

            // Skip binary files
            if (await ws.isBinary(fullPath)) {
              continue;
            }

            try {
              const content = await fs.readFile(fullPath, 'utf-8');
              const lines = content.split(/\r?\n/);

              for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
                if (matches.length >= maxResults) {
                  truncated = true;
                  break;
                }

                const lineText = lines[lineIdx] ?? '';
                regex.lastIndex = 0;
                if (regex.test(lineText)) {
                  matches.push({
                    file: ws.toRelative(fullPath),
                    line: lineIdx + 1,
                    content: lineText.trim().slice(0, 300)
                  });
                }
              }
            } catch {
              // Ignore read errors on inaccessible files
            }
          }
        }
      };

      await scanDirectory(searchRoot);

      return {
        success: true,
        data: {
          query,
          matches,
          totalMatches: matches.length,
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
