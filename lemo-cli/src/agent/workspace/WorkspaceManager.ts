/**
 * Workspace Manager
 * Enforces secure workspace containment, canonical path resolution,
 * symlink verification, sensitive file redaction, and path traversal protection.
 */

import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { SecurityError, WorkspaceError, ToolError } from '../../core/errors/index.js';
import type { DestinationIdentity } from '../tools/Tool.js';
import {
  type FilesystemCapabilities,
  PlatformCapabilityRegistry
} from './PlatformCapabilities.js';

export type { FilesystemCapabilities };
export { PlatformCapabilityRegistry };

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
  capabilities?: Partial<FilesystemCapabilities> | undefined;
}

export class WorkspaceManager {
  private readonly root: string;
  private readonly allowSensitiveFiles: boolean;
  private readonly capabilities: FilesystemCapabilities;

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

    const probed = PlatformCapabilityRegistry.probe(this.root);
    // Custom capability overrides cannot turn an unsupported kernel operation into a supported one.
    // If a capability requires native/platform support and the probe determined it is unavailable,
    // custom overrides must not claim it is supported.
    const requestedCapabilities = options.capabilities ?? {};
    const effectiveCapabilities: FilesystemCapabilities = {
      atomicDirectoryNoReplace: probed.atomicDirectoryNoReplace
        ? (requestedCapabilities.atomicDirectoryNoReplace ?? true)
        : (requestedCapabilities.atomicDirectoryNoReplace === true &&
           typeof (globalThis as Record<string, unknown>)['__lemo_native_rename_noreplace'] === 'function'),
      safeDestinationOverwrite: probed.safeDestinationOverwrite
        ? (requestedCapabilities.safeDestinationOverwrite ?? true)
        : false,
      safeSourceEntryRemoval: probed.safeSourceEntryRemoval
        ? (requestedCapabilities.safeSourceEntryRemoval ?? true)
        : false,
      secureFileRelocation: probed.secureFileRelocation
        ? (requestedCapabilities.secureFileRelocation ?? true)
        : false
    };

