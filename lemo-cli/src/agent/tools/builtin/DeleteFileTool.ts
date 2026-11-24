/**
 * Delete File Tool
 * Deletes a regular file, empty directory, or symlink within the workspace.
 * Rejects non-empty directories, workspace root, and sensitive paths.
 * Requires cryptographic approval.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import { Tool, type ToolSchema, type ApprovalPreparation } from '../Tool.js';
import type { WorkspaceManager } from '../../workspace/WorkspaceManager.js';
import type { ApprovalManager } from '../../approval/ApprovalManager.js';
import type { ToolPermission, ToolResult, ToolExecutionContext } from '../../types/index.js';
import { SecurityError, ToolError } from '../../../core/errors/index.js';

export const DeleteFileSchema: ToolSchema = {
  type: 'object',
  properties: {
    path: {
      type: 'string',
      description: 'Workspace-relative path of the file or empty directory to delete.'
    }
  },
  required: ['path']
};

export class DeleteFileTool extends Tool {
  public readonly name = 'delete_file';
  public readonly description =
    'Deletes a regular file, empty directory, or symlink in the workspace. Requires explicit approval.';
  public readonly parameters = DeleteFileSchema;
  public readonly permissions: ToolPermission[] = ['file_delete'];

  constructor(
    private readonly workspaceManager: WorkspaceManager,
    private readonly approvalManager?: ApprovalManager
  ) {
    super();
  }

  /**
   * Prepares cryptographic approval details and summary preview before deletion.
   */
  public override async prepareApproval(
    args: Record<string, unknown>,
    _context?: ToolExecutionContext
  ): Promise<ApprovalPreparation | null> {
    const rawPath = args['path'];

    if (typeof rawPath !== 'string' || rawPath.trim() === '') {
      throw new ToolError("Parameter 'path' must be a non-empty string");
    }

    const canonicalTarget = this.workspaceManager.resolvePathNoFollow(rawPath);
    if (canonicalTarget === this.workspaceManager.getRoot()) {
      throw new SecurityError('Cannot delete workspace root directory');
    }
    this.workspaceManager.assertNotSensitive(canonicalTarget);

    let stat: fs.Stats;
    try {
      stat = await fs.promises.lstat(canonicalTarget);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === 'ENOENT') {
        throw new ToolError(`Target not found: '${rawPath}'`);
      }
      throw err;
    }

    const relPath = this.workspaceManager.toRelative(canonicalTarget);
    let originalContentHash: string | undefined;
    let preview: string;

    if (stat.isSymbolicLink()) {
      preview = `Delete symlink: ${relPath} (link target is preserved)`;
    } else if (stat.isDirectory()) {
      const entries = await fs.promises.readdir(canonicalTarget);
      if (entries.length > 0) {
        throw new SecurityError(
          `Cannot delete non-empty directory '${relPath}'. Recursive deletion is not supported.`
        );
      }
      preview = `Delete empty directory: ${relPath}`;
    } else if (stat.isFile()) {
      const buf = await fs.promises.readFile(canonicalTarget);
      originalContentHash = crypto.createHash('sha256').update(buf).digest('hex');
      preview = `Delete file: ${relPath} (${buf.length} bytes, sha256:${originalContentHash.slice(0, 12)}...)`;
    } else {
      throw new SecurityError(`Unsupported file type: '${relPath}'`);
    }

    return {
      operationType: 'delete',
      targetPaths: [
        {
          canonicalPath: canonicalTarget,
          workspaceRelative: relPath
        }
      ],
      payloadDigest: {
        algorithm: 'sha256',
        ...(originalContentHash ? { originalContentHash } : {})
      },
      preview
    };
  }

  /**
   * Executes deletion after validating cryptographic approval token.
   */
  public async execute(
    args: Record<string, unknown>,
    context?: ToolExecutionContext
  ): Promise<ToolResult> {
    const rawPath = args['path'];

    if (typeof rawPath !== 'string' || rawPath.trim() === '') {
      return { success: false, error: "Parameter 'path' must be a non-empty string" };
    }

    try {
      const canonicalTarget = this.workspaceManager.resolvePathNoFollow(rawPath);
      if (canonicalTarget === this.workspaceManager.getRoot()) {
        throw new SecurityError('Cannot delete workspace root directory');
      }
      this.workspaceManager.assertNotSensitive(canonicalTarget);

      let stat: fs.Stats;
      try {
        stat = await fs.promises.lstat(canonicalTarget);
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === 'ENOENT') {
          return { success: false, error: `Target not found: '${rawPath}'` };
        }
        throw err;
      }

      let originalContentHash: string | undefined;
      if (stat.isFile()) {
        const buf = await fs.promises.readFile(canonicalTarget);
        originalContentHash = crypto.createHash('sha256').update(buf).digest('hex');
      }

      // Cryptographic approval validation
      if (this.approvalManager) {
        this.approvalManager.validateAndConsume(context?.approvalToken, {
          toolName: this.name,
          operationType: 'delete',
          workspaceIdentity: this.workspaceManager.getIdentity(),
          canonicalPath: canonicalTarget,
          originalContentHash
        });
      }

      const result = await this.workspaceManager.deleteEntry(canonicalTarget);

      return {
        success: true,
        data: {
          path: this.workspaceManager.toRelative(canonicalTarget),
          type: result.type,
          bytesDeleted: result.bytesDeleted
        }
      };
    } catch (err: unknown) {
      if (err instanceof SecurityError || err instanceof ToolError) {
        return { success: false, error: err.message };
      }
      return { success: false, error: `Deletion failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}
