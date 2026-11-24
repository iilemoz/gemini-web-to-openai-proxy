/**
 * Edit File Tool
 * Surgically replaces an exact match of target_content with replacement_content.
 * Enforces single-occurrence matching, pre/post cryptographic fingerprints,
 * and conflict detection before atomic commit.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import { Tool, type ToolSchema, type ApprovalPreparation } from '../Tool.js';
import type { WorkspaceManager } from '../../workspace/WorkspaceManager.js';
import type { ApprovalManager } from '../../approval/ApprovalManager.js';
import { generateUnifiedDiff, formatColoredDiff } from '../../approval/DiffGenerator.js';
import type { ToolPermission, ToolResult, ToolExecutionContext } from '../../types/index.js';
import { SecurityError, ToolError, EditConflictError } from '../../../core/errors/index.js';

export const EditFileSchema: ToolSchema = {
  type: 'object',
  properties: {
    path: {
      type: 'string',
      description: 'Workspace-relative path of the file to edit.'
    },
    target_content: {
      type: 'string',
      description: 'Exact string to be replaced (must match exactly once in the file).'
    },
    replacement_content: {
      type: 'string',
      description: 'New replacement string.'
    }
  },
  required: ['path', 'target_content', 'replacement_content']
};

export class EditFileTool extends Tool {
  public readonly name = 'edit_file';
  public readonly description =
    'Surgically replaces an exact match of target_content with replacement_content in a file.';
  public readonly parameters = EditFileSchema;
  public readonly permissions: ToolPermission[] = ['file_modify'];

  constructor(
    private readonly workspaceManager: WorkspaceManager,
    private readonly approvalManager?: ApprovalManager
  ) {
    super();
  }

  /**
   * Prepares cryptographic approval details and unified diff preview before execution.
   */
  public override async prepareApproval(
    args: Record<string, unknown>,
    _context?: ToolExecutionContext
  ): Promise<ApprovalPreparation | null> {
    const rawPath = args['path'];
    const targetContent = args['target_content'];
    const replacementContent = args['replacement_content'];

    if (typeof rawPath !== 'string' || rawPath.trim() === '') {
      throw new ToolError("Parameter 'path' must be a non-empty string");
    }
    if (typeof targetContent !== 'string') {
      throw new ToolError("Parameter 'target_content' must be a string");
    }
    if (targetContent === '') {
      throw new ToolError("Parameter 'target_content' cannot be empty");
    }
    if (typeof replacementContent !== 'string') {
      throw new ToolError("Parameter 'replacement_content' must be a string");
    }

    const canonicalTarget = this.workspaceManager.resolvePath(rawPath);
    if (canonicalTarget === this.workspaceManager.getRoot()) {
      throw new SecurityError('Cannot edit workspace root directory');
    }
    this.workspaceManager.assertNotSensitive(canonicalTarget);

    if (!fs.existsSync(canonicalTarget)) {
      throw new ToolError(`File not found: '${rawPath}'`);
    }

    const lstat = fs.lstatSync(canonicalTarget);
    if (lstat.isSymbolicLink()) {
      throw new SecurityError(`Refusing to edit symlink target: '${rawPath}'`);
    }
    if (!lstat.isFile()) {
      throw new SecurityError(`Target is not a regular file: '${rawPath}'`);
    }

    if (await this.workspaceManager.isBinary(canonicalTarget)) {
      throw new ToolError(`Cannot edit binary file: '${rawPath}'`);
    }

    const originalBuffer = await fs.promises.readFile(canonicalTarget);
    const originalText = originalBuffer.toString('utf8');
    const originalContentHash = crypto.createHash('sha256').update(originalBuffer).digest('hex');

    // Count exact matching occurrences
    let count = 0;
    let idx = -1;
    let firstIdx = -1;
    while ((idx = originalText.indexOf(targetContent, idx + 1)) !== -1) {
      count++;
      if (firstIdx === -1) firstIdx = idx;
      if (count > 1) break;
    }

    if (count === 0) {
      throw new ToolError(`Target content not found in file '${rawPath}'. Edit rejected.`);
    }
    if (count > 1) {
      throw new ToolError(
        `Target content matches multiple times in file '${rawPath}'. Ambiguous edit rejected. Include more surrounding lines in target_content to match uniquely.`
      );
    }

    // Apply surgical replacement
    const proposedText =
      originalText.slice(0, firstIdx) +
      replacementContent +
      originalText.slice(firstIdx + targetContent.length);

    const proposedBuffer = Buffer.from(proposedText, 'utf8');
    const proposedContentHash = crypto.createHash('sha256').update(proposedBuffer).digest('hex');

    const diff = generateUnifiedDiff(this.workspaceManager.toRelative(canonicalTarget), originalText, proposedText);
    const preview = diff ? formatColoredDiff(diff) : 'No net changes.';

    return {
      operationType: 'modify',
      targetPaths: [
        {
          canonicalPath: canonicalTarget,
          workspaceRelative: this.workspaceManager.toRelative(canonicalTarget)
        }
      ],
      payloadDigest: {
        algorithm: 'sha256',
        originalContentHash,
        proposedContentHash
      },
      preview
    };
  }

  /**
   * Executes surgical edit with pre-commit conflict detection and atomic replacement.
   */
  public async execute(
    args: Record<string, unknown>,
    context?: ToolExecutionContext
  ): Promise<ToolResult> {
    const rawPath = args['path'];
    const targetContent = args['target_content'];
    const replacementContent = args['replacement_content'];

    if (typeof rawPath !== 'string' || rawPath.trim() === '') {
      return { success: false, error: "Parameter 'path' must be a non-empty string" };
    }
    if (typeof targetContent !== 'string') {
      return { success: false, error: "Parameter 'target_content' must be a string" };
    }
    if (targetContent === '') {
      return { success: false, error: "Parameter 'target_content' cannot be empty" };
    }
    if (typeof replacementContent !== 'string') {
      return { success: false, error: "Parameter 'replacement_content' must be a string" };
    }

    try {
      const canonicalTarget = this.workspaceManager.resolvePath(rawPath);
      if (canonicalTarget === this.workspaceManager.getRoot()) {
        throw new SecurityError('Cannot edit workspace root directory');
      }
      this.workspaceManager.assertNotSensitive(canonicalTarget);

      if (!fs.existsSync(canonicalTarget)) {
        throw new ToolError(`File not found: '${rawPath}'`);
      }

      const lstat = fs.lstatSync(canonicalTarget);
      if (lstat.isSymbolicLink()) {
        throw new SecurityError(`Refusing to edit symlink target: '${rawPath}'`);
      }
      if (!lstat.isFile()) {
        throw new SecurityError(`Target is not a regular file: '${rawPath}'`);
      }

      // Read current disk content
      const diskBuffer = await fs.promises.readFile(canonicalTarget);
      const diskText = diskBuffer.toString('utf8');
      const diskContentHash = crypto.createHash('sha256').update(diskBuffer).digest('hex');

      // Verify exact single match
      let count = 0;
      let idx = -1;
      let firstIdx = -1;
      while ((idx = diskText.indexOf(targetContent, idx + 1)) !== -1) {
        count++;
        if (firstIdx === -1) firstIdx = idx;
        if (count > 1) break;
      }

      if (count === 0) {
        throw new ToolError(`Target content not found in file '${rawPath}'. Edit rejected.`);
      }
      if (count > 1) {
        throw new ToolError(
          `Target content matches multiple times in file '${rawPath}'. Ambiguous edit rejected.`
        );
      }

      const proposedText =
        diskText.slice(0, firstIdx) +
        replacementContent +
        diskText.slice(firstIdx + targetContent.length);

      const proposedBuffer = Buffer.from(proposedText, 'utf8');
      const proposedContentHash = crypto.createHash('sha256').update(proposedBuffer).digest('hex');

      // Cryptographic approval validation and atomic consumption
      if (this.approvalManager) {
        this.approvalManager.validateAndConsume(context?.approvalToken, {
          toolName: this.name,
          operationType: 'modify',
          workspaceIdentity: this.workspaceManager.getIdentity(),
          canonicalPath: canonicalTarget,
          originalContentHash: diskContentHash,
          proposedContentHash
        });
      }

      // Pre-commit Revalidation: re-read file directly before commit to guarantee no concurrent modification
      const preCommitBuffer = await fs.promises.readFile(canonicalTarget);
      const preCommitFingerprint = crypto.createHash('sha256').update(preCommitBuffer).digest('hex');
      if (preCommitFingerprint !== diskContentHash) {
        throw new EditConflictError(
          `Edit conflict detected for '${rawPath}': file content was modified concurrently after approval was issued.`
        );
      }

      const { bytesWritten } = await this.workspaceManager.writeAtomic(canonicalTarget, proposedBuffer);

      return {
        success: true,
        data: {
          path: this.workspaceManager.toRelative(canonicalTarget),
          bytesWritten,
          replacedLength: targetContent.length,
          replacementLength: replacementContent.length
        },
        raw: `File '${this.workspaceManager.toRelative(canonicalTarget)}' successfully edited.`
      };
    } catch (err: unknown) {
      if (err instanceof SecurityError || err instanceof ToolError || err instanceof EditConflictError) {
        throw err;
      }
      return {
        success: false,
        error: `Failed to edit file '${rawPath}': ${err instanceof Error ? err.message : String(err)}`
      };
    }
  }
}
