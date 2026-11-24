/**
 * Workspace Manager
 * Enforces secure workspace containment, canonical path resolution,
 * symlink verification, sensitive file redaction, and path traversal protection.
 */

import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { SecurityError, WorkspaceError, ToolError } from '../../core/errors/index.js';

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
   * Resolves target path within workspace WITHOUT dereferencing the final leaf symlink.
   * Ensures ancestor directories resolve canonically inside the workspace.
   */
  public resolvePathNoFollow(targetPath: string): string {
    if (typeof targetPath !== 'string') {
      throw new SecurityError('Target path must be a string');
    }

    if (targetPath.includes('\0')) {
      throw new SecurityError('Null byte detected in path');
    }

    const trimmed = targetPath.trim();
    if (!trimmed || trimmed === '.') {
      return this.root;
    }

    const resolved = path.isAbsolute(trimmed)
      ? path.resolve(trimmed)
      : path.resolve(this.root, trimmed);

    if (process.platform === 'win32') {
      if (resolved.toLowerCase() === this.root.toLowerCase()) {
        return this.root;
      }
    } else {
      if (resolved === this.root) {
        return this.root;
      }
    }

    if (!isPathInside(this.root, resolved)) {
      throw new SecurityError(`Access denied: path '${targetPath}' is outside workspace root`);
    }

    // Inspect parent directory canonically
    const parentDir = path.dirname(resolved);
    const leaf = path.basename(resolved);

    if (fs.existsSync(parentDir)) {
      try {
        const canonicalParent = fs.realpathSync(parentDir);
        if (!isPathInside(this.root, canonicalParent)) {
          throw new SecurityError(`Security Exception: Parent directory symlink points outside workspace: '${targetPath}'`);
        }
        const leafPath = path.join(canonicalParent, leaf);
        if (!isPathInside(this.root, leafPath)) {
          throw new SecurityError(`Access denied: path '${targetPath}' is outside workspace root`);
        }
        return leafPath;
      } catch (err) {
        if (err instanceof SecurityError) throw err;
        throw new SecurityError(`Failed to resolve parent path for '${targetPath}': ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      let current = path.dirname(parentDir);
      while (current && current !== path.dirname(current)) {
        if (fs.existsSync(current)) {
          try {
            const canonicalAncestor = fs.realpathSync(current);
            if (!isPathInside(this.root, canonicalAncestor)) {
              throw new SecurityError(`Security Exception: Ancestor directory symlink points outside workspace: '${targetPath}'`);
            }
          } catch (err) {
            if (err instanceof SecurityError) throw err;
            throw new SecurityError(`Failed to verify ancestor path for '${targetPath}'`);
          }
          break;
        }
        current = path.dirname(current);
      }
      return resolved;
    }
  }

  /**
   * Asserts that destinationPath is not equal to sourcePath and not inside sourcePath.
   * Prevents directory move infinite recursion and corruption.
   */
  public assertNotDescendant(sourcePath: string, destinationPath: string): void {
    const normSource = path.resolve(sourcePath);
    const normDest = path.resolve(destinationPath);

    if (isPathInside(normSource, normDest)) {
      throw new SecurityError(
        `Cannot move directory into itself or a subdirectory of itself: '${destinationPath}' is inside '${sourcePath}'`
      );
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
   * Sweeps and removes stale temp files older than maxAgeMs recursively.
   */
  public cleanStaleTempFiles(maxAgeMs = 3_600_000): void {
    const sweep = (dir: string) => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const now = Date.now();
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name !== '.git' && entry.name !== 'node_modules') {
              sweep(full);
            }
          } else if (entry.isFile() && entry.name.startsWith('.') && entry.name.includes('.lemo_tmp_')) {
            try {
              const stat = fs.statSync(full);
              if (now - stat.mtimeMs > maxAgeMs) {
                fs.unlinkSync(full);
              }
            } catch {
              // Ignore individual unlink error
            }
          }
        }
      } catch {
        // Ignore directory read error
      }
    };
    sweep(this.root);
  }

  /**
   * Safely deletes a regular file, empty directory, or symlink within the workspace.
   * Rejects non-empty directories and protected workspace root.
   */
  public async deleteEntry(targetPath: string): Promise<{ type: 'file' | 'directory' | 'symlink'; bytesDeleted?: number }> {
    const canonical = this.resolvePathNoFollow(targetPath);

    if (canonical === this.root) {
      throw new SecurityError('Cannot delete workspace root directory');
    }

    this.assertNotSensitive(canonical);

    let stat: fs.Stats;
    try {
      stat = await fs.promises.lstat(canonical);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === 'ENOENT') {
        throw new ToolError(`Target not found: '${this.toRelative(canonical)}'`);
      }
      throw err;
    }

    if (stat.isSymbolicLink()) {
      // Unlink symlink leaf only - target is untouched
      await fs.promises.unlink(canonical);
      return { type: 'symlink' };
    }

    if (stat.isDirectory()) {
      const entries = await fs.promises.readdir(canonical);
      if (entries.length > 0) {
        throw new SecurityError(
          `Cannot delete non-empty directory '${this.toRelative(canonical)}'. Recursive deletion is not supported.`
        );
      }
      await fs.promises.rmdir(canonical);
      return { type: 'directory' };
    }

    if (stat.isFile()) {
      const bytesDeleted = stat.size;
      await fs.promises.unlink(canonical);
      return { type: 'file', bytesDeleted };
    }

    throw new SecurityError(`Unsupported file type: '${this.toRelative(canonical)}'`);
  }

  /**
   * Safely moves or renames a regular file, empty/populated directory, or symlink within the workspace.
   * Enforces dual boundary containment, root protection, sensitive path rejection,
   * descendant move prevention, and race-safe non-overwrite semantics.
   */
  public async moveEntry(
    sourcePath: string,
    destinationPath: string,
    options?: { overwrite?: boolean }
  ): Promise<{ type: 'file' | 'directory' | 'symlink'; bytesMoved?: number }> {
    const canonicalSource = this.resolvePathNoFollow(sourcePath);
    if (canonicalSource === this.root) {
      throw new SecurityError('Cannot move workspace root directory');
    }
    this.assertNotSensitive(canonicalSource);

    let sourceStat: fs.Stats;
    try {
      sourceStat = await fs.promises.lstat(canonicalSource);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === 'ENOENT') {
        throw new ToolError(`Source not found: '${this.toRelative(canonicalSource)}'`);
      }
      throw err;
    }

    const canonicalDest = this.resolvePathNoFollow(destinationPath);
    if (canonicalDest === this.root) {
      throw new SecurityError('Cannot overwrite workspace root directory');
    }
    this.assertNotSensitive(canonicalDest);

    if (canonicalSource === canonicalDest) {
      throw new ToolError('Source and destination paths are identical');
    }

    // Validate destination parent directory exists and resides inside workspace
    const destParent = path.dirname(canonicalDest);
    if (!fs.existsSync(destParent)) {
      throw new WorkspaceError(`Destination parent directory does not exist: '${this.toRelative(destParent)}'`);
    }
    const canonicalDestParent = fs.realpathSync(destParent);
    if (!isPathInside(this.root, canonicalDestParent)) {
      throw new SecurityError('Destination parent directory symlink points outside workspace');
    }

    let destExists = false;
    let destStat: fs.Stats | null = null;
    try {
      destStat = await fs.promises.lstat(canonicalDest);
      destExists = true;
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code !== 'ENOENT') {
        throw err;
      }
    }

    // Directory relocation
    if (sourceStat.isDirectory()) {
      this.assertNotDescendant(canonicalSource, canonicalDest);

      if (destExists) {
        throw new ToolError(`Destination already exists: '${this.toRelative(canonicalDest)}'. Cannot overwrite with directory.`);
      }

      await fs.promises.rename(canonicalSource, canonicalDest);
      return { type: 'directory' };
    }

    // Regular file relocation
    if (sourceStat.isFile()) {
      if (destExists) {
        if (options?.overwrite !== true) {
          throw new ToolError(`Destination already exists: '${this.toRelative(canonicalDest)}'. Specify overwrite=true to replace.`);
        }
        if (destStat?.isDirectory()) {
          throw new SecurityError(`Cannot overwrite directory with file: '${this.toRelative(canonicalDest)}'`);
        }
        if (destStat?.isSymbolicLink()) {
          throw new SecurityError(`Refusing to overwrite symlink destination: '${this.toRelative(canonicalDest)}'`);
        }
        // Overwrite via atomic rename
        await fs.promises.rename(canonicalSource, canonicalDest);
        return { type: 'file', bytesMoved: sourceStat.size };
      } else {
        // Destination does not exist.
        // For non-overwrite, guarantee race safety via atomic hard link where supported
        if (options?.overwrite !== true) {
          try {
            await fs.promises.link(canonicalSource, canonicalDest);
            await fs.promises.unlink(canonicalSource);
            return { type: 'file', bytesMoved: sourceStat.size };
          } catch (linkErr: unknown) {
            const code = (linkErr as { code?: string })?.code;
            if (code === 'EEXIST') {
              throw new ToolError(`Destination already exists: '${this.toRelative(canonicalDest)}'. Specify overwrite=true to replace.`);
            }
            if (code === 'EXDEV') {
              throw new SecurityError('Cross-device file move not permitted');
            }
            // If hardlinks not supported on filesystem (e.g. FAT), fallback to rename
            await fs.promises.rename(canonicalSource, canonicalDest);
            return { type: 'file', bytesMoved: sourceStat.size };
          }
        } else {
          await fs.promises.rename(canonicalSource, canonicalDest);
          return { type: 'file', bytesMoved: sourceStat.size };
        }
      }
    }

    // Symlink relocation
    if (sourceStat.isSymbolicLink()) {
      if (destExists) {
        if (options?.overwrite !== true) {
          throw new ToolError(`Destination already exists: '${this.toRelative(canonicalDest)}'. Specify overwrite=true to replace.`);
        }
      }
      await fs.promises.rename(canonicalSource, canonicalDest);
      return { type: 'symlink' };
    }

    throw new SecurityError(`Unsupported file type: '${this.toRelative(canonicalSource)}'`);
  }
}
