/**
 * Workspace Manager
 * Enforces secure workspace containment, canonical path resolution,
 * symlink verification, sensitive file redaction, and path traversal protection.
 */

import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { SecurityError, WorkspaceError } from '../../core/errors/index.js';

export interface WorkspaceIdentity {
  canonicalPath: string;
  deviceNumber: number;
  inodeNumber: number;
}

/**
 * Checks whether childPath is equal to or located inside parentPath.
 * Accounts for Windows drive letter casing and case-insensitivity.
 */
export function isPathInside(parentPath: string, childPath: string): boolean {
  const normParent = path.resolve(parentPath);
  const normChild = path.resolve(childPath);

  if (process.platform === 'win32') {
    const p = normParent.toLowerCase();
    const c = normChild.toLowerCase();
    if (p === c) return true;
    const rel = path.relative(p, c);
    return !rel.startsWith('..') && !path.isAbsolute(rel);
  } else {
    if (normParent === normChild) return true;
    const rel = path.relative(normParent, normChild);
    return !rel.startsWith('..') && !path.isAbsolute(rel);
  }
}

export interface WorkspaceManagerOptions {
  allowSensitiveFiles?: boolean;
}

export class WorkspaceManager {
  private readonly root: string;
  private readonly allowSensitiveFiles: boolean;

