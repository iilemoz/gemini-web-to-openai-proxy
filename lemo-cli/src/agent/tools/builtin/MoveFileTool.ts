/**
 * Move File Tool
 * Relocates or renames a regular file, empty/populated directory, or symlink within the workspace.
 * Enforces dual boundary containment, root protection, sensitive path rejection,
 * descendant move prevention, and race-safe non-overwrite semantics.
 * Requires cryptographic approval.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import { Tool, type ToolSchema, type ApprovalPreparation, type DestinationIdentity } from '../Tool.js';
import type { WorkspaceManager } from '../../workspace/WorkspaceManager.js';
import type { ApprovalManager } from '../../approval/ApprovalManager.js';
import type { ToolPermission, ToolResult, ToolExecutionContext } from '../../types/index.js';
import { SecurityError, ToolError, WorkspaceError } from '../../../core/errors/index.js';

export const MoveFileSchema: ToolSchema = {
  type: 'object',
  properties: {
    source_path: {
      type: 'string',
      description: 'Workspace-relative path of the source file or directory to move.'
    },
    destination_path: {
      type: 'string',
      description: 'Workspace-relative path of the destination location.'
    },
    overwrite: {
      type: 'boolean',
      description: 'Whether to overwrite an existing destination file (default: false).'
    }
  },
  required: ['source_path', 'destination_path']
};

export class MoveFileTool extends Tool {
  public readonly name = 'move_file';
  public readonly description =
    'Moves or renames a file or directory in the workspace. Requires explicit approval.';
  public readonly parameters = MoveFileSchema;
  public readonly permissions: ToolPermission[] = ['file_create', 'file_modify', 'file_delete'];

  constructor(
    private readonly workspaceManager: WorkspaceManager,
    private readonly approvalManager?: ApprovalManager
  ) {
    super();
  }

  private extractPaths(args: Record<string, unknown>): { rawSource: string; rawDest: string; overwrite: boolean } {
    const rawSource = args['source_path'] ?? args['source'];
    const rawDest = args['destination_path'] ?? args['destination'];
    const overwrite = Boolean(args['overwrite'] ?? false);

    if (typeof rawSource !== 'string' || rawSource.trim() === '') {
      throw new ToolError("Parameter 'source_path' must be a non-empty string");
    }
    if (typeof rawDest !== 'string' || rawDest.trim() === '') {
      throw new ToolError("Parameter 'destination_path' must be a non-empty string");
    }

    return { rawSource: rawSource.trim(), rawDest: rawDest.trim(), overwrite };
  }

  /**
   * Prepares cryptographic approval details and move preview before execution.
   */
  public override async prepareApproval(
    args: Record<string, unknown>,
    _context?: ToolExecutionContext
  ): Promise<ApprovalPreparation | null> {
    const { rawSource, rawDest, overwrite } = this.extractPaths(args);

    const canonicalSource = this.workspaceManager.resolvePathNoFollow(rawSource);
    const canonicalDest = this.workspaceManager.resolvePathNoFollow(rawDest);

    if (canonicalSource === this.workspaceManager.getRoot()) {
      throw new SecurityError('Cannot move workspace root directory');
    }
    if (canonicalDest === this.workspaceManager.getRoot()) {
      throw new SecurityError('Cannot overwrite workspace root directory');
    }

    this.workspaceManager.assertNotSensitive(canonicalSource);
    this.workspaceManager.assertNotSensitive(canonicalDest);

    let sourceStat: fs.Stats;
    try {
      sourceStat = await fs.promises.lstat(canonicalSource);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === 'ENOENT') {
        throw new ToolError(`Source not found: '${rawSource}'`);
      }
      throw err;
    }

    const relSource = this.workspaceManager.toRelative(canonicalSource);
    const relDest = this.workspaceManager.toRelative(canonicalDest);

    let originalContentHash: string | undefined;
    let preview: string;

    if (sourceStat.isDirectory()) {
      if (!this.workspaceManager.getCapabilities().atomicDirectoryNoReplace) {
        throw new SecurityError(
          "Directory relocation disabled: atomic no-replace capability ('atomicDirectoryNoReplace' via renameat2/renamex_np) is unavailable on this platform/runtime"
        );
      }
      this.workspaceManager.assertNotDescendant(canonicalSource, canonicalDest);
      preview = `Move directory: ${relSource} -> ${relDest}`;
    } else if (sourceStat.isSymbolicLink()) {
      preview = `Move symlink: ${relSource} -> ${relDest}`;
    } else if (sourceStat.isFile()) {
      const buf = await fs.promises.readFile(canonicalSource);
      originalContentHash = crypto.createHash('sha256').update(buf).digest('hex');
      preview = `Move file: ${relSource} -> ${relDest} (${buf.length} bytes)${overwrite ? ' [overwrite: true]' : ''}`;
    } else {
      throw new SecurityError(`Unsupported file type: '${relSource}'`);
    }

    if (overwrite && !this.workspaceManager.getCapabilities().safeDestinationOverwrite) {
      throw new SecurityError(
        "Safe destination overwrite disabled: verified displacement/staging capability ('safeDestinationOverwrite') is unavailable"
      );
    }

    // Check destination existence and capture fingerprint / identity
    let destinationContentHash: string | undefined;
    let destinationIdentity: DestinationIdentity | undefined;
    try {
      const destStat = await fs.promises.lstat(canonicalDest);
      if (!overwrite) {
        throw new ToolError(`Destination already exists: '${relDest}'. Specify overwrite=true to replace.`);
      }
      if (sourceStat.isDirectory()) {
        throw new ToolError(`Destination already exists: '${relDest}'. Cannot overwrite with directory.`);
      }
      if (destStat.isDirectory()) {
        throw new SecurityError(`Cannot overwrite directory with file: '${relDest}'`);
      }
      if (destStat.isSymbolicLink()) {
        throw new SecurityError(`Refusing to overwrite symlink destination: '${relDest}'`);
      }
      if (destStat.isFile()) {
        const destBuf = await fs.promises.readFile(canonicalDest);
        destinationContentHash = crypto.createHash('sha256').update(destBuf).digest('hex');
        destinationIdentity = {
          canonicalPath: canonicalDest,
          deviceNumber: Number(destStat.dev),
          inodeNumber: Number(destStat.ino),
          type: 'file',
          exists: true
        };
      } else {
        throw new SecurityError(`Unsupported destination file type: '${relDest}'`);
      }
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === 'ENOENT') {
        destinationIdentity = {
          canonicalPath: canonicalDest,
          type: 'none',
          exists: false
        };
      } else {
        throw err;
      }
    }

    return {
      operationType: 'move',
      targetPaths: [
        { canonicalPath: canonicalSource, workspaceRelative: relSource },
        { canonicalPath: canonicalDest, workspaceRelative: relDest }
      ],
      payloadDigest: {
        algorithm: 'sha256',
        ...(originalContentHash ? { originalContentHash } : {}),
        ...(destinationContentHash ? { destinationContentHash } : {})
      },
      destinationIdentity,
      preview
    };
  }

  /**
   * Executes file relocation after validating cryptographic approval token.
   */
  public async execute(
    args: Record<string, unknown>,
    context?: ToolExecutionContext
  ): Promise<ToolResult> {
    let parsed: { rawSource: string; rawDest: string; overwrite: boolean };
    try {
      parsed = this.extractPaths(args);
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }

    const { rawSource, rawDest, overwrite } = parsed;

    try {
      const canonicalSource = this.workspaceManager.resolvePathNoFollow(rawSource);
      const canonicalDest = this.workspaceManager.resolvePathNoFollow(rawDest);

      if (canonicalSource === this.workspaceManager.getRoot()) {
        throw new SecurityError('Cannot move workspace root directory');
      }
      if (canonicalDest === this.workspaceManager.getRoot()) {
        throw new SecurityError('Cannot overwrite workspace root directory');
      }

      this.workspaceManager.assertNotSensitive(canonicalSource);
      this.workspaceManager.assertNotSensitive(canonicalDest);

      let sourceStat: fs.Stats;
      try {
        sourceStat = await fs.promises.lstat(canonicalSource);
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === 'ENOENT') {
          return { success: false, error: `Source not found: '${rawSource}'` };
        }
        throw err;
      }

      let originalContentHash: string | undefined;
      if (sourceStat.isFile()) {
        const buf = await fs.promises.readFile(canonicalSource);
        originalContentHash = crypto.createHash('sha256').update(buf).digest('hex');
      }

      if (sourceStat.isDirectory()) {
        if (!this.workspaceManager.getCapabilities().atomicDirectoryNoReplace) {
          throw new SecurityError(
            "Directory relocation disabled: atomic no-replace capability ('atomicDirectoryNoReplace' via renameat2/renamex_np) is unavailable on this platform/runtime"
          );
        }
      }

      if (overwrite && !this.workspaceManager.getCapabilities().safeDestinationOverwrite) {
        throw new SecurityError(
          "Safe destination overwrite disabled: verified displacement/staging capability ('safeDestinationOverwrite') is unavailable"
        );
      }

      // Revalidate destination identity and content hash immediately before approval validation
      let destinationContentHash: string | undefined;
      let destinationIdentity: DestinationIdentity | undefined;
      try {
        const destStat = await fs.promises.lstat(canonicalDest);
        if (destStat.isFile()) {
          const destBuf = await fs.promises.readFile(canonicalDest);
          destinationContentHash = crypto.createHash('sha256').update(destBuf).digest('hex');
          destinationIdentity = {
            canonicalPath: canonicalDest,
            deviceNumber: Number(destStat.dev),
            inodeNumber: Number(destStat.ino),
            type: 'file',
            exists: true
          };
        } else if (destStat.isDirectory()) {
          destinationIdentity = {
            canonicalPath: canonicalDest,
            deviceNumber: Number(destStat.dev),
            inodeNumber: Number(destStat.ino),
            type: 'directory',
            exists: true
          };
        } else if (destStat.isSymbolicLink()) {
          destinationIdentity = {
            canonicalPath: canonicalDest,
            deviceNumber: Number(destStat.dev),
            inodeNumber: Number(destStat.ino),
            type: 'symlink',
            exists: true
          };
        }
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === 'ENOENT') {
          destinationIdentity = {
            canonicalPath: canonicalDest,
            type: 'none',
            exists: false
          };
        } else {
          throw err;
        }
      }

      // Cryptographic approval validation
      if (this.approvalManager) {
        this.approvalManager.validateAndConsume(context?.approvalToken, {
          toolName: this.name,
          operationType: 'move',
          workspaceIdentity: this.workspaceManager.getIdentity(),
          canonicalPath: canonicalSource,
          destinationCanonicalPath: canonicalDest,
          ...(originalContentHash ? { originalContentHash } : {}),
          ...(destinationContentHash ? { destinationContentHash } : {}),
          ...(destinationIdentity ? { destinationIdentity } : {})
        });
      }

      const result = await this.workspaceManager.moveEntry(canonicalSource, canonicalDest, {
        overwrite,
        expectedDestIdentity: destinationIdentity,
        expectedDestContentHash: destinationContentHash
      });

      return {
        success: true,
        data: {
          source: this.workspaceManager.toRelative(canonicalSource),
          destination: this.workspaceManager.toRelative(canonicalDest),
          type: result.type,
          bytesMoved: result.bytesMoved
        }
      };
    } catch (err: unknown) {
      if (err instanceof SecurityError || err instanceof ToolError || err instanceof WorkspaceError) {
        return { success: false, error: err.message };
      }
      return { success: false, error: `Move failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}
