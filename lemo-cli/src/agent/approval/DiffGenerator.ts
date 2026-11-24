/**
 * Unified Diff Generator
 * Computes deterministic unified diffs without external dependencies.
 */

import pc from 'picocolors';

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface DiffChange {
  type: 'context' | 'added' | 'deleted';
  value: string;
}

/**
 * Computes the Longest Common Subsequence table between two string arrays.
 */
function computeLcs(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));

  for (let i = 0; i < m; i++) {
    const aItem = a[i];
    const dpRow = dp[i];
    const dpNextRow = dp[i + 1];
    if (!dpRow || !dpNextRow) continue;

    for (let j = 0; j < n; j++) {
      const bItem = b[j];
      const prevVal = dpRow[j] ?? 0;
      const leftVal = dpRow[j + 1] ?? 0;
      const topVal = dpNextRow[j] ?? 0;

      if (aItem !== undefined && bItem !== undefined && aItem === bItem) {
        dpNextRow[j + 1] = prevVal + 1;
      } else {
        dpNextRow[j + 1] = Math.max(leftVal, topVal);
      }
    }
  }

  return dp;
}

/**
 * Backtracks the LCS matrix to produce a sequence of diff changes.
 */
function backtrackLcs(dp: number[][], a: string[], b: string[]): DiffChange[] {
  let i = a.length;
  let j = b.length;
  const changes: DiffChange[] = [];

  while (i > 0 || j > 0) {
    const aItem = a[i - 1];
    const bItem = b[j - 1];
    const dpCurrRow = dp[i];
    const dpPrevRow = dp[i - 1];
    const valLeft = dpCurrRow ? (dpCurrRow[j - 1] ?? 0) : 0;
    const valTop = dpPrevRow ? (dpPrevRow[j] ?? 0) : 0;

    if (i > 0 && j > 0 && aItem !== undefined && bItem !== undefined && aItem === bItem) {
      changes.push({ type: 'context', value: aItem });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || valLeft >= valTop)) {
      changes.push({ type: 'added', value: bItem ?? '' });
      j--;
    } else if (i > 0 && (j === 0 || valLeft < valTop)) {
      changes.push({ type: 'deleted', value: aItem ?? '' });
      i--;
    }
  }

  return changes.reverse();
}

/**
 * Generates a unified diff string between original and new text.
 */
export function generateUnifiedDiff(
  filePath: string,
  originalText: string,
  newText: string,
  contextLines = 3
): string {
  if (originalText === newText) {
    return '';
  }

  const a = originalText === '' ? [] : originalText.split('\n');
  const b = newText === '' ? [] : newText.split('\n');

  const dp = computeLcs(a, b);
  const changes = backtrackLcs(dp, a, b);

  // Group into hunks
  const hunks: DiffHunk[] = [];
  let currentHunkLines: string[] = [];
  let oldLineNum = 1;
  let newLineNum = 1;
  let hunkOldStart = 1;
  let hunkNewStart = 1;
  let hunkOldCount = 0;
  let hunkNewCount = 0;
  let lastModifiedIdx = -1;

  for (let idx = 0; idx < changes.length; idx++) {
    const ch = changes[idx];
    if (ch && ch.type !== 'context') {
      lastModifiedIdx = idx;
    }
  }

  let inHunk = false;

  for (let idx = 0; idx < changes.length; idx++) {
    const ch = changes[idx];
    if (!ch) continue;

    const isNearbyChange =
      idx <= lastModifiedIdx + contextLines &&
      changes.slice(Math.max(0, idx - contextLines), Math.min(changes.length, idx + contextLines + 1)).some(
        (c) => c && c.type !== 'context'
      );

    if (isNearbyChange) {
      if (!inHunk) {
        inHunk = true;
        hunkOldStart = oldLineNum;
        hunkNewStart = newLineNum;
        hunkOldCount = 0;
        hunkNewCount = 0;
        currentHunkLines = [];
      }

      if (ch.type === 'context') {
        currentHunkLines.push(` ${ch.value}`);
        hunkOldCount++;
        hunkNewCount++;
        oldLineNum++;
        newLineNum++;
      } else if (ch.type === 'deleted') {
        currentHunkLines.push(`-${ch.value}`);
        hunkOldCount++;
        oldLineNum++;
      } else if (ch.type === 'added') {
        currentHunkLines.push(`+${ch.value}`);
        hunkNewCount++;
        newLineNum++;
      }
    } else {
      if (inHunk) {
        hunks.push({
          oldStart: hunkOldStart,
          oldLines: hunkOldCount,
          newStart: hunkNewStart,
          newLines: hunkNewCount,
          lines: currentHunkLines
        });
        inHunk = false;
      }
      if (ch.type === 'context') {
        oldLineNum++;
        newLineNum++;
      } else if (ch.type === 'deleted') {
        oldLineNum++;
      } else if (ch.type === 'added') {
        newLineNum++;
      }
    }
  }

  if (inHunk && currentHunkLines.length > 0) {
    hunks.push({
      oldStart: hunkOldStart,
      oldLines: hunkOldCount,
      newStart: hunkNewStart,
      newLines: hunkNewCount,
      lines: currentHunkLines
    });
  }

  if (hunks.length === 0) {
    return '';
  }

  const cleanPath = filePath.replace(/\\/g, '/');
  const header = [`--- a/${cleanPath}`, `+++ b/${cleanPath}`];

  for (const hunk of hunks) {
    header.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
    header.push(...hunk.lines);
  }

  return header.join('\n');
}

/**
 * Formats a unified diff string with ANSI terminal color codes for REPL preview.
 */
export function formatColoredDiff(diffText: string): string {
  if (!diffText) return '';

  return diffText
    .split('\n')
    .map((line) => {
      if (line.startsWith('---') || line.startsWith('+++')) {
        return pc.bold(pc.cyan(line));
      }
      if (line.startsWith('@@')) {
        return pc.magenta(line);
      }
      if (line.startsWith('+')) {
        return pc.green(line);
      }
      if (line.startsWith('-')) {
        return pc.red(line);
      }
      return pc.gray(line);
    })
    .join('\n');
}
