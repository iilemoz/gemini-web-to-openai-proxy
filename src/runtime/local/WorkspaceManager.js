import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';

/**
 * Manages authorized local workspaces and enforces strict path traversal protection.
 */
export class WorkspaceManager {
  constructor(authorizedRoots = [process.cwd()]) {
    this.authorizedRoots = authorizedRoots.map(r => path.resolve(r));
  }

  addRoot(workspacePath) {
    const resolved = path.resolve(workspacePath);
    if (!this.authorizedRoots.includes(resolved)) {
      this.authorizedRoots.push(resolved);
    }
  }

  isPathAuthorized(targetPath) {
    const resolved = path.resolve(targetPath);
    return this.authorizedRoots.some(root => resolved === root || resolved.startsWith(root + path.sep));
  }

  assertAuthorized(targetPath) {
    const resolved = path.resolve(targetPath);
    if (!this.isPathAuthorized(resolved)) {
      throw new Error(`Security Exception: Access denied to path outside authorized workspace: '${targetPath}'`);
    }

    // Harden against symlink traversal / junction escapes
    try {
      const real = realpathSync(resolved);
      if (!this.isPathAuthorized(real)) {
        throw new Error(`Security Exception: Symlink points outside authorized workspace: '${targetPath}' -> '${real}'`);
      }
      return real;
    } catch (e) {
      if (e.code === 'ENOENT') {
        let parent = path.dirname(resolved);
        while (parent && parent !== path.dirname(parent)) {
          if (existsSync(parent)) {
            try {
              const realParent = realpathSync(parent);
              if (!this.isPathAuthorized(realParent)) {
                throw new Error(`Security Exception: Parent directory symlink points outside authorized workspace: '${targetPath}'`);
              }
            } catch { /* ignore non-critical realpath errors on parent */ }
            break;
          }
          parent = path.dirname(parent);
        }
        return resolved;
      }
      throw e;
    }
  }

  async isBinary(filePath) {
    try {
      const fd = await fs.open(filePath, 'r');
      const buffer = Buffer.alloc(1024);
      const { bytesRead } = await fd.read(buffer, 0, 1024, 0);
      await fd.close();

      for (let i = 0; i < bytesRead; i++) {
        if (buffer[i] === 0) return true; // Null byte indicates binary
      }
      return false;
    } catch {
      return false;
    }
  }

  async listFiles(dirPath = '.', recursive = false) {
    const root = this.assertAuthorized(dirPath);
    const results = [];

    async function scan(current, relPrefix = '') {
      const entries = await fs.readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const relPath = path.join(relPrefix, entry.name).replace(/\\/g, '/');
        const fullPath = path.join(current, entry.name);

        results.push({
          name: entry.name,
          path: relPath,
          isDirectory: entry.isDirectory(),
          size: entry.isDirectory() ? null : (await fs.stat(fullPath)).size
        });

        if (recursive && entry.isDirectory()) {
          await scan(fullPath, relPath);
        }
      }
    }

    await scan(root);
    return results;
  }

  async readFile(filePath) {
    const target = this.assertAuthorized(filePath);
    if (await this.isBinary(target)) {
      throw new Error(`File '${filePath}' appears to be binary and cannot be read as text.`);
    }
    return await fs.readFile(target, 'utf-8');
  }

  async writeFile(filePath, content) {
    const target = this.assertAuthorized(filePath);
    const parent = path.dirname(target);
    if (!existsSync(parent)) {
      await fs.mkdir(parent, { recursive: true });
    }
    await fs.writeFile(target, content, 'utf-8');
    return { path: filePath, writtenBytes: Buffer.byteLength(content, 'utf-8') };
  }

  async editFile(filePath, targetString, replacementString) {
    const target = this.assertAuthorized(filePath);
    const existing = await fs.readFile(target, 'utf-8');
    if (!existing.includes(targetString)) {
      throw new Error(`Target string not found in '${filePath}'.`);
    }
    const updated = existing.replaceAll(targetString, replacementString);
    await fs.writeFile(target, updated, 'utf-8');
    return { path: filePath, status: 'edited' };
  }

  async deleteFile(filePath) {
    const target = this.assertAuthorized(filePath);
    await fs.unlink(target);
    return { path: filePath, status: 'deleted' };
  }

  async createDirectory(dirPath) {
    const target = this.assertAuthorized(dirPath);
    await fs.mkdir(target, { recursive: true });
    return { path: dirPath, status: 'created' };
  }

  async getFileInfo(targetPath) {
    const target = this.assertAuthorized(targetPath);
    const stat = await fs.stat(target);
    return {
      path: targetPath,
      size: stat.size,
      isDirectory: stat.isDirectory(),
      created: stat.birthtime,
      modified: stat.mtime
    };
  }
}

export const workspaceManager = new WorkspaceManager();
