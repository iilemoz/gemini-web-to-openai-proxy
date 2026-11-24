import { workspaceManager } from '../WorkspaceManager.js';

export function registerFSTools(registry) {
  registry.register({
    schema: {
      name: 'list_files',
      description: 'Lists files and directories within an authorized workspace path.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative directory path to list (default: ".")' },
          recursive: { type: 'boolean', description: 'Whether to list recursively (default: false)' }
        }
      },
      requiredPermissions: ['read:fs'],
      executionTarget: 'local'
    },
    handler: async ({ path = '.', recursive = false }) => {
      return await workspaceManager.listFiles(path, recursive);
    }
  });

  registry.register({
    schema: {
      name: 'read_file',
      description: 'Reads the complete text content of a file within the authorized workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path of the file to read' }
        },
        required: ['path']
      },
      requiredPermissions: ['read:fs'],
      executionTarget: 'local'
    },
    handler: async ({ path: filePath }) => {
      const content = await workspaceManager.readFile(filePath);
      return { path: filePath, content };
    }
  });

  registry.register({
    schema: {
      name: 'write_file',
      description: 'Creates or completely overwrites a file in the authorized workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path of the file' },
          content: { type: 'string', description: 'Complete file text content to write' }
        },
        required: ['path', 'content']
      },
      requiredPermissions: ['write:fs'],
      executionTarget: 'local'
    },
    handler: async ({ path: filePath, content }) => {
      return await workspaceManager.writeFile(filePath, content);
    }
  });

  registry.register({
    schema: {
      name: 'edit_file',
      description: 'Replaces an exact occurrence of target string with replacement in a file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path of the file to edit' },
          target: { type: 'string', description: 'Exact text segment to replace' },
          replacement: { type: 'string', description: 'New text segment to insert' }
        },
        required: ['path', 'target', 'replacement']
      },
      requiredPermissions: ['write:fs'],
      executionTarget: 'local'
    },
    handler: async ({ path: filePath, target, replacement }) => {
      return await workspaceManager.editFile(filePath, target, replacement);
    }
  });

  registry.register({
    schema: {
      name: 'delete_file',
      description: 'Deletes a file within the authorized workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path of the file to delete' }
        },
        required: ['path']
      },
      requiredPermissions: ['write:fs'],
      executionTarget: 'local'
    },
    handler: async ({ path: filePath }) => {
      return await workspaceManager.deleteFile(filePath);
    }
  });

  registry.register({
    schema: {
      name: 'create_directory',
      description: 'Creates a new directory in the workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path to create' }
        },
        required: ['path']
      },
      requiredPermissions: ['write:fs'],
      executionTarget: 'local'
    },
    handler: async ({ path: dirPath }) => {
      return await workspaceManager.createDirectory(dirPath);
    }
  });

  registry.register({
    schema: {
      name: 'get_file_info',
      description: 'Gets file metadata (size, timestamps, isDirectory).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to inspect' }
        },
        required: ['path']
      },
      requiredPermissions: ['read:fs'],
      executionTarget: 'local'
    },
    handler: async ({ path: targetPath }) => {
      return await workspaceManager.getFileInfo(targetPath);
    }
  });
}
