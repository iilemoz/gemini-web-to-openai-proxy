/**
 * Cryptographic Approval Manager
 * Issues, binds, stores, validates, and atomically consumes single-use approval tokens.
 * Complies with RFC 8785 JSON Canonicalization Scheme and HMAC-SHA256 signatures.
 */

import crypto from 'node:crypto';
import { canonicalize } from './CanonicalSerializer.js';
import { SecurityError } from '../../core/errors/index.js';

export interface WorkspaceIdentity {
  canonicalPath: string;
  deviceNumber: number;
  inodeNumber: number;
}

export interface CanonicalApprovalRecord {
  approvalId: string;
  nonce: string;
  toolName: string;
  operationType: 'create' | 'modify' | 'delete' | 'move' | 'execute';
  workspaceIdentity: WorkspaceIdentity;
  targetPaths: {
    canonicalPath: string;
    workspaceRelative: string;
  }[];
  payloadDigest: {
    algorithm: 'sha256';
    originalContentHash?: string | undefined;
    proposedContentHash?: string | undefined;
    commandStringHash?: string | undefined;
  };
  parameters: Record<string, unknown>;
  preview?: string | undefined;
  issuedAt: string;
  expiresAt: string;
}

export interface ExpectedValidation {
  toolName: string;
  operationType: 'create' | 'modify' | 'delete' | 'move' | 'execute';
  workspaceIdentity: WorkspaceIdentity;
  canonicalPath: string;
  destinationCanonicalPath?: string | undefined;
  originalContentHash?: string | undefined;
  proposedContentHash?: string | undefined;
  commandStringHash?: string | undefined;
}

interface StoredApproval {
  record: CanonicalApprovalRecord;
  token: string;
  canonicalJson: string;
  consumed: boolean;
}

export class ApprovalManager {
  private readonly secretKey: Buffer;
  private readonly records = new Map<string, StoredApproval>();
  private readonly tokenToId = new Map<string, string>();
  private readonly ttlMs: number;

  constructor(options: { secretKey?: Buffer; ttlMs?: number } = {}) {
    this.secretKey = options.secretKey || crypto.randomBytes(32);
    this.ttlMs = options.ttlMs ?? 60_000; // Strict 60-second expiration default
  }

  /**
   * Issues a new cryptographic approval record and HMAC-SHA256 token.
   */
  public createApproval(params: {
    toolName: string;
    operationType: 'create' | 'modify' | 'delete' | 'move' | 'execute';
    workspaceIdentity: WorkspaceIdentity;
    targetPaths: { canonicalPath: string; workspaceRelative: string }[];
    payloadDigest: {
      algorithm: 'sha256';
      originalContentHash?: string | undefined;
      proposedContentHash?: string | undefined;
      commandStringHash?: string | undefined;
    };
    parameters: Record<string, unknown>;
    preview?: string | undefined;
  }): { record: CanonicalApprovalRecord; token: string } {
    this.cleanExpired();

    const approvalId = crypto.randomUUID();
    const nonce = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    const issuedAt = new Date(now).toISOString();
    const expiresAt = new Date(now + this.ttlMs).toISOString();

    const record: CanonicalApprovalRecord = {
      approvalId,
      nonce,
      toolName: params.toolName,
      operationType: params.operationType,
      workspaceIdentity: {
        canonicalPath: params.workspaceIdentity.canonicalPath,
        deviceNumber: params.workspaceIdentity.deviceNumber,
        inodeNumber: params.workspaceIdentity.inodeNumber
      },
      targetPaths: params.targetPaths.map((p) => ({
        canonicalPath: p.canonicalPath,
        workspaceRelative: p.workspaceRelative
      })),
      payloadDigest: {
        algorithm: 'sha256',
        ...(params.payloadDigest.originalContentHash
          ? { originalContentHash: params.payloadDigest.originalContentHash }
          : {}),
        ...(params.payloadDigest.proposedContentHash
          ? { proposedContentHash: params.payloadDigest.proposedContentHash }
          : {}),
        ...(params.payloadDigest.commandStringHash
          ? { commandStringHash: params.payloadDigest.commandStringHash }
          : {})
      },
      parameters: params.parameters,
      preview: params.preview,
      issuedAt,
      expiresAt
    };

    const canonicalJson = canonicalize(record);
    const token = crypto.createHmac('sha256', this.secretKey).update(canonicalJson).digest('hex');

    const stored: StoredApproval = {
      record,
      token,
      canonicalJson,
      consumed: false
    };

    this.records.set(approvalId, stored);
    this.tokenToId.set(token, approvalId);

    return { record, token };
  }

