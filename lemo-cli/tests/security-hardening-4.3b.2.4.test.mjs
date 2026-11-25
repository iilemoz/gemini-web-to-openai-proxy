import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { WorkspaceManager } from '../dist/agent/workspace/WorkspaceManager.js';
import { ApprovalManager, deepFreeze } from '../dist/agent/approval/ApprovalManager.js';
import { MoveFileTool } from '../dist/agent/tools/builtin/MoveFileTool.js';
import { SecurityError, ToolError } from '../dist/core/errors/index.js';

describe('Phase 4.3B.2.4: Final Move Security Hardening', () => {
  let tmpDir;
  let workspace;
  let approvalManager;
  let moveTool;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lemo-hardening-4.3b.2.4-'));
    // Canonical realpath to resolve any symlinks in temp dir (e.g. macOS /var -> /private/var)
    tmpDir = fs.realpathSync(tmpDir);
    workspace = new WorkspaceManager(tmpDir);
    approvalManager = new ApprovalManager();
    moveTool = new MoveFileTool(workspace, approvalManager);
  });

  afterEach(async () => {
    try {
      if (tmpDir && fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup error
    }
  });

  describe('FINDING-01: Directory Move Collision & Identity Guarantees', () => {
    it('rejects directory move when destination already exists as a regular file', async () => {
      const srcDir = path.join(tmpDir, 'src_dir');
      const destFile = path.join(tmpDir, 'dest_file.txt');
      fs.mkdirSync(srcDir);
      fs.writeFileSync(path.join(srcDir, 'item.txt'), 'hello');
      fs.writeFileSync(destFile, 'existing file');

      await assert.rejects(
        async () => {
          await workspace.moveEntry(srcDir, destFile);
        },
        (err) => {
          assert(err instanceof ToolError);
          assert(err.message.includes('Destination already exists'));
          return true;
        }
      );

      // Verify source directory and destination file remain intact
      assert.strictEqual(fs.existsSync(srcDir), true);
      assert.strictEqual(fs.existsSync(destFile), true);
      assert.strictEqual(fs.readFileSync(destFile, 'utf8'), 'existing file');
    });

    it('rejects directory move when destination exists as an empty or populated directory', async () => {
      const srcDir = path.join(tmpDir, 'src_dir');
      const destEmptyDir = path.join(tmpDir, 'dest_empty');
      fs.mkdirSync(srcDir);
      fs.writeFileSync(path.join(srcDir, 'file.txt'), 'content');
      fs.mkdirSync(destEmptyDir);

      await assert.rejects(
        async () => {
          await workspace.moveEntry(srcDir, destEmptyDir);
        },
        (err) => {
          assert(err instanceof ToolError);
          assert(err.message.includes('Destination already exists'));
          return true;
        }
      );

      assert.strictEqual(fs.existsSync(srcDir), true);
      assert.strictEqual(fs.existsSync(destEmptyDir), true);
    });

    it('preserves directory inode identity post-move without substitution', async () => {
      const srcDir = path.join(tmpDir, 'dir_original');
      const destDir = path.join(tmpDir, 'dir_renamed');
      fs.mkdirSync(srcDir);
      fs.writeFileSync(path.join(srcDir, 'data.txt'), 'payload');

      const preStat = fs.lstatSync(srcDir);
      const res = await workspace.moveEntry(srcDir, destDir);
      assert.strictEqual(res.type, 'directory');

      const postStat = fs.lstatSync(destDir);
      assert.strictEqual(Number(postStat.ino), Number(preStat.ino));
      assert.strictEqual(Number(postStat.dev), Number(preStat.dev));
      assert.strictEqual(fs.existsSync(srcDir), false);
    });
  });

  describe('FINDING-02: Destination Approval Integrity on Overwrites', () => {
    it('fails closed when destination file content is modified between approval and execution', async () => {
      const srcFile = path.join(tmpDir, 'source.txt');
      const destFile = path.join(tmpDir, 'dest.txt');
      fs.writeFileSync(srcFile, 'new version');
      fs.writeFileSync(destFile, 'original version 1');

      // 1. Prepare approval for overwrite
      const prep = await moveTool.prepareApproval({
        source_path: 'source.txt',
        destination_path: 'dest.txt',
        overwrite: true
      });
      assert(prep !== null);
      assert.strictEqual(prep.destinationIdentity?.exists, true);
      assert(prep.payloadDigest.destinationContentHash !== undefined);

      const { token } = approvalManager.createApproval({
        toolName: moveTool.name,
        operationType: 'move',
        workspaceIdentity: workspace.getIdentity(),
        targetPaths: prep.targetPaths,
        payloadDigest: prep.payloadDigest,
        destinationIdentity: prep.destinationIdentity,
        parameters: { source_path: 'source.txt', destination_path: 'dest.txt', overwrite: true }
      });

      // 2. Tamper destination file behind the scenes
      fs.writeFileSync(destFile, 'tampered version 2');

      // 3. Execution must fail closed
      const execRes = await moveTool.execute(
        { source_path: 'source.txt', destination_path: 'dest.txt', overwrite: true },
        { approvalToken: token }
      );

      assert.strictEqual(execRes.success, false);
      assert(
        execRes.error?.includes('approved destination content digest does not match current destination file fingerprint')
      );

      // Verify destFile was not overwritten
      assert.strictEqual(fs.readFileSync(destFile, 'utf8'), 'tampered version 2');
      assert.strictEqual(fs.readFileSync(srcFile, 'utf8'), 'new version');
    });

    it('fails closed when destination file disappears between approval and execution', async () => {
      const srcFile = path.join(tmpDir, 'source.txt');
      const destFile = path.join(tmpDir, 'dest.txt');
      fs.writeFileSync(srcFile, 'src content');
      fs.writeFileSync(destFile, 'will be deleted');

      const prep = await moveTool.prepareApproval({
        source_path: 'source.txt',
        destination_path: 'dest.txt',
        overwrite: true
      });
      assert(prep !== null);
      assert.strictEqual(prep.destinationIdentity?.exists, true);

      const { token } = approvalManager.createApproval({
        toolName: moveTool.name,
        operationType: 'move',
        workspaceIdentity: workspace.getIdentity(),
        targetPaths: prep.targetPaths,
        payloadDigest: prep.payloadDigest,
        destinationIdentity: prep.destinationIdentity,
        parameters: { source_path: 'source.txt', destination_path: 'dest.txt', overwrite: true }
      });

      // Delete destination before execution
      fs.unlinkSync(destFile);

      const execRes = await moveTool.execute(
        { source_path: 'source.txt', destination_path: 'dest.txt', overwrite: true },
        { approvalToken: token }
      );

      assert.strictEqual(execRes.success, false);
      assert(execRes.error?.includes('destination existence changed from true to false'));
      assert.strictEqual(fs.existsSync(srcFile), true);
    });

    it('fails closed when destination file appears after approval was issued for non-existing destination', async () => {
      const srcFile = path.join(tmpDir, 'source.txt');
      const destFile = path.join(tmpDir, 'dest_absent.txt');
      fs.writeFileSync(srcFile, 'src content');

      // Prepare approval for non-existing destination
      const prep = await moveTool.prepareApproval({
        source_path: 'source.txt',
        destination_path: 'dest_absent.txt'
      });
      assert(prep !== null);
      assert.strictEqual(prep.destinationIdentity?.exists, false);

      const { token } = approvalManager.createApproval({
        toolName: moveTool.name,
        operationType: 'move',
        workspaceIdentity: workspace.getIdentity(),
        targetPaths: prep.targetPaths,
        payloadDigest: prep.payloadDigest,
        destinationIdentity: prep.destinationIdentity,
        parameters: { source_path: 'source.txt', destination_path: 'dest_absent.txt' }
      });

      // Sneak in a destination file
      fs.writeFileSync(destFile, 'unauthorized newcomer');

      const execRes = await moveTool.execute(
        { source_path: 'source.txt', destination_path: 'dest_absent.txt' },
        { approvalToken: token }
      );

      assert.strictEqual(execRes.success, false);
      assert(execRes.error?.includes('destination existence changed from false to true'));
      assert.strictEqual(fs.readFileSync(destFile, 'utf8'), 'unauthorized newcomer');
      assert.strictEqual(fs.existsSync(srcFile), true);
    });

    it('fails closed when destination file is replaced with a symlink before execution', async () => {
      const srcFile = path.join(tmpDir, 'source.txt');
      const destFile = path.join(tmpDir, 'dest.txt');
      const externalTarget = path.join(tmpDir, 'external.txt');
      fs.writeFileSync(srcFile, 'src content');
      fs.writeFileSync(destFile, 'dest file');
      fs.writeFileSync(externalTarget, 'external');

      const prep = await moveTool.prepareApproval({
        source_path: 'source.txt',
        destination_path: 'dest.txt',
        overwrite: true
      });
      assert(prep !== null);
      assert.strictEqual(prep.destinationIdentity?.type, 'file');

      const { token } = approvalManager.createApproval({
        toolName: moveTool.name,
        operationType: 'move',
        workspaceIdentity: workspace.getIdentity(),
        targetPaths: prep.targetPaths,
        payloadDigest: prep.payloadDigest,
        destinationIdentity: prep.destinationIdentity,
        parameters: { source_path: 'source.txt', destination_path: 'dest.txt', overwrite: true }
      });

      // Replace destFile with a symlink
      fs.unlinkSync(destFile);
      try {
        fs.symlinkSync(externalTarget, destFile);
      } catch {
        // On Windows if unprivileged symlink fails, skip symlink test
        return;
      }

      const execRes = await moveTool.execute(
        { source_path: 'source.txt', destination_path: 'dest.txt', overwrite: true },
        { approvalToken: token }
      );

      assert.strictEqual(execRes.success, false);
      assert(
        execRes.error?.includes('destination type changed') ||
        execRes.error?.includes('Refusing to overwrite symlink')
      );
    });
  });

  describe('FINDING-03: Hardlink Failure Without Unsafe Fallback', () => {
    it('fails closed on ENOSYS without falling back to rename', async () => {
      const srcFile = path.join(tmpDir, 'src_hardlink.txt');
      const destFile = path.join(tmpDir, 'dest_hardlink.txt');
      fs.writeFileSync(srcFile, 'content');

      const originalLink = fs.promises.link;
      const originalRename = fs.promises.rename;
      let renameCalled = false;

      // Mock fs.promises.link to throw ENOSYS
      fs.promises.link = async () => {
        const err = new Error('Function not implemented');
        err.code = 'ENOSYS';
        throw err;
      };
      fs.promises.rename = async (...args) => {
        renameCalled = true;
        return originalRename.apply(fs.promises, args);
      };

      try {
        await assert.rejects(
          async () => {
            await workspace.moveEntry(srcFile, destFile);
          },
          (err) => {
            assert(err instanceof SecurityError);
            assert(err.message.includes('Filesystem does not support atomic link-based non-overwrite relocation'));
            assert(err.message.includes('ENOSYS'));
            return true;
          }
        );

        assert.strictEqual(renameCalled, false, 'rename must NEVER be called when link fails with ENOSYS');
        assert.strictEqual(fs.existsSync(srcFile), true);
        assert.strictEqual(fs.existsSync(destFile), false);
      } finally {
        fs.promises.link = originalLink;
        fs.promises.rename = originalRename;
      }
    });

    it('fails closed on ENOTSUP without falling back to rename', async () => {
      const srcFile = path.join(tmpDir, 'src_hardlink.txt');
      const destFile = path.join(tmpDir, 'dest_hardlink.txt');
      fs.writeFileSync(srcFile, 'content');

      const originalLink = fs.promises.link;
      let renameCalled = false;
      const originalRename = fs.promises.rename;

      fs.promises.link = async () => {
        const err = new Error('Operation not supported');
        err.code = 'ENOTSUP';
        throw err;
      };
      fs.promises.rename = async (...args) => {
        renameCalled = true;
        return originalRename.apply(fs.promises, args);
      };

      try {
        await assert.rejects(
          async () => {
            await workspace.moveEntry(srcFile, destFile);
          },
          (err) => {
            assert(err instanceof SecurityError);
            assert(err.message.includes('ENOTSUP'));
            return true;
          }
        );
        assert.strictEqual(renameCalled, false);
      } finally {
        fs.promises.link = originalLink;
        fs.promises.rename = originalRename;
      }
    });
  });

  describe('FINDING-04: Windows NTFS Alternate Data Streams (ADS) Protection', () => {
    it('detects and blocks .git with alternate data stream syntax', () => {
      assert.strictEqual(workspace.isSensitive('.git:stream'), true);
      assert.strictEqual(workspace.isSensitive('.git:stream:$DATA'), true);
      assert.strictEqual(workspace.isSensitive('some/subpath/.git:hidden'), true);
      assert.strictEqual(workspace.isSensitive('.gitmodules:stream'), true);
      assert.strictEqual(workspace.isSensitive('.gitconfig:stream'), true);
    });

    it('detects and blocks sensitive files with ADS stream syntax', () => {
      assert.strictEqual(workspace.isSensitive('.env:stream'), true);
      assert.strictEqual(workspace.isSensitive('.env.local:stream'), true);
      assert.strictEqual(workspace.isSensitive('id_rsa:stream'), true);
      assert.strictEqual(workspace.isSensitive('server.key:stream'), true);
      assert.strictEqual(workspace.isSensitive('credentials.json:stream'), true);
      assert.strictEqual(workspace.isSensitive('path/to/.aws/credentials:stream'), true);
    });

    it('preserves Windows drive letters and allows valid normal paths', () => {
      assert.strictEqual(workspace.isSensitive('C:\\Users\\workspace\\normal.txt'), false);
      assert.strictEqual(workspace.isSensitive('D:/projects/app/main.ts'), false);
      assert.strictEqual(workspace.isSensitive('C:\\repo\\.git:stream\\item'), true);
    });
  });

  describe('FINDING-05: Genuine Deterministic Race-Condition Interleaving', () => {
    it('detects and rejects directory move when destination appears right before rename', async () => {
      const srcDir = path.join(tmpDir, 'src_race_dir');
      const destDir = path.join(tmpDir, 'dest_race_dir');
      fs.mkdirSync(srcDir);
      fs.writeFileSync(path.join(srcDir, 'file.txt'), 'content');

      const originalLstat = fs.promises.lstat;
      let lstatCallCount = 0;

      // Interleave: On the second lstat check for destination, create the destination
      fs.promises.lstat = async (targetPath) => {
        if (targetPath === destDir) {
          lstatCallCount++;
          if (lstatCallCount === 2) {
            // Simulate another process creating destination dir right here!
            fs.mkdirSync(destDir);
          }
        }
        return originalLstat.call(fs.promises, targetPath);
      };

      try {
        await assert.rejects(
          async () => {
            await workspace.moveEntry(srcDir, destDir);
          },
          (err) => {
            assert(err instanceof ToolError);
            assert(err.message.includes('Destination already exists'));
            return true;
          }
        );
      } finally {
        fs.promises.lstat = originalLstat;
      }
    });

    it('detects source identity change between hardlink creation and unlinking', async () => {
      const srcFile = path.join(tmpDir, 'source_file.txt');
      const destFile = path.join(tmpDir, 'dest_file.txt');
      fs.writeFileSync(srcFile, 'original file');

      const originalLink = fs.promises.link;
      const originalUnlink = fs.promises.unlink;
      let unlinkCalled = false;

      fs.promises.link = async (src, dst) => {
        await originalLink.call(fs.promises, src, dst);
        // Tamper: replace source file with a new file (different inode) before unlink!
        fs.unlinkSync(srcFile);
        fs.writeFileSync(srcFile, 'swapped file with different inode');
      };

      fs.promises.unlink = async (target) => {
        unlinkCalled = true;
        return originalUnlink.call(fs.promises, target);
      };

      try {
        await assert.rejects(
          async () => {
            await workspace.moveEntry(srcFile, destFile);
          },
          (err) => {
            assert(err instanceof SecurityError);
            assert(err.message.includes('Source file identity changed prior to unlinking'));
            return true;
          }
        );
        assert.strictEqual(unlinkCalled, false, 'Must NOT unlink when source identity changed');
      } finally {
        fs.promises.link = originalLink;
        fs.promises.unlink = originalUnlink;
      }
    });

    it('detects destination file replacement immediately before overwrite rename', async () => {
      const srcFile = path.join(tmpDir, 'src_overwrite.txt');
      const destFile = path.join(tmpDir, 'dest_overwrite.txt');
      fs.writeFileSync(srcFile, 'src content');
      fs.writeFileSync(destFile, 'original dest');

      const destStatBefore = fs.lstatSync(destFile);
      const expectedDestIdentity = {
        canonicalPath: destFile,
        deviceNumber: Number(destStatBefore.dev),
        inodeNumber: Number(destStatBefore.ino),
        type: 'file',
        exists: true
      };

      // Tamper: change destFile inode right before calling moveEntry
      fs.unlinkSync(destFile);
      fs.writeFileSync(destFile, 'different inode dest');

      await assert.rejects(
        async () => {
          await workspace.moveEntry(srcFile, destFile, {
            overwrite: true,
            expectedDestIdentity
          });
        },
        (err) => {
          assert(err instanceof SecurityError);
          assert(err.message.includes('Destination file identity changed prior to overwrite rename'));
          return true;
        }
      );
    });
  });

  describe('FINDING-06: Approval Record Immutability', () => {
    it('creates deeply frozen approval records that cannot be mutated', () => {
      const { record } = approvalManager.createApproval({
        toolName: 'move_file',
        operationType: 'move',
        workspaceIdentity: workspace.getIdentity(),
        targetPaths: [{ canonicalPath: path.join(tmpDir, 'a'), workspaceRelative: 'a' }],
        payloadDigest: { algorithm: 'sha256', originalContentHash: 'abc', destinationContentHash: 'def' },
        destinationIdentity: { canonicalPath: path.join(tmpDir, 'b'), exists: true, type: 'file' },
        parameters: { test: 123 }
      });

      assert.strictEqual(Object.isFrozen(record), true);
      assert.strictEqual(Object.isFrozen(record.workspaceIdentity), true);
      assert.strictEqual(Object.isFrozen(record.targetPaths), true);
      assert.strictEqual(Object.isFrozen(record.targetPaths[0]), true);
      assert.strictEqual(Object.isFrozen(record.payloadDigest), true);
      assert.strictEqual(Object.isFrozen(record.destinationIdentity), true);
      assert.strictEqual(Object.isFrozen(record.parameters), true);

      assert.throws(() => {
        // @ts-expect-error mutating frozen object
        record.toolName = 'malicious_tool';
      }, TypeError);

      assert.throws(() => {
        // @ts-expect-error mutating frozen object
        record.destinationIdentity.exists = false;
      }, TypeError);

      assert.throws(() => {
        // @ts-expect-error mutating frozen object
        record.payloadDigest.destinationContentHash = 'hacked';
      }, TypeError);
    });

    it('returns deeply frozen records on validateAndConsume', () => {
      const src = path.join(tmpDir, 'file.txt');
      const dst = path.join(tmpDir, 'file2.txt');
      const wsIdent = workspace.getIdentity();

      const { token } = approvalManager.createApproval({
        toolName: 'move_file',
        operationType: 'move',
        workspaceIdentity: wsIdent,
        targetPaths: [
          { canonicalPath: src, workspaceRelative: 'file.txt' },
          { canonicalPath: dst, workspaceRelative: 'file2.txt' }
        ],
        payloadDigest: { algorithm: 'sha256' },
        destinationIdentity: { canonicalPath: dst, exists: false, type: 'none' },
        parameters: {}
      });

      const consumed = approvalManager.validateAndConsume(token, {
        toolName: 'move_file',
        operationType: 'move',
        workspaceIdentity: wsIdent,
        canonicalPath: src,
        destinationCanonicalPath: dst,
        destinationIdentity: { canonicalPath: dst, exists: false, type: 'none' }
      });

      assert.strictEqual(Object.isFrozen(consumed), true);
      assert.strictEqual(Object.isFrozen(consumed.destinationIdentity), true);
      assert.throws(() => {
        // @ts-expect-error mutating frozen object
        consumed.approvalId = 'tampered';
      }, TypeError);
    });
  });
});
