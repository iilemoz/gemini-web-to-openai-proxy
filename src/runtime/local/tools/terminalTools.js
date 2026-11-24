import { terminalManager } from '../TerminalManager.js';

export function registerTerminalTools(registry) {
  registry.register({
    schema: {
      name: 'execute_command',
      description: 'Executes a terminal command inside the authorized workspace and returns stdout, stderr, and exitCode.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command line to execute' },
          timeoutMs: { type: 'number', description: 'Maximum execution time in ms (default: 60000)' }
        },
        required: ['command']
      },
      requiredPermissions: ['execute:command'],
      timeoutMs: 120000,
      executionTarget: 'local'
    },
    handler: async ({ command, timeoutMs = 60000 }) => {
      return await terminalManager.executeCommand(command, { timeoutMs });
    }
  });

  registry.register({
    schema: {
      name: 'list_processes',
      description: 'Lists currently tracked background processes.',
      parameters: { type: 'object', properties: {} },
      requiredPermissions: ['read:process'],
      executionTarget: 'local'
    },
    handler: async () => {
      return terminalManager.listProcesses();
    }
  });

  registry.register({
    schema: {
      name: 'stop_process',
      description: 'Terminates an active process by process ID.',
      parameters: {
        type: 'object',
        properties: {
          processId: { type: 'string', description: 'The process identifier' }
        },
        required: ['processId']
      },
      requiredPermissions: ['execute:command'],
      executionTarget: 'local'
    },
    handler: async ({ processId }) => {
      return terminalManager.stopProcess(processId);
    }
  });
}
