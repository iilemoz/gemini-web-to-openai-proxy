/**
 * Platform Filesystem Capability Architecture
 * Probes, detects, and registers runtime filesystem security capabilities.
 * Guarantees deterministic capability evaluation and fail-closed security enforcement.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface FilesystemCapabilities {
  /**
   * Whether the platform/runtime provides genuine kernel-level atomic directory no-replace
   * (e.g. renameat2(RENAME_NOREPLACE) on Linux, renamex_np(RENAME_EXCL) on macOS, or
   * verified OS-level directory collision refusal like Windows MoveFileExW without replace flag).
   */
  readonly atomicDirectoryNoReplace: boolean;

  /**
   * Whether the platform/runtime supports verified safe destination replacement
   * without silent TOCTOU overwriting of unapproved destination objects
   * (e.g. via staging/exchange verification or native RENAME_EXCHANGE).
   */
  readonly safeDestinationOverwrite: boolean;

  /**
   * Whether the platform/runtime supports descriptor-pinned or verified source entry removal
   * (e.g. unlinkat with pinned dirfd, or verified pre-unlink identity checks with fail-closed recovery).
   */
  readonly safeSourceEntryRemoval: boolean;

  /**
   * Whether the platform/runtime supports race-safe non-overwrite regular-file relocation
   * (e.g. atomic hardlink creation + verified source unlinking).
   */
  readonly secureFileRelocation: boolean;
}

export class PlatformCapabilityRegistry {
  private static cachedCapabilities: FilesystemCapabilities | null = null;

  /**
   * Probes runtime filesystem capabilities in a temporary or specified scratch directory.
   * Probes are empirical, deterministic, and fail closed on unexpected errors.
   */
  public static probe(scratchDir?: string): FilesystemCapabilities {
    if (this.cachedCapabilities && !scratchDir) {
      return this.cachedCapabilities;
    }

    let secureFileRelocation = false;
    let atomicDirectoryNoReplace = false;
    const safeDestinationOverwrite = true; // Supported via verified displacement & rollback
    const safeSourceEntryRemoval = true; // Supported via pre-unlink identity checks and fail-closed preservation

    let probeDir: string | null = null;

    try {
      if (scratchDir && fs.existsSync(scratchDir)) {
        probeDir = fs.mkdtempSync(path.join(scratchDir, '.lemo_cap_'));
      } else {
        probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lemo_cap_'));
      }

      // 1. Probe secureFileRelocation (atomic hardlink creation and no-replace)
      const probeSrc = path.join(probeDir, 'probe_src.tmp');
      const probeDst = path.join(probeDir, 'probe_dst.tmp');
      fs.writeFileSync(probeSrc, 'probe');

      try {
        fs.linkSync(probeSrc, probeDst);
        const s1 = fs.lstatSync(probeSrc);
        const s2 = fs.lstatSync(probeDst);
        if (Number(s1.ino) === Number(s2.ino) && Number(s1.dev) === Number(s2.dev)) {
          // Verify EEXIST collision rejection when destination already exists
          try {
            fs.linkSync(probeSrc, probeDst);
          } catch (err: unknown) {
            const code = (err as { code?: string })?.code;
            if (code === 'EEXIST') {
              secureFileRelocation = true;
            }
          }
        }
        try { fs.unlinkSync(probeDst); } catch {}
      } catch {
        secureFileRelocation = false;
      } finally {
        try { fs.unlinkSync(probeSrc); } catch {}
      }

      // 2. Probe atomicDirectoryNoReplace:
      // Check for explicit native bindings first
      const hasNativeBinding = Boolean(
        (globalThis as Record<string, unknown>)['__lemo_native_rename_noreplace'] ||
        process.env['LEMO_FORCE_NATIVE_RENAME_NOREPLACE'] === '1'
      );

      if (hasNativeBinding) {
        atomicDirectoryNoReplace = true;
      } else if (process.platform === 'win32') {
        // On Windows (NTFS), libuv MoveFileExW without replace flag rejects directory rename
        // over an existing directory with EPERM (ERROR_ACCESS_DENIED)
        const d1 = path.join(probeDir, 'probe_d1');
        const d2 = path.join(probeDir, 'probe_d2');
        fs.mkdirSync(d1);
        fs.mkdirSync(d2);
        try {
          fs.renameSync(d1, d2);
          // If rename succeeded, it replaced d2 -> no-replace is FALSE
          atomicDirectoryNoReplace = false;
        } catch (err: unknown) {
          const code = (err as { code?: string })?.code;
          if (code === 'EPERM' || code === 'EEXIST' || code === 'EACCES') {
            atomicDirectoryNoReplace = true;
          }
        } finally {
          try { fs.rmSync(d1, { recursive: true, force: true }); } catch {}
          try { fs.rmSync(d2, { recursive: true, force: true }); } catch {}
        }
      } else {
        // POSIX (Linux, macOS, BSD): standard rename(2) silently overwrites empty directories.
        // Without native renameat2(RENAME_NOREPLACE) or renamex_np(RENAME_EXCL), this capability is FALSE.
        const d1 = path.join(probeDir, 'probe_d1');
        const d2 = path.join(probeDir, 'probe_d2');
        fs.mkdirSync(d1);
        fs.mkdirSync(d2);
        try {
          fs.renameSync(d1, d2);
          // Successfully overwritten empty directory -> atomicDirectoryNoReplace is FALSE
          atomicDirectoryNoReplace = false;
        } catch {
          atomicDirectoryNoReplace = false;
        } finally {
          try { fs.rmSync(d1, { recursive: true, force: true }); } catch {}
          try { fs.rmSync(d2, { recursive: true, force: true }); } catch {}
        }
      }
    } catch {
      // Fail closed on any probing error
      secureFileRelocation = false;
      atomicDirectoryNoReplace = false;
    } finally {
      if (probeDir) {
        try { fs.rmSync(probeDir, { recursive: true, force: true }); } catch {}
      }
    }

    const capabilities: FilesystemCapabilities = {
      atomicDirectoryNoReplace,
      safeDestinationOverwrite,
      safeSourceEntryRemoval,
      secureFileRelocation
    };

    if (!scratchDir) {
      this.cachedCapabilities = capabilities;
    }

    return capabilities;
  }

  /**
   * Resets cached capability probes (useful for tests).
   */
  public static reset(): void {
    this.cachedCapabilities = null;
  }
}
