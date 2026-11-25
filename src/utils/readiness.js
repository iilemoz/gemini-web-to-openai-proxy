import { requestTracker } from './requestTracker.js';

class ReadinessManager {
  constructor() {
    this._isInitialized = false;
  }

  /**
   * Set initialization state.
   * @param {boolean} initialized
   */
  setInitialized(initialized) {
    this._isInitialized = Boolean(initialized);
  }

  /**
   * Whether application is currently initialized and accepting traffic.
   * @returns {boolean}
   */
  isReady() {
    return this._isInitialized && !requestTracker.isShuttingDown;
  }

  /**
   * Returns current status summary.
   * @returns {{ ready: boolean, status: string }}
   */
  getStatus() {
    if (requestTracker.isShuttingDown) {
      return { ready: false, status: 'shutting_down' };
    }
    if (!this._isInitialized) {
      return { ready: false, status: 'initializing' };
    }
    return { ready: true, status: 'ready' };
  }

  /**
   * Reset readiness state (for testing).
   */
  reset() {
    this._isInitialized = false;
  }
}

export const readiness = new ReadinessManager();
