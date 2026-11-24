import fs from 'node:fs/promises';
import path from 'node:path';
import { workspaceManager } from '../WorkspaceManager.js';

export function registerProjectTools(registry) {
  registry.register({
    schema: {
      name: 'analyze_project',
      description: 'Analyzes project type, package.json dependencies, and high-level structure.',
      parameters: { type: 'object', properties: {} },
      requiredPermissions: ['read:fs'],
      executionTarget: 'local'
    },
    handler: async () => {
      const summary = {
        projectType: 'Unknown',
        hasPackageJson: false,
        dependencies: {},
        devDependencies: {},
        topLevelEntries: []
      };

      try {
        const pkgContent = await workspaceManager.readFile('package.json');
        const pkg = JSON.parse(pkgContent);
        summary.projectType = 'Node.js / JavaScript';
        summary.hasPackageJson = true;
        summary.name = pkg.name;
        summary.version = pkg.version;
        summary.dependencies = pkg.dependencies || {};
        summary.devDependencies = pkg.devDependencies || {};
      } catch {
        // Not a node project
      }

      const files = await workspaceManager.listFiles('.', false);
      summary.topLevelEntries = files.map(f => f.name);
      return summary;
    }
  });

  registry.register({
    schema: {
      name: 'get_project_structure',
      description: 'Returns recursive directory tree up to maxDepth (excluding node_modules and .git).',
      parameters: {
        type: 'object',
        properties: {
          maxDepth: { type: 'number', description: 'Maximum depth level to recurse (default: 3)' }
        }
      },
      requiredPermissions: ['read:fs'],
      executionTarget: 'local'
    },
    handler: async ({ maxDepth = 3 }) => {
      const root = workspaceManager.authorizedRoots[0];
      const tree = [];

      async function buildTree(dir, currentDepth) {
        if (currentDepth > maxDepth) return;
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === 'node_modules' || entry.name === '.git') continue;
          const relPath = path.relative(root, path.join(dir, entry.name)).replace(/\\/g, '/');
          tree.push({
            name: entry.name,
            path: relPath,
            depth: currentDepth,
            isDirectory: entry.isDirectory()
          });
          if (entry.isDirectory()) {
            await buildTree(path.join(dir, entry.name), currentDepth + 1);
          }
        }
      }

      await buildTree(root, 1);
      return tree;
    }
  });
}
