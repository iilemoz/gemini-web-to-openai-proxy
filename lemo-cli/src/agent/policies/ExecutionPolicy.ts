/**
 * Execution Policy
 * Enforces iteration bounds, timeouts, and cancellation constraints.
 */

import { AgentExecutionError } from '../../core/errors/index.js';

export interface ExecutionPolicyOptions {
  maxIterations?: number;
  maxToolExecutionsPerTurn?: number;
  toolTimeoutMs?: number;
}

export class ExecutionPolicy {
  public readonly maxIterations: number;
  public readonly maxToolExecutionsPerTurn: number;
  public readonly toolTimeoutMs: number;

  constructor(options: ExecutionPolicyOptions = {}) {
    this.maxIterations = options.maxIterations && options.maxIterations > 0 ? options.maxIterations : 25;
    this.maxToolExecutionsPerTurn = options.maxToolExecutionsPerTurn && options.maxToolExecutionsPerTurn > 0 ? options.maxToolExecutionsPerTurn : 10;
    this.toolTimeoutMs = options.toolTimeoutMs && options.toolTimeoutMs > 0 ? options.toolTimeoutMs : 60000;
  }

  /**
   * Validates that current iteration has not exceeded maximum allowed iterations.
   */
  public validateIteration(iteration: number): void {
    if (iteration > this.maxIterations) {
      throw new AgentExecutionError(
        `Agent execution loop reached iteration limit (max: ${this.maxIterations} iterations)`
      );
    }
  }

  /**
   * Validates that the active AbortSignal has not been triggered.
   */
  public checkSignal(signal?: AbortSignal): void {
    if (signal?.aborted) {
      const err = new AgentExecutionError('Agent execution was cancelled by signal');
      err.name = 'AbortError';
      throw err;
    }
  }
}
