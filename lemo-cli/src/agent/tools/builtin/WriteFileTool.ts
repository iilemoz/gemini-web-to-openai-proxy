/**
 * Write File Tool
 * Creates a new file or overwrites an existing regular file within the workspace.
 * Uses atomic scratch-file replacement and requires explicit approval.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import { Tool, type ToolSchema, type ApprovalPreparation } from '../Tool.js';
import type { WorkspaceManager } from '../../workspace/WorkspaceManager.js';
import type { ApprovalManager } from '../../approval/ApprovalManager.js';
import { generateUnifiedDiff, formatColoredDiff } from '../../approval/DiffGenerator.js';
import type { ToolPermission, ToolResult, ToolExecutionContext } from '../../types/index.js';
import { SecurityError, ToolError } from '../../../core/errors/index.js';

export const WriteFileSchema: ToolSchema = {
  type: 'object',
  properties: {
    path: {
      type: 'string',
      description: 'Workspace-relative path of the file to create or overwrite.'
    },
    content: {
      type: 'string',
      description: 'The complete content to write to the file.'
    }
  },
  required: ['path', 'content']
};

export class WriteFileTool extends Tool {
  public readonly name = 'write_file';
  public readonly description =
    'Creates a new file or overwrites an existing regular file in the workspace using atomic writes.';
  public readonly parameters = WriteFileSchema;
  public readonly permissions: ToolPermission[] = ['file_create', 'file_modify'];

  constructor(
    private readonly workspaceManager: WorkspaceManager,
    private readonly approvalManager?: ApprovalManager
  ) {
    super();
  }

  /**
   * Prepares cryptographic approval details and diff preview before execution.
   */
  public override async prepareApproval(
    args: Record<string, unknown>,
    _context?: ToolExecutionContext
  ): Promise<ApprovalPreparation | null> {
    const rawPath = args['path'];
    const content = args['content'];

    if (typeof rawPath !== 'string' || rawPath.trim() === '') {
      throw new ToolError("Parameter 'path' must be a non-empty string");
    }
    if (typeof content !== 'string') {
      throw new ToolError("Parameter 'content' must be a string");
    }

    const canonicalTarget = this.workspaceManager.resolvePath(rawPath);
    if (canonicalTarget === this.workspaceManager.getRoot()) {
      throw new SecurityError('Cannot overwrite workspace root directory');
    }
    this.workspaceManager.assertNotSensitive(canonicalTarget);

    const exists = fs.existsSync(canonicalTarget);
    let operationType: 'create' | 'modify' = 'create';
    let originalContentHash: string | undefined;
    let preview: string;

    const proposedBuffer = Buffer.from(content, 'utf8');
    const proposedContentHash = crypto.createHash('sha256').update(proposedBuffer).digest('hex');

    if (exists) {
      operationType = 'modify';
      const lstat = fs.lstatSync(canonicalTarget);
      if (lstat.isSymbolicLink()) {
        throw new SecurityError(`Refusing to overwrite symlink target: '${rawPath}'`);
      }
      if (!lstat.isFile()) {
        throw new SecurityError(`Target is not a regular file: '${rawPath}'`);
      }

      const existingBuffer = await fs.promises.readFile(canonicalTarget);
      originalContentHash = crypto.createHash('sha256').update(existingBuffer).digest('hex');
      const existingText = existingBuffer.toString('utf8');

      const diff = generateUnifiedDiff(this.workspaceManager.toRelative(canonicalTarget), existingText, content);
      preview = diff ? formatColoredDiff(diff) : 'No content changes detected.';
    } else {
      operationType = 'create';
      preview = `Create new file: ${this.workspaceManager.toRelative(canonicalTarget)} (${proposedBuffer.length} bytes)`;
    }

    return {
      operationType,
      targetPaths: [
        {
          canonicalPath: canonicalTarget,
          workspaceRelative: this.workspaceManager.toRelative(canonicalTarget)
        }
      ],
      payloadDigest: {
        algorithm: 'sha256',
        ...(originalContentHash ? { originalContentHash } : {}),
        proposedContentHash
      },
      preview
    };
  }

  /**
   * Executes atomic file writing after verifying approval token.
   */
  public async execute(
    args: Record<string, unknown>,
    context?: ToolExecutionContext
  ): Promise<ToolResult> {
    const rawPath = args['path'];
    const content = args['content'];

    if (typeof rawPath !== 'string' || rawPath.trim() === '') {
      return { success: false, error: "Parameter 'path' must be a non-empty string" };
    }
    if (typeof content !== 'string') {
      return { success: false, error: "Parameter 'content' must be a string" };
    }

    try {
      const canonicalTarget = this.workspaceManager.resolvePath(rawPath);
      if (canonicalTarget === this.workspaceManager.getRoot()) {
        throw new SecurityError('Cannot overwrite workspace root directory');
      }
      this.workspaceManager.assertNotSensitive(canonicalTarget);

      const exists = fs.existsSync(canonicalTarget);
      const proposedBuffer = Buffer.from(content, 'utf8');
      const proposedContentHash = crypto.createHash('sha256').update(proposedBuffer).digest('hex');

      let originalContentHash: string | undefined;
      if (exists) {
        const lstat = fs.lstatSync(canonicalTarget);
        if (lstat.isSymbolicLink()) {
          throw new SecurityError(`Refusing to overwrite symlink target: '${rawPath}'`);
        }
        if (!lstat.isFile()) {
          throw new SecurityError(`Target is not a regular file: '${rawPath}'`);
        }
        const existingBuffer = await fs.promises.readFile(canonicalTarget);
        originalContentHash = crypto.createHash('sha256').update(existingBuffer).digest('hex');
      }

      // Cryptographic approval validation and atomic consumption
      if (this.approvalManager) {
        this.approvalManager.validateAndConsume(context?.approvalToken, {
          toolName: this.name,
          operationType: exists ? 'modify' : 'create',
          workspaceIdentity: this.workspaceManager.getIdentity(),
          canonicalPath: canonicalTarget,
          ...(originalContentHash ? { originalContentHash } : {}),
          proposedContentHash
        });
      }

      const { bytesWritten } = await this.workspaceManager.writeAtomic(canonicalTarget, proposedBuffer);

      return {
        success: true,
        data: {
          path: this.workspaceManager.toRelative(canonicalTarget),
          bytesWritten,
          operation: exists ? 'overwritten' : 'created'
        },
        raw: `File '${this.workspaceManager.toRelative(canonicalTarget)}' successfully ${
          exists ? 'overwritten' : 'created'
        } (${bytesWritten} bytes).`
      };
    } catch (err: unknown) {
      if (err instanceof SecurityError || err instanceof ToolError) {
        throw err;
      }
      return {
        success: false,
        error: `Failed to write file '${rawPath}': ${err instanceof Error ? err.message : String(err)}`
      };
    }
  }
}
