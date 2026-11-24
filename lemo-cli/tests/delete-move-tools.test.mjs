/**
 * Security & Functional Test Suite for Phase 4.3B.2
 * Controlled Deletion & Relocation Operations: delete_file, move_file,
 * symlink unlinking safety, non-empty directory rejection, descendant move prevention,
 * race-safe non-overwrite semantics, and cryptographic approval verification.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

import { WorkspaceManager } from '../dist/agent/workspace/WorkspaceManager.js';
import { ApprovalManager } from '../dist/agent/approval/ApprovalManager.js';
import { DeleteFileTool } from '../dist/agent/tools/builtin/DeleteFileTool.js';
import { MoveFileTool } from '../dist/agent/tools/builtin/MoveFileTool.js';
import { ToolExecutor } from '../dist/agent/tools/ToolExecutor.js';
import { ToolRegistry } from '../dist/agent/tools/ToolRegistry.js';
import { StrictApprovalPolicy, AutoApprovalPolicy } from '../dist/agent/policies/ApprovalPolicy.js';
import { ExecutionPolicy } from '../dist/agent/policies/ExecutionPolicy.js';
import { SecurityError, ToolError, WorkspaceError } from '../dist/core/errors/index.js';

describe('Phase 4.3B.2: Safe Deletion & Relocation Tools', () => {
  let testDir;
  let workspaceManager;
  let approvalManager;
  let deleteFileTool;
  let moveFileTool;

  before(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lemo-test-delete-move-'));
  });

  after(() => {
    try {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    } catch {
      // Best-effort cleanup
    }
  });

  beforeEach(() => {
    // Reset workspace directory contents
    const entries = fs.readdirSync(testDir);
    for (const entry of entries) {
      const fullPath = path.join(testDir, entry);
      fs.rmSync(fullPath, { recursive: true, force: true });
    }

    workspaceManager = new WorkspaceManager(testDir);
    approvalManager = new ApprovalManager();
    deleteFileTool = new DeleteFileTool(workspaceManager, approvalManager);
    moveFileTool = new MoveFileTool(workspaceManager, approvalManager);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Safe Deletion: delete_file
  // ──────────────────────────────────────────────────────────────────────────
  describe('delete_file Tool Requirements & Invariants', () => {
    test('successfully deletes a regular file with valid approval', async () => {
      const filePath = path.join(testDir, 'sample.txt');
      fs.writeFileSync(filePath, 'deletable content', 'utf8');
      const hash = crypto.createHash('sha256').update('deletable content').digest('hex');

      const prep = await deleteFileTool.prepareApproval({ path: 'sample.txt' });
      assert.equal(prep.operationType, 'delete');
      assert.equal(prep.targetPaths[0].workspaceRelative, 'sample.txt');
      assert.equal(prep.payloadDigest.originalContentHash, hash);

      const { token } = approvalManager.createApproval({
        toolName: 'delete_file',
        operationType: 'delete',
        workspaceIdentity: workspaceManager.getIdentity(),
        targetPaths: prep.targetPaths,
        payloadDigest: prep.payloadDigest,
        parameters: { path: 'sample.txt' },
        preview: prep.preview
      });

      const res = await deleteFileTool.execute({ path: 'sample.txt' }, { toolCallId: 'call_1', approvalToken: token });
      assert.equal(res.success, true);
      assert.equal(res.data.type, 'file');
      assert.equal(res.data.bytesDeleted, 17);
      assert.equal(fs.existsSync(filePath), false);
    });

    test('successfully deletes an empty directory', async () => {
      const emptyDirPath = path.join(testDir, 'empty_dir');
      fs.mkdirSync(emptyDirPath);

      const prep = await deleteFileTool.prepareApproval({ path: 'empty_dir' });
      assert.equal(prep.operationType, 'delete');
      assert.match(prep.preview, /Delete empty directory/);

      const { token } = approvalManager.createApproval({
        toolName: 'delete_file',
        operationType: 'delete',
        workspaceIdentity: workspaceManager.getIdentity(),
        targetPaths: prep.targetPaths,
        payloadDigest: prep.payloadDigest,
        parameters: { path: 'empty_dir' },
        preview: prep.preview
      });

      const res = await deleteFileTool.execute({ path: 'empty_dir' }, { toolCallId: 'call_2', approvalToken: token });
      assert.equal(res.success, true);
      assert.equal(res.data.type, 'directory');
      assert.equal(fs.existsSync(emptyDirPath), false);
    });

    test('STRICTLY PROHIBITS recursive deletion of non-empty directory', async () => {
      const nestedDir = path.join(testDir, 'nested_dir');
      fs.mkdirSync(nestedDir);
      fs.writeFileSync(path.join(nestedDir, 'child.txt'), 'keep me', 'utf8');

      // prepareApproval must reject non-empty directory
      await assert.rejects(
        async () => {
          await deleteFileTool.prepareApproval({ path: 'nested_dir' });
        },
        {
          name: 'SecurityError',
          message: /Recursive deletion is not supported/
        }
      );

      // deleteEntry must also reject non-empty directory directly
      await assert.rejects(
        async () => {
          await workspaceManager.deleteEntry(nestedDir);
        },
        {
          name: 'SecurityError',
          message: /Recursive deletion is not supported/
        }
      );

      // Verify directory and children are completely intact
      assert.equal(fs.existsSync(nestedDir), true);
      assert.equal(fs.existsSync(path.join(nestedDir, 'child.txt')), true);
    });

    test('STRICTLY PROHIBITS workspace root deletion', async () => {
      await assert.rejects(
        async () => {
          await deleteFileTool.prepareApproval({ path: '.' });
        },
        {
          name: 'SecurityError',
          message: /Cannot delete workspace root directory/
        }
      );

      await assert.rejects(
        async () => {
          await workspaceManager.deleteEntry(workspaceManager.getRoot());
        },
        {
          name: 'SecurityError',
          message: /Cannot delete workspace root directory/
        }
      );
    });

    test('rejects path traversal attacks attempting to delete outside workspace', async () => {
      await assert.rejects(
        async () => {
          await deleteFileTool.prepareApproval({ path: '../../etc/passwd' });
        },
        {
          name: 'SecurityError',
          message: /outside workspace root/
        }
      );
    });

    test('rejects deletion of sensitive configuration files', async () => {
      const sensitiveFiles = ['.env', '.env.local', 'id_rsa', 'secret.pem', 'credentials.json'];
      for (const file of sensitiveFiles) {
        fs.writeFileSync(path.join(testDir, file), 'secret data', 'utf8');
        await assert.rejects(
          async () => {
            await deleteFileTool.prepareApproval({ path: file });
          },
          {
            name: 'SecurityError',
            message: /sensitive file/
          }
        );
      }
    });

    test('safely unlinks symlinks without traversing or deleting target file', async () => {
      const targetFile = path.join(testDir, 'real_file.txt');
      fs.writeFileSync(targetFile, 'precious data', 'utf8');

      const symlinkPath = path.join(testDir, 'link_to_file');
      try {
        fs.symlinkSync(targetFile, symlinkPath);
      } catch (err) {
        // Skip if symlinks not permitted on this platform / permissions
        return;
      }

      const prep = await deleteFileTool.prepareApproval({ path: 'link_to_file' });
      assert.equal(prep.operationType, 'delete');
      assert.match(prep.preview, /Delete symlink/);

      const { token } = approvalManager.createApproval({
        toolName: 'delete_file',
        operationType: 'delete',
        workspaceIdentity: workspaceManager.getIdentity(),
        targetPaths: prep.targetPaths,
        payloadDigest: prep.payloadDigest,
        parameters: { path: 'link_to_file' },
        preview: prep.preview
      });

      const res = await deleteFileTool.execute({ path: 'link_to_file' }, { toolCallId: 'call_sym', approvalToken: token });
      assert.equal(res.success, true);
      assert.equal(res.data.type, 'symlink');

      // Crucial assertion: the symlink was unlinked, but target file is 100% INTACT!
      assert.equal(fs.existsSync(symlinkPath), false);
      assert.equal(fs.existsSync(targetFile), true);
      assert.equal(fs.readFileSync(targetFile, 'utf8'), 'precious data');
    });

    test('rejects deletion when approval token was issued for a different file', async () => {
      fs.writeFileSync(path.join(testDir, 'fileA.txt'), 'content A', 'utf8');
      fs.writeFileSync(path.join(testDir, 'fileB.txt'), 'content B', 'utf8');

      const prepA = await deleteFileTool.prepareApproval({ path: 'fileA.txt' });
      const { token } = approvalManager.createApproval({
        toolName: 'delete_file',
        operationType: 'delete',
        workspaceIdentity: workspaceManager.getIdentity(),
        targetPaths: prepA.targetPaths,
        payloadDigest: prepA.payloadDigest,
        parameters: { path: 'fileA.txt' },
        preview: prepA.preview
      });

      // Attempt to execute deletion of fileB using fileA's token
      const res = await deleteFileTool.execute({ path: 'fileB.txt' }, { toolCallId: 'call_tamper', approvalToken: token });
      assert.equal(res.success, false);
      assert.match(res.error, /not found in approved target paths/);
      assert.equal(fs.existsSync(path.join(testDir, 'fileB.txt')), true);
    });

    test('rejects deletion when file content was tampered after approval', async () => {
      const filePath = path.join(testDir, 'tamper.txt');
      fs.writeFileSync(filePath, 'original content', 'utf8');

      const prep = await deleteFileTool.prepareApproval({ path: 'tamper.txt' });
      const { token } = approvalManager.createApproval({
        toolName: 'delete_file',
        operationType: 'delete',
        workspaceIdentity: workspaceManager.getIdentity(),
        targetPaths: prep.targetPaths,
        payloadDigest: prep.payloadDigest,
        parameters: { path: 'tamper.txt' },
        preview: prep.preview
      });

      // Modify file behind the agent's back
      fs.writeFileSync(filePath, 'tampered content', 'utf8');

      const res = await deleteFileTool.execute({ path: 'tamper.txt' }, { toolCallId: 'call_tamper2', approvalToken: token });
      assert.equal(res.success, false);
      assert.match(res.error, /does not match current target file fingerprint/);
      assert.equal(fs.existsSync(filePath), true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Safe Relocation: move_file
  // ──────────────────────────────────────────────────────────────────────────
  describe('move_file Tool Requirements & Invariants', () => {
    test('successfully relocates a regular file to a new path', async () => {
      const src = path.join(testDir, 'source.txt');
      const dst = path.join(testDir, 'dest.txt');
      fs.writeFileSync(src, 'relocate me', 'utf8');

      const prep = await moveFileTool.prepareApproval({ source_path: 'source.txt', destination_path: 'dest.txt' });
      assert.equal(prep.operationType, 'move');
      assert.equal(prep.targetPaths.length, 2);
      assert.equal(prep.targetPaths[0].workspaceRelative, 'source.txt');
      assert.equal(prep.targetPaths[1].workspaceRelative, 'dest.txt');

      const { token } = approvalManager.createApproval({
        toolName: 'move_file',
        operationType: 'move',
        workspaceIdentity: workspaceManager.getIdentity(),
        targetPaths: prep.targetPaths,
        payloadDigest: prep.payloadDigest,
        parameters: { source_path: 'source.txt', destination_path: 'dest.txt' },
        preview: prep.preview
      });

      const res = await moveFileTool.execute(
        { source_path: 'source.txt', destination_path: 'dest.txt' },
        { toolCallId: 'call_m1', approvalToken: token }
      );
      assert.equal(res.success, true);
      assert.equal(res.data.type, 'file');
      assert.equal(fs.existsSync(src), false);
      assert.equal(fs.existsSync(dst), true);
      assert.equal(fs.readFileSync(dst, 'utf8'), 'relocate me');
    });

    test('supports source and destination alias parameters', async () => {
      const src = path.join(testDir, 'alias_src.txt');
      const dst = path.join(testDir, 'alias_dst.txt');
      fs.writeFileSync(src, 'alias content', 'utf8');

      const prep = await moveFileTool.prepareApproval({ source: 'alias_src.txt', destination: 'alias_dst.txt' });
      const { token } = approvalManager.createApproval({
        toolName: 'move_file',
        operationType: 'move',
        workspaceIdentity: workspaceManager.getIdentity(),
        targetPaths: prep.targetPaths,
        payloadDigest: prep.payloadDigest,
        parameters: { source: 'alias_src.txt', destination: 'alias_dst.txt' },
        preview: prep.preview
      });

      const res = await moveFileTool.execute(
        { source: 'alias_src.txt', destination: 'alias_dst.txt' },
        { toolCallId: 'call_alias', approvalToken: token }
      );
      assert.equal(res.success, true);
      assert.equal(fs.existsSync(src), false);
      assert.equal(fs.existsSync(dst), true);
    });

    test('successfully relocates a directory to a new location', async () => {
      const srcDir = path.join(testDir, 'folderA');
      const dstDir = path.join(testDir, 'folderB');
      fs.mkdirSync(srcDir);
      fs.writeFileSync(path.join(srcDir, 'data.json'), '{"ok":true}', 'utf8');

      const prep = await moveFileTool.prepareApproval({ source_path: 'folderA', destination_path: 'folderB' });
      assert.equal(prep.operationType, 'move');

      const { token } = approvalManager.createApproval({
        toolName: 'move_file',
        operationType: 'move',
        workspaceIdentity: workspaceManager.getIdentity(),
        targetPaths: prep.targetPaths,
        payloadDigest: prep.payloadDigest,
        parameters: { source_path: 'folderA', destination_path: 'folderB' },
        preview: prep.preview
      });

      const res = await moveFileTool.execute(
        { source_path: 'folderA', destination_path: 'folderB' },
        { toolCallId: 'call_m_dir', approvalToken: token }
      );
      assert.equal(res.success, true);
      assert.equal(res.data.type, 'directory');
      assert.equal(fs.existsSync(srcDir), false);
      assert.equal(fs.existsSync(dstDir), true);
      assert.equal(fs.readFileSync(path.join(dstDir, 'data.json'), 'utf8'), '{"ok":true}');
    });

    test('STRICTLY PROHIBITS moving a directory into a descendant of itself', async () => {
      const parentDir = path.join(testDir, 'parent');
      const subDir = path.join(parentDir, 'sub');
      fs.mkdirSync(parentDir);
      fs.mkdirSync(subDir);

      await assert.rejects(
        async () => {
          await moveFileTool.prepareApproval({
            source_path: 'parent',
            destination_path: 'parent/sub/nested'
          });
        },
        {
          name: 'SecurityError',
          message: /Cannot move directory into itself or a subdirectory of itself/
        }
      );

      await assert.rejects(
        async () => {
          await workspaceManager.moveEntry(parentDir, path.join(subDir, 'nested'));
        },
        {
          name: 'SecurityError',
          message: /Cannot move directory into itself or a subdirectory of itself/
        }
      );
    });

    test('STRICTLY PROHIBITS workspace root as source or destination', async () => {
      await assert.rejects(
        async () => {
          await moveFileTool.prepareApproval({ source_path: '.', destination_path: 'somewhere' });
        },
        {
          name: 'SecurityError',
          message: /Cannot move workspace root directory/
        }
      );

      await assert.rejects(
        async () => {
          await moveFileTool.prepareApproval({ source_path: 'file.txt', destination_path: '.' });
        },
        {
          name: 'SecurityError',
          message: /Cannot overwrite workspace root directory/
        }
      );
    });

    test('rejects move when destination already exists and overwrite is false', async () => {
      fs.writeFileSync(path.join(testDir, 'src_file.txt'), 'source', 'utf8');
      fs.writeFileSync(path.join(testDir, 'existing.txt'), 'already here', 'utf8');

      await assert.rejects(
        async () => {
          await moveFileTool.prepareApproval({
            source_path: 'src_file.txt',
            destination_path: 'existing.txt',
            overwrite: false
          });
        },
        {
          name: 'ToolError',
          message: /Destination already exists/
        }
      );

      // Verify workspaceManager directly also rejects
      await assert.rejects(
        async () => {
          await workspaceManager.moveEntry(
            path.join(testDir, 'src_file.txt'),
            path.join(testDir, 'existing.txt'),
            { overwrite: false }
          );
        },
        {
          name: 'ToolError',
          message: /Destination already exists/
        }
      );
    });

    test('allows replacing destination file when overwrite is explicitly true', async () => {
      fs.writeFileSync(path.join(testDir, 'source_ow.txt'), 'new replacement', 'utf8');
      fs.writeFileSync(path.join(testDir, 'target_ow.txt'), 'old to replace', 'utf8');

      const prep = await moveFileTool.prepareApproval({
        source_path: 'source_ow.txt',
        destination_path: 'target_ow.txt',
        overwrite: true
      });
      assert.match(prep.preview, /\[overwrite: true\]/);

      const { token } = approvalManager.createApproval({
        toolName: 'move_file',
        operationType: 'move',
        workspaceIdentity: workspaceManager.getIdentity(),
        targetPaths: prep.targetPaths,
        payloadDigest: prep.payloadDigest,
        parameters: { source_path: 'source_ow.txt', destination_path: 'target_ow.txt', overwrite: true },
        preview: prep.preview
      });

      const res = await moveFileTool.execute(
        { source_path: 'source_ow.txt', destination_path: 'target_ow.txt', overwrite: true },
        { toolCallId: 'call_ow', approvalToken: token }
      );
      assert.equal(res.success, true);
      assert.equal(fs.existsSync(path.join(testDir, 'source_ow.txt')), false);
      assert.equal(fs.readFileSync(path.join(testDir, 'target_ow.txt'), 'utf8'), 'new replacement');
    });

    test('rejects overwriting a directory with a file even if overwrite is true', async () => {
      fs.writeFileSync(path.join(testDir, 'file.txt'), 'data', 'utf8');
      fs.mkdirSync(path.join(testDir, 'existing_dir'));

      await assert.rejects(
        async () => {
          await moveFileTool.prepareApproval({
            source_path: 'file.txt',
            destination_path: 'existing_dir',
            overwrite: true
          });
        },
        {
          name: 'SecurityError',
          message: /Cannot overwrite directory with file/
        }
      );
    });

    test('rejects move when sensitive files are targeted', async () => {
      fs.writeFileSync(path.join(testDir, 'normal.txt'), 'normal', 'utf8');
      fs.writeFileSync(path.join(testDir, '.env'), 'SECRET=123', 'utf8');

      // Moving sensitive file as source
      await assert.rejects(
        async () => {
          await moveFileTool.prepareApproval({ source_path: '.env', destination_path: 'env.bak' });
        },
        {
          name: 'SecurityError',
          message: /sensitive file/
        }
      );

      // Moving file into sensitive name as destination
      await assert.rejects(
        async () => {
          await moveFileTool.prepareApproval({ source_path: 'normal.txt', destination_path: '.env.local' });
        },
        {
          name: 'SecurityError',
          message: /sensitive file/
        }
      );
    });

    test('rejects move when approval destination does not match actual destination', async () => {
      fs.writeFileSync(path.join(testDir, 'original.txt'), 'content', 'utf8');

      const prep = await moveFileTool.prepareApproval({
        source_path: 'original.txt',
        destination_path: 'intended_dest.txt'
      });

      const { token } = approvalManager.createApproval({
        toolName: 'move_file',
        operationType: 'move',
        workspaceIdentity: workspaceManager.getIdentity(),
        targetPaths: prep.targetPaths,
        payloadDigest: prep.payloadDigest,
        parameters: { source_path: 'original.txt', destination_path: 'intended_dest.txt' },
        preview: prep.preview
      });

      // Tamper: try to redirect to hijacked_dest.txt
      const res = await moveFileTool.execute(
        { source_path: 'original.txt', destination_path: 'hijacked_dest.txt' },
        { toolCallId: 'call_hijack', approvalToken: token }
      );
      assert.equal(res.success, false);
      assert.match(res.error, /destination path '.*hijacked_dest.txt' not found in approved target paths/);
      assert.equal(fs.existsSync(path.join(testDir, 'hijacked_dest.txt')), false);
      assert.equal(fs.existsSync(path.join(testDir, 'original.txt')), true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. ToolExecutor & Policy Integration
  // ──────────────────────────────────────────────────────────────────────────
  describe('ToolExecutor Integration with Strict and Auto Policies', () => {
    let registry;
    let executor;

    beforeEach(() => {
      registry = new ToolRegistry();
      registry.register(deleteFileTool);
      registry.register(moveFileTool);
    });

    test('StrictApprovalPolicy requires interactive approval for delete_file and move_file', async () => {
      const strictPolicy = new StrictApprovalPolicy(['read_only']);
      executor = new ToolExecutor(registry, strictPolicy, new ExecutionPolicy(), approvalManager, workspaceManager);

      fs.writeFileSync(path.join(testDir, 'strict_test.txt'), 'protected', 'utf8');

      // delete_file without approval must be denied
      const delRes = await executor.execute({
        id: 'call_strict_del',
        type: 'function',
        function: {
          name: 'delete_file',
          arguments: JSON.stringify({ path: 'strict_test.txt' })
        }
      });
      assert.equal(delRes.success, false);
      assert.match(delRes.error, /denied by policy|requires permission 'file_delete'/);
      assert.equal(fs.existsSync(path.join(testDir, 'strict_test.txt')), true);

      // move_file without approval must be denied
      const moveRes = await executor.execute({
        id: 'call_strict_move',
        type: 'function',
        function: {
          name: 'move_file',
          arguments: JSON.stringify({ source_path: 'strict_test.txt', destination_path: 'moved.txt' })
        }
      });
      assert.equal(moveRes.success, false);
      assert.match(moveRes.error, /denied by policy|requires permission 'file_create'/);
    });

    test('AutoApprovalPolicy executes delete_file when permissions are granted', async () => {
      const autoPolicy = new AutoApprovalPolicy(['read_only', 'file_delete']);
      executor = new ToolExecutor(registry, autoPolicy, new ExecutionPolicy(), approvalManager, workspaceManager);

      fs.writeFileSync(path.join(testDir, 'auto_del.txt'), 'auto delete me', 'utf8');

      const res = await executor.execute({
        id: 'call_auto_del',
        type: 'function',
        function: {
          name: 'delete_file',
          arguments: JSON.stringify({ path: 'auto_del.txt' })
        }
      });

      assert.equal(res.success, true);
      assert.equal(fs.existsSync(path.join(testDir, 'auto_del.txt')), false);
    });

    test('AutoApprovalPolicy executes move_file when permissions are granted', async () => {
      const autoPolicy = new AutoApprovalPolicy(['read_only', 'file_create', 'file_modify', 'file_delete']);
      executor = new ToolExecutor(registry, autoPolicy, new ExecutionPolicy(), approvalManager, workspaceManager);

      fs.writeFileSync(path.join(testDir, 'auto_move_src.txt'), 'moving with auto policy', 'utf8');

      const res = await executor.execute({
        id: 'call_auto_move',
        type: 'function',
        function: {
          name: 'move_file',
          arguments: JSON.stringify({ source_path: 'auto_move_src.txt', destination_path: 'auto_move_dst.txt' })
        }
      });

      assert.equal(res.success, true);
      assert.equal(fs.existsSync(path.join(testDir, 'auto_move_src.txt')), false);
      assert.equal(fs.readFileSync(path.join(testDir, 'auto_move_dst.txt'), 'utf8'), 'moving with auto policy');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. Recursive Temp File Sweep (SEC-AUD-01)
  // ──────────────────────────────────────────────────────────────────────────
  describe('WorkspaceManager Recursive Temp File Sweep', () => {
    test('cleans stale temporary files recursively in nested subdirectories', () => {
      const subDir = path.join(testDir, 'deep', 'nested', 'dir');
      fs.mkdirSync(subDir, { recursive: true });

      const staleTemp1 = path.join(testDir, '.root_file.lemo_tmp_1234');
      const staleTemp2 = path.join(subDir, '.deep_file.lemo_tmp_5678');
      const regularFile = path.join(subDir, 'regular.txt');

      fs.writeFileSync(staleTemp1, 'stale1', 'utf8');
      fs.writeFileSync(staleTemp2, 'stale2', 'utf8');
      fs.writeFileSync(regularFile, 'regular', 'utf8');

      // Artificially age the temp files
      const twoHoursAgo = new Date(Date.now() - 7_200_000);
      fs.utimesSync(staleTemp1, twoHoursAgo, twoHoursAgo);
      fs.utimesSync(staleTemp2, twoHoursAgo, twoHoursAgo);

      // Sweep stale files older than 1 hour (3_600_000 ms)
      workspaceManager.cleanStaleTempFiles(3_600_000);

      assert.equal(fs.existsSync(staleTemp1), false);
      assert.equal(fs.existsSync(staleTemp2), false);
      assert.equal(fs.existsSync(regularFile), true);
    });
  });
});
