/**
 * Manages cancellation signals and abort listeners for agent runs.
 */
export class AgentCancellation {
  constructor() {
    this.controller = new AbortController();
    this.isCancelled = false;
    this.cancelReason = '';
  }

  get signal() {
    return this.controller.signal;
  }

  cancel(reason = 'User requested cancellation') {
    if (this.isCancelled) return;
    this.isCancelled = true;
    this.cancelReason = reason;
    this.controller.abort(reason);
  }

  throwIfCancelled() {
    if (this.isCancelled) {
      const err = new Error(`Agent run was cancelled: ${this.cancelReason}`);
      err.name = 'AbortError';
      throw err;
    }
  }
}