  constructor(workspaceRoot: string = process.cwd(), options: WorkspaceManagerOptions = {}) {
    this.allowSensitiveFiles = options.allowSensitiveFiles ?? false;

    if (!workspaceRoot || typeof workspaceRoot !== 'string' || workspaceRoot.trim() === '') {
      throw new WorkspaceError('Workspace path cannot be empty');
    }

    const resolved = path.resolve(workspaceRoot);
    if (!fs.existsSync(resolved)) {
      throw new WorkspaceError(`Workspace directory does not exist: '${resolved}'`);
    }

    try {
      const stat = fs.statSync(resolved);
      if (!stat.isDirectory()) {
        throw new WorkspaceError(`Workspace path is not a directory: '${resolved}'`);
      }
      this.root = fs.realpathSync(resolved);
    } catch (err: unknown) {
      if (err instanceof WorkspaceError) throw err;
      throw new WorkspaceError(`Failed to initialize workspace root '${resolved}': ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Returns the canonical workspace root directory.
   */
  public getRoot(): string {
    return this.root;
  }

  /**
   * Resolves and verifies that a target path lies securely inside the canonical workspace.
   * Handles relative paths, absolute paths, null-byte attacks, and symlinks.
   */
  public resolvePath(targetPath: string): string {
    if (typeof targetPath !== 'string') {
      throw new SecurityError('Target path must be a string');
    }

    // 1. Detect null-byte injection
    if (targetPath.includes('\0')) {
      throw new SecurityError('Null byte detected in path');
    }

    const trimmed = targetPath.trim();
    if (!trimmed || trimmed === '.') {
      return this.root;
    }

    // 2. Resolve target relative to workspace root (or resolve absolute path directly)
    const resolved = path.isAbsolute(trimmed)
      ? path.resolve(trimmed)
      : path.resolve(this.root, trimmed);

    // 3. Prevent path traversal beyond canonical workspace root
    if (!isPathInside(this.root, resolved)) {
      throw new SecurityError(`Access denied: path '${targetPath}' is outside workspace root`);
    }

    // 4. Verify symbolic links and ancestor directories
    if (fs.existsSync(resolved)) {
      try {
        const canonical = fs.realpathSync(resolved);
        if (!isPathInside(this.root, canonical)) {
          throw new SecurityError(`Security Exception: Symlink points outside workspace: '${targetPath}' -> '${canonical}'`);
        }
        return canonical;
      } catch (err) {
        if (err instanceof SecurityError) throw err;
        throw new SecurityError(`Failed to resolve canonical path for '${targetPath}': ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      // If path doesn't exist yet, inspect all existing ancestor directories
      let current = path.dirname(resolved);
      while (current && current !== path.dirname(current)) {
        if (fs.existsSync(current)) {
          try {
            const canonicalParent = fs.realpathSync(current);
            if (!isPathInside(this.root, canonicalParent)) {
              throw new SecurityError(`Security Exception: Ancestor directory symlink points outside workspace: '${targetPath}'`);
            }
          } catch (err) {
            if (err instanceof SecurityError) throw err;
            throw new SecurityError(`Failed to verify parent path for '${targetPath}'`);
          }
          break;
        }
        current = path.dirname(current);
      }
      return resolved;
    }
  }

  /**
   * Checks whether a file path points to a sensitive environment or secret file.
   * Performs case-insensitive matching across basename and normalized relative path.
   */
  public isSensitive(filePath: string): boolean {
    const base = path.basename(filePath).toLowerCase();
    const normalized = filePath.replace(/\\/g, '/').toLowerCase();

    // 1. Environment files (.env, .env.local, .env.production, etc.)
    if (base === '.env' || base.startsWith('.env.')) {
      return true;
    }

    // 2. Private SSH keys (id_rsa, id_ed25519, id_ecdsa, id_ecdsa_sk, id_ed25519_sk, id_dsa, etc.)
    // Explicitly allow public keys (*.pub)
    if (/^id_[a-z0-9_-]+$/i.test(base)) {
      return true;
    }

    // 3. Certificates, private keys & password databases (.pem, .key, .pkcs12, .pfx, .p12, .kdbx, .keystore, .jks)
    if (/\.(pem|key|pkcs12|pfx|p12|kdbx|keystore|jks)$/i.test(base)) {
      return true;
    }

    // 4. Secret / credential configuration files
    if (/^(credentials|client_secret.*|token|secrets?|passwords?)\.(json|ya?ml|ini)$/i.test(base)) {
      return true;
    }

    // 5. Package manager, tool, and shell secret files
    if (
      base === '.npmrc' ||
      base === '.netrc' ||
      base === '.pypirc' ||
      base === '.htpasswd' ||
      base === '.pgpass' ||
      base === 'master.key' ||
      base === '.bash_history' ||
      base === '.zsh_history'
    ) {
      return true;
    }

    // 6. Docker Compose secret overrides (e.g. docker-compose.override.yml, compose.override.yaml)
    // Note: Standard docker-compose.yml / compose.yaml are NOT blocked
    if (/^(docker-compose|compose)\.override\.(ya?ml)$/i.test(base)) {
      return true;
    }

    // 7. Cloud, VCS, and system credential stores
    if (
      normalized.includes('/.aws/credentials') ||
      normalized.includes('/.aws/config') ||
      normalized.endsWith('.aws/credentials') ||
      normalized.endsWith('.aws/config') ||
      normalized.includes('/.git/config') ||
      normalized.includes('/.git/credentials') ||
      normalized.includes('/.git-credentials')
    ) {
      return true;
    }

    return false;
  }

  /**
   * Asserts that a target file is not classified as sensitive.
   */
  public assertNotSensitive(filePath: string): void {
    if (!this.allowSensitiveFiles && this.isSensitive(filePath)) {
      throw new SecurityError(`Access denied to sensitive file: '${path.basename(filePath)}'`);
    }
  }

  /**
   * Detects whether a file contains binary content by inspecting its initial byte header.
   */
  public async isBinary(filePath: string): Promise<boolean> {
    let handle: fs.promises.FileHandle | null = null;
    try {
      handle = await fs.promises.open(filePath, 'r');
      const buffer = Buffer.alloc(4096);
      const { bytesRead } = await handle.read(buffer, 0, 4096, 0);

      for (let i = 0; i < bytesRead; i++) {
        if (buffer[i] === 0) {
          return true; // Null byte indicates binary content
        }
      }
      return false;
    } catch {
      return false;
    } finally {
      if (handle) {
        try {
          await handle.close();
        } catch {
          // Ignore close error
        }
      }
    }
  }

  /**
   * Converts an absolute path inside the workspace to a clean, POSIX-style relative path.
   */
  public toRelative(targetPath: string): string {
    const rel = path.relative(this.root, targetPath);
    if (!rel || rel === '') return '.';
    return rel.replace(/\\/g, '/');
  }

  /**
   * Returns cryptographic identity of the canonical workspace root.
   */
  public getIdentity(): WorkspaceIdentity {
    const stat = fs.statSync(this.root);
    return {
      canonicalPath: this.root,
      deviceNumber: Number(stat.dev),
      inodeNumber: Number(stat.ino)
    };
  }

  /**
   * Revalidates workspace directory identity against expected identity.
   */
  public verifyIdentity(expected: WorkspaceIdentity): boolean {
    try {
      const canonical = fs.realpathSync(this.root);
      if (canonical !== expected.canonicalPath) return false;
      const stat = fs.statSync(canonical);
      return Number(stat.dev) === expected.deviceNumber && Number(stat.ino) === expected.inodeNumber;
    } catch {
      return false;
    }
  }

  private static readonly activeGlobalTempFiles = new Set<string>();
  private static exitHookRegistered = false;

  private static registerExitHook(): void {
    if (WorkspaceManager.exitHookRegistered) return;
    WorkspaceManager.exitHookRegistered = true;

    const cleanup = () => {
      for (const tempPath of WorkspaceManager.activeGlobalTempFiles) {
        try {
          if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
          }
        } catch {
          // Best effort cleanup during process exit
        }
      }
      WorkspaceManager.activeGlobalTempFiles.clear();
    };

    process.on('exit', cleanup);
    process.on('SIGINT', () => {
      cleanup();
      process.exit(130);
    });
    process.on('SIGTERM', () => {
      cleanup();
      process.exit(143);
    });
  }

