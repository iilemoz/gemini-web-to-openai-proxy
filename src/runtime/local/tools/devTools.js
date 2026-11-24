import fs from 'node:fs/promises';
import path from 'node:path';
import { workspaceManager } from '../WorkspaceManager.js';
import { terminalManager } from '../TerminalManager.js';

export const devTools = [
  {
    schema: {
      name: 'search_code',
      description: 'Search for text or regex pattern across workspace files with line numbers and matched snippets.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern or search string' },
          fileExtension: { type: 'string', description: 'Optional extension filter like .js or .json' },
          maxResults: { type: 'number', description: 'Max matches to return (default 50)' }
        },
        required: ['pattern']
      },
      requiredPermissions: ['read:fs'],
      executionTarget: 'local'
    },
    handler: async (args, context) => {
      const root = context?.workspaceRoot || workspaceManager.authorizedRoots[0] || process.cwd();
      const regex = new RegExp(args.pattern, 'i');
      const maxResults = args.maxResults || 50;
      const matches = [];

      async function scanDir(dir) {
        if (matches.length >= maxResults) return;
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (matches.length >= maxResults) break;
          const fullPath = path.join(dir, entry.name);

          if (['node_modules', '.git', 'dist', 'build', '.gemini'].includes(entry.name)) continue;

          if (entry.isDirectory()) {
            await scanDir(fullPath);
          } else if (entry.isFile()) {
            if (args.fileExtension && !entry.name.endsWith(args.fileExtension)) continue;
            try {
              const content = await fs.readFile(fullPath, 'utf8');
              const lines = content.split(/\r?\n/);
              for (let i = 0; i < lines.length; i++) {
                if (regex.test(lines[i])) {
                  matches.push({
                    file: path.relative(root, fullPath).replace(/\\/g, '/'),
                    line: i + 1,
                    text: lines[i].trim()
                  });
                  if (matches.length >= maxResults) break;
                }
              }
            } catch {
              // Ignore binary or unreadable files
            }
          }
        }
      }

      await scanDir(root);
      return { totalMatches: matches.length, matches };
    }
  },

  {
    schema: {
      name: 'find_by_name',
      description: 'Find files or directories matching a name pattern or glob across the workspace.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Substring or pattern of the filename' }
        },
        required: ['pattern']
      },
      requiredPermissions: ['read:fs'],
      executionTarget: 'local'
    },
    handler: async (args, context) => {
      const root = context?.workspaceRoot || workspaceManager.authorizedRoots[0] || process.cwd();
      const query = args.pattern.toLowerCase();
      const results = [];

      async function scanDir(dir) {
        if (results.length >= 100) return;
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (results.length >= 100) break;
          const fullPath = path.join(dir, entry.name);
          if (['node_modules', '.git', 'dist', '.gemini'].includes(entry.name)) continue;

          if (entry.name.toLowerCase().includes(query)) {
            results.push({
              path: path.relative(root, fullPath).replace(/\\/g, '/'),
              type: entry.isDirectory() ? 'directory' : 'file'
            });
          }

          if (entry.isDirectory()) {
            await scanDir(fullPath);
          }
        }
      }

      await scanDir(root);
      return { totalFound: results.length, items: results };
    }
  },

  {
    schema: {
      name: 'git_branch',
      description: 'List, create, or switch Git branches in the workspace repository.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'create', 'switch'], description: 'Branch operation' },
          branchName: { type: 'string', description: 'Branch name for create or switch action' }
        },
        required: ['action']
      },
      requiredPermissions: ['execute:terminal'],
      executionTarget: 'local'
    },
    handler: async (args, context) => {
      const root = context?.workspaceRoot || workspaceManager.authorizedRoots[0] || process.cwd();
      if (args.action === 'list') {
        return await terminalManager.executeCommand('git branch -a', { cwd: root });
      }
      if (args.action === 'create') {
        if (!args.branchName) throw new Error('branchName required for create action');
        return await terminalManager.executeCommand(`git branch ${args.branchName}`, { cwd: root });
      }
      if (args.action === 'switch') {
        if (!args.branchName) throw new Error('branchName required for switch action');
        return await terminalManager.executeCommand(`git checkout ${args.branchName}`, { cwd: root });
      }
      throw new Error(`Unsupported git branch action: ${args.action}`);
    }
  },

  {
    schema: {
      name: 'run_diagnostics',
      description: 'Run project diagnostics, syntax verifications, and health checks on workspace files.',
      parameters: {
        type: 'object',
        properties: {
          targetFile: { type: 'string', description: 'Optional specific file path to check syntax' }
        }
      },
      requiredPermissions: ['execute:terminal', 'read:fs'],
      executionTarget: 'local'
    },
    handler: async (args, context) => {
      const root = context?.workspaceRoot || workspaceManager.authorizedRoots[0] || process.cwd();
      const results = { checks: [], passed: true };

      if (args.targetFile) {
        const fullPath = path.resolve(root, args.targetFile);
        if (args.targetFile.endsWith('.js') || args.targetFile.endsWith('.mjs')) {
          const checkRes = await terminalManager.executeCommand(`node --check "${fullPath}"`, { cwd: root });
          const ok = checkRes.exitCode === 0;
          results.checks.push({
            name: `Syntax Check: ${args.targetFile}`,
            passed: ok,
            details: ok ? 'Syntax OK' : checkRes.stderr
          });
          if (!ok) results.passed = false;
        }
      } else {
        try {
          const pkgRaw = await fs.readFile(path.join(root, 'package.json'), 'utf8');
          JSON.parse(pkgRaw);
          results.checks.push({ name: 'package.json validation', passed: true, details: 'Valid JSON' });
        } catch (e) {
          results.checks.push({ name: 'package.json validation', passed: false, details: e.message });
          results.passed = false;
        }

        try {
          const gitRes = await terminalManager.executeCommand('git status --porcelain', { cwd: root });
          results.checks.push({
            name: 'Git Repository Status',
            passed: gitRes.exitCode === 0,
            details: gitRes.exitCode === 0 ? 'Git workspace detected' : 'Not a git repo or error'
          });
        } catch {
          // ignore
        }
      }

      return results;
    }
  }
];
