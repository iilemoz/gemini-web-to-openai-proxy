import { spawn } from 'node:child_process';
import os from 'node:os';

/**
 * Manages terminal execution and child processes with output capture and timeouts.
 */
export class TerminalManager {
  constructor(defaultCwd = process.cwd()) {
    this.defaultCwd = defaultCwd;
    this.processes = new Map();
  }

  getShell() {
    if (os.platform() === 'win32') {
      return 'powershell.exe';
    }
    return process.env.SHELL || '/bin/bash';
  }

  /**
   * Execute command synchronously until completion with timeout.
   */
  async executeCommand(command, { cwd = this.defaultCwd, timeoutMs = 60000, env = {} } = {}) {
    return new Promise((resolve) => {
      const isWindows = os.platform() === 'win32';
      const shell = this.getShell();
      const shellArgs = isWindows && shell.toLowerCase().includes('cmd.exe')
        ? ['/d', '/s', '/c', command]
        : isWindows
        ? ['-NoProfile', '-Command', command]
        : ['-c', command];

      let stdout = '';
      let stderr = '';
      let killed = false;

      const proc = spawn(shell, shellArgs, {
        cwd,
        env: { ...process.env, ...env },
        windowsHide: true
      });

      const timer = setTimeout(() => {
        killed = true;
        proc.kill('SIGTERM');
      }, timeoutMs);

      proc.stdout.on('data', data => {
        stdout += data.toString();
        if (stdout.length > 500000) {
          stdout = stdout.slice(0, 500000) + '\n[Output truncated...]';
        }
      });

      proc.stderr.on('data', data => {
        stderr += data.toString();
        if (stderr.length > 100000) {
          stderr = stderr.slice(0, 100000) + '\n[Error output truncated...]';
        }
      });

      proc.on('close', code => {
        clearTimeout(timer);
        resolve({
          command,
          exitCode: killed ? -1 : (code ?? 0),
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          timedOut: killed
        });
      });

      proc.on('error', err => {
        clearTimeout(timer);
        resolve({
          command,
          exitCode: -1,
          stdout: stdout.trim(),
          stderr: err.message,
          timedOut: false
        });
      });
    });
  }

  /**
   * Start a long-running process and track its lifecycle.
   */
  startProcess(processId, command, { cwd = this.defaultCwd } = {}) {
    const isWindows = os.platform() === 'win32';
    const shell = this.getShell();
    const shellArgs = isWindows && shell.toLowerCase().includes('cmd.exe')
      ? ['/d', '/s', '/c', command]
      : isWindows
      ? ['-NoProfile', '-Command', command]
      : ['-c', command];

    const proc = spawn(shell, shellArgs, { cwd, windowsHide: true });
    let outputBuffer = '';

    proc.stdout.on('data', d => { outputBuffer += d.toString(); });
    proc.stderr.on('data', d => { outputBuffer += d.toString(); });

    this.processes.set(processId, {
      id: processId,
      command,
      pid: proc.pid,
      instance: proc,
      startedAt: Date.now(),
      getOutput: () => outputBuffer
    });

    proc.on('close', () => {
      this.processes.delete(processId);
    });

    return { processId, pid: proc.pid, status: 'running' };
  }

  stopProcess(processId) {
    const record = this.processes.get(processId);
    if (!record) return { processId, status: 'not_found' };
    record.instance.kill('SIGTERM');
    this.processes.delete(processId);
    return { processId, status: 'stopped' };
  }

  listProcesses() {
    return Array.from(this.processes.values()).map(p => ({
      id: p.id,
      command: p.command,
      pid: p.pid,
      startedAt: p.startedAt
    }));
  }
}

export const terminalManager = new TerminalManager();
