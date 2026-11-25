/**
 * Security Hardening Tests — Phase 4.3B.2.6
 * Proves platform filesystem capability probing, atomic directory no-replace fail-closed enforcement,
 * verified destination overwrite displacement & rollback, and hardlink unlink race recovery.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {
  WorkspaceManager,
  PlatformCapabilityRegistry
} from '../dist/agent/workspace/WorkspaceManager.js';
import { MoveFileTool } from '../dist/agent/tools/builtin/MoveFileTool.js';
import { DeleteFileTool } from '../dist/agent/tools/builtin/DeleteFileTool.js';
import { ApprovalManager } from '../dist/agent/approval/ApprovalManager.js';
import { SecurityError, ToolError } from '../dist/core/errors/index.js';

describe('Phase 4.3B.2.6: Final Filesystem Race Hardening & Platform Capability Enforcement', () => {
  let tmpDir;
  let workspace;
  let approvalManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lemo-test-4.3b.2.6-'));
    workspace = new WorkspaceManager(tmpDir);
    approvalManager = new ApprovalManager();
  });

  afterEach(() => {
    PlatformCapabilityRegistry.reset();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error on Windows
    }
  });

  describe('1. Platform Capability Registry & Empirical Probing', () => {
    it('probes runtime filesystem capabilities and returns all required boolean flags', () => {
      const caps = PlatformCapabilityRegistry.probe(tmpDir);
      assert.strictEqual(typeof caps.atomicDirectoryNoReplace, 'boolean');
      assert.strictEqual(typeof caps.safeDestinationOverwrite, 'boolean');
      assert.strictEqual(typeof caps.safeSourceEntryRemoval, 'boolean');
      assert.strictEqual(typeof caps.secureFileRelocation, 'boolean');
    });

    it('caches default probe results and respects reset', () => {
      PlatformCapabilityRegistry.reset();
      const cap1 = PlatformCapabilityRegistry.probe();
      const cap2 = PlatformCapabilityRegistry.probe();
      assert.strictEqual(cap1, cap2, 'Subsequent probe calls without scratchDir must return cached capabilities');

      PlatformCapabilityRegistry.reset();
      const cap3 = PlatformCapabilityRegistry.probe();
      assert.notStrictEqual(cap1, cap3, 'Probe after reset must produce a fresh capability instance');
    });

    it('allows WorkspaceManager to accept capability overrides', () => {
      const customWs = new WorkspaceManager(tmpDir, {
        capabilities: {
          atomicDirectoryNoReplace: false,
          safeDestinationOverwrite: false
        }
      });

      const caps = customWs.getCapabilities();
      assert.strictEqual(caps.atomicDirectoryNoReplace, false);
      assert.strictEqual(caps.safeDestinationOverwrite, false);
    });
  });

  describe('2. Finding 01: POSIX Directory Move Atomic No-Replace Enforcement', () => {
    it('fails closed when atomicDirectoryNoReplace is false in workspace.moveEntry', async () => {
      const customWs = new WorkspaceManager(tmpDir, {
        capabilities: { atomicDirectoryNoReplace: false }
      });

      const srcDir = path.join(tmpDir, 'source_dir');
      const dstDir = path.join(tmpDir, 'dest_dir');
      fs.mkdirSync(srcDir);

      await assert.rejects(
        async () => {
          await customWs.moveEntry(srcDir, dstDir);
        },
        (err) => {
          assert(err instanceof SecurityError);
          assert(err.message.includes('atomic no-replace capability'));
          assert(err.message.includes('atomicDirectoryNoReplace'));
          return true;
        }
      );

      // Verify source directory remained intact
      assert(fs.existsSync(srcDir), 'Source directory must remain intact');
      assert(!fs.existsSync(dstDir), 'Destination directory must not be created');
    });

    it('fails closed in MoveFileTool.prepareApproval and execute when atomicDirectoryNoReplace is false', async () => {
      const customWs = new WorkspaceManager(tmpDir, {
        capabilities: { atomicDirectoryNoReplace: false }
      });
      const moveTool = new MoveFileTool(customWs, approvalManager);

      const srcDir = path.join(tmpDir, 'dir_to_move');
      const dstDir = path.join(tmpDir, 'moved_dir');
      fs.mkdirSync(srcDir);

      // prepareApproval must reject
      await assert.rejects(
        async () => {
          await moveTool.prepareApproval({
            source_path: 'dir_to_move',
            destination_path: 'moved_dir'
          });
        },
        (err) => {
          assert(err instanceof SecurityError);
          assert(err.message.includes('atomic no-replace capability'));
          return true;
        }
      );

      // execute must also reject
      const result = await moveTool.execute({
        source_path: 'dir_to_move',
        destination_path: 'moved_dir'
      });

      assert.strictEqual(result.success, false);
      assert(result.error.includes('atomic no-replace capability'));
      assert(fs.existsSync(srcDir), 'Source directory must remain intact');
    });

    it('allows directory move when atomicDirectoryNoReplace is true and destination does not exist', async () => {
      const customWs = new WorkspaceManager(tmpDir, {
        capabilities: { atomicDirectoryNoReplace: true }
      });

      const srcDir = path.join(tmpDir, 'valid_src_dir');
      const dstDir = path.join(tmpDir, 'valid_dst_dir');
      fs.mkdirSync(srcDir);
      fs.writeFileSync(path.join(srcDir, 'inner.txt'), 'nested file');

      const result = await customWs.moveEntry(srcDir, dstDir);
      assert.strictEqual(result.type, 'directory');
      assert(!fs.existsSync(srcDir), 'Source directory must be moved');
      assert(fs.existsSync(dstDir), 'Destination directory must exist');
      assert.strictEqual(
        fs.readFileSync(path.join(dstDir, 'inner.txt'), 'utf8'),
        'nested file'
      );
    });
  });

  describe('3. Finding 02: Destination Overwrite Identity Race & Verified Displacement', () => {
    it('fails closed when safeDestinationOverwrite is false', async () => {
      const customWs = new WorkspaceManager(tmpDir, {
        capabilities: { safeDestinationOverwrite: false }
      });
      const moveTool = new MoveFileTool(customWs, approvalManager);

      const srcFile = path.join(tmpDir, 'source.txt');
      const dstFile = path.join(tmpDir, 'dest.txt');
      fs.writeFileSync(srcFile, 'new content');
      fs.writeFileSync(dstFile, 'old content');

      // prepareApproval must reject overwrite
      await assert.rejects(
        async () => {
          await moveTool.prepareApproval({
            source_path: 'source.txt',
            destination_path: 'dest.txt',
            overwrite: true
          });
        },
        (err) => {
          assert(err instanceof SecurityError);
          assert(err.message.includes('safeDestinationOverwrite'));
          return true;
        }
      );

      // execute must reject overwrite
      const result = await moveTool.execute({
        source_path: 'source.txt',
        destination_path: 'dest.txt',
        overwrite: true
      });
      assert.strictEqual(result.success, false);
      assert(result.error.includes('safeDestinationOverwrite'));
    });

    it('performs verified displacement and replaces destination cleanly on matching identity and hash', async () => {
      const srcFile = path.join(tmpDir, 'source_clean.txt');
      const dstFile = path.join(tmpDir, 'dest_clean.txt');
      fs.writeFileSync(srcFile, 'hello updated world');
      fs.writeFileSync(dstFile, 'previous old world');

      const destStat = fs.lstatSync(dstFile);
      const destHash = crypto.createHash('sha256').update(fs.readFileSync(dstFile)).digest('hex');

      const res = await workspace.moveEntry(srcFile, dstFile, {
        overwrite: true,
        expectedDestIdentity: {
          canonicalPath: dstFile,
          deviceNumber: Number(destStat.dev),
          inodeNumber: Number(destStat.ino),
          type: 'file',
          exists: true
        },
        expectedDestContentHash: destHash
      });

      assert.strictEqual(res.type, 'file');
      assert(!fs.existsSync(srcFile), 'Source file must be moved');
      assert.strictEqual(fs.readFileSync(dstFile, 'utf8'), 'hello updated world');

      // Verify no dangling staging files in directory
      const remainingFiles = fs.readdirSync(tmpDir);
      assert(remainingFiles.every((f) => !f.includes('.lemo_bkp_')), 'Staging files must be unlinked');
    });

    it('rolls back displaced destination when expected content hash does not match', async () => {
      const srcFile = path.join(tmpDir, 'source_tamper.txt');
      const dstFile = path.join(tmpDir, 'dest_tamper.txt');
      fs.writeFileSync(srcFile, 'source data');
      fs.writeFileSync(dstFile, 'destination data original');

      const destStat = fs.lstatSync(dstFile);
      const wrongHash = 'e'.repeat(64); // Tampered hash

      await assert.rejects(
        async () => {
          await workspace.moveEntry(srcFile, dstFile, {
            overwrite: true,
            expectedDestIdentity: {
              canonicalPath: dstFile,
              deviceNumber: Number(destStat.dev),
              inodeNumber: Number(destStat.ino),
              type: 'file',
              exists: true
            },
            expectedDestContentHash: wrongHash
          });
        },
        (err) => {
          assert(err instanceof SecurityError);
          assert(err.message.includes('Destination file content changed prior to overwrite displacement'));
          return true;
        }
      );

      // Verify destination was rolled back completely
      assert(fs.existsSync(dstFile), 'Destination file must be restored on hash mismatch');
      assert.strictEqual(fs.readFileSync(dstFile, 'utf8'), 'destination data original');
      assert(fs.existsSync(srcFile), 'Source file must remain intact');

      // Verify no leftover temporary files
      const files = fs.readdirSync(tmpDir);
      assert(files.every((f) => !f.includes('.lemo_bkp_')), 'Staging files must be rolled back');
    });

    it('rolls back displaced destination when destination identity (inode) does not match', async () => {
      const srcFile = path.join(tmpDir, 'source_inode.txt');
      const dstFile = path.join(tmpDir, 'dest_inode.txt');
      fs.writeFileSync(srcFile, 'source data');
      fs.writeFileSync(dstFile, 'dest data');

      const wrongIdentity = {
        canonicalPath: dstFile,
        deviceNumber: 99999,
        inodeNumber: 888888,
        type: 'file',
        exists: true
      };

      await assert.rejects(
        async () => {
          await workspace.moveEntry(srcFile, dstFile, {
            overwrite: true,
            expectedDestIdentity: wrongIdentity
          });
        },
        (err) => {
          assert(err instanceof SecurityError);
          assert(err.message.includes('Destination file identity changed prior to overwrite rename'));
          return true;
        }
      );

      // Destination must be restored
      assert(fs.existsSync(dstFile), 'Destination file must be restored on identity mismatch');
      assert.strictEqual(fs.readFileSync(dstFile, 'utf8'), 'dest data');
      assert(fs.existsSync(srcFile), 'Source file must remain untouched');
    });
  });

  describe('4. Finding 03: Hardlink + Unlink Source Race Fail-Closed Recovery', () => {
    it('fails closed when secureFileRelocation capability is false', async () => {
      const customWs = new WorkspaceManager(tmpDir, {
        capabilities: { secureFileRelocation: false }
      });

      const srcFile = path.join(tmpDir, 'src_noreloc.txt');
      const dstFile = path.join(tmpDir, 'dst_noreloc.txt');
      fs.writeFileSync(srcFile, 'data');

      await assert.rejects(
        async () => {
          await customWs.moveEntry(srcFile, dstFile, { overwrite: false });
        },
        (err) => {
          assert(err instanceof SecurityError);
          assert(err.message.includes('secureFileRelocation'));
          return true;
        }
      );

      assert(fs.existsSync(srcFile), 'Source file must remain intact');
      assert(!fs.existsSync(dstFile), 'Destination file must not exist');
    });

    it('preserves destination link and aborts source unlink when source identity changes during hardlink move', async () => {
      const srcFile = path.join(tmpDir, 'src_race_hardlink.txt');
      const dstFile = path.join(tmpDir, 'dst_race_hardlink.txt');
      fs.writeFileSync(srcFile, 'original source content');

      const originalLink = fs.promises.link;
      const originalUnlink = fs.promises.unlink;
      let unlinkAttempted = false;

      fs.promises.link = async (src, dst) => {
        await originalLink.call(fs.promises, src, dst);
        // Simulate race condition: source file is substituted before unlinking!
        fs.unlinkSync(srcFile);
        fs.writeFileSync(srcFile, 'substituted new file at source path');
      };

      fs.promises.unlink = async (target) => {
        unlinkAttempted = true;
        return originalUnlink.call(fs.promises, target);
      };

      try {
        await assert.rejects(
          async () => {
            await workspace.moveEntry(srcFile, dstFile, { overwrite: false });
          },
          (err) => {
            assert(err instanceof SecurityError);
            assert(err.message.includes('Source file identity changed prior to unlinking in move operation'));
            assert(err.message.includes('destination hardlink preserved at'));
            assert(err.message.includes('source entry unlinking aborted to prevent data loss'));
            assert(err.message.toLowerCase().includes('manual reconciliation required'));
            return true;
          }
        );

        // Verification: unlink was NOT attempted on the substituted source!
        assert.strictEqual(unlinkAttempted, false, 'fs.promises.unlink must NOT be called');

        // Verification: destination hardlink was preserved with original content!
        assert(fs.existsSync(dstFile), 'Destination hardlink must be preserved');
        assert.strictEqual(fs.readFileSync(dstFile, 'utf8'), 'original source content');

        // Verification: substituted source file was also preserved!
        assert(fs.existsSync(srcFile), 'Substituted source file must be preserved');
        assert.strictEqual(fs.readFileSync(srcFile, 'utf8'), 'substituted new file at source path');
      } finally {
        fs.promises.link = originalLink;
        fs.promises.unlink = originalUnlink;
      }
    });
  });

  describe('5. Safe Source Entry Removal in deleteEntry', () => {
    it('aborts deletion and fails closed if target file identity changes before unlink', async () => {
      const targetFile = path.join(tmpDir, 'file_to_delete.txt');
      fs.writeFileSync(targetFile, 'content to be deleted');

      const originalLstat = fs.promises.lstat;
      let callCount = 0;

      // Simulate a concurrent swap between first lstat and pre-unlink lstat
      fs.promises.lstat = async (target) => {
        const stat = await originalLstat.call(fs.promises, target);
        callCount++;
        if (callCount === 2) {
          // Pre-unlink check: return simulated different inode while preserving fs.Stats prototype
          const modified = Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, {
            ino: Number(stat.ino) + 9999
          });
          return modified;
        }
        return stat;
      };

      try {
        await assert.rejects(
          async () => {
            await workspace.deleteEntry(targetFile);
          },
          (err) => {
            assert(err instanceof SecurityError);
            assert(err.message.includes('Target file identity changed prior to unlinking in delete operation'));
            return true;
          }
        );

        // Target file must be intact
        assert(fs.existsSync(targetFile), 'Target file must not be deleted when identity check fails');
        assert.strictEqual(fs.readFileSync(targetFile, 'utf8'), 'content to be deleted');
      } finally {
        fs.promises.lstat = originalLstat;
      }
    });
  });
});
