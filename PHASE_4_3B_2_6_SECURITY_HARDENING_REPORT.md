# Phase 4.3B.2.6 Security Hardening Report
## Final Filesystem Race Hardening & Platform Capability Enforcement

**Date:** 2026-11-25  
**Branch:** `phase-4-lemo-cli`  
**Baseline Commit:** `aaf1ae94fa78fe759d2d06f05bcac26428458ff5`  
**Objective:** Remediate the three residual filesystem race conditions identified in the Phase 4.3B.2.5 independent security audit by establishing an explicit Platform Capability Architecture and enforcing strict fail-closed operations whenever required atomic filesystem primitives are unavailable.

---

## 1. Executive Summary

Phase 4.3B.2.6 addresses the three critical findings identified in the Phase 4.3B.2.5 audit:

1. **Finding 01 (POSIX Directory Move Atomic No-Replace):** Standard POSIX `rename(2)` silently overwrites empty destination directories. Lemo CLI now dynamically probes and verifies whether the runtime environment supports atomic directory no-replace (`atomicDirectoryNoReplace`), such as native `renameat2(..., RENAME_NOREPLACE)` on Linux, `renamex_np(..., RENAME_EXCL)` on macOS, or Windows NTFS directory collision refusal (`EPERM`). In environments lacking kernel-level atomic no-replace guarantees, directory relocation fails closed immediately with `SecurityError`.
2. **Finding 02 (Destination Overwrite Identity Race):** To eliminate the TOCTOU gap between pre-move approval verification and the final `rename(2)` overwrite, a verified displacement and rollback strategy (`safeDestinationOverwrite`) was implemented. The approved destination file is first displaced to a nonce temporary backup file in the same directory. The displaced object is then strictly verified (file type, device number, inode number, and SHA-256 content digest). If any check fails, the destination is immediately restored, the source remains untouched, and the operation fails closed.
3. **Finding 03 (Hardlink + Unlink Source Race Fail-Closed Recovery):** When an asynchronous race modifies or replaces the source file after the destination hardlink is created but before the source is unlinked, unlinking is immediately aborted to prevent data loss. Renaming fallback is strictly prohibited. The destination hardlink is preserved, and a detailed `SecurityError` is raised providing full recovery diagnostics and instructions for manual reconciliation.
4. **Safe Source Entry Removal in Deletions:** In `WorkspaceManager.deleteEntry()`, file identity is revalidated immediately before calling `unlink(2)`. If the target inode or device changed after approval/initial inspection, deletion is aborted and fails closed with `SecurityError`.

All 237 test suites in `lemo-cli` pass cleanly with 0 failures, TypeScript compiles with 0 errors, and all 107 proxy backend tests pass.

---

## 2. Unresolved Audit Findings & Remediations

### Finding 01: POSIX Directory Move Atomic No-Replace

- **Vulnerability / Risk:** Under POSIX standards, `rename(old, new)` silently replaces `new` if `new` is an existing empty directory. A simple userland check (`fs.existsSync` or `lstat`) before `rename` leaves an exploitable TOCTOU window where an attacker could place an empty directory at `new`, causing silent replacement and loss of directory hierarchy.
- **Architectural Remediation:**
  - Introduced `FilesystemCapabilities.atomicDirectoryNoReplace`.
  - Probed empirically via `PlatformCapabilityRegistry.probe()`:
    - Checks for explicit native bindings or runtime environment capabilities.
    - On Windows (NTFS), verified that `MoveFileExW` without replace flags refuses directory overwrite with `EPERM`.
    - On POSIX without native no-replace flags, probes standard directory collision behavior; if empty directory overwrite succeeds, `atomicDirectoryNoReplace` evaluates to `false`.
  - In `MoveFileTool.prepareApproval`, `MoveFileTool.execute`, and `WorkspaceManager.moveEntry`, directory relocation fails closed with `SecurityError("Directory relocation disabled: atomic no-replace capability ('atomicDirectoryNoReplace' via renameat2/renamex_np) is unavailable on this platform/runtime")` whenever this capability is `false`.

### Finding 02: Destination Overwrite Identity Race

- **Vulnerability / Risk:** When `overwrite: true` is authorized, standard `rename(src, dest)` atomically clobbers whatever exists at `dest` at the instant of execution. An unapproved process could swap the destination file between approval validation and rename execution, causing the agent to overwrite an unintended object.
- **Architectural Remediation:**
  - Introduced `FilesystemCapabilities.safeDestinationOverwrite`.
  - Implemented verified displacement and staging:
    1. The approved destination file is displaced to `.lemo_bkp_<basename>_<nonce>.tmp` in the same directory.
    2. The displaced object is registered in `WorkspaceManager.activeGlobalTempFiles` to ensure cleanup on abnormal exit.
    3. The displaced file is inspected against approved identity:
       - Verified to be a regular file (`isFile()`).
       - Inode number and device number match `expectedDestIdentity`.
       - SHA-256 digest matches `expectedDestContentHash`.
       - Current source file identity matches original source stat.
    4. If any check fails, destination is rolled back: `rename(displaced, canonicalDest)` and fails closed.
    5. On successful replacement, the displaced backup file is unlinked.

### Finding 03: Hardlink + Unlink Source Race Fail-Closed Recovery

