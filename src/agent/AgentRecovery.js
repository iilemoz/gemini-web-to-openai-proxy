import { logger } from '../utils/logger.js';

/**
 * Handles error recovery, retry policies, and self-correction during tool failures.
 */
export class AgentRecovery {
  constructor({ maxRetries = 3 } = {}) {
    this.maxRetries = maxRetries;
    this.retryCounts = new Map();
  }

  shouldRetry(toolName) {
    const count = this.retryCounts.get(toolName) || 0;
    return count < this.maxRetries;
  }

  recordAttempt(toolName, error) {
    const count = (this.retryCounts.get(toolName) || 0) + 1;
    this.retryCounts.set(toolName, count);
    logger.warn(`[AgentRecovery] Tool '${toolName}' failed (attempt ${count}/${this.maxRetries}): ${error.message || error}`);
    return count;
  }

  buildCorrectionPrompt(toolName, error) {
    return `The previous execution of tool '${toolName}' failed with the following error:
${error.message || error}

Please analyze the error, adjust your arguments or plan, and retry or choose an alternative tool.`;
  }

  reset() {
    this.retryCounts.clear();
  }
}
