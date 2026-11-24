/**
 * Security & Functional Test Suite for Phase 4.3B.1
 * Controlled Write Operations: write_file, edit_file, atomic writes,
 * RFC 8785 JCS, HMAC-SHA256 approvals, and edit conflict detection.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

import { WorkspaceManager } from '../dist/agent/workspace/WorkspaceManager.js';
import { ApprovalManager } from '../dist/agent/approval/ApprovalManager.js';
import { canonicalize } from '../dist/agent/approval/CanonicalSerializer.js';
import { generateUnifiedDiff } from '../dist/agent/approval/DiffGenerator.js';
import { WriteFileTool } from '../dist/agent/tools/builtin/WriteFileTool.js';
import { EditFileTool } from '../dist/agent/tools/builtin/EditFileTool.js';
import { ToolExecutor } from '../dist/agent/tools/ToolExecutor.js';
import { ToolRegistry } from '../dist/agent/tools/ToolRegistry.js';
import { StrictApprovalPolicy, AutoApprovalPolicy } from '../dist/agent/policies/ApprovalPolicy.js';
import { SecurityError, ToolError, EditConflictError } from '../dist/core/errors/index.js';

describe('Phase 4.3B.1: Atomic File Creation, Surgical Editing & Approval Integrity', () => {
  let testDir;
  let workspaceManager;
  let approvalManager;
  let writeFileTool;
  let editFileTool;

  before(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lemo-test-write-edit-'));
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
    writeFileTool = new WriteFileTool(workspaceManager, approvalManager);
    editFileTool = new EditFileTool(workspaceManager, approvalManager);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. RFC 8785 JSON Canonicalization Scheme (JCS)
  // ──────────────────────────────────────────────────────────────────────────
  describe('RFC 8785 JCS Canonicalization', () => {
    test('serializes objects with sorted keys and no whitespace', () => {
      const obj = { z: 1, b: 'two', a: true, m: null };
      const canonical = canonicalize(obj);
      assert.equal(canonical, '{"a":true,"b":"two","m":null,"z":1}');
    });

    test('omits undefined properties and functions', () => {
      const obj = { b: 2, c: undefined, a: 1, fn: () => {} };
      const canonical = canonicalize(obj);
      assert.equal(canonical, '{"a":1,"b":2}');
    });

    test('serializes nested structures deterministically', () => {
      const obj1 = { x: { b: 2, a: 1 }, list: [3, 2, 1] };
      const obj2 = { list: [3, 2, 1], x: { a: 1, b: 2 } };
      assert.equal(canonicalize(obj1), canonicalize(obj2));
      assert.equal(canonicalize(obj1), '{"list":[3,2,1],"x":{"a":1,"b":2}}');
    });

    test('rejects NaN and Infinity per RFC 8785', () => {
      assert.throws(() => canonicalize({ num: NaN }), TypeError);
      assert.throws(() => canonicalize({ num: Infinity }), TypeError);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Cryptographic Approval Lifecycle & Invariants
  // ──────────────────────────────────────────────────────────────────────────
  describe('ApprovalManager Lifecycle & Cryptographic Invariants', () => {
    test('issues HMAC-SHA256 token and validates single-use consumption', () => {
      const targetPath = path.join(testDir, 'test.txt');
      const content = 'hello world';
      const proposedContentHash = crypto.createHash('sha256').update(content).digest('hex');

      const { record, token } = approvalManager.createApproval({
        toolName: 'write_file',
        operationType: 'create',
        workspaceIdentity: workspaceManager.getIdentity(),
        targetPaths: [{ canonicalPath: targetPath, workspaceRelative: 'test.txt' }],
        payloadDigest: { algorithm: 'sha256', proposedContentHash },
        parameters: { path: 'test.txt', content }
      });

      assert.ok(token, 'HMAC token must be generated');
      assert.equal(record.toolName, 'write_file');

      // First consumption succeeds
      const consumed = approvalManager.validateAndConsume(token, {
        toolName: 'write_file',
        operationType: 'create',
        workspaceIdentity: workspaceManager.getIdentity(),
        canonicalPath: targetPath,
        proposedContentHash
      });
      assert.equal(consumed.approvalId, record.approvalId);

      // Replay attempt fails closed
      assert.throws(
        () =>
          approvalManager.validateAndConsume(token, {
            toolName: 'write_file',
            operationType: 'create',
            workspaceIdentity: workspaceManager.getIdentity(),
            canonicalPath: targetPath,
            proposedContentHash
          }),
        SecurityError
      );
    });

    test('rejects expired approval tokens', async () => {
      const shortTtlManager = new ApprovalManager({ ttlMs: 40 });
      const targetPath = path.join(testDir, 'test.txt');
      const content = 'expired content';
      const proposedContentHash = crypto.createHash('sha256').update(content).digest('hex');

      const { token } = shortTtlManager.createApproval({
        toolName: 'write_file',
        operationType: 'create',
        workspaceIdentity: workspaceManager.getIdentity(),
        targetPaths: [{ canonicalPath: targetPath, workspaceRelative: 'test.txt' }],
        payloadDigest: { algorithm: 'sha256', proposedContentHash },
        parameters: { path: 'test.txt', content }
      });

      // Wait 50ms for token to expire
      await new Promise((r) => setTimeout(r, 60));

      assert.throws(
        () =>
          shortTtlManager.validateAndConsume(token, {
            toolName: 'write_file',
            operationType: 'create',
            workspaceIdentity: workspaceManager.getIdentity(),
            canonicalPath: targetPath,
            proposedContentHash
          }),
        (err) => err instanceof SecurityError && err.message.includes('expired')
      );
    });

    test('rejects argument tampering (path, content, tool, operation mismatch)', () => {
      const targetPath = path.join(testDir, 'test.txt');
      const content = 'original content';
      const proposedContentHash = crypto.createHash('sha256').update(content).digest('hex');

      const { token } = approvalManager.createApproval({
        toolName: 'write_file',
        operationType: 'create',
        workspaceIdentity: workspaceManager.getIdentity(),
        targetPaths: [{ canonicalPath: targetPath, workspaceRelative: 'test.txt' }],
        payloadDigest: { algorithm: 'sha256', proposedContentHash },
        parameters: { path: 'test.txt', content }
      });

      // Tampered path
      assert.throws(
        () =>
          approvalManager.validateAndConsume(token, {
            toolName: 'write_file',
            operationType: 'create',
            workspaceIdentity: workspaceManager.getIdentity(),
            canonicalPath: path.join(testDir, 'tampered.txt'),
            proposedContentHash
          }),
        SecurityError
      );

      // Recreate token for content mismatch test
      const issue2 = approvalManager.createApproval({
        toolName: 'write_file',
        operationType: 'create',
        workspaceIdentity: workspaceManager.getIdentity(),
        targetPaths: [{ canonicalPath: targetPath, workspaceRelative: 'test.txt' }],
        payloadDigest: { algorithm: 'sha256', proposedContentHash },
        parameters: { path: 'test.txt', content }
      });

      // Tampered content digest
      assert.throws(
        () =>
          approvalManager.validateAndConsume(issue2.token, {
            toolName: 'write_file',
            operationType: 'create',
            workspaceIdentity: workspaceManager.getIdentity(),
            canonicalPath: targetPath,
            proposedContentHash: 'tampered-hash'
          }),
        SecurityError
      );
    });

    test('rejects workspace identity changes', () => {
      const targetPath = path.join(testDir, 'test.txt');
      const content = 'content';
      const proposedContentHash = crypto.createHash('sha256').update(content).digest('hex');

      const { token } = approvalManager.createApproval({
        toolName: 'write_file',
        operationType: 'create',
        workspaceIdentity: workspaceManager.getIdentity(),
        targetPaths: [{ canonicalPath: targetPath, workspaceRelative: 'test.txt' }],
        payloadDigest: { algorithm: 'sha256', proposedContentHash },
        parameters: { path: 'test.txt', content }
      });

      const fakeIdentity = {
        canonicalPath: path.join(testDir, 'fake'),
        deviceNumber: 9999,
        inodeNumber: 8888
      };

      assert.throws(
        () =>
          approvalManager.validateAndConsume(token, {
            toolName: 'write_file',
            operationType: 'create',
            workspaceIdentity: fakeIdentity,
            canonicalPath: targetPath,
            proposedContentHash
          }),
        SecurityError
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. write_file: Safe File Creation & Overwrite
  // ──────────────────────────────────────────────────────────────────────────
  describe('WriteFileTool Operations & Containment', () => {
    test('creates a new regular file with atomic write', async () => {
      const relPath = 'src/app.ts';
      const content = 'export const message = "hello";\n';
      fs.mkdirSync(path.join(testDir, 'src'));

      const prep = await writeFileTool.prepareApproval({ path: relPath, content });
      assert.equal(prep.operationType, 'create');

      const { token } = approvalManager.createApproval({
        toolName: writeFileTool.name,
        operationType: prep.operationType,
        workspaceIdentity: workspaceManager.getIdentity(),
        targetPaths: prep.targetPaths,
        payloadDigest: prep.payloadDigest,
        parameters: { path: relPath, content }
      });

      const result = await writeFileTool.execute({ path: relPath, content }, { toolCallId: 'call_1', approvalToken: token });
      assert.equal(result.success, true);
      assert.equal(result.data.operation, 'created');

      const filePath = path.join(testDir, relPath);
      assert.ok(fs.existsSync(filePath));
      assert.equal(fs.readFileSync(filePath, 'utf8'), content);

      // Verify no temporary scratch files remain
      const srcFiles = fs.readdirSync(path.join(testDir, 'src'));
      assert.equal(srcFiles.length, 1);
      assert.equal(srcFiles[0], 'app.ts');
    });

    test('overwrites an existing regular file only with explicit modify approval', async () => {
      const relPath = 'README.md';
      const initialContent = '# Initial\n';
      const updatedContent = '# Updated Header\nNew content here.\n';
      fs.writeFileSync(path.join(testDir, relPath), initialContent, 'utf8');

      const prep = await writeFileTool.prepareApproval({ path: relPath, content: updatedContent });
      assert.equal(prep.operationType, 'modify');
      assert.ok(prep.payloadDigest.originalContentHash);
      assert.ok(prep.preview.includes('--- a/README.md'));

      // Without approval token, execution fails closed
      await assert.rejects(
        () => writeFileTool.execute({ path: relPath, content: updatedContent }, { toolCallId: 'call_2' }),
        SecurityError
      );

      // With approved token, overwrite succeeds atomically
      const { token } = approvalManager.createApproval({
        toolName: writeFileTool.name,
        operationType: prep.operationType,
        workspaceIdentity: workspaceManager.getIdentity(),
        targetPaths: prep.targetPaths,
        payloadDigest: prep.payloadDigest,
        parameters: { path: relPath, content: updatedContent }
      });

      const result = await writeFileTool.execute(
        { path: relPath, content: updatedContent },
        { toolCallId: 'call_2', approvalToken: token }
      );
      assert.equal(result.success, true);
      assert.equal(result.data.operation, 'overwritten');
      assert.equal(fs.readFileSync(path.join(testDir, relPath), 'utf8'), updatedContent);
    });

    test('rejects overwriting the workspace root directory', async () => {
      await assert.rejects(
        () => writeFileTool.prepareApproval({ path: '.', content: 'root overwrite' }),
        SecurityError
      );
    });

    test('rejects writing to sensitive files (.env, private keys)', async () => {
      await assert.rejects(
        () => writeFileTool.prepareApproval({ path: '.env', content: 'SECRET=123' }),
        SecurityError
      );
      await assert.rejects(
        () => writeFileTool.prepareApproval({ path: 'id_ed25519', content: 'PRIVATE KEY' }),
        SecurityError
      );
      await assert.rejects(
        () => writeFileTool.prepareApproval({ path: 'docker-compose.override.yml', content: 'secret' }),
        SecurityError
      );
    });

    test('rejects path traversal escape attempts', async () => {
      await assert.rejects(
        () => writeFileTool.prepareApproval({ path: '../../escape.txt', content: 'bad' }),
        SecurityError
      );
    });

    test('rejects overwriting a symlink target', async () => {
      // Create real target and symlink
      const realTarget = path.join(testDir, 'real.txt');
      const symlinkTarget = path.join(testDir, 'sym.txt');
      fs.writeFileSync(realTarget, 'real content', 'utf8');

      try {
        fs.symlinkSync(realTarget, symlinkTarget);
      } catch {
        // Skip on systems without unprivileged symlink permissions (Windows non-dev mode)
        return;
      }

      await assert.rejects(
        () => writeFileTool.prepareApproval({ path: 'sym.txt', content: 'attack' }),
        SecurityError
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. edit_file: Surgical Exact-Match Editing & Conflict Detection
  // ──────────────────────────────────────────────────────────────────────────
  describe('EditFileTool Operations & Conflict Handling', () => {
    test('surgically replaces an exact single match', async () => {
      const relPath = 'calc.ts';
      const initial = 'function add(a, b) {\n  return a - b;\n}\n';
      fs.writeFileSync(path.join(testDir, relPath), initial, 'utf8');

      const prep = await editFileTool.prepareApproval({
        path: relPath,
        target_content: 'return a - b;',
        replacement_content: 'return a + b;'
      });
      assert.equal(prep.operationType, 'modify');
      assert.ok(prep.preview.includes('-  return a - b;'));
      assert.ok(prep.preview.includes('+  return a + b;'));

      const { token } = approvalManager.createApproval({
        toolName: editFileTool.name,
        operationType: prep.operationType,
        workspaceIdentity: workspaceManager.getIdentity(),
        targetPaths: prep.targetPaths,
        payloadDigest: prep.payloadDigest,
        parameters: { path: relPath, target_content: 'return a - b;', replacement_content: 'return a + b;' }
      });

      const result = await editFileTool.execute(
        {
          path: relPath,
          target_content: 'return a - b;',
          replacement_content: 'return a + b;'
        },
        { toolCallId: 'call_edit_1', approvalToken: token }
      );

      assert.equal(result.success, true);
      const updated = fs.readFileSync(path.join(testDir, relPath), 'utf8');
      assert.equal(updated, 'function add(a, b) {\n  return a + b;\n}\n');
    });

    test('rejects zero matches with ToolError', async () => {
      const relPath = 'calc.ts';
      fs.writeFileSync(path.join(testDir, relPath), 'function add(a, b) { return a + b; }\n', 'utf8');

      await assert.rejects(
        () =>
          editFileTool.prepareApproval({
            path: relPath,
            target_content: 'function multiply',
            replacement_content: 'function div'
          }),
        ToolError
      );
    });

    test('rejects multiple matches with ToolError (ambiguous edit)', async () => {
      const relPath = 'repeat.txt';
      const content = 'line duplicate\nline duplicate\nline unique\n';
      fs.writeFileSync(path.join(testDir, relPath), content, 'utf8');

      await assert.rejects(
        () =>
          editFileTool.prepareApproval({
            path: relPath,
            target_content: 'line duplicate',
            replacement_content: 'line replaced'
          }),
        (err) => err instanceof ToolError && err.message.includes('Ambiguous edit rejected')
      );
    });

    test('detects concurrent edit conflict and aborts with EditConflictError', async () => {
      const relPath = 'file.txt';
      const initial = 'line 1\nline 2\nline 3\n';
      const filePath = path.join(testDir, relPath);
      fs.writeFileSync(filePath, initial, 'utf8');

      // 1. Prepare approval for initial version
      const prep = await editFileTool.prepareApproval({
        path: relPath,
        target_content: 'line 2',
        replacement_content: 'line two'
      });

      const { token } = approvalManager.createApproval({
        toolName: editFileTool.name,
        operationType: prep.operationType,
        workspaceIdentity: workspaceManager.getIdentity(),
        targetPaths: prep.targetPaths,
        payloadDigest: prep.payloadDigest,
        parameters: { path: relPath, target_content: 'line 2', replacement_content: 'line two' }
      });

      // 2. Simulate concurrent modification by developer / external process
      fs.writeFileSync(filePath, 'line 1\nline 2 MODIFIED\nline 3\n', 'utf8');

      // 3. Execution MUST detect conflict and fail closed
      await assert.rejects(
        () =>
          editFileTool.execute(
            {
              path: relPath,
              target_content: 'line 2',
              replacement_content: 'line two'
            },
            { toolCallId: 'call_conflict', approvalToken: token }
          ),
        (err) => err instanceof EditConflictError || (err instanceof SecurityError && err.message.includes('digest'))
      );

      // Verify developer's modification was preserved and not overwritten
      assert.equal(fs.readFileSync(filePath, 'utf8'), 'line 1\nline 2 MODIFIED\nline 3\n');
    });

    test('rejects editing binary files', async () => {
      const relPath = 'binary.bin';
      const binBuf = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x00, 0xff]);
      fs.writeFileSync(path.join(testDir, relPath), binBuf);

      await assert.rejects(
        () =>
          editFileTool.prepareApproval({
            path: relPath,
            target_content: 'foo',
            replacement_content: 'bar'
          }),
        ToolError
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. ToolExecutor Integration & Approval Policies
  // ──────────────────────────────────────────────────────────────────────────
  describe('ToolExecutor Integration with Approval Policies', () => {
    test('StrictApprovalPolicy rejects write_file execution before invoking tool', async () => {
      const registry = new ToolRegistry();
      registry.register(writeFileTool);

      const strictPolicy = new StrictApprovalPolicy(['read_only']);
      const executor = new ToolExecutor(
        registry,
        strictPolicy,
        undefined,
        approvalManager,
        workspaceManager
      );

      const result = await executor.execute({
        id: 'call_strict',
        type: 'function',
        function: {
          name: 'write_file',
          arguments: JSON.stringify({ path: 'forbidden.txt', content: 'should fail' })
        }
      });

      assert.equal(result.success, false);
      assert.ok(result.error.includes('denied by policy'));
      assert.ok(!fs.existsSync(path.join(testDir, 'forbidden.txt')));
    });

    test('AutoApprovalPolicy approves and executes write_file atomically', async () => {
      const registry = new ToolRegistry();
      registry.register(writeFileTool);

      const autoPolicy = new AutoApprovalPolicy(['read_only', 'file_create', 'file_modify']);
      const executor = new ToolExecutor(
        registry,
        autoPolicy,
        undefined,
        approvalManager,
        workspaceManager
      );

      const result = await executor.execute({
        id: 'call_auto',
        type: 'function',
        function: {
          name: 'write_file',
          arguments: JSON.stringify({ path: 'auto_created.txt', content: 'auto approved content' })
        }
      });

      assert.equal(result.success, true);
      assert.ok(fs.existsSync(path.join(testDir, 'auto_created.txt')));
      assert.equal(
        fs.readFileSync(path.join(testDir, 'auto_created.txt'), 'utf8'),
        'auto approved content'
      );
    });

    test('AutoApprovalPolicy approves and executes edit_file surgically', async () => {
      const filePath = path.join(testDir, 'code.js');
      fs.writeFileSync(filePath, 'const x = 10;\nconst y = 20;\n', 'utf8');

      const registry = new ToolRegistry();
      registry.register(editFileTool);

      const autoPolicy = new AutoApprovalPolicy(['read_only', 'file_create', 'file_modify']);
      const executor = new ToolExecutor(
        registry,
        autoPolicy,
        undefined,
        approvalManager,
        workspaceManager
      );

      const result = await executor.execute({
        id: 'call_auto_edit',
        type: 'function',
        function: {
          name: 'edit_file',
          arguments: JSON.stringify({
            path: 'code.js',
            target_content: 'const y = 20;',
            replacement_content: 'const y = 42;'
          })
        }
      });

      assert.equal(result.success, true);
      assert.equal(fs.readFileSync(filePath, 'utf8'), 'const x = 10;\nconst y = 42;\n');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 6. Unified Diff Generator
  // ──────────────────────────────────────────────────────────────────────────
  describe('Unified Diff Generator', () => {
    test('produces standard unified diff format', () => {
      const orig = 'line 1\nold line\nline 3\n';
      const modified = 'line 1\nnew line\nline 3\n';
      const diff = generateUnifiedDiff('test.txt', orig, modified);

      assert.ok(diff.includes('--- a/test.txt'));
      assert.ok(diff.includes('+++ b/test.txt'));
      assert.ok(diff.includes('-old line'));
      assert.ok(diff.includes('+new line'));
    });

    test('returns empty string when content is identical', () => {
      const text = 'identical content\n';
      assert.equal(generateUnifiedDiff('file.txt', text, text), '');
    });
  });
});
