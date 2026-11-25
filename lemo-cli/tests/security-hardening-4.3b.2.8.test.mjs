/**
 * Security Hardening Tests — Phase 4.3B.2.8
 * Proves verified rollback integrity, fail-closed overwrite semantics,
 * crash recovery for stale staging backups (.lemo_bkp_*), capability override integrity,
 * and regression resilience across all filesystem tools.
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
import { WriteFileTool } from '../dist/agent/tools/builtin/WriteFileTool.js';
import { EditFileTool } from '../dist/agent/tools/builtin/EditFileTool.js';
import { ApprovalManager } from '../dist/agent/approval/ApprovalManager.js';
import { SecurityError, ToolError } from '../dist/core/errors/index.js';

describe('Phase 4.3B.2.8: Verified Rollback, Capability Integrity & Crash Recovery', () => {
  let tmpDir;
  let workspace;
  let approvalManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lemo-test-4.3b.2.8-'));
    workspace = new WorkspaceManager(tmpDir);
    approvalManager = new ApprovalManager();
  });

  afterEach(() => {
    delete process.env['LEMO_FORCE_NATIVE_RENAME_NOREPLACE'];
    delete globalThis.__lemo_native_rename_noreplace;
    delete globalThis.__lemo_native_rename_exchange;
    PlatformCapabilityRegistry.reset();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error on Windows
    }
  });

  describe('1. Verified Rollback & Invariant Enforcement (FINDING-01)', () => {
    it('aborts rollback and preserves backup when displaced backup content is tampered before rollback', async () => {
      const srcFile = path.join(tmpDir, 'source.txt');
      const dstFile = path.join(tmpDir, 'dest.txt');
      fs.writeFileSync(srcFile, 'new content from source');
      fs.writeFileSync(dstFile, 'original dest content');

      const destStat = fs.lstatSync(dstFile);
      const destHash = crypto.createHash('sha256').update(fs.readFileSync(dstFile)).digest('hex');

      // Intercept fs.promises.rename: when attempting to move source to destination,
      // tamper with the displaced backup file on disk and fail the source rename to trigger rollback
      const origRename = fs.promises.rename;
      let bkpPathFound = null;
      fs.promises.rename = async (oldP, newP) => {
        if (typeof newP === 'string' && path.basename(newP).startsWith('.lemo_bkp_')) {
          bkpPathFound = newP;
          return origRename(oldP, newP);
        }
        if (oldP === srcFile && newP === dstFile) {
          // Source rename step: tamper with the displaced backup before rollback triggers
          if (bkpPathFound) {
            fs.writeFileSync(bkpPathFound, 'tampered content injected during race!');
          }
          throw new Error('Simulated crash / failure during source rename');
        }
        return origRename(oldP, newP);
      };

      try {
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
              expectedDestContentHash: destHash
            });
          },
          (err) => {
            assert(err instanceof SecurityError);
            assert(err.message.includes('Verified rollback aborted to prevent data corruption'));
            assert(err.message.includes('Displaced backup content mismatch'));
            return true;
          }
        );

        // Verification: backup entry was preserved on disk for manual recovery, destination was not clobbered
        const files = fs.readdirSync(tmpDir);
        const bkpFile = files.find((f) => f.startsWith('.lemo_bkp_') && !f.endsWith('.journal.json'));
        assert(bkpFile, 'Displaced backup must be preserved on disk for manual reconciliation');
        assert.strictEqual(
          fs.readFileSync(path.join(tmpDir, bkpFile), 'utf8'),
          'tampered content injected during race!'
        );
        assert(!fs.existsSync(dstFile), 'Destination must not be overwritten with tampered backup');
        assert(fs.existsSync(srcFile), 'Source file must remain untouched');
      } finally {
        fs.promises.rename = origRename;
      }
    });

    it('aborts rollback and preserves entries when destination is unexpectedly occupied during rollback', async () => {
      const srcFile = path.join(tmpDir, 'source.txt');
      const dstFile = path.join(tmpDir, 'dest.txt');
      fs.writeFileSync(srcFile, 'new source');
      fs.writeFileSync(dstFile, 'original dest');

      const destStat = fs.lstatSync(dstFile);
      const destHash = crypto.createHash('sha256').update(fs.readFileSync(dstFile)).digest('hex');

      // Intercept fs.promises.rename so that after displacement, we simulate another process creating dstFile
      const origRename = fs.promises.rename;
      let displaced = false;
      fs.promises.rename = async (oldP, newP) => {
        const res = await origRename(oldP, newP);
        if (typeof newP === 'string' && path.basename(newP).startsWith('.lemo_bkp_') && !displaced) {
          displaced = true;
          // Concurrent process creates unexpected occupant at destination path
          fs.writeFileSync(dstFile, 'rogue occupant created concurrently');
          // Now cause an error in moveEntry by corrupting source file to trigger rollback
          fs.unlinkSync(srcFile);
        }
        return res;
      };

      try {
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
              expectedDestContentHash: destHash
            });
          },
          (err) => {
            assert(err instanceof SecurityError);
            assert(err.message.includes('Verified rollback aborted to prevent data corruption'));
            assert(err.message.includes('was unexpectedly occupied during rollback'));
            return true;
          }
        );

        // Verification: occupant is preserved, backup is preserved, neither is clobbered
        assert.strictEqual(
          fs.readFileSync(dstFile, 'utf8'),
          'rogue occupant created concurrently',
          'Unexpected occupant must NOT be overwritten'
        );
        const files = fs.readdirSync(tmpDir);
        const bkpFile = files.find((f) => f.startsWith('.lemo_bkp_') && !f.endsWith('.journal.json'));
        assert(bkpFile, 'Displaced backup must be preserved for manual recovery');
      } finally {
        fs.promises.rename = origRename;
      }
    });
  });

  describe('2. Fail-Closed Overwrite Semantics (FINDING-02)', () => {
    it('disables destination overwrite when safeDestinationOverwrite is false', async () => {
      const customWs = new WorkspaceManager(tmpDir, {
        capabilities: { safeDestinationOverwrite: false }
      });
      const moveTool = new MoveFileTool(customWs, approvalManager);

      const src = path.join(tmpDir, 'src.txt');
      const dst = path.join(tmpDir, 'dst.txt');
      fs.writeFileSync(src, 'content src');
      fs.writeFileSync(dst, 'content dst');

      // 1. prepareApproval rejects
      await assert.rejects(
        async () => {
          await moveTool.prepareApproval({
            source_path: 'src.txt',
            destination_path: 'dst.txt',
            overwrite: true
          });
        },
        (err) => {
          assert(err instanceof SecurityError);
          assert(err.message.includes("Safe destination overwrite disabled: verified displacement/staging capability ('safeDestinationOverwrite') is unavailable"));
          return true;
        }
      );

      // 2. moveEntry directly rejects
      await assert.rejects(
        async () => {
          await customWs.moveEntry(src, dst, { overwrite: true });
        },
        (err) => {
          assert(err instanceof SecurityError);
          assert(err.message.includes("Safe destination overwrite disabled: verified displacement/staging capability ('safeDestinationOverwrite') is unavailable"));
          return true;
        }
      );

      // 3. Non-overwrite relocation remains intact subject to its existing security checks
      const dstNew = path.join(tmpDir, 'dst_new.txt');
      const res = await customWs.moveEntry(src, dstNew, { overwrite: false });
      assert.strictEqual(res.type, 'file');
      assert(fs.existsSync(dstNew));
      assert(!fs.existsSync(src));
    });
  });

  describe('3. Crash Recovery & Stale Staging Sweeper (FINDING-03)', () => {
    it('recovers displaced backup when destination does not exist and hash matches journal', () => {
      const dstFile = path.join(tmpDir, 'important_doc.txt');
      const nonce = crypto.randomBytes(8).toString('hex');
      const bkpFile = path.join(tmpDir, `.lemo_bkp_important_doc.txt_${nonce}.tmp`);
      const journalFile = `${bkpFile}.journal.json`;

      const content = 'critical user data saved prior to crash';
      fs.writeFileSync(bkpFile, content);
      const hash = crypto.createHash('sha256').update(content).digest('hex');

      fs.writeFileSync(
        journalFile,
        JSON.stringify({
          targetCanonical: dstFile,
          expectedHash: hash,
          displacedHash: hash,
          timestamp: Date.now() - 10_000
        })
      );

      // Execute crash recovery sweep
      workspace.cleanStaleTempFiles(0);

      // Verification: destination restored, staging file and journal removed
      assert(fs.existsSync(dstFile), 'Destination must be recovered from valid stale backup');
      assert.strictEqual(fs.readFileSync(dstFile, 'utf8'), content);
      assert(!fs.existsSync(bkpFile), 'Staging file must be cleaned up upon successful recovery');
      assert(!fs.existsSync(journalFile), 'Journal must be cleaned up upon successful recovery');
    });

    it('preserves backup untouched when destination already exists (never overwrites during recovery)', () => {
      const dstFile = path.join(tmpDir, 'existing_doc.txt');
      fs.writeFileSync(dstFile, 'current active content on disk');

      const nonce = crypto.randomBytes(8).toString('hex');
      const bkpFile = path.join(tmpDir, `.lemo_bkp_existing_doc.txt_${nonce}.tmp`);
      const journalFile = `${bkpFile}.journal.json`;
      const content = 'stale backup content';
      fs.writeFileSync(bkpFile, content);

      fs.writeFileSync(
        journalFile,
        JSON.stringify({
          targetCanonical: dstFile,
          expectedHash: crypto.createHash('sha256').update(content).digest('hex'),
          timestamp: Date.now() - 10_000
        })
      );

      // Execute crash recovery sweep
      workspace.cleanStaleTempFiles(0);

      // Invariant: destination is NEVER overwritten during crash recovery
      assert.strictEqual(
        fs.readFileSync(dstFile, 'utf8'),
        'current active content on disk',
        'Existing destination must remain untouched'
      );
      assert(fs.existsSync(bkpFile), 'Backup file must be preserved for manual reconciliation');
    });

    it('preserves backup untouched when backup content hash does not match journal expected hash', () => {
      const dstFile = path.join(tmpDir, 'tampered_doc.txt');
      const nonce = crypto.randomBytes(8).toString('hex');
      const bkpFile = path.join(tmpDir, `.lemo_bkp_tampered_doc.txt_${nonce}.tmp`);
      const journalFile = `${bkpFile}.journal.json`;

      fs.writeFileSync(bkpFile, 'tampered modified content on disk');

      fs.writeFileSync(
        journalFile,
        JSON.stringify({
          targetCanonical: dstFile,
          expectedHash: crypto.createHash('sha256').update('original legitimate content').digest('hex'),
          timestamp: Date.now() - 10_000
        })
      );

      workspace.cleanStaleTempFiles(0);

      // Invariant: tampered backup is preserved, not recovered
      assert(!fs.existsSync(dstFile), 'Tampered backup must NOT be restored to destination');
      assert(fs.existsSync(bkpFile), 'Tampered backup must be preserved for investigation');
    });

    it('preserves ambiguous backup files when journal is corrupted or missing', () => {
      const bkpFile = path.join(tmpDir, '.lemo_bkp_unknown_nonce123.tmp');
      fs.writeFileSync(bkpFile, 'orphaned content without valid metadata');

      workspace.cleanStaleTempFiles(0);

      assert(fs.existsSync(bkpFile), 'Ambiguous backup without journal must NEVER be deleted');
    });

    it('rejects path traversal and symlinks in journal target Canonical', () => {
      const outsideTarget = path.join(os.tmpdir(), 'outside_lemo_escape.txt');
      const nonce = crypto.randomBytes(8).toString('hex');
      const bkpFile = path.join(tmpDir, `.lemo_bkp_escape_${nonce}.tmp`);
      const journalFile = `${bkpFile}.journal.json`;

      fs.writeFileSync(bkpFile, 'escape content');
      fs.writeFileSync(
        journalFile,
        JSON.stringify({
          targetCanonical: outsideTarget,
          expectedHash: null,
          timestamp: Date.now() - 10_000
        })
      );

      workspace.cleanStaleTempFiles(0);

      assert(!fs.existsSync(outsideTarget), 'Recovery must not write outside workspace root');
      assert(fs.existsSync(bkpFile), 'Backup file must be preserved');
    });
  });

  describe('4. Platform Capability Override Integrity (FINDING-04)', () => {
    it('neutralizes LEMO_FORCE_NATIVE_RENAME_NOREPLACE environment variable', () => {
      process.env['LEMO_FORCE_NATIVE_RENAME_NOREPLACE'] = '1';
      PlatformCapabilityRegistry.reset();
      const caps = PlatformCapabilityRegistry.probe(tmpDir);

      // On POSIX without a callable native binding function, atomicDirectoryNoReplace must remain false
      if (process.platform !== 'win32') {
        assert.strictEqual(
          caps.atomicDirectoryNoReplace,
          false,
          'LEMO_FORCE_NATIVE_RENAME_NOREPLACE must not enable unsupported native capabilities on POSIX'
        );
      }
    });

    it('requires callable native implementation for native bindings', () => {
      // Non-callable binding should be ignored
      globalThis.__lemo_native_rename_noreplace = 'not-a-function';
      PlatformCapabilityRegistry.reset();
      const caps = PlatformCapabilityRegistry.probe(tmpDir);

      if (process.platform !== 'win32') {
        assert.strictEqual(
          caps.atomicDirectoryNoReplace,
          false,
          'String or non-callable binding must not enable atomicDirectoryNoReplace'
        );
      }
    });
  });

  describe('5. Regression Suite: Write, Edit, Delete & Non-Overwrite Move', () => {
    it('WriteFileTool creates files atomically and enforces containment', async () => {
      const writeTool = new WriteFileTool(workspace, approvalManager);
      const params = {
        path: 'new_file.txt',
        content: 'hello world'
      };
      const prep = await writeTool.prepareApproval(params);
      const { token } = approvalManager.createApproval({
        toolName: 'write_file',
        operationType: prep.operationType,
        workspaceIdentity: workspace.getIdentity(),
        targetPaths: prep.targetPaths,
        payloadDigest: prep.payloadDigest,
        parameters: params,
        preview: prep.preview
      });

      const res = await writeTool.execute(params, { toolCallId: 'c1', approvalToken: token });
      assert(res.success);
      assert.strictEqual(fs.readFileSync(path.join(tmpDir, 'new_file.txt'), 'utf8'), 'hello world');

      // Rejects writing outside workspace
      await assert.rejects(
        async () => {
          await writeTool.prepareApproval({
            path: '../outside.txt',
            content: 'bad'
          });
        },
        (err) => err instanceof SecurityError
      );
    });

    it('EditFileTool performs surgical edits cleanly', async () => {
      const filePath = path.join(tmpDir, 'edit_target.txt');
      fs.writeFileSync(filePath, 'foo\nbar\nbaz\n');

      const editTool = new EditFileTool(workspace, approvalManager);
      const params = {
        path: 'edit_target.txt',
        target_content: 'bar',
        replacement_content: 'qux'
      };
      const prep = await editTool.prepareApproval(params);
      const { token } = approvalManager.createApproval({
        toolName: 'edit_file',
        operationType: prep.operationType,
        workspaceIdentity: workspace.getIdentity(),
        targetPaths: prep.targetPaths,
        payloadDigest: prep.payloadDigest,
        parameters: params,
        preview: prep.preview
      });

      const res = await editTool.execute(params, { toolCallId: 'c2', approvalToken: token });
      assert(res.success);
      assert.strictEqual(fs.readFileSync(filePath, 'utf8'), 'foo\nqux\nbaz\n');
    });

    it('DeleteFileTool deletes files and empty directories safely', async () => {
      const filePath = path.join(tmpDir, 'del_file.txt');
      fs.writeFileSync(filePath, 'to be deleted');
      const delTool = new DeleteFileTool(workspace, approvalManager);

      const paramsFile = { path: 'del_file.txt' };
      const prepFile = await delTool.prepareApproval(paramsFile);
      const { token: tokenFile } = approvalManager.createApproval({
        toolName: 'delete_file',
        operationType: prepFile.operationType,
        workspaceIdentity: workspace.getIdentity(),
        targetPaths: prepFile.targetPaths,
        payloadDigest: prepFile.payloadDigest,
        parameters: paramsFile,
        preview: prepFile.preview
      });

      const resFile = await delTool.execute(paramsFile, { toolCallId: 'c3', approvalToken: tokenFile });
      assert(resFile.success);
      assert(!fs.existsSync(filePath));

      const emptyDir = path.join(tmpDir, 'empty_dir');
      fs.mkdirSync(emptyDir);
      const paramsDir = { path: 'empty_dir' };
      const prepDir = await delTool.prepareApproval(paramsDir);
      const { token: tokenDir } = approvalManager.createApproval({
        toolName: 'delete_file',
        operationType: prepDir.operationType,
        workspaceIdentity: workspace.getIdentity(),
        targetPaths: prepDir.targetPaths,
        payloadDigest: prepDir.payloadDigest,
        parameters: paramsDir,
        preview: prepDir.preview
      });

      const resDir = await delTool.execute(paramsDir, { toolCallId: 'c4', approvalToken: tokenDir });
      assert(resDir.success);
      assert(!fs.existsSync(emptyDir));

      // Rejects deleting non-empty directory
      const nonEmpty = path.join(tmpDir, 'non_empty');
      fs.mkdirSync(nonEmpty);
      fs.writeFileSync(path.join(nonEmpty, 'child.txt'), 'child');
      await assert.rejects(
        async () => {
          await delTool.prepareApproval({ path: 'non_empty' });
        },
        (err) => err instanceof SecurityError
      );
    });

    it('MoveFileTool performs race-safe non-overwrite hardlink move', async () => {
      const src = path.join(tmpDir, 'move_src.txt');
      const dst = path.join(tmpDir, 'move_dst.txt');
      fs.writeFileSync(src, 'relocation data');

      const moveTool = new MoveFileTool(workspace, approvalManager);
      const params = {
        source_path: 'move_src.txt',
        destination_path: 'move_dst.txt',
        overwrite: false
      };
      const prep = await moveTool.prepareApproval(params);
      const { token } = approvalManager.createApproval({
        toolName: 'move_file',
        operationType: prep.operationType,
        workspaceIdentity: workspace.getIdentity(),
        targetPaths: prep.targetPaths,
        payloadDigest: prep.payloadDigest,
        parameters: params,
        preview: prep.preview
      });

      const res = await moveTool.execute(params, { toolCallId: 'c5', approvalToken: token });

      assert(res.success);
      assert(!fs.existsSync(src), 'Source must be unlinked');
      assert(fs.existsSync(dst), 'Destination must exist');
      assert.strictEqual(fs.readFileSync(dst, 'utf8'), 'relocation data');
    });
  });
});
