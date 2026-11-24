/**
 * Agent State Machine
 * Tracks and controls valid state transitions for the agent lifecycle.
 */

import type { AgentStatus } from '../types/index.js';
import { AgentExecutionError } from '../../core/errors/index.js';

export class AgentState {
  private currentStatus: AgentStatus = 'idle';
  private statusHistory: { status: AgentStatus; timestamp: number }[] = [];

  constructor(initialStatus: AgentStatus = 'idle') {
    this.currentStatus = initialStatus;
    this.statusHistory.push({ status: initialStatus, timestamp: Date.now() });
  }

  public get status(): AgentStatus {
    return this.currentStatus;
  }

  public get isTerminal(): boolean {
    return this.currentStatus === 'completed' || this.currentStatus === 'failed' || this.currentStatus === 'aborted';
  }

  public get isRunning(): boolean {
    return this.currentStatus === 'running' || this.currentStatus === 'waiting_approval' || this.currentStatus === 'executing_tool';
  }

  /**
   * Transitions to a new state if valid.
   */
  public transitionTo(newStatus: AgentStatus): void {
    if (this.currentStatus === newStatus) {
      return;
    }

    // Terminal states cannot transition to active states
    if (this.isTerminal) {
      throw new AgentExecutionError(
        `Cannot transition from terminal state '${this.currentStatus}' to '${newStatus}'`
      );
    }

    this.currentStatus = newStatus;
    this.statusHistory.push({ status: newStatus, timestamp: Date.now() });
  }

  public getHistory(): readonly { status: AgentStatus; timestamp: number }[] {
    return [...this.statusHistory];
  }

  public reset(): void {
    this.currentStatus = 'idle';
    this.statusHistory = [{ status: 'idle', timestamp: Date.now() }];
  }
}
