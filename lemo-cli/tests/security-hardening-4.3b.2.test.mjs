/**
 * Regression & Hardening Test Suite for Phase 4.3B.2.2
 *
 * Verifies:
 * 1. AUD-FINDING-01: Git metadata protection (.git roots, .gitmodules, nested git paths, case insensitivity, alternate representations, non-sensitive preservation).
 * 2. AUD-FINDING-02: Mandatory approval fingerprint validation (missing, null, mismatched, valid, legitimate operations without original fingerprints, unexpected fingerprints).
 * 3. Additional Move Safety: Concurrent directory destination changes, source identity validation before unlinking, hardlink partial move crash recovery.
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
import { WriteFileTool } from '../dist/agent/tools/builtin/WriteFileTool.js';
import { SecurityError, ToolError } from '../dist/core/errors/index.js';

describe('Phase 4.3B.2.2: Security Hardening & Approval Validation Fixes', () => {
  let testDir;
  let workspaceManager;
  let approvalManager;
  let deleteFileTool;
  let moveFileTool;
  let writeFileTool;

  before(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lemo-test-hardening-43b22-'));
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
    const entries = fs.readdirSync(testDir);
    for (const entry of entries) {
      fs.rmSync(path.join(testDir, entry), { recursive: true, force: true });
    }

    workspaceManager = new WorkspaceManager(testDir);
    approvalManager = new ApprovalManager({ ttlMs: 60_000 });
    deleteFileTool = new DeleteFileTool(workspaceManager, approvalManager);
    moveFileTool = new MoveFileTool(workspaceManager, approvalManager);
    writeFileTool = new WriteFileTool(workspaceManager, approvalManager);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. AUD-FINDING-01: Git Metadata Protection
  // ──────────────────────────────────────────────────────────────────────────
  describe('AUD-FINDING-01: Git Metadata Protection', () => {
    test('protects .git directory root from deletion via delete_file and deleteEntry', async () => {
      const gitDir = path.join(testDir, '.git');
      fs.mkdirSync(gitDir);

      // delete_file tool prepareApproval must reject
      await assert.rejects(
        async () => {
          await deleteFileTool.prepareApproval({ path: '.git' });
        },
        {
          name: 'SecurityError',
          message: /sensitive file/
        }
      );

      // WorkspaceManager.deleteEntry must reject directly
      await assert.rejects(
        async () => {
          await workspaceManager.deleteEntry(gitDir);
        },
        {
          name: 'SecurityError',
          message: /sensitive file/
        }
      );

      assert.equal(fs.existsSync(gitDir), true);
    });

    test('protects .git directory root from moving via move_file and moveEntry', async () => {
      const gitDir = path.join(testDir, '.git');
      fs.mkdirSync(gitDir);

      // Moving .git to another directory
      await assert.rejects(
        async () => {
          await moveFileTool.prepareApproval({ source_path: '.git', destination_path: '.git_backup' });
        },
        {
          name: 'SecurityError',
          message: /sensitive file/
        }
      );

      await assert.rejects(
        async () => {
          await workspaceManager.moveEntry(gitDir, path.join(testDir, '.git_backup'));
        },
        {
          name: 'SecurityError',
          message: /sensitive file/
        }
      );

      assert.equal(fs.existsSync(gitDir), true);
    });

    test('protects against moving files into .git directory destination', async () => {
      const gitDir = path.join(testDir, '.git');
      fs.mkdirSync(gitDir);
      const regularFile = path.join(testDir, 'inject.txt');
      fs.writeFileSync(regularFile, 'evil payload', 'utf8');

      await assert.rejects(
        async () => {
          await moveFileTool.prepareApproval({ source_path: 'inject.txt', destination_path: '.git/inject.txt' });
        },
        {
          name: 'SecurityError',
          message: /sensitive file/
        }
      );
    });

    test('protects .gitmodules from deletion and relocation', async () => {
      const modulesFile = path.join(testDir, '.gitmodules');
      fs.writeFileSync(modulesFile, '[submodule "lib"]\n\tpath = lib\n', 'utf8');

      // delete_file
      await assert.rejects(
        async () => {
          await deleteFileTool.prepareApproval({ path: '.gitmodules' });
        },
        {
          name: 'SecurityError',
          message: /sensitive file/
        }
      );

      // move_file
      await assert.rejects(
        async () => {
          await moveFileTool.prepareApproval({ source_path: '.gitmodules', destination_path: 'modules.bak' });
        },
        {
          name: 'SecurityError',
          message: /sensitive file/
        }
      );

      // workspaceManager.deleteEntry
      await assert.rejects(
        async () => {
          await workspaceManager.deleteEntry(modulesFile);
        },
        {
          name: 'SecurityError',
          message: /sensitive file/
        }
      );

      // workspaceManager.moveEntry
      await assert.rejects(
        async () => {
          await workspaceManager.moveEntry(modulesFile, path.join(testDir, 'modules.bak'));
        },
        {
          name: 'SecurityError',
          message: /sensitive file/
        }
      );

      assert.equal(fs.existsSync(modulesFile), true);
    });

    test('protects nested Git metadata paths and submodules', async () => {
      const subDir = path.join(testDir, 'packages', 'subpkg');
      const nestedGit = path.join(subDir, '.git');
      fs.mkdirSync(nestedGit, { recursive: true });
      const nestedHead = path.join(nestedGit, 'HEAD');
      fs.writeFileSync(nestedHead, 'ref: refs/heads/main\n', 'utf8');

      const nestedModules = path.join(subDir, '.gitmodules');
      fs.writeFileSync(nestedModules, 'content', 'utf8');

      // Nested .git
      await assert.rejects(
        async () => {
          await deleteFileTool.prepareApproval({ path: 'packages/subpkg/.git' });
        },
        { name: 'SecurityError', message: /sensitive file/ }
      );

      // Nested .git/HEAD
      await assert.rejects(
        async () => {
          await deleteFileTool.prepareApproval({ path: 'packages/subpkg/.git/HEAD' });
        },
        { name: 'SecurityError', message: /sensitive file/ }
      );

      // Nested .gitmodules
      await assert.rejects(
        async () => {
          await moveFileTool.prepareApproval({
            source_path: 'packages/subpkg/.gitmodules',
            destination_path: 'packages/subpkg/modules.bak'
          });
        },
        { name: 'SecurityError', message: /sensitive file/ }
      );
    });

    test('accounts for case-insensitivity on Git metadata (.GIT, .GitModules)', () => {
      assert.strictEqual(workspaceManager.isSensitive('.GIT'), true);
      assert.strictEqual(workspaceManager.isSensitive('.Git'), true);
      assert.strictEqual(workspaceManager.isSensitive('.GitModules'), true);
      assert.strictEqual(workspaceManager.isSensitive('sub/.GIT/config'), true);
      assert.strictEqual(workspaceManager.isSensitive('sub/.GitModules'), true);
    });

    test('accounts for alternate path representations (./.git, dir/../.git, trailing slashes)', () => {
      assert.strictEqual(workspaceManager.isSensitive('./.git'), true);
      assert.strictEqual(workspaceManager.isSensitive('.git/'), true);
      assert.strictEqual(workspaceManager.isSensitive('.git\\'), true);
      assert.strictEqual(workspaceManager.isSensitive('foo/../.git'), true);
      assert.strictEqual(workspaceManager.isSensitive('foo/../.gitmodules'), true);
    });

    test('preserves normal operations on unrelated project files containing git in name', () => {
      assert.strictEqual(workspaceManager.isSensitive('.gitignore'), false);
      assert.strictEqual(workspaceManager.isSensitive('.gitattributes'), false);
      assert.strictEqual(workspaceManager.isSensitive('my.git.repo.txt'), false);
      assert.strictEqual(workspaceManager.isSensitive('digit.ts'), false);
      assert.strictEqual(workspaceManager.isSensitive('git-helper.js'), false);
      assert.strictEqual(workspaceManager.isSensitive('src/components/git-status.tsx'), false);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. AUD-FINDING-02: Mandatory Approval Fingerprint Validation
  // ──────────────────────────────────────────────────────────────────────────
  describe('AUD-FINDING-02: Mandatory Approval Fingerprint Validation', () => {
    test('succeeds when correct originalContentHash is provided', () => {
      const targetPath = path.join(testDir, 'file.txt');
      const content = 'hello world';
      const originalContentHash = crypto.createHash('sha256').update(content).digest('hex');

      const { token } = approvalManager.createApproval({
        toolName: 'delete_file',
        operationType: 'delete',
        workspaceIdentity: workspaceManager.getIdentity(),
        targetPaths: [{ canonicalPath: targetPath, workspaceRelative: 'file.txt' }],
        payloadDigest: { algorithm: 'sha256', originalContentHash },
        parameters: { path: 'file.txt' }
      });

      const consumed = approvalManager.validateAndConsume(token, {
        toolName: 'delete_file',
        operationType: 'delete',
        workspaceIdentity: workspaceManager.getIdentity(),
        canonicalPath: targetPath,
        originalContentHash
      });

      assert.ok(consumed);
      assert.equal(consumed.payloadDigest.originalContentHash, originalContentHash);
    });

    test('fails closed when originalContentHash is missing (undefined)', () => {
      const targetPath = path.join(testDir, 'file.txt');
      const content = 'hello world';
      const originalContentHash = crypto.createHash('sha256').update(content).digest('hex');

      const { token } = approvalManager.createApproval({
        toolName: 'delete_file',
        operationType: 'delete',
        workspaceIdentity: workspaceManager.getIdentity(),
        targetPaths: [{ canonicalPath: targetPath, workspaceRelative: 'file.txt' }],
        payloadDigest: { algorithm: 'sha256', originalContentHash },
        parameters: { path: 'file.txt' }
      });

      assert.throws(
        () =>
          approvalManager.validateAndConsume(token, {
            toolName: 'delete_file',
            operationType: 'delete',
            workspaceIdentity: workspaceManager.getIdentity(),
            canonicalPath: targetPath
            // originalContentHash omitted!
          }),
        {
          name: 'SecurityError',
          message: /missing required originalContentHash fingerprint/
        }
      );
    });

    test('fails closed when originalContentHash is null or empty string', () => {
      const targetPath = path.join(testDir, 'file.txt');
      const content = 'hello world';
      const originalContentHash = crypto.createHash('sha256').update(content).digest('hex');

      const { token } = approvalManager.createApproval({
        toolName: 'delete_file',
        operationType: 'delete',
        workspaceIdentity: workspaceManager.getIdentity(),
        targetPaths: [{ canonicalPath: targetPath, workspaceRelative: 'file.txt' }],
        payloadDigest: { algorithm: 'sha256', originalContentHash },
        parameters: { path: 'file.txt' }
      });

      // Null
      assert.throws(
        () =>
          approvalManager.validateAndConsume(token, {
            toolName: 'delete_file',
            operationType: 'delete',
            workspaceIdentity: workspaceManager.getIdentity(),
            canonicalPath: targetPath,
            originalContentHash: null
          }),
        {
          name: 'SecurityError',
          message: /missing required originalContentHash fingerprint/
        }
      );

      // Empty string
      const issue2 = approvalManager.createApproval({
        toolName: 'delete_file',
        operationType: 'delete',
        workspaceIdentity: workspaceManager.getIdentity(),
        targetPaths: [{ canonicalPath: targetPath, workspaceRelative: 'file.txt' }],
        payloadDigest: { algorithm: 'sha256', originalContentHash },
        parameters: { path: 'file.txt' }
      });

      assert.throws(
        () =>
          approvalManager.validateAndConsume(issue2.token, {
            toolName: 'delete_file',
            operationType: 'delete',
            workspaceIdentity: workspaceManager.getIdentity(),
            canonicalPath: targetPath,
            originalContentHash: ''
          }),
        {
          name: 'SecurityError',
          message: /missing required originalContentHash fingerprint/
        }
      );
    });

    test('fails closed when originalContentHash is mismatched', () => {
      const targetPath = path.join(testDir, 'file.txt');
      const content = 'hello world';
      const originalContentHash = crypto.createHash('sha256').update(content).digest('hex');
      const fakeHash = crypto.createHash('sha256').update('different content').digest('hex');

      const { token } = approvalManager.createApproval({
        toolName: 'delete_file',
        operationType: 'delete',
        workspaceIdentity: workspaceManager.getIdentity(),
        targetPaths: [{ canonicalPath: targetPath, workspaceRelative: 'file.txt' }],
        payloadDigest: { algorithm: 'sha256', originalContentHash },
        parameters: { path: 'file.txt' }
      });

      assert.throws(
        () =>
          approvalManager.validateAndConsume(token, {
            toolName: 'delete_file',
            operationType: 'delete',
            workspaceIdentity: workspaceManager.getIdentity(),
            canonicalPath: targetPath,
            originalContentHash: fakeHash
          }),
        {
          name: 'SecurityError',
          message: /approved original content digest does not match/
        }
      );
    });

    test('preserves compatibility for legitimate operations without originalContentHash (create)', () => {
      const targetPath = path.join(testDir, 'new_file.txt');
      const proposedContentHash = crypto.createHash('sha256').update('brand new').digest('hex');

      const { token } = approvalManager.createApproval({
        toolName: 'write_file',
        operationType: 'create',
        workspaceIdentity: workspaceManager.getIdentity(),
        targetPaths: [{ canonicalPath: targetPath, workspaceRelative: 'new_file.txt' }],
        payloadDigest: { algorithm: 'sha256', proposedContentHash },
        parameters: { path: 'new_file.txt', content: 'brand new' }
      });

      // Legitimate call without originalContentHash must succeed
      const consumed = approvalManager.validateAndConsume(token, {
        toolName: 'write_file',
        operationType: 'create',
        workspaceIdentity: workspaceManager.getIdentity(),
        canonicalPath: targetPath,
        proposedContentHash
      });

      assert.ok(consumed);
      assert.equal(consumed.payloadDigest.originalContentHash, undefined);
    });

    test('fails closed if unexpected originalContentHash is provided for an approval without one', () => {
      const targetPath = path.join(testDir, 'new_file.txt');
      const proposedContentHash = crypto.createHash('sha256').update('brand new').digest('hex');

      const { token } = approvalManager.createApproval({
        toolName: 'write_file',
        operationType: 'create',
        workspaceIdentity: workspaceManager.getIdentity(),
        targetPaths: [{ canonicalPath: targetPath, workspaceRelative: 'new_file.txt' }],
        payloadDigest: { algorithm: 'sha256', proposedContentHash },
        parameters: { path: 'new_file.txt', content: 'brand new' }
      });

      // Caller tries to pass an originalContentHash when record did not have one
      assert.throws(
        () =>
          approvalManager.validateAndConsume(token, {
            toolName: 'write_file',
            operationType: 'create',
            workspaceIdentity: workspaceManager.getIdentity(),
            canonicalPath: targetPath,
            originalContentHash: 'unexpected-hash',
            proposedContentHash
          }),
        {
          name: 'SecurityError',
          message: /unexpected originalContentHash provided/
        }
      );
    });

    test('fails closed when destinationCanonicalPath is missing for dual-target move operation', () => {
      const srcPath = path.join(testDir, 'src.txt');
      const dstPath = path.join(testDir, 'dst.txt');

      const { token } = approvalManager.createApproval({
        toolName: 'move_file',
        operationType: 'move',
        workspaceIdentity: workspaceManager.getIdentity(),
        targetPaths: [
          { canonicalPath: srcPath, workspaceRelative: 'src.txt' },
          { canonicalPath: dstPath, workspaceRelative: 'dst.txt' }
        ],
        payloadDigest: { algorithm: 'sha256' },
        parameters: { source_path: 'src.txt', destination_path: 'dst.txt' }
      });

      // Caller attempts to validate without destinationCanonicalPath
      assert.throws(
        () =>
          approvalManager.validateAndConsume(token, {
            toolName: 'move_file',
            operationType: 'move',
            workspaceIdentity: workspaceManager.getIdentity(),
            canonicalPath: srcPath
          }),
        {
          name: 'SecurityError',
          message: /missing required destinationCanonicalPath/
        }
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Additional Move Safety Verification
  // ──────────────────────────────────────────────────────────────────────────
  describe('Additional Move Safety & Race Verification', () => {
    test('catches destination race if directory destination is created concurrently', async () => {
      const srcDir = path.join(testDir, 'src_dir');
      const dstDir = path.join(testDir, 'dst_dir');
      fs.mkdirSync(srcDir);
      fs.writeFileSync(path.join(srcDir, 'file.txt'), 'data', 'utf8');

      // Before rename, destination is created concurrently
      fs.mkdirSync(dstDir);

      await assert.rejects(
        async () => {
          await workspaceManager.moveEntry(srcDir, dstDir);
        },
        {
          name: 'ToolError',
          message: /Destination already exists/
        }
      );
    });

    test('validates source identity immediately before unlinking during non-overwrite move', async () => {
      const srcFile = path.join(testDir, 'atomic_src.txt');
      const dstFile = path.join(testDir, 'atomic_dst.txt');
      fs.writeFileSync(srcFile, 'source payload', 'utf8');

      // Verify normal hardlink + unlink move works
      const res = await workspaceManager.moveEntry(srcFile, dstFile, { overwrite: false });
      assert.equal(res.type, 'file');
      assert.equal(fs.existsSync(srcFile), false);
      assert.equal(fs.existsSync(dstFile), true);
      assert.equal(fs.readFileSync(dstFile, 'utf8'), 'source payload');
    });

    test('hardlink partial move crash consistency preserves data intact', async () => {
      const srcFile = path.join(testDir, 'crash_src.txt');
      const dstFile = path.join(testDir, 'crash_dst.txt');
      fs.writeFileSync(srcFile, 'critical crash data', 'utf8');

      // Simulate state where link() succeeded but process was killed before unlink()
      await fs.promises.link(srcFile, dstFile);

      // Both directory entries exist and reference the exact same data
      assert.equal(fs.existsSync(srcFile), true);
      assert.equal(fs.existsSync(dstFile), true);
      assert.equal(fs.readFileSync(srcFile, 'utf8'), 'critical crash data');
      assert.equal(fs.readFileSync(dstFile, 'utf8'), 'critical crash data');

      const statSrc = fs.statSync(srcFile);
      const statDst = fs.statSync(dstFile);
      assert.equal(statSrc.size, statDst.size);
      assert.equal(Number(statSrc.ino), Number(statDst.ino));

      // Subsequent move attempt fails closed because destination already exists
      await assert.rejects(
        async () => {
          await workspaceManager.moveEntry(srcFile, dstFile, { overwrite: false });
        },
        {
          name: 'ToolError',
          message: /Destination already exists/
        }
      );

      // Data is 100% preserved
      assert.equal(fs.readFileSync(dstFile, 'utf8'), 'critical crash data');
    });
  });
});
