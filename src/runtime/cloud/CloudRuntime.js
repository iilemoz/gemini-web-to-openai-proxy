import { containerManager } from './ContainerManager.js';
import { dockerManager } from './DockerManager.js';

/**
 * CloudRuntime provides an unified API for running isolated, containerized tasks.
 */
export class CloudRuntime {
  constructor(mgr = containerManager) {
    this.manager = mgr;
  }

  async checkStatus() {
    const dockerAvailable = await dockerManager.isDockerAvailable();
    return {
      status: 'active',
      dockerAvailable,
      sandboxesActive: this.manager.sandboxes.size,
      activeSandboxes: this.manager.listSandboxes()
    };
  }

  async createSandbox(opts) {
    return await this.manager.createSandbox(opts);
  }

  async execute(sandboxId, command, opts) {
    return await this.manager.executeInSandbox(sandboxId, command, opts);
  }

  async writeFile(sandboxId, filePath, content) {
    return await this.manager.writeFile(sandboxId, filePath, content);
  }

  async readFile(sandboxId, filePath) {
    return await this.manager.readFile(sandboxId, filePath);
  }

  async destroy(sandboxId) {
    return await this.manager.destroySandbox(sandboxId);
  }
}

export const cloudRuntime = new CloudRuntime();
