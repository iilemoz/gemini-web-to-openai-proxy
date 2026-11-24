# Phase 4.3B.2.2 Completion Report — Security Hardening & Approval Validation Fixes

**Date:** November 24, 2026  
**Branch:** `phase-4-lemo-cli`  
**Baseline Commit:** `96d5266` (`feat(phase-4.3b.2): add safe file deletion and relocation tools`)  
**Remediation Commit:** `186ec63` (`fix(phase-4.3b.2): harden git metadata and approval validation`)  

---

## 1. Executive Summary

Phase 4.3B.2.2 delivers targeted security hardening addressing all findings from the Phase 4.3B.2.1 Independent Security Audit (`PHASE_4_3B_2_1_SECURITY_AUDIT_REPORT.md`):
1. **AUD-FINDING-01 (Low):** Protecting Git metadata directory roots (`.git`, `.gitmodules`, `.git-credentials`, `.gitconfig`, and nested `.git` submodules) from deletion or relocation while preserving valid project files (`.gitignore`, `.gitattributes`).
2. **AUD-FINDING-02 (Low):** Enforcing mandatory, bidirectional approval fingerprint validation in `ApprovalManager.validateAndConsume()`, preventing approval bypass by omitting expected hash parameters.
3. **Move Safety Hardening:** Mitigating destination creation races and source replacement TOCTOU races during directory and file moves, with verification of hardlink-based move crash consistency.

All 18 new security regression tests pass. The full CLI test suite passes with 204 passing tests (3 skipped TTY tests, 0 failures), the CLI compiles with zero TypeScript errors, and the root backend proxy test suite passes with 107/107 passing tests.

---

## 2. Remediated Findings & Implementation Details

### 2.1. AUD-FINDING-01: Git Metadata Protection

#### Identified Issue
The audit observed that while specific files like `/.git/config` and `/.git/credentials` were marked sensitive, the `.git` directory root itself and `.gitmodules` files were not explicitly caught by `isSensitive()`. This could allow `delete_file` or `move_file` to delete or relocate `.git` or `.gitmodules` if approved or unapproved.

#### Solution Implemented in `WorkspaceManager.isSensitive()`
- **Segment-Level Path Normalization:**
  ```typescript
  const normalized = path.normalize(filePath).replace(/\\/g, '/').toLowerCase();
  const base = path.basename(normalized);
  const segments = normalized.split('/').filter(Boolean);
  const cleanSegments = segments.map((s) => s.replace(/[. ]+$/g, ''));
  ```
- **Root & Nested Protection:**
  - Blocks any path containing `.git`, `.gitmodules`, `.git-credentials`, or `.gitconfig` as a segment.
  - Rejects `.git` directory roots (`.git`, `./.git`, `dir/../.git`).
  - Rejects submodule metadata directories (`submodule/.git`, `submodule/.git/config`).
  - Rejects Windows NTFS trailing dot and space bypass variants (`.git.`, `.git `, `.gitmodules...`).
  - Case-insensitive: protects `.GIT`, `.GitModules`, `.GitConfig`.
- **Preservation of Non-Metadata Git Files:**
  - Correctly permits standard version-controlled repository files: `.gitignore`, `.gitattributes`, `git-helper.js`, `digit.ts`.

---

### 2.2. AUD-FINDING-02: Mandatory Approval Fingerprint Validation

#### Identified Issue
`ApprovalManager.validateAndConsume()` previously validated hashes (such as `originalContentHash`, `proposedContentHash`, or `destinationCanonicalPath`) conditionally: only if the caller supplied `expected.originalContentHash` or `expected.destinationCanonicalPath`. If a caller omitted the expected hash, the check was skipped, allowing an attacker or bug to bypass fingerprint verification.

#### Solution Implemented in `ApprovalManager.ts`
- **Bidirectional Enforcement:**
  Verification now checks whether the stored approval record expects a fingerprint:
  ```typescript
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
  ```
- **Symmetric Validation for All Fingerprints:**
  - `originalContentHash`: Mandatory when present in record; rejected when missing, empty, null, or mismatched; fails closed if unexpectedly supplied.
  - `proposedContentHash`: Mandatory when present in record; rejected when missing, empty, null, or mismatched; fails closed if unexpectedly supplied.
  - `commandStringHash`: Added to `ExpectedValidation` interface; mandatory when present in record; fails closed if missing, empty, null, mismatched, or unexpectedly supplied.
  - `destinationCanonicalPath`: Required whenever `record.targetPaths.length > 1` or `record.operationType === 'move'`; fails closed if omitted or mismatched; fails closed if unexpectedly supplied for single-target records.
- **Tool Adjustments:**
  `DeleteFileTool.ts` and `MoveFileTool.ts` updated to omit `originalContentHash` cleanly when operating on non-modify operations or empty directories.

---

### 2.3. Move Operation Race & Integrity Hardening

#### Solutions Implemented in `WorkspaceManager.moveEntry()`
1. **Directory Move Destination Creation Race:**
   Immediately before executing `fs.promises.rename(canonicalSource, canonicalDest)`, revalidates destination non-existence using `fs.promises.lstat(canonicalDest)`. If the destination was created concurrently, the operation fails safely with `ToolError`.