  /**
   * Atomically writes content to a target file inside the workspace.
   * Guarantees:
   * 1. Target and parent directory validation inside canonical workspace.
   * 2. Exclusive temporary sibling file creation with mode 0o600.
   * 3. Full sync of temporary file descriptor before closing.
   * 4. Pre-commit parent and target identity verification.
   * 5. Atomic rename replacement.
   * 6. Cleanup of temporary files on all failure paths.
   */
  public async writeAtomic(targetPath: string, content: string | Buffer): Promise<{ bytesWritten: number }> {
    const canonicalTarget = this.resolvePath(targetPath);

    if (canonicalTarget === this.root) {
      throw new SecurityError('Cannot overwrite workspace root directory');
    }

    this.assertNotSensitive(canonicalTarget);

    const parentDir = path.dirname(canonicalTarget);
    if (!fs.existsSync(parentDir)) {
      throw new WorkspaceError(`Parent directory does not exist: '${this.toRelative(parentDir)}'`);
    }

    const canonicalParent = fs.realpathSync(parentDir);
    if (!isPathInside(this.root, canonicalParent)) {
      throw new SecurityError('Parent directory symlink points outside workspace');
    }

    const parentStat = fs.statSync(canonicalParent);
    if (!parentStat.isDirectory()) {
      throw new WorkspaceError(`Parent path is not a directory: '${this.toRelative(parentDir)}'`);
    }

    const targetExists = fs.existsSync(canonicalTarget);
    if (targetExists) {
      const lstat = fs.lstatSync(canonicalTarget);
      if (lstat.isSymbolicLink()) {
        throw new SecurityError(`Refusing to write through symlink destination: '${this.toRelative(canonicalTarget)}'`);
      }
      if (lstat.isDirectory()) {
        throw new SecurityError(`Cannot overwrite directory with file: '${this.toRelative(canonicalTarget)}'`);
      }
      if (!lstat.isFile()) {
        throw new SecurityError(`Target is not a regular file: '${this.toRelative(canonicalTarget)}'`);
      }
    }

    // Generate exclusive sibling temp file
    const base = path.basename(canonicalTarget);
    const uuid = crypto.randomUUID();
    const tempPath = path.join(canonicalParent, `.${base}.lemo_tmp_${uuid}`);

    WorkspaceManager.registerExitHook();
    WorkspaceManager.activeGlobalTempFiles.add(tempPath);

    let handle: fs.promises.FileHandle | null = null;

    try {
      // Exclusive creation mode 0o600 (owner read/write only)
      handle = await fs.promises.open(tempPath, 'wx', 0o600);
      const buf = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
      await handle.writeFile(buf);
      await handle.sync();
      await handle.close();
      handle = null;

      // Revalidate parent directory identity
      const currentParentStat = await fs.promises.stat(canonicalParent);
      if (
        Number(currentParentStat.dev) !== Number(parentStat.dev) ||
        Number(currentParentStat.ino) !== Number(parentStat.ino)
      ) {
        throw new SecurityError('Parent directory identity changed during atomic write operation');
      }

      // Revalidate target if it existed
      if (targetExists) {
        const currentTargetLstat = await fs.promises.lstat(canonicalTarget);
        if (currentTargetLstat.isSymbolicLink()) {
          throw new SecurityError('Target file was replaced with a symlink during write operation');
        }
      }

      // Atomic replacement
      let renamed = false;
      let renameErr: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await fs.promises.rename(tempPath, canonicalTarget);
          renamed = true;
          break;
        } catch (err: unknown) {
          renameErr = err;
          const code = (err as { code?: string })?.code;
          if (process.platform === 'win32' && (code === 'EBUSY' || code === 'EPERM')) {
            await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
          } else {
            break;
          }
        }
      }

      if (!renamed) {
        throw renameErr;
      }

      // Sync parent directory where supported on POSIX
      if (process.platform !== 'win32') {
        let parentHandle: fs.promises.FileHandle | null = null;
        try {
          parentHandle = await fs.promises.open(canonicalParent, 'r');
          await parentHandle.sync();
        } catch {
          // Ignore parent sync error on filesystems that don't support directory fsync
        } finally {
          if (parentHandle) {
            try {
              await parentHandle.close();
            } catch {
              // Ignore close error
            }
          }
        }
      }

      WorkspaceManager.activeGlobalTempFiles.delete(tempPath);
      return { bytesWritten: buf.length };
    } catch (err) {
      if (handle) {
        try {
          await handle.close();
        } catch {
          // Ignore close error
        }
      }
      try {
        if (fs.existsSync(tempPath)) {
          await fs.promises.unlink(tempPath);
        }
      } catch {
        // Ignore unlink error
      }
      WorkspaceManager.activeGlobalTempFiles.delete(tempPath);
      throw err;
    }
  }

  /**
   * Sweeps and removes stale temp files older than maxAgeMs.
   */
  public cleanStaleTempFiles(maxAgeMs = 3_600_000): void {
    try {
      const files = fs.readdirSync(this.root);
      const now = Date.now();
      for (const file of files) {
        if (file.startsWith('.') && file.includes('.lemo_tmp_')) {
          const full = path.join(this.root, file);
          try {
            const stat = fs.statSync(full);
            if (now - stat.mtimeMs > maxAgeMs) {
              fs.unlinkSync(full);
            }
          } catch {
            // Ignore individual file error
          }
        }
      }
    } catch {
      // Ignore directory read error
    }
  }
}