  /**
   * Atomically validates and consumes an approval token.
   * Throws SecurityError if token is missing, expired, replayed, or mismatched.
   */
  public validateAndConsume(token: string | undefined, expected: ExpectedValidation): CanonicalApprovalRecord {
    if (!token || typeof token !== 'string' || token.trim() === '') {
      throw new SecurityError('Execution denied: missing required cryptographic approval token');
    }

    const approvalId = this.tokenToId.get(token);
    if (!approvalId) {
      throw new SecurityError('Execution denied: invalid or unissued approval token');
    }

    const stored = this.records.get(approvalId);
    if (!stored) {
      throw new SecurityError('Execution denied: approval record not found');
    }

    // 1. Replay check (Single-use consumption)
    if (stored.consumed) {
      throw new SecurityError('Execution denied: approval token has already been consumed (replay rejected)');
    }

    // 2. Expiration check
    const expiresAtMs = new Date(stored.record.expiresAt).getTime();
    if (Date.now() > expiresAtMs) {
      this.invalidate(approvalId);
      throw new SecurityError('Execution denied: approval token has expired');
    }

    // 3. Signature verification (constant-time comparison)
    const expectedHmac = crypto.createHmac('sha256', this.secretKey).update(stored.canonicalJson).digest('hex');
    const tokenBuf = Buffer.from(token, 'utf8');
    const expectedBuf = Buffer.from(expectedHmac, 'utf8');
    if (tokenBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(tokenBuf, expectedBuf)) {
      this.invalidate(approvalId);
      throw new SecurityError('Execution denied: approval token cryptographic signature mismatch');
    }

    // 4. ATOMIC CONSUMPTION: mark consumed and remove from active lookups
    stored.consumed = true;
    this.records.delete(approvalId);
    this.tokenToId.delete(token);

    // 5. Tool name validation
    if (stored.record.toolName !== expected.toolName) {
      throw new SecurityError(
        `Execution denied: approval tool '${stored.record.toolName}' does not match requested tool '${expected.toolName}'`
      );
    }

    // 6. Operation type validation
    if (stored.record.operationType !== expected.operationType) {
      throw new SecurityError(
        `Execution denied: approval operation '${stored.record.operationType}' does not match requested '${expected.operationType}'`
      );
    }

    // 7. Workspace identity validation
    const approvedWs = stored.record.workspaceIdentity;
    const currentWs = expected.workspaceIdentity;
    if (approvedWs.canonicalPath !== currentWs.canonicalPath) {
      throw new SecurityError(
        `Execution denied: approval workspace path '${approvedWs.canonicalPath}' does not match current '${currentWs.canonicalPath}'`
      );
    }
    if (approvedWs.deviceNumber !== currentWs.deviceNumber || approvedWs.inodeNumber !== currentWs.inodeNumber) {
      throw new SecurityError('Execution denied: workspace filesystem device or inode identity changed');
    }

    // 8. Target path validation
    const pathMatched = stored.record.targetPaths.some(
      (p) => p.canonicalPath === expected.canonicalPath
    );
    if (!pathMatched) {
      throw new SecurityError(
        `Execution denied: target path '${expected.canonicalPath}' not found in approved target paths`
      );
    }

    const hasDestinationInRecord =
      stored.record.targetPaths.length > 1 || stored.record.operationType === 'move';
    if (hasDestinationInRecord) {
      if (!expected.destinationCanonicalPath || typeof expected.destinationCanonicalPath !== 'string') {
        throw new SecurityError('Execution denied: missing required destinationCanonicalPath in validation request');
      }
      const destMatched = stored.record.targetPaths.some(
        (p) => p.canonicalPath === expected.destinationCanonicalPath
      );
      if (!destMatched) {
        throw new SecurityError(
          `Execution denied: destination path '${expected.destinationCanonicalPath}' not found in approved target paths`
        );
      }
    } else if (expected.destinationCanonicalPath) {
      throw new SecurityError('Execution denied: unexpected destinationCanonicalPath provided for single-target approval');
    }

    // 9. Original content fingerprint validation
    if (stored.record.payloadDigest.originalContentHash) {
      if (!expected.originalContentHash || typeof expected.originalContentHash !== 'string') {
        throw new SecurityError(
          'Execution denied: missing required originalContentHash fingerprint in validation request'
        );
      }
      if (stored.record.payloadDigest.originalContentHash !== expected.originalContentHash) {
        throw new SecurityError(
          'Execution denied: approved original content digest does not match current target file fingerprint'
        );
      }
    } else if (expected.originalContentHash) {
      throw new SecurityError(
        'Execution denied: unexpected originalContentHash provided for approval record without original content hash'
      );
    }

    // 10. Proposed content fingerprint validation
    if (stored.record.payloadDigest.proposedContentHash) {
      if (!expected.proposedContentHash || typeof expected.proposedContentHash !== 'string') {
        throw new SecurityError(
          'Execution denied: missing required proposedContentHash fingerprint in validation request'
        );
      }
      if (stored.record.payloadDigest.proposedContentHash !== expected.proposedContentHash) {
        throw new SecurityError(
          'Execution denied: proposed content digest does not match approved digest'
        );
      }
    } else if (expected.proposedContentHash) {
      throw new SecurityError(
        'Execution denied: unexpected proposedContentHash provided for approval record without proposed content hash'
      );
    }

    // 11. Command string fingerprint validation
    if (stored.record.payloadDigest.commandStringHash) {
      if (!expected.commandStringHash || typeof expected.commandStringHash !== 'string') {
        throw new SecurityError(
          'Execution denied: missing required commandStringHash fingerprint in validation request'
        );
      }
      if (stored.record.payloadDigest.commandStringHash !== expected.commandStringHash) {
        throw new SecurityError(
          'Execution denied: command string digest does not match approved digest'
        );
      }
    } else if (expected.commandStringHash) {
      throw new SecurityError(
        'Execution denied: unexpected commandStringHash provided for approval record without command hash'
      );
    }

    return stored.record;
  }

  /**
   * Invalidates a pending approval token (e.g. upon user rejection or abort).
   */
  public invalidate(approvalId: string): void {
    const stored = this.records.get(approvalId);
    if (stored) {
      this.tokenToId.delete(stored.token);
      this.records.delete(approvalId);
    }
  }

  /**
   * Purges expired approvals from the in-memory store.
   */
  public cleanExpired(): void {
    const now = Date.now();
    for (const [id, stored] of this.records.entries()) {
      if (now > new Date(stored.record.expiresAt).getTime()) {
        this.tokenToId.delete(stored.token);
        this.records.delete(id);
      }
    }
  }

  /**
   * Returns count of active (unconsumed, unexpired) approval records.
   */
  public getPendingCount(): number {
    this.cleanExpired();
    return this.records.size;
  }
}
