import { toolRegistry } from './registry/ToolRegistry.js';
import { toolDiscovery } from './registry/ToolDiscovery.js';
import { toolDispatcher } from './dispatcher/ToolDispatcher.js';
import { registerBuiltinTools } from './builtins/index.js';
import { registerLocalTools } from '../runtime/local/registerLocalTools.js';

// Auto-register built-in and local tools on startup
registerBuiltinTools();
registerLocalTools(toolRegistry);

export {
  toolRegistry,
  toolDiscovery,
  toolDispatcher,
  registerBuiltinTools,
  registerLocalTools
};