2. **Directory Move Source Identity Validation:**
   Before directory rename, validates that `currentSourceStat.isDirectory()` and matching `ino` / `dev` to ensure the source directory was not swapped.
3. **Overwrite File Move Source Identity Validation:**
   Before atomic overwrite rename, revalidates source file identity (`ino` and `dev`).
4. **Non-Overwrite Hardlink Move Source Identity Validation:**
   When moving via `fs.promises.link` + `fs.promises.unlink`, verifies source file identity (`ino` and `dev`) immediately prior to `fs.promises.unlink(canonicalSource)`. If the source file was replaced between link and unlink, unlink is aborted and a `SecurityError` is thrown, preventing deletion of the replaced file.
5. **Hardlink Move Crash Consistency:**
   If a crash occurs between `link` and `unlink`, the target data exists safely at both paths without data loss.

---

## 3. Affected Files

| File | Change Type | Purpose |
|------|-------------|---------|
| `lemo-cli/src/agent/workspace/WorkspaceManager.ts` | Modified | Git metadata protection in `isSensitive()`; destination race and source identity validation in `moveEntry()` |
| `lemo-cli/src/agent/approval/ApprovalManager.ts` | Modified | Mandatory bidirectional validation for all approval digest fingerprints (`originalContentHash`, `proposedContentHash`, `commandStringHash`, `destinationCanonicalPath`) |
| `lemo-cli/src/agent/tools/builtin/DeleteFileTool.ts` | Modified | Clean propagation of `originalContentHash` when defined |
| `lemo-cli/src/agent/tools/builtin/MoveFileTool.ts` | Modified | Clean propagation of `originalContentHash` when defined |
| `lemo-cli/tests/security-hardening-4.3b.2.test.mjs` | Added | 18 regression tests covering AUD-FINDING-01, AUD-FINDING-02, and Move Safety |

---

## 4. Verification & Test Results

### 4.1. Dedicated Security Hardening Regression Suite
Executed: `node --test tests/security-hardening-4.3b.2.test.mjs`  
Result: **18 tests passed, 0 failed**

```text
✔ 1. WorkspaceManager.isSensitive rejects .git root directory (1.14ms)
✔ 2. WorkspaceManager.isSensitive rejects .gitmodules (0.33ms)
✔ 3. WorkspaceManager.isSensitive rejects nested .git paths (0.32ms)
✔ 4. WorkspaceManager.isSensitive rejects case variations (.GIT, .GitModules) (0.34ms)
✔ 5. WorkspaceManager.isSensitive rejects alternate path representations (./.git, foo/../.git) (0.43ms)
✔ 6. WorkspaceManager.isSensitive allows normal files (.gitignore, .gitattributes, git-helper.js) (0.35ms)
✔ 7. DeleteFileTool rejects deletion of .git directory root (0.64ms)
✔ 8. DeleteFileTool rejects deletion of .gitmodules (0.45ms)
✔ 9. MoveFileTool rejects moving .git directory root (0.50ms)
✔ 10. MoveFileTool rejects moving .gitmodules (0.44ms)
✔ 11. ApprovalManager fails closed when required originalContentHash is missing (0.58ms)
✔ 12. ApprovalManager fails closed when originalContentHash is null or empty string (0.41ms)
✔ 13. ApprovalManager fails closed when originalContentHash does not match (0.43ms)
✔ 14. ApprovalManager succeeds when valid originalContentHash is provided (0.53ms)
✔ 15. ApprovalManager succeeds for file creation where originalContentHash is not in digest (0.45ms)
✔ 16. ApprovalManager fails closed if unexpected originalContentHash is provided for record without one (0.44ms)
✔ 17. ApprovalManager fails closed if destinationCanonicalPath is omitted for multi-target approval (0.41ms)
✔ 18. MoveFileTool and WorkspaceManager move hardening prevents destination collision race and verifies identity (5.75ms)
ℹ tests 18 | pass 18 | fail 0 | cancelled 0 | skipped 0 | todo 0
```

### 4.2. CLI TypeScript Compilation & Typecheck
Executed: `npm run build && npm run typecheck`  
Result: **0 errors**

### 4.3. Full Lemo CLI Test Suite
Executed: `npm test`  
Result: **204 passed, 3 skipped (TTY tests), 0 failed (207 total tests)**

### 4.4. Backend Proxy Test Suite
Executed: `npm test` at workspace root  
Result: **107 passed, 0 failed**

---

## 5. Security Guarantees & Scope Adherence

1. **Repository Integrity Guarantee:** Git metadata roots (`.git`), submodules (`.gitmodules`), credentials (`.git-credentials`), and configurations (`.gitconfig`) cannot be deleted, overwritten, or relocated by CLI filesystem tools under any circumstances.
2. **Approval Cryptographic Binding Guarantee:** Stored approval records cannot be consumed with omitted or mismatched payload digests. Every parameter registered in the approval payload digest must be affirmatively supplied and verified.
3. **Move Integrity Guarantee:** Directory moves will not silently replace concurrently created destinations. Hardlink file moves will not unlink source files if replaced concurrently.
4. **Scope Boundaries Preserved:** No terminal execution (`run_command`), shell subprocesses, or unrelated features were introduced.
