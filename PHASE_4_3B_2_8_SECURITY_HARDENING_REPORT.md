# Phase 4.3B.2.8 Security Hardening Report
## Verified Rollback, Fail-Closed Overwrite Semantics, Capability Integrity & Crash Recovery

**Date:** 2026-11-25  
**Branch:** `phase-4-lemo-cli`  
**Baseline Commit:** `bed267c7639e3662d3204f1051f68da660bdc360`  
**Target Commit Message:** `fix(phase-4.3b.2): harden rollback and filesystem capability integrity`  
**Audit Reference:** `PHASE_4_3B_2_7_INDEPENDENT_SECURITY_AUDIT.md`  

---

## 1. Executive Summary

Phase 4.3B.2.8 is a narrowly scoped security remediation addressing all four actionable findings identified in `PHASE_4_3B_2_7_INDEPENDENT_SECURITY_AUDIT.md`:

1. **FINDING-01 (Verified Rollback Invariant Enforcement):**  
   The destination displacement rollback mechanism in `WorkspaceManager.moveEntry()` now binds and validates the displaced backup file's identity (regular file, device number, inode number, and SHA-256 content digest) against the state captured immediately upon displacement. Rollback verifies that the destination path is unoccupied before attempting to restore. If the backup is tampered with, missing, or the destination is unexpectedly occupied, rollback aborts and fails closed with a descriptive `SecurityError`, preserving all files on disk for forensic inspection and manual reconciliation.

2. **FINDING-02 (Fail-Closed Overwrite Semantics):**  
   `safeDestinationOverwrite` is now actively enforced across all overwrite validation paths. In `MoveFileTool.prepareApproval`, `MoveFileTool.execute`, and `WorkspaceManager.moveEntry`, if `safeDestinationOverwrite` is false and destination overwrite is requested (`overwrite: true`), the operation immediately fails closed with `SecurityError("Destination overwrite disabled: safe destination displacement and rollback ('safeDestinationOverwrite') is unavailable on this platform/runtime")`.

3. **FINDING-03 (Crash Recovery & Stale Staging Sweeper):**  
   `WorkspaceManager.cleanStaleTempFiles()` was extended to safely identify and process `.lemo_bkp_*` files alongside `.lemo_tmp_*` files. Crash recovery is backed by a transactional sidecar journal (`.journal.json`) containing the canonical target path, expected hash, and timestamp. Crash recovery enforces strict fail-safe invariants: it **never** overwrites an existing destination file, verifies SHA-256 content integrity against the journal, validates path containment within the workspace root, and leaves ambiguous or tampered backup files untouched for manual inspection.

4. **FINDING-04 (Capability Override Integrity):**  
   In `PlatformCapabilities.ts`, the insecure `LEMO_FORCE_NATIVE_RENAME_NOREPLACE` environment variable override was eliminated. Platform capability discovery for `atomicDirectoryNoReplace` now strictly requires a callable native binding function (`globalThis.__lemo_native_rename_noreplace`) or verified native NTFS kernel refusal behavior. Non-callable values (such as strings or objects) and arbitrary environment flags are ignored.

---

## 2. Detailed Findings & Remediations

### FINDING-01: Verified Rollback & Invariant Enforcement

- **Risk:** During destination displacement in overwrite moves, if verification fails, an unverified rollback could restore a tampered backup file or clobber an unexpected entity that appeared at the destination during the operation.
- **Implementation in `WorkspaceManager.ts`:**
  - `moveEntry()` records `capturedDisplacedStat` and `capturedDisplacedHash` immediately following displacement of the destination file to `.lemo_bkp_<basename>_<nonce>.tmp`.
  - The `rollbackDestination()` closure performs strict pre-restoration checks:
    1. Checks if the destination path is already occupied. If occupied, rollback aborts to prevent clobbering new data.
    2. Validates that the displaced file exists and is a regular file.
    3. Validates device ID and inode number match `capturedDisplacedStat`.
    4. Computes SHA-256 digest of the backup file and verifies it matches `capturedDisplacedHash`.
  - If any check fails, rollback aborts, preserving both the backup file and destination path, and throws `SecurityError` with detailed diagnostics for manual reconciliation.
  - If all checks pass, `fs.renameSync` restores the backup to the canonical destination, and the original error is re-thrown.

### FINDING-02: Fail-Closed Overwrite Semantics

- **Risk:** If a runtime or platform lacked the `safeDestinationOverwrite` capability, moving with `overwrite: true` could proceed without displacement guarantees or fail open.
- **Implementation:**
  - Added enforcement in `MoveFileTool.prepareApproval`: rejects `overwrite: true` if `!this.workspace.getCapabilities().safeDestinationOverwrite`.
  - Added enforcement in `MoveFileTool.execute`: rejects `overwrite: true` before execution if `!this.workspace.getCapabilities().safeDestinationOverwrite`.
  - Added enforcement in `WorkspaceManager.moveEntry`: throws `SecurityError` if `overwrite: true` and `!this.capabilities.safeDestinationOverwrite`.

