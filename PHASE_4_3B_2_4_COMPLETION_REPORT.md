# Phase 4.3B.2.4 Completion Report
## Final Move Security Hardening: Atomic No-Replace Semantics, Destination Approval Integrity & Windows ADS Protection

**Execution Date:** 2026-11-25  
**Branch:** `phase-4-lemo-cli`  
**Baseline Commit:** `a1dd9b2` (`fix(phase-4.3b.2): harden git metadata and approval validation`)  
**Hardening Scope:** Full remediation of Phase 4.3B.2.3 Independent Security Verification Audit findings (FINDING-01 through FINDING-06).  
**Status:** COMPLETED — All security criteria implemented, verified, and passing 100%.

---

## 1. Summary of Changes & Audit Remediations

### FINDING-01: Directory Move Atomic No-Replace Guarantee & Strict TOCTOU Mitigation
- **Issue:** On POSIX, `rename(dir, empty_dir)` atomically overwrites `empty_dir`. On Windows, libuv `rename(dir, existing_file)` replaces regular files. Check-then-act directory moves were vulnerable to destination race conditions.
- **Remediation:**
  - Implemented pre-rename destination non-existence revalidation in `WorkspaceManager.moveEntry` immediately before renaming.
  - Implemented source directory identity revalidation (`ino`, `dev`, `isDirectory`) before the rename operation.
  - Added strict platform error handling catching `EEXIST`, `ENOTEMPTY`, and `EPERM` from the underlying system call, failing closed with a clean `ToolError`.
  - Added post-move destination identity validation: verifies destination directory identity (`ino`, `dev`, `isDirectory`) strictly matches the source directory identity to detect any race or substitution.

### FINDING-02: Destination Approval Integrity on Overwrites
- **Issue:** Approvals for file moves only verified the source file content hash, leaving destination overwrites susceptible to TOCTOU attacks where destination files could be swapped, altered, or deleted between user approval and tool execution.
- **Remediation:**
  - Extended `ApprovalPreparation` in `Tool.ts` and `CanonicalApprovalRecord` / `ExpectedValidation` in `ApprovalManager.ts` to include `destinationContentHash` and `DestinationIdentity` (`canonicalPath`, `deviceNumber`, `inodeNumber`, `type`, `exists`).
  - In `MoveFileTool.prepareApproval`, inspected the destination path:
    - If it exists as a regular file, computed its SHA-256 content hash and bound its filesystem identity (`ino`, `dev`, `type: 'file'`, `exists: true`).
    - If it does not exist, bound `exists: false`, `type: 'none'`.
    - If it exists as a directory or symlink, rejected the operation immediately.
  - In `MoveFileTool.execute` and `ApprovalManager.validateAndConsume`, revalidated the destination file's current content hash, file type, and filesystem device/inode numbers. If the destination was modified, replaced, removed, or unexpectedly appeared after approval was granted, execution fails closed with a `SecurityError`.
  - In `WorkspaceManager.moveEntry`, revalidated `expectedDestIdentity` immediately prior to the atomic overwrite rename.
  - In `ToolExecutor.ts`, passed `destinationIdentity` to `createApproval`.

### FINDING-03: Removal of Unsafe Hardlink Fallback
- **Issue:** In `WorkspaceManager.moveEntry`, when non-overwrite `link()` threw an unhandled error, it fell back silently to `rename()`, undermining race-safe non-overwrite semantics on non-hardlink filesystems.
- **Remediation:**
  - Removed the unsafe silent fallback to `rename()`.
  - Configured `WorkspaceManager.moveEntry` to fail closed with `SecurityError("Filesystem does not support atomic link-based non-overwrite relocation (${code})")` whenever `link()` fails with `ENOSYS`, `ENOTSUP`, or `EPERM`.
  - Retained explicit handling for `EEXIST` (throwing `ToolError`) and `EXDEV` (throwing `SecurityError`).

### FINDING-04: Windows NTFS Alternate Data Streams (ADS) Protection
- **Issue:** On Windows NTFS, appending stream syntax (e.g., `.git:stream`, `.env:stream`, `id_rsa:stream`) allowed attackers to bypass basename and segment checks while accessing or manipulating stream data.
- **Remediation:**
  - Updated `WorkspaceManager.isSensitive()` to detect and strip Alternate Data Stream (ADS) syntax across path segments, the basename, and normalized paths.
  - Strictly preserved Windows drive letters (`C:`, `D:`) using `/^[a-z]:$/i` checks.
  - Normalized and stripped trailing spaces and dots per Win32 path rules.
  - Added comprehensive sensitive checks against stripped base, segments, and full normalized path.

### FINDING-05: Genuine Race-Condition Interleaving Regression Tests
- **Issue:** Previous race tests relied on timing assumptions rather than deterministic operation interleaving.
- **Remediation:**
  - Created `lemo-cli/tests/security-hardening-4.3b.2.4.test.mjs` with deterministic interleaving mocks:
    - Simulating destination directory creation immediately prior to rename.
    - Simulating source file inode replacement between hardlink creation and unlinking.
    - Simulating destination file replacement immediately prior to overwrite rename.

### FINDING-06: Approval Record Immutability
- **Issue:** Approval records could theoretically be mutated by callers after creation or validation.
- **Remediation:**
  - Implemented `deepFreeze<T>()` and deep cloning in `ApprovalManager.ts`.
  - Enforced that both stored records and returned approval records from `createApproval` and `validateAndConsume` are deeply frozen immutable objects, ensuring callers cannot mutate records or compromise cryptographic integrity.

---

## 2. Verification & Test Results

### Lemo CLI Test Suite
- `security-hardening-4.3b.2.4.test.mjs`: All 14 tests passed (covering FINDING-01 through FINDING-06).
- Full regression suite across `lemo-cli`: All tests passing (218+ passed, 3 skipped Windows symlink privilege tests, 0 failed).
- TypeScript strict typecheck (`tsc --noEmit`): 0 errors.

### Backend Proxy Verification
- Backend tests (`npm test` in project root): 107 passed, 0 failed.
- Proxy backend files remained strictly untouched (read-only constraint honored).

---

## 3. Files Modified
- `lemo-cli/src/agent/tools/Tool.ts` (added `DestinationIdentity` interface and updated `ApprovalPreparation`)
- `lemo-cli/src/agent/approval/ApprovalManager.ts` (added `DestinationIdentity` re-export, `deepFreeze`, destination content hash and identity validation)
- `lemo-cli/src/agent/workspace/WorkspaceManager.ts` (Windows ADS stream stripping in `isSensitive`, removed hardlink fallback in `moveEntry`, post-move directory identity validation, pre-rename destination identity validation)
- `lemo-cli/src/agent/tools/builtin/MoveFileTool.ts` (bound destination fingerprint and identity in `prepareApproval` and revalidated in `execute`)
- `lemo-cli/src/agent/tools/ToolExecutor.ts` (forwarded `destinationIdentity` to `createApproval`)
- `lemo-cli/tests/security-hardening-4.3b.2.4.test.mjs` (comprehensive regression suite for all 6 findings)