- **Vulnerability / Risk:** For non-overwrite file moves, atomic hardlink creation (`link(src, dest)`) followed by unlinking (`unlink(src)`) prevents destination clobbering. However, if the source file is modified or substituted between `link` and `unlink`, unlinking the source path would destroy the new/tampered source file.
- **Architectural Remediation:**
  - Revalidated source inode and device immediately prior to `unlink(canonicalSource)`.
  - If source identity changed:
    - Source unlinking is immediately aborted (protecting the new source content from destruction).
    - Destination link is preserved intact at `canonicalDest`.
    - Renaming fallback is strictly forbidden.
    - Fails closed with informative `SecurityError`:
      `"Source file identity changed prior to unlinking in move operation (destination hardlink preserved at '<dest>'; source entry unlinking aborted to prevent data loss; manual reconciliation required)"`.

---

## 3. Platform Capability Architecture

### Capability Interface (`PlatformCapabilities.ts`)

```typescript
export interface FilesystemCapabilities {
  readonly atomicDirectoryNoReplace: boolean;
  readonly safeDestinationOverwrite: boolean;
  readonly safeSourceEntryRemoval: boolean;
  readonly secureFileRelocation: boolean;
}
```

### Capability Probing & Registry

- `PlatformCapabilityRegistry.probe(scratchDir?: string)` empirically tests the active filesystem in a temporary scratch directory.
- Results are cached for process lifetime unless explicitly reset via `PlatformCapabilityRegistry.reset()`.
- `WorkspaceManager` constructor accepts optional custom capabilities for deterministic testing and policy enforcement:
  `new WorkspaceManager(root, { capabilities: { atomicDirectoryNoReplace: false } })`.
- Workspace capabilities are accessible via `workspace.getCapabilities()`.

---

## 4. Verification & Test Suite

A dedicated regression test suite was implemented in `lemo-cli/tests/security-hardening-4.3b.2.6.test.mjs`:

1. **Platform Capability Registry & Empirical Probing:**
   - Probes runtime capabilities and returns valid boolean flags.
   - Respects caching and reset lifecycle.
   - Accepts custom capability overrides in `WorkspaceManager`.
2. **Finding 01: POSIX Directory Move Atomic No-Replace:**
   - Fails closed in `moveEntry` when `atomicDirectoryNoReplace` is `false`.
   - Fails closed in `MoveFileTool.prepareApproval` and `execute`.
   - Allows clean directory move when `atomicDirectoryNoReplace` is `true`.
3. **Finding 02: Destination Overwrite Identity Race & Verified Displacement:**
   - Fails closed when `safeDestinationOverwrite` is `false`.
   - Verified displacement and replacement succeeds cleanly on valid destination identity and hash.
   - Rolls back displaced destination intact when content hash is tampered.
   - Rolls back displaced destination intact when destination inode is tampered.
   - Cleans up temporary staging files in all code paths.
4. **Finding 03: Hardlink + Unlink Source Race Fail-Closed Recovery:**
   - Fails closed when `secureFileRelocation` is `false`.
   - Preserves destination link, aborts source unlinking, and preserves modified source when source identity changes between hardlink and unlink.
5. **Safe Source Entry Removal in Deletions:**
   - Aborts unlinking and fails closed with `SecurityError` if target file identity changes before deletion unlink.

### Comprehensive Test Results

- **`lemo-cli` Test Suite:** 237 tests executed across 29 test suites:
  - **Pass:** 234
  - **Fail:** 0
  - **Skipped:** 3 (optional bash/powershell spawn tests)
- **TypeScript Typecheck:** `tsc --noEmit` produced **0 errors**.
- **Backend Proxy Test Suite:** 107 tests executed:
  - **Pass:** 107
  - **Fail:** 0

---

## 5. Modified & Added Files

- `lemo-cli/src/agent/workspace/PlatformCapabilities.ts` (New module: platform capability interface, registry, and empirical probes).
- `lemo-cli/src/agent/workspace/WorkspaceManager.ts` (Integrated capability checks, verified destination displacement/rollback, pre-unlink validation).
- `lemo-cli/src/agent/tools/builtin/MoveFileTool.ts` (Integrated capability checks and destination content hash passing).
- `lemo-cli/tests/security-hardening-4.3b.2.6.test.mjs` (New comprehensive test suite covering all 3 findings).
- `PHASE_4_3B_2_6_SECURITY_HARDENING_REPORT.md` (This documentation report).

---

## 6. Pre-existing Markdown Reports Protection

All 7 pre-existing untracked markdown reports remain untouched:
- `PHASE_4_3A_2_SECURITY_VERIFICATION_REPORT.md`
- `PHASE_4_3B_0_1_REVISED_SECURITY_ARCHITECTURE.md`
- `PHASE_4_3B_0_ARCHITECTURE_SECURITY_DESIGN.md`
- `PHASE_4_3B_1_1_SECURITY_AUDIT_REPORT.md`
- `PHASE_4_3B_2_1_SECURITY_AUDIT_REPORT.md`
- `PHASE_4_3B_2_3_INDEPENDENT_SECURITY_AUDIT.md`
- `PHASE_4_3B_2_5_INDEPENDENT_SECURITY_AUDIT.md`
