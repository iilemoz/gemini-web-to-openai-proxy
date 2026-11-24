import { toolRegistry } from '../../tools/registry/ToolRegistry.js';
import { registerFSTools } from './tools/fsTools.js';
import { registerTerminalTools } from './tools/terminalTools.js';
import { registerGitTools } from './tools/gitTools.js';
import { registerProjectTools } from './tools/projectTools.js';
import { logger } from '../../utils/logger.js';

export function registerLocalTools(registry = toolRegistry) {
  registerFSTools(registry);
  registerTerminalTools(registry);
  registerGitTools(registry);
  registerProjectTools(registry);
  logger.info('[LocalRuntime] Registered Local Runtime tools (FS, Terminal, Git, Project)');
}
