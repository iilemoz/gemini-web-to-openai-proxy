import { logger } from './logger.js';

/**
 * Tracks active HTTP requests in-flight for graceful shutdown and lifecycle management.
 */
class RequestTracker {
  constructor() {
    this.activeRequests = new Set();
    this.isShuttingDown = false;
  }

  /**
   * Register a new active request with its AbortController.
   * @param {string} id - Unique request id
   * @param {AbortController} abortController
   * @returns {boolean} True if registered, false if server is shutting down
   */
  track(id, abortController) {
    if (this.isShuttingDown) {
      return false;
    }
    this.activeRequests.add({ id, abortController });
    return true;
  }

  /**
   * Unregister a completed or aborted request.
   * @param {string} id
   */
  untrack(id) {
    for (const req of this.activeRequests) {
      if (req.id === id) {
        this.activeRequests.delete(req);
        break;
      }
    }
  }

  /**
   * Get the current number of active requests.
   * @returns {number}
   */
  getActiveCount() {
    return this.activeRequests.size;
  }

  /**
   * Begin graceful shutdown. Mark server as shutting down and prevent new requests.
   */
  startShutdown() {
    this.isShuttingDown = true;
    logger.info(`[RequestTracker] Shutdown initiated. Active requests: ${this.activeRequests.size}`);
  }

  /**
   * Abort all remaining active requests.
   * @param {string} reason
   */
  abortAll(reason = 'Server shutdown') {
    logger.warn(`[RequestTracker] Aborting ${this.activeRequests.size} remaining request(s): ${reason}`);
    for (const req of this.activeRequests) {
      try {
        req.abortController.abort(new Error(reason));
      } catch {
        // Ignore abort errors
      }
    }
    this.activeRequests.clear();
  }

  /**
   * Reset shutdown state (for testing).
   */
  reset() {
    this.isShuttingDown = false;
    this.activeRequests.clear();
  }
}

export const requestTracker = new RequestTracker();
