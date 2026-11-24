/**
 * Builtin Tool: search_files
 * Searches for text or regular expression patterns across files within the workspace.
 * Hardened against ReDoS (catastrophic backtracking), cyclic symlink loops, and TOCTOU races.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Tool } from '../Tool.js';
import type { ToolPermission, ToolResult, ToolExecutionContext } from '../../types/index.js';
import { WorkspaceManager } from '../../workspace/WorkspaceManager.js';
import { SecurityError } from '../../../core/errors/index.js';
import { SafeRegexMatcher } from './SafeRegexMatcher.js';

export interface SearchMatch {
  file: string;
  line: number;
  content: string;
}

const MAX_QUERY_LENGTH = 500;

export class SearchFilesTool extends Tool {
  public readonly name = 'search_files';
  public readonly description = 'Searches for text or regex patterns across files in the workspace';
  public readonly permissions: ToolPermission[] = ['read_only'];

  public readonly parameters = {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Text pattern or regular expression to search for (max 500 characters)'
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

    if (query.length > MAX_QUERY_LENGTH) {
      return { success: false, error: `Search query length (${query.length}) exceeds maximum allowed limit of ${MAX_QUERY_LENGTH} characters` };
    }

    const relPath = typeof args['path'] === 'string' ? args['path'] : '.';
    const isRegex = Boolean(args['is_regex']);
    const caseSensitive = Boolean(args['case_sensitive']);
    const filePattern = typeof args['file_pattern'] === 'string' ? args['file_pattern'].toLowerCase().trim() : null;
    const maxResults = typeof args['max_results'] === 'number' && args['max_results'] > 0
      ? Math.min(Math.floor(args['max_results']), 200)
      : 50;

    // Validate regex syntax upfront if regex mode is requested
    const regexFlags = caseSensitive ? '' : 'i';
    if (isRegex) {
      try {
        new RegExp(query, regexFlags);
      } catch (err: unknown) {
        return { success: false, error: `Invalid regular expression query: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    const matcher = isRegex ? new SafeRegexMatcher({ timeoutMs: 1500 }) : null;

    try {
      const searchRoot = ws.resolvePath(relPath);
      const matches: SearchMatch[] = [];
      let truncated = false;
      const MAX_FILES_SCANNED = 500;
      let filesScanned = 0;

      // Track visited canonical directory paths to eliminate cyclic symlink loops
      const visitedDirs = new Set<string>();

      const openFlags = fs.constants.O_RDONLY | (process.platform !== 'win32' ? (fs.constants.O_NOFOLLOW ?? 0) : 0);

      const scanDirectory = async (currentDir: string): Promise<void> => {
        if (matches.length >= maxResults || filesScanned >= MAX_FILES_SCANNED) {
          truncated = true;
          return;
        }

        if (context?.signal?.aborted) {
          return;
        }

        let canonicalDir: string;
        try {
          canonicalDir = fs.realpathSync(currentDir);
        } catch {
          return; // Skip unresolvable directory
        }

        // Prevent infinite loops across cyclic or duplicate directory symlinks
        if (visitedDirs.has(canonicalDir)) {
          return;
        }
        visitedDirs.add(canonicalDir);

        let entries;
        try {
          entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
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

            let fileHandle: fs.promises.FileHandle | null = null;
            try {
              fileHandle = await fs.promises.open(fullPath, openFlags);
              const stat = await fileHandle.stat();
              if (!stat.isFile()) continue;

              // Check binary via header bytes
              const header = Buffer.alloc(4096);
              const { bytesRead: hBytes } = await fileHandle.read(header, 0, 4096, 0);
              let isBin = false;
              for (let i = 0; i < hBytes; i++) {
                if (header[i] === 0) {
                  isBin = true;
                  break;
                }
              }
              if (isBin) continue;

              // Read file content
              const contentBuf = Buffer.alloc(stat.size);
              await fileHandle.read(contentBuf, 0, stat.size, 0);
              const content = contentBuf.toString('utf-8');
              const lines = content.split(/\r?\n/);

              if (matcher) {
                // Regex search executed in isolated worker thread with ReDoS timeout
                const matchedLineIndices = await matcher.matchLines(lines, query, regexFlags);
                for (const lineIdx of matchedLineIndices) {
                  if (matches.length >= maxResults) {
                    truncated = true;
                    break;
                  }
                  const lineText = lines[lineIdx] ?? '';
                  matches.push({
                    file: ws.toRelative(fullPath),
                    line: lineIdx + 1,
                    content: lineText.trim().slice(0, 300)
                  });
                }
              } else {
                // Literal string search (linear time complexity, immune to ReDoS)
                const targetQuery = caseSensitive ? query : query.toLowerCase();
                for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
                  if (matches.length >= maxResults) {
                    truncated = true;
                    break;
                  }
                  const lineText = lines[lineIdx] ?? '';
                  const hasMatch = caseSensitive
                    ? lineText.includes(targetQuery)
                    : lineText.toLowerCase().includes(targetQuery);

                  if (hasMatch) {
                    matches.push({
                      file: ws.toRelative(fullPath),
                      line: lineIdx + 1,
                      content: lineText.trim().slice(0, 300)
                    });
                  }
                }
              }
            } catch (err: unknown) {
              // ReDoS timeout or security error must bubble up
              const msg = err instanceof Error ? err.message : String(err);
              if (msg.includes('ReDoS') || msg.includes('timed out')) {
                throw err;
              }
              // Ignore other non-fatal read errors
            } finally {
              if (fileHandle) {
                try {
                  await fileHandle.close();
                } catch {
                  // File descriptor closed
                }
              }
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
    } finally {
      if (matcher) {
        await matcher.terminate();
      }
    }
  }
}
