import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { dockerManager } from './DockerManager.js';
import { logger } from '../../utils/logger.js';
import { TerminalManager } from '../local/TerminalManager.js';

/**
 * ContainerManager orchestrates sandboxed runtimes (Docker-based or Process-Isolated Fallback).
 */
export class ContainerManager {
  constructor({ tempBase = path.join(os.tmpdir(), 'gemini_cloud_sandboxes') } = {}) {
    this.tempBase = tempBase;
    this.sandboxes = new Map();
    this.terminalManager = new TerminalManager();
  }

  async createSandbox({
    image = 'node:20-alpine',
    memoryLimit = '512m',
    cpuLimit = '1.0',
    network = 'none',
    timeoutMs = 300000 // 5 minutes default lifetime
  } = {}) {
    const sandboxId = `sandbox_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const hasDocker = await dockerManager.isDockerAvailable();

    const sandbox = {
      id: sandboxId,
      image,
      mode: hasDocker ? 'docker' : 'process_fallback',
      status: 'initializing',
      createdAt: Date.now(),
      timeoutMs,
      containerName: `sandbox_${sandboxId}`,
      localPath: path.join(this.tempBase, sandboxId)
    };

    await fs.mkdir(sandbox.localPath, { recursive: true });

    if (hasDocker) {
      try {
        await dockerManager.runContainer({
          image,
          name: sandbox.containerName,
          memoryLimit,
          cpuLimit,
          network
        });
        sandbox.status = 'ready';
      } catch (err) {
        logger.warn(`[ContainerManager] Docker startup failed, falling back to process isolation: ${err.message}`);
        sandbox.mode = 'process_fallback';
        sandbox.status = 'ready';
      }
    } else {
      sandbox.status = 'ready';
    }

    this.sandboxes.set(sandboxId, sandbox);
    logger.info(`[ContainerManager] Created sandbox ${sandboxId} (mode: ${sandbox.mode})`);
    return sandbox;
  }

  async executeInSandbox(sandboxId, command, { timeoutMs = 30000 } = {}) {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) throw new Error(`Sandbox '${sandboxId}' not found`);

    if (sandbox.mode === 'docker') {
      return await dockerManager.execInContainer(sandbox.containerName, command, { timeoutMs });
    } else {
      // Process fallback in sandbox temp directory
      return await this.terminalManager.executeCommand(command, {
        cwd: sandbox.localPath,
        timeoutMs
      });
    }
  }

  async writeFile(sandboxId, filePath, content) {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) throw new Error(`Sandbox '${sandboxId}' not found`);

    const fullPath = path.resolve(sandbox.localPath, filePath.replace(/^[/\\]+/, ''));
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf8');

    if (sandbox.mode === 'docker') {
      // Transfer to docker container via stdin/cat
      const escapedContent = Buffer.from(content).toString('base64');
      await dockerManager.execInContainer(
        sandbox.containerName,
        `mkdir -p $(dirname "${filePath}") && echo "${escapedContent}" | base64 -d > "${filePath}"`
      );
    }
    return { path: filePath, bytesWritten: Buffer.byteLength(content, 'utf8') };
  }

  async readFile(sandboxId, filePath) {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) throw new Error(`Sandbox '${sandboxId}' not found`);

    const fullPath = path.resolve(sandbox.localPath, filePath.replace(/^[/\\]+/, ''));
    const content = await fs.readFile(fullPath, 'utf8');
    return { path: filePath, content };
  }

  async destroySandbox(sandboxId) {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) return false;

    if (sandbox.mode === 'docker') {
      await dockerManager.stopAndRemove(sandbox.containerName);
    }

    try {
      await fs.rm(sandbox.localPath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }

    sandbox.status = 'destroyed';
    this.sandboxes.delete(sandboxId);
    logger.info(`[ContainerManager] Destroyed sandbox ${sandboxId}`);
    return true;
  }

  listSandboxes() {
    return Array.from(this.sandboxes.values()).map(s => ({
      id: s.id,
      mode: s.mode,
      status: s.status,
      createdAt: s.createdAt
    }));
  }
}

export const containerManager = new ContainerManager();
