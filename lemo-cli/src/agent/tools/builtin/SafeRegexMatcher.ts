/**
 * Safe Regex Matcher
 * Executes regular expression pattern matching inside an isolated Worker Thread
 * with a strict timeout and forced worker termination to prevent ReDoS / catastrophic
 * backtracking from freezing the main Node.js event loop.
 */

import { Worker } from 'node:worker_threads';

const WORKER_SCRIPT = `
const { parentPort } = require('node:worker_threads');

parentPort.on('message', ({ pattern, flags, lines }) => {
  try {
    const re = new RegExp(pattern, flags);
    const matchedIndices = [];
    for (let i = 0; i < lines.length; i++) {
      re.lastIndex = 0;
      if (re.test(lines[i])) {
        matchedIndices.push(i);
      }
    }
    parentPort.postMessage({ success: true, matchedIndices });
  } catch (err) {
    parentPort.postMessage({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});
`;

export interface SafeRegexMatcherOptions {
  timeoutMs?: number;
}

export class SafeRegexMatcher {
  private worker: Worker | null = null;
  private isTerminated = false;
  private readonly timeoutMs: number;

  constructor(options: SafeRegexMatcherOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 1500;
  }

  private ensureWorker(): Worker {
    if (this.isTerminated) {
      throw new Error('SafeRegexMatcher worker has already been terminated');
    }
    if (!this.worker) {
      this.worker = new Worker(WORKER_SCRIPT, { eval: true });
      this.worker.unref(); // Prevent worker from holding process open if idle
    }
    return this.worker;
  }

  /**
   * Matches an array of lines against a regex pattern.
   * If evaluation exceeds timeoutMs, the worker is forcibly terminated
   * and a structured timeout error is thrown.
   */
  public async matchLines(lines: string[], pattern: string, flags: string): Promise<number[]> {
    if (lines.length === 0) {
      return [];
    }

    const worker = this.ensureWorker();
    worker.ref();

    return new Promise<number[]>((resolve, reject) => {
      let timer: NodeJS.Timeout | null = null;

      const cleanup = () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        worker.off('message', onMessage);
        worker.off('error', onError);
        if (this.worker && !this.isTerminated) {
          this.worker.unref();
        }
      };

      const onMessage = (msg: { success: boolean; matchedIndices?: number[]; error?: string }) => {
        cleanup();
        if (msg.success && Array.isArray(msg.matchedIndices)) {
          resolve(msg.matchedIndices);
        } else {
          reject(new Error(msg.error || 'Regex evaluation failed in worker thread'));
        }
      };

      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };

      worker.on('message', onMessage);
      worker.on('error', onError);

      timer = setTimeout(async () => {
        cleanup();
        this.isTerminated = true;
        try {
          await worker.terminate();
        } catch {
          // Worker termination
        }
        this.worker = null;
        reject(new Error(`Regular expression evaluation timed out after ${this.timeoutMs}ms (ReDoS / catastrophic backtracking detected)`));
      }, this.timeoutMs);

      worker.postMessage({ pattern, flags, lines });
    });
  }

  /**
   * Terminates the worker thread cleanly.
   */
  public async terminate(): Promise<void> {
    if (this.worker && !this.isTerminated) {
      this.isTerminated = true;
      try {
        await this.worker.terminate();
      } catch {
        // Ignore termination error
      }
      this.worker = null;
    }
  }
}
