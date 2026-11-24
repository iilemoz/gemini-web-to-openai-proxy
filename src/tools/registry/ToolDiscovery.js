import { toolRegistry } from './ToolRegistry.js';

/**
 * Tool Discovery helper.
 * Discovers and filters tools according to requested categories, permissions, and environments.
 */
export class ToolDiscovery {
  constructor(registry = toolRegistry) {
    this.registry = registry;
  }

  findAvailable(grantedPermissions = ['none', 'all'], target = null) {
    const permSet = new Set(grantedPermissions);
    const hasAll = permSet.has('all');

    return this.registry.list().filter(tool => {
      // Filter by execution target (local, cloud, both)
      if (target && tool.executionTarget !== target && tool.executionTarget !== 'any') {
        return false;
      }

      // Filter by permissions
      if (hasAll) return true;
      return tool.requiredPermissions.every(p => permSet.has(p) || p === 'none');
    });
  }

  getAuthorizedTools(grantedPermissions = ['none', 'all'], target = null) {
    return this.findAvailable(grantedPermissions, target);
  }

  search(keyword = '') {
    const q = keyword.toLowerCase().trim();
    if (!q) return this.registry.list();
    return this.registry.list().filter(tool =>
      tool.name.toLowerCase().includes(q) ||
      tool.description.toLowerCase().includes(q)
    );
  }
}

export const toolDiscovery = new ToolDiscovery();
