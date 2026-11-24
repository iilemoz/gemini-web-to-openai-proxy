import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../../utils/logger.js';

const execFileAsync = promisify(execFile);

/**
 * DockerManager provides low-level command execution against the local Docker CLI daemon.
 * It is completely resilient to Docker being absent or stopped on the host.
 */
export class DockerManager {
  constructor() {
    this._isAvailable = null;
  }

  async isDockerAvailable() {
    if (this._isAvailable !== null) return this._isAvailable;
    try {
      await execFileAsync('docker', ['version'], { timeout: 3000 });
      this._isAvailable = true;
    } catch {
      this._isAvailable = false;
    }
    return this._isAvailable;
  }

  async runContainer({
    image = 'node:20-alpine',
    name,
    memoryLimit = '512m',
    cpuLimit = '1.0',
    network = 'none',
    workdir = '/workspace'
  }) {
    const args = [
      'run',
      '-d',
      '--name', name,
      '--memory', memoryLimit,
      '--cpus', cpuLimit,
      '--network', network,
      '-w', workdir,
      image,
      'tail', '-f', '/dev/null'
    ];

    try {
      const { stdout } = await execFileAsync('docker', args, { timeout: 15000 });
      return stdout.trim();
    } catch (err) {
      logger.warn(`[DockerManager] Failed to run container '${name}': ${err.message}`);
      throw err;
    }
  }

  async execInContainer(containerName, command, { timeoutMs = 30000 } = {}) {
    try {
      const { stdout, stderr } = await execFileAsync(
        'docker',
        ['exec', containerName, 'sh', '-c', command],
        { timeout: timeoutMs }
      );
      return { stdout, stderr, exitCode: 0 };
    } catch (err) {
      return {
        stdout: err.stdout || '',
        stderr: err.stderr || err.message,
        exitCode: err.code || 1
      };
    }
  }

  async stopAndRemove(containerName) {
    try {
      await execFileAsync('docker', ['rm', '-f', containerName], { timeout: 10000 });
      return true;
    } catch {
      return false;
    }
  }
}

export const dockerManager = new DockerManager();