### FINDING-03: Crash Recovery & Stale Staging Sweeper

- **Risk:** If the agent crashed or was terminated during the narrow window between destination displacement and final move/unlink, displaced backup files (`.lemo_bkp_*`) would remain orphaned or potentially clobber newer files during naive recovery.
- **Implementation in `WorkspaceManager.ts`:**
  - Displaced backup files write a sidecar journal (`.journal.json`) containing `targetCanonical`, `expectedHash`, and `timestamp`.
  - `cleanStaleTempFiles(maxAgeMs)` scans the workspace recursively for `.lemo_bkp_*` files:
    - Skips files currently registered in `activeGlobalTempFiles`.
    - Skips files newer than `maxAgeMs`.
    - Invokes `recoverStaleBackupEntry(bkpPath, stat)`:
      - Validates journal existence and parsability.
      - Enforces that journal `targetCanonical` resolves within the workspace root and is not a symlink.
      - Enforces that `targetCanonical` does not already exist on disk (never clobber existing files during crash recovery).
      - Computes SHA-256 of the backup file and ensures it matches `expectedHash`.
      - If valid, restores `bkpPath` to `targetCanonical` via `fs.renameSync` and deletes the journal.
      - If destination already exists, hash mismatches, or journal is missing/corrupt, the backup file is preserved untouched.

### FINDING-04: Capability Override Integrity

- **Risk:** Relying on unverified environment variables like `LEMO_FORCE_NATIVE_RENAME_NOREPLACE` allows untrusted external configuration or parent environments to falsely claim native kernel guarantees when none exist.
- **Implementation in `PlatformCapabilities.ts`:**
  - Removed `process.env['LEMO_FORCE_NATIVE_RENAME_NOREPLACE']`.
  - In `probeDirectoryCollision()`, checking `globalThis.__lemo_native_rename_noreplace` strictly validates `typeof candidate === 'function'`.
  - On non-Windows platforms without a callable native binding, directory collision is empirically probed; if empty directories can be replaced, `atomicDirectoryNoReplace` is strictly `false`.

---

## 3. Verification & Test Suite

### Dedicated Test Suite: `lemo-cli/tests/security-hardening-4.3b.2.8.test.mjs`

14 comprehensive security tests covering all four findings and regressions:
1. **FINDING-01:**
   - Aborts rollback and preserves backup when displaced backup content is tampered before rollback.
   - Aborts rollback and preserves entries when destination is unexpectedly occupied during rollback.
2. **FINDING-02:**
   - Disables destination overwrite when `safeDestinationOverwrite` is false.
3. **FINDING-03:**
   - Recovers displaced backup when destination does not exist and hash matches journal.
   - Preserves backup untouched when destination already exists (never overwrites during recovery).
   - Preserves backup untouched when backup content hash does not match journal expected hash.
   - Preserves ambiguous backup files when journal is corrupted or missing.
   - Rejects path traversal and symlinks in journal targetCanonical.
4. **FINDING-04:**
   - Neutralizes `LEMO_FORCE_NATIVE_RENAME_NOREPLACE` environment variable.
   - Requires callable native implementation for native bindings.
5. **Regression Suite:**
   - `WriteFileTool` creates files atomically and enforces containment.
   - `EditFileTool` performs surgical edits cleanly.
   - `DeleteFileTool` deletes files and empty directories safely.
   - `MoveFileTool` performs race-safe non-overwrite hardlink move.

### Test Results

- **`lemo-cli` Test Suite (`npm test --prefix lemo-cli`):**
  - **251 total tests:** 248 passed, 0 failed, 3 skipped (Windows symlink elevation tests).
  - TypeScript build (`npm run build --prefix lemo-cli`): 0 compilation errors.
- **Root Proxy Backend Test Suite (`npm test`):**
  - **107 total tests:** 107 passed, 0 failed, 0 skipped.
- **Cumulative Test Count:** 358 tests passing across the entire repository.

---

## 4. Git Status & Untracked Reports Preservation

The 8 pre-existing untracked audit and architecture reports remain untouched:
- `PHASE_4_3A_2_SECURITY_VERIFICATION_REPORT.md`
- `PHASE_4_3B_0_1_REVISED_SECURITY_ARCHITECTURE.md`
- `PHASE_4_3B_0_ARCHITECTURE_SECURITY_DESIGN.md`
- `PHASE_4_3B_1_1_SECURITY_AUDIT_REPORT.md`
- `PHASE_4_3B_2_1_SECURITY_AUDIT_REPORT.md`
- `PHASE_4_3B_2_3_INDEPENDENT_SECURITY_AUDIT.md`
- `PHASE_4_3B_2_5_INDEPENDENT_SECURITY_AUDIT.md`
- `PHASE_4_3B_2_7_INDEPENDENT_SECURITY_AUDIT.md`

All code modifications are confined strictly to `lemo-cli/src/agent/workspace/` and `lemo-cli/tests/`. The root proxy backend (`src/` and root `tests/`) is 100% untouched.
