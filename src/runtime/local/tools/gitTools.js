import { terminalManager } from '../TerminalManager.js';

export function registerGitTools(registry) {
  registry.register({
    schema: {
      name: 'git_status',
      description: 'Runs git status in the project workspace.',
      parameters: { type: 'object', properties: {} },
      requiredPermissions: ['read:git'],
      executionTarget: 'local'
    },
    handler: async () => {
      return await terminalManager.executeCommand('git status --short');
    }
  });

  registry.register({
    schema: {
      name: 'git_diff',
      description: 'Runs git diff to inspect uncommitted changes.',
      parameters: {
        type: 'object',
        properties: {
          staged: { type: 'boolean', description: 'Inspect staged changes if true' }
        }
      },
      requiredPermissions: ['read:git'],
      executionTarget: 'local'
    },
    handler: async ({ staged = false }) => {
      const cmd = staged ? 'git diff --cached' : 'git diff';
      return await terminalManager.executeCommand(cmd);
    }
  });

  registry.register({
    schema: {
      name: 'git_log',
      description: 'Shows recent git commits.',
      parameters: {
        type: 'object',
        properties: {
          count: { type: 'number', description: 'Number of commits to retrieve (default: 5)' }
        }
      },
      requiredPermissions: ['read:git'],
      executionTarget: 'local'
    },
    handler: async ({ count = 5 }) => {
      return await terminalManager.executeCommand(`git log -n ${count} --oneline`);
    }
  });

  registry.register({
    schema: {
      name: 'git_commit',
      description: 'Creates a git commit with the specified message.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Commit message' }
        },
        required: ['message']
      },
      requiredPermissions: ['write:git'],
      executionTarget: 'local'
    },
    handler: async ({ message }) => {
      const sanitized = message.replace(/"/g, '\\"');
      return await terminalManager.executeCommand(`git commit -m "${sanitized}"`);
    }
  });
}
