# Phase 4.3B.2 Completion Report
## Safe Deletion & Relocation Tools

**Project:** Lemo CLI — Standalone Terminal AI Assistant & Coding Agent  
**Branch:** `phase-4-lemo-cli`  
**Baseline Commit:** `7393523`  
**Phase:** 4.3B.2 — Controlled Filesystem Tools (`delete_file`, `move_file`)  
**Status:** Completed & Verified  

---

## 1. Executive Summary

Phase 4.3B.2 extends Lemo CLI's controlled filesystem write suite by implementing two privileged file management tools:
1. `delete_file`: Deletes regular files, empty directories, and symbolic links within the canonical workspace under cryptographic approval.
2. `move_file`: Safely relocates files and directories within the workspace with dual boundary containment, root protection, descendant move prevention, and race-safe non-overwrite semantics.

Both tools integrate seamlessly with the RFC 8785 JSON Canonicalization Scheme (JCS) and HMAC-SHA256 cryptographic approval system established in Phase 4.3B.1. In addition, the security audit finding **SEC-AUD-01** (recursive stale temporary file cleanup) was resolved in `WorkspaceManager`.

---

## 2. Deliverables & Architectural Enhancements

### A. WorkspaceManager Security Extensions (`WorkspaceManager.ts`)
- **`resolvePathNoFollow(targetPath: string): string`**:
  - Resolves target paths within the workspace without dereferencing leaf symbolic links.
  - Verifies that all ancestor directories reside strictly inside the canonical workspace root.
  - Prevents symlink dereferencing when deleting or moving links, ensuring the link itself is modified while the target remains unmolested.
  - Immediately recognizes the canonical workspace root and prevents bypasses.
- **`assertNotDescendant(sourcePath: string, destinationPath: string): void`**:
  - Verifies that `destinationPath` is not equal to or contained within `sourcePath`.
  - Prevents catastrophic directory move loops and filesystem corruption.
- **`deleteEntry(targetPath: string)`**:
  - Rejects deletion of the workspace root (`SecurityError`).
  - Enforces `assertNotSensitive(canonicalTarget)`.
  - Inspects file type using `fs.promises.lstat`:
    - **Symbolic Link:** Unlinks the symlink using `fs.promises.unlink` without dereferencing or touching the target.
    - **Directory:** Inspects child entries using `fs.promises.readdir`. If directory is non-empty (`entries.length > 0`), throws `SecurityError('Cannot delete non-empty directory... Recursive deletion is not supported')`. Empty directories are removed via `fs.promises.rmdir`.
    - **Regular File:** Unlinks the file and reports `bytesDeleted`.
    - **Special Files (FIFOs, sockets, devices):** Throws `SecurityError`.
- **`moveEntry(sourcePath, destinationPath, options)`**:
  - Validates that both source and destination are securely contained within the workspace root.
  - Rejects workspace root as source or destination.
  - Enforces `assertNotSensitive` on both source and destination.
  - Validates that the destination parent directory exists and is canonical within the workspace.
  - **Directory Moves:** Enforces `assertNotDescendant`. Rejects moving directories over existing files or directories.
  - **Regular File Moves:**
    - If `overwrite !== true`: Enforces atomic race-safe non-overwrite semantics using `fs.promises.link` followed by `fs.promises.unlink`. If destination exists, the kernel atomically returns `EEXIST`, preventing race conditions.
    - If `overwrite === true`: Rejects overwriting directories with files, rejects overwriting symlinks, and performs atomic replacement via `fs.promises.rename`.
  - **Symlink Moves:** Renames the symlink itself without modifying the underlying target.
- **Recursive Temp File Cleanup (`cleanStaleTempFiles`)**:
  - Recursively sweeps nested subdirectories in the workspace root to clean orphaned `.lemo_tmp_` files older than `maxAgeMs`.

### B. Controlled Deletion Tool (`DeleteFileTool.ts`)
- **Tool Name:** `delete_file`
- **Schema:** Requires `path: string`.
- **Permissions:** `['file_delete']`.
- **Approval Integration:**
  - `prepareApproval`: Resolves target without dereferencing symlinks, checks sensitivity, computes SHA-256 fingerprint (`originalContentHash`) for regular files, detects empty vs. non-empty directories, and produces formatted previews.
  - `execute`: Verifies the single-use HMAC-SHA256 approval token, re-validates workspace identity (`dev`/`ino`), re-verifies file content fingerprint against concurrent modification, and invokes `WorkspaceManager.deleteEntry`.

