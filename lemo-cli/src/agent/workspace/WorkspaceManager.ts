/**
 * Workspace Manager
 * Enforces secure workspace containment, canonical path resolution,
 * symlink verification, sensitive file redaction, and path traversal protection.
 */

import path from 'node:path';
import fs from 'node:fs';
import { SecurityError, WorkspaceError } from '../../core/errors/index.js';

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
   */
  public isSensitive(filePath: string): boolean {
    const base = path.basename(filePath).toLowerCase();

    // Environment files
    if (base === '.env' || base.startsWith('.env.')) {
      return true;
    }

    // Private SSH / SSL keys
    if (/^id_(rsa|ed25519|ecdsa|dsa)(\.pub)?$/i.test(base)) {
      return true;
    }
    if (/\.(pem|key|pkcs12|pfx|kdbx)$/i.test(base)) {
      return true;
    }

    // Secrets / credentials configs
    if (/^(credentials|client_secret.*|token|secrets?|passwords?)\.json$/i.test(base)) {
      return true;
    }

    // Package manager secret configurations
    if (base === '.npmrc' || base === '.netrc' || base === '.htpasswd') {
      return true;
    }

    // Git internal credential / configuration files
    const normalized = filePath.replace(/\\/g, '/').toLowerCase();
    if (normalized.includes('/.git/config') || normalized.includes('/.git/credentials')) {
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
    try {
      const handle = await fs.promises.open(filePath, 'r');
      const buffer = Buffer.alloc(4096);
      const { bytesRead } = await handle.read(buffer, 0, 4096, 0);
      await handle.close();

      for (let i = 0; i < bytesRead; i++) {
        if (buffer[i] === 0) {
          return true; // Null byte indicates binary content
        }
      }
      return false;
    } catch {
      return false;
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
}