    this.capabilities = effectiveCapabilities;
  }

  /**
   * Returns the probed or configured filesystem capabilities for this workspace.
   */
  public getCapabilities(): Readonly<FilesystemCapabilities> {
    return this.capabilities;
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
   * Strips Windows Alternate Data Stream (ADS) specifications while preserving drive letters.
   */
  public isSensitive(filePath: string): boolean {
    const normalized = path.normalize(filePath).replace(/\\/g, '/').toLowerCase();
    const rawBase = path.basename(normalized);
    const segments = normalized.split('/').filter(Boolean);

    const stripAdsAndTrailing = (name: string): string => {
      if (/^[a-z]:$/i.test(name)) return name; // Preserve Windows drive letter
      const withoutStream = name.includes(':') ? name.split(':')[0]! : name;
      return withoutStream.replace(/[. ]+$/g, '');
    };

    const cleanBase = stripAdsAndTrailing(rawBase);
    const cleanSegments = segments.map(stripAdsAndTrailing);
    const cleanNormalized = cleanSegments.join('/');

    // 0. Git metadata directory roots, submodule configurations, and nested paths
    // Protects .git directory roots, .gitmodules, .git-credentials, .gitconfig, and all files inside any .git directory
    if (
      cleanSegments.includes('.git') ||
      cleanSegments.includes('.gitmodules') ||
      cleanSegments.includes('.git-credentials') ||
      cleanSegments.includes('.gitconfig') ||
      cleanBase === '.git' ||
      cleanBase === '.gitmodules' ||
      cleanBase === '.git-credentials' ||
      cleanBase === '.gitconfig'
    ) {
      return true;
    }

    // 1. Environment files (.env, .env.local, .env.production, etc.)
    if (cleanBase === '.env' || cleanBase.startsWith('.env.')) {
      return true;
    }

    // 2. Private SSH keys (id_rsa, id_ed25519, id_ecdsa, id_ecdsa_sk, id_ed25519_sk, id_dsa, etc.)
    // Explicitly allow public keys (*.pub)
    if (/^id_[a-z0-9_-]+$/i.test(cleanBase)) {
      return true;
    }

    // 3. Certificates, private keys & password databases (.pem, .key, .pkcs12, .pfx, .p12, .kdbx, .keystore, .jks)
    if (/\.(pem|key|pkcs12|pfx|p12|kdbx|keystore|jks)$/i.test(cleanBase)) {
      return true;
    }

    // 4. Secret / credential configuration files
    if (/^(credentials|client_secret.*|token|secrets?|passwords?)\.(json|ya?ml|ini)$/i.test(cleanBase)) {
      return true;
    }

    // 5. Package manager, tool, and shell secret files
    if (
      cleanBase === '.npmrc' ||
      cleanBase === '.netrc' ||
      cleanBase === '.pypirc' ||
      cleanBase === '.htpasswd' ||
      cleanBase === '.pgpass' ||
      cleanBase === 'master.key' ||
      cleanBase === '.bash_history' ||
      cleanBase === '.zsh_history'
    ) {
      return true;
    }

    // 6. Docker Compose secret overrides (e.g. docker-compose.override.yml, compose.override.yaml)
    // Note: Standard docker-compose.yml / compose.yaml are NOT blocked
    if (/^(docker-compose|compose)\.override\.(ya?ml)$/i.test(cleanBase)) {
      return true;
    }

    // 7. Cloud, VCS, and system credential stores
    if (
      cleanNormalized.includes('/.aws/credentials') ||
      cleanNormalized.includes('/.aws/config') ||
      cleanNormalized.endsWith('.aws/credentials') ||
      cleanNormalized.endsWith('.aws/config') ||
      normalized.includes('/.aws/credentials') ||
      normalized.includes('/.aws/config') ||
      normalized.endsWith('.aws/credentials') ||
      normalized.endsWith('.aws/config')
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
   * Recognizes `.lemo_bkp_*` staging files and applies conservative recovery/preservation:
   * never blindly deletes user backups based solely on filename or age.
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
          } else if (entry.isFile()) {
            if (entry.name.startsWith('.') && entry.name.includes('.lemo_tmp_')) {
              try {
                const stat = fs.statSync(full);
                if (now - stat.mtimeMs > maxAgeMs) {
                  fs.unlinkSync(full);
                }
              } catch {
                // Ignore individual unlink error
              }
            } else if (entry.name.startsWith('.') && entry.name.includes('.lemo_bkp_')) {
              // Ignore companion journal files during file scan; they are handled by recoverStaleBackupEntry
              if (entry.name.endsWith('.journal.json')) {
                continue;
              }
              // Staging backup entry: conservative crash recovery
              this.recoverStaleBackupEntry(full);
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
   * Conservative crash recovery for `.lemo_bkp_*` staging entries.
   * Invariants:
   * 1. Never blindly delete backup entries based only on filename or age.
   * 2. Never automatically overwrite an existing destination during recovery.
   * 3. Verify file type, workspace containment, and journal metadata.
   * 4. If destination does not exist and unambiguous, restore the backup.
   * 5. If destination exists, ambiguous, or tampered, preserve backup untouched for manual reconciliation.
   */
  public recoverStaleBackupEntry(backupPath: string): 'recovered' | 'preserved' | 'skipped' {
    try {
      if (!isPathInside(this.root, backupPath)) {
        return 'skipped';
      }

      let backupStat: fs.Stats;
      try {
        backupStat = fs.lstatSync(backupPath);
      } catch {
        return 'skipped';
      }

      // Reject symlinks or non-regular files
      if (backupStat.isSymbolicLink() || !backupStat.isFile()) {
        return 'preserved';
      }

      const filename = path.basename(backupPath);
      const dir = path.dirname(backupPath);

      // Check for associated atomic journal file: <backupPath>.journal.json
      const journalPath = `${backupPath}.journal.json`;
      let targetCanonical: string | null = null;
      let expectedHash: string | null = null;

      if (fs.existsSync(journalPath)) {
        try {
          const rawJournal = fs.readFileSync(journalPath, 'utf8');
          const journalData = JSON.parse(rawJournal);
          if (
            journalData &&
            typeof journalData.targetCanonical === 'string' &&
            isPathInside(this.root, journalData.targetCanonical)
          ) {
            targetCanonical = journalData.targetCanonical;
            expectedHash = typeof journalData.expectedHash === 'string' ? journalData.expectedHash : null;
          } else {
            // Target is invalid, outside workspace root, or corrupted: preserve backup for manual inspection
            return 'preserved';
          }
        } catch {
          // Journal corrupted or invalid: preserve both for manual recovery
          return 'preserved';
        }
      }

      // If no journal, deduce target from pattern: .lemo_bkp_<basename>_<nonce>.tmp
      if (!targetCanonical) {
        const match = /^\.lemo_bkp_(.+)_([a-f0-9]+)\.tmp$/.exec(filename);
        if (match && match[1]) {
          const originalBasename = match[1];
          targetCanonical = path.join(dir, originalBasename);
        }
      }

      if (!targetCanonical || !isPathInside(this.root, targetCanonical)) {
        return 'preserved';
      }

      // Check if destination exists
      let destExists = false;
      try {
        fs.lstatSync(targetCanonical);
        destExists = true;
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code !== 'ENOENT') {
          return 'preserved';
        }
      }

      // If destination already exists: NEVER overwrite. Preserve backup for manual reconciliation.
      if (destExists) {
        return 'preserved';
      }

      // If journal specified an expected hash, verify backup has not been tampered with
      if (expectedHash) {
        const buf = fs.readFileSync(backupPath);
        const actualHash = crypto.createHash('sha256').update(buf).digest('hex');
        if (actualHash !== expectedHash) {
          // Backup was modified or tampered with: do NOT restore, preserve for manual recovery
          return 'preserved';
        }
      }

      // Recover backup back to canonical destination
      fs.renameSync(backupPath, targetCanonical);

      // Clean up journal if present
      if (fs.existsSync(journalPath)) {
        try { fs.unlinkSync(journalPath); } catch {}
      }

      return 'recovered';
    } catch {
      return 'preserved';
    }
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
      // Revalidate target file identity immediately before unlinking
      const preUnlinkStat = await fs.promises.lstat(canonical);
      if (
        !preUnlinkStat.isFile() ||
        Number(preUnlinkStat.ino) !== Number(stat.ino) ||
        Number(preUnlinkStat.dev) !== Number(stat.dev)
      ) {
        throw new SecurityError('Target file identity changed prior to unlinking in delete operation');
      }
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
    options?: {
      overwrite?: boolean | undefined;
      expectedDestIdentity?: DestinationIdentity | undefined;
      expectedDestContentHash?: string | undefined;
      directoryMovePolicy?: 'strict' | 'standard' | undefined;
    }
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
      if (!this.capabilities.atomicDirectoryNoReplace) {
        throw new SecurityError(
          "Directory relocation disabled: atomic no-replace capability ('atomicDirectoryNoReplace' via renameat2/renamex_np) is unavailable on this platform/runtime"
        );
      }

      this.assertNotDescendant(canonicalSource, canonicalDest);

      if (destExists) {
        throw new ToolError(`Destination already exists: '${this.toRelative(canonicalDest)}'. Cannot overwrite with directory.`);
      }

      // Revalidate destination non-existence immediately before rename to catch destination races
      let preRenameDestExists = false;
      try {
        await fs.promises.lstat(canonicalDest);
        preRenameDestExists = true;
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code !== 'ENOENT') throw err;
      }
      if (preRenameDestExists) {
        throw new ToolError(`Destination already exists: '${this.toRelative(canonicalDest)}'. Cannot overwrite with directory.`);
      }

      // Revalidate source directory identity before rename
      const currentSourceStat = await fs.promises.lstat(canonicalSource);
      if (
        !currentSourceStat.isDirectory() ||
        Number(currentSourceStat.ino) !== Number(sourceStat.ino) ||
        Number(currentSourceStat.dev) !== Number(sourceStat.dev)
      ) {
        throw new SecurityError('Source directory identity changed prior to rename');
      }

      try {
        await fs.promises.rename(canonicalSource, canonicalDest);
      } catch (renameErr: unknown) {
        const code = (renameErr as { code?: string })?.code;
        if (code === 'EEXIST' || code === 'ENOTEMPTY' || code === 'EPERM') {
          throw new ToolError(`Destination already exists: '${this.toRelative(canonicalDest)}'. Cannot overwrite with directory.`);
        }
        throw renameErr;
      }

      // Post-move validation: verify destination directory identity matches original source directory identity
      const postDestStat = await fs.promises.lstat(canonicalDest);
      if (
        !postDestStat.isDirectory() ||
        Number(postDestStat.ino) !== Number(sourceStat.ino) ||
        Number(postDestStat.dev) !== Number(sourceStat.dev)
      ) {
        throw new SecurityError('Post-move destination identity mismatch for directory');
      }

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
        if (!this.capabilities.safeDestinationOverwrite) {
          throw new SecurityError(
            "Safe destination overwrite disabled: verified displacement/staging capability ('safeDestinationOverwrite') is unavailable"
          );
        }

        // Verified displacement and staging strategy:
        // Displace the approved destination to a temporary nonce location in the same directory.
        // Also persist an atomic journal metadata file alongside for crash recovery.
        const destDir = path.dirname(canonicalDest);
        const nonce = crypto.randomBytes(8).toString('hex');
        const displacedPath = path.join(destDir, `.lemo_bkp_${path.basename(canonicalDest)}_${nonce}.tmp`);
        const journalPath = `${displacedPath}.journal.json`;
        WorkspaceManager.activeGlobalTempFiles.add(displacedPath);

        // Pre-create atomic journal before displacement
        try {
          fs.writeFileSync(
            journalPath,
            JSON.stringify({
              targetCanonical: canonicalDest,
              expectedHash: options?.expectedDestContentHash ?? null,
              expectedDevice: options?.expectedDestIdentity?.deviceNumber ?? null,
              expectedInode: options?.expectedDestIdentity?.inodeNumber ?? null,
              timestamp: Date.now()
            })
          );
        } catch {
          // Non-fatal if journal write fails
        }

        let capturedDisplacedStat: fs.Stats | null = null;
        let capturedDisplacedHash: string | null = null;

        try {
          await fs.promises.rename(canonicalDest, displacedPath);
        } catch (displaceErr: unknown) {
          try { if (fs.existsSync(journalPath)) fs.unlinkSync(journalPath); } catch {}
          WorkspaceManager.activeGlobalTempFiles.delete(displacedPath);
          throw new SecurityError(
            `Failed to stage destination file for verified overwrite: ${displaceErr instanceof Error ? displaceErr.message : String(displaceErr)}`
          );
        }

        let destinationVerified = false;
        try {
          // Inspect displaced destination object and bind its displaced identity
          const displacedStat = await fs.promises.lstat(displacedPath);
          if (!displacedStat.isFile()) {
            throw new SecurityError('Displaced destination object is not a regular file');
          }
          capturedDisplacedStat = displacedStat;

          const displacedBuf = await fs.promises.readFile(displacedPath);
          const actualHash = crypto.createHash('sha256').update(displacedBuf).digest('hex');
          capturedDisplacedHash = actualHash;

          // Update journal with exact displaced parameters
          try {
            fs.writeFileSync(
              journalPath,
              JSON.stringify({
                targetCanonical: canonicalDest,
                expectedHash: options?.expectedDestContentHash ?? actualHash,
                displacedHash: actualHash,
                expectedDevice: Number(displacedStat.dev),
                expectedInode: Number(displacedStat.ino),
                timestamp: Date.now()
              })
            );
          } catch {}

          if (
            options?.expectedDestIdentity?.inodeNumber !== undefined &&
            Number(displacedStat.ino) !== options.expectedDestIdentity.inodeNumber
          ) {
            throw new SecurityError('Destination file identity changed prior to overwrite rename (displacement verification failed)');
          }
          if (
            options?.expectedDestIdentity?.deviceNumber !== undefined &&
            Number(displacedStat.dev) !== options.expectedDestIdentity.deviceNumber
          ) {
            throw new SecurityError('Destination file device changed prior to overwrite rename (displacement verification failed)');
          }
          if (options?.expectedDestContentHash !== undefined && actualHash !== options.expectedDestContentHash) {
            throw new SecurityError('Destination file content changed prior to overwrite displacement');
          }

          // Inspect source before committing rename
          const currentSourceStat = await fs.promises.lstat(canonicalSource);
          if (
            !currentSourceStat.isFile() ||
            Number(currentSourceStat.ino) !== Number(sourceStat.ino) ||
            Number(currentSourceStat.dev) !== Number(sourceStat.dev)
          ) {
            throw new SecurityError('Source file identity changed prior to overwrite rename');
          }

          // Commit source to destination
          await fs.promises.rename(canonicalSource, canonicalDest);
          destinationVerified = true;
        } catch (stageErr: unknown) {
          // Rollback displaced destination if destination wasn't successfully replaced.
          // Verified Rollback (FINDING-01):
          // 1. Verify displacedPath matches approved identity (file, inode/dev, hash).
          // 2. Verify canonicalDest is in expected state (must NOT exist).
          // 3. Never overwrite an unexpected destination occupant during rollback.
          // 4. If identity or destination state cannot be verified, fail closed and preserve files.
          if (!destinationVerified) {
            let rollbackSafe = false;
            let rollbackErrorReason = '';

            try {
              // Re-check displaced path still exists and is a regular file
              const checkDisplacedStat = await fs.promises.lstat(displacedPath);
              if (!checkDisplacedStat.isFile()) {
                rollbackErrorReason = `Displaced backup at '${this.toRelative(displacedPath)}' is not a regular file`;
              } else if (
                capturedDisplacedStat &&
                (Number(checkDisplacedStat.ino) !== Number(capturedDisplacedStat.ino) ||
                  Number(checkDisplacedStat.dev) !== Number(capturedDisplacedStat.dev))
              ) {
                rollbackErrorReason = `Displaced backup identity mismatch at '${this.toRelative(displacedPath)}'`;
              } else {
                const bkpBuf = await fs.promises.readFile(displacedPath);
                const bkpHash = crypto.createHash('sha256').update(bkpBuf).digest('hex');
                if (capturedDisplacedHash && bkpHash !== capturedDisplacedHash) {
                  rollbackErrorReason = `Displaced backup content mismatch at '${this.toRelative(displacedPath)}'`;
                } else {
                  rollbackSafe = true;
                }
              }

              // Check if canonicalDest was unexpectedly occupied
              if (rollbackSafe) {
                try {
                  await fs.promises.lstat(canonicalDest);
                  // Destination is occupied! Must not overwrite!
                  rollbackSafe = false;
                  rollbackErrorReason = `Destination path '${this.toRelative(canonicalDest)}' was unexpectedly occupied during rollback`;
                } catch (destCheckErr: unknown) {
                  const code = (destCheckErr as { code?: string })?.code;
                  if (code !== 'ENOENT') {
                    rollbackSafe = false;
                    rollbackErrorReason = `Cannot verify destination path '${this.toRelative(canonicalDest)}' status: ${destCheckErr instanceof Error ? destCheckErr.message : String(destCheckErr)}`;
                  }
                }
              }

              if (rollbackSafe) {
                await fs.promises.rename(displacedPath, canonicalDest);
                if (fs.existsSync(journalPath)) {
                  try { fs.unlinkSync(journalPath); } catch {}
                }
              } else {
                // Fail closed: preserve both displaced backup and unexpected destination occupant
                throw new SecurityError(
                  `Verified rollback aborted to prevent data corruption (${rollbackErrorReason}). Displaced entry preserved at '${this.toRelative(displacedPath)}'; manual reconciliation required.`
                );
              }
            } catch (rbErr: unknown) {
              if (rbErr instanceof SecurityError) {
                throw rbErr;
              }
              throw new SecurityError(
                `Rollback failed: ${rbErr instanceof Error ? rbErr.message : String(rbErr)}. Displaced entry preserved at '${this.toRelative(displacedPath)}'; manual reconciliation required.`
              );
            }
          }
          throw stageErr;
        } finally {
          if (destinationVerified) {
            try {
              await fs.promises.unlink(displacedPath);
              if (fs.existsSync(journalPath)) {
                fs.unlinkSync(journalPath);
              }
            } catch {
              // Nonce temp file will be cleaned up by sweep
            }
          }
          WorkspaceManager.activeGlobalTempFiles.delete(displacedPath);
        }

        return { type: 'file', bytesMoved: sourceStat.size };
      } else {
        // Destination does not exist.
        if (options?.expectedDestIdentity?.exists === true) {
          throw new SecurityError('Expected destination file disappeared prior to move');
        }

        // For non-overwrite, guarantee race safety via atomic hard link where supported
        if (options?.overwrite !== true) {
          if (!this.capabilities.secureFileRelocation) {
            throw new SecurityError(
              "Race-safe file relocation disabled: hardlink capability ('secureFileRelocation') is unavailable"
            );
          }
          try {
            await fs.promises.link(canonicalSource, canonicalDest);
            // Source identity validation immediately before unlinking
            const preUnlinkStat = await fs.promises.lstat(canonicalSource);
            if (
              !preUnlinkStat.isFile() ||
              Number(preUnlinkStat.ino) !== Number(sourceStat.ino) ||
              Number(preUnlinkStat.dev) !== Number(sourceStat.dev)
            ) {
              throw new SecurityError(
                `Source file identity changed prior to unlinking in move operation (destination hardlink preserved at '${this.toRelative(canonicalDest)}'; source entry unlinking aborted to prevent data loss; manual reconciliation required)`
              );
            }
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
            if (code === 'ENOSYS' || code === 'ENOTSUP' || code === 'EPERM') {
              throw new SecurityError(`Filesystem does not support atomic link-based non-overwrite relocation (${code})`);
            }
            throw linkErr;
          }
        } else {
          // Overwrite mode requested, but destination did not exist
          const currentSourceStat = await fs.promises.lstat(canonicalSource);
          if (
            !currentSourceStat.isFile() ||
            Number(currentSourceStat.ino) !== Number(sourceStat.ino) ||
            Number(currentSourceStat.dev) !== Number(sourceStat.dev)
          ) {
            throw new SecurityError('Source file identity changed prior to move rename');
          }
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