### C. Controlled Relocation Tool (`MoveFileTool.ts`)
- **Tool Name:** `move_file`
- **Schema:** Requires `source_path: string` (alias `source`), `destination_path: string` (alias `destination`), and optional `overwrite: boolean` (default `false`).
- **Permissions:** `['file_create', 'file_modify', 'file_delete']`.
- **Approval Integration:**
  - `prepareApproval`: Validates dual boundary containment, asserts `assertNotDescendant`, computes source fingerprint, checks destination existence against `overwrite`, and binds both source and destination canonical paths in the cryptographic record.
  - `execute`: Validates and consumes the approval token (enforcing dual target validation in `ApprovalManager`), re-validates source content fingerprint, and performs relocation via `WorkspaceManager.moveEntry`.

### D. Approval Manager Extensions (`ApprovalManager.ts`)
- Extended `ExpectedValidation` to include `destinationCanonicalPath`.
- Validates that both source and destination paths match the issued canonical approval record before consuming the single-use token.

### E. Session & Tool Registration Integration
- Registered `delete_file` and `move_file` in `AgentSession.ts`.
- Exported both tools and schemas in `lemo-cli/src/agent/tools/builtin/index.ts`.

---

## 3. Security Regression Test Suite (`tests/delete-move-tools.test.mjs`)

A dedicated 23-test suite was implemented covering all invariants:

| # | Test Scenario | Expected Outcome | Status |
|---|---|---|---|
| 1 | Regular file deletion | Successful unlink with valid approval | **PASS** |
| 2 | Empty directory deletion | Successful `rmdir` with valid approval | **PASS** |
| 3 | Non-empty directory deletion | Rejected with `SecurityError` (recursive deletion strictly prohibited) | **PASS** |
| 4 | Workspace root deletion | Rejected with `SecurityError` | **PASS** |
| 5 | Path traversal deletion escape (`../../etc/passwd`) | Rejected with `SecurityError` | **PASS** |
| 6 | Sensitive file deletion (`.env`, `id_rsa`, `credentials.json`) | Rejected with `SecurityError` | **PASS** |
| 7 | Symlink deletion | Symlink unlinked, target file 100% intact | **PASS** |
| 8 | Target substitution after approval | Rejected by `ApprovalManager` | **PASS** |
| 9 | Content tampering before deletion | Rejected by content fingerprint validation | **PASS** |
| 10 | Regular file relocation | Moved atomically to destination | **PASS** |
| 11 | Parameter aliases (`source` / `destination`) | Handled cleanly and identically | **PASS** |
| 12 | Directory relocation | Moved cleanly to destination path | **PASS** |
| 13 | Descendant directory move (`parent -> parent/sub/nested`) | Rejected with `SecurityError` | **PASS** |
| 14 | Workspace root as move source or destination | Rejected with `SecurityError` | **PASS** |
| 15 | Move to existing destination without overwrite | Rejected with `ToolError` | **PASS** |
| 16 | Move to existing destination with `overwrite: true` | Replaced atomically with approval | **PASS** |
| 17 | Overwrite directory with file | Rejected with `SecurityError` | **PASS** |
| 18 | Sensitive file relocation (as source or destination) | Rejected with `SecurityError` | **PASS** |
| 19 | Destination tampering / hijacking after approval | Rejected by `ApprovalManager` | **PASS** |
| 20 | StrictApprovalPolicy enforcement | Denies unapproved deletion/move | **PASS** |
| 21 | AutoApprovalPolicy deletion execution | Approved and executed | **PASS** |
| 22 | AutoApprovalPolicy relocation execution | Approved and executed | **PASS** |
| 23 | Recursive stale temp file sweep (SEC-AUD-01) | Sweeps nested temp files | **PASS** |

---

## 4. Test Verification Summary

- **TypeScript Compilation:** Zero errors (`npm run typecheck`, `npm run build`).
- **Phase 4.3B.2 Test Suite:** 23/23 tests passed (`node --test tests/delete-move-tools.test.mjs`).
- **All Lemo CLI Tests:** 189 tests executed, 186 passed, 3 skipped (platform-specific symlink permissions), 0 failed.
- **Backend Proxy Test Suite:** 107/107 tests passed with zero regressions.

---

## 5. Scope Boundaries Confirmation

- **No Shell / Terminal Execution:** No `run_command`, `exec`, `spawn`, or terminal execution tools were introduced.
- **No Recursive Directory Deletion:** Recursive directory deletion (`rm -rf`) remains strictly forbidden.
- **No Browser Automation:** No browser or external network automation was introduced.
- **Backend Untouched:** Zero changes made to proxy server codebase or contracts.
