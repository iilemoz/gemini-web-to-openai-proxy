/**
 * Manages memory, steps, and tool execution history for an active agent run.
 */
export class AgentMemory {
  constructor(maxHistoryItems = 100) {
    this.maxHistoryItems = maxHistoryItems;
    this.steps = [];
    this.toolHistory = [];
    this.facts = new Map();
  }

  addStep(step) {
    this.steps.push({
      ...step,
      timestamp: Date.now()
    });
    if (this.steps.length > this.maxHistoryItems) {
      this.steps.shift();
    }
  }

  recordToolResult(toolCall, result) {
    this.toolHistory.push({
      toolCall,
      result,
      timestamp: Date.now()
    });
  }

  setFact(key, value) {
    this.facts.set(key, value);
  }

  getFact(key) {
    return this.facts.get(key);
  }

  getSummary() {
    return {
      totalSteps: this.steps.length,
      totalToolCalls: this.toolHistory.length,
      successfulTools: this.toolHistory.filter(t => !t.result.is_error).length,
      failedTools: this.toolHistory.filter(t => t.result.is_error).length,
      facts: Object.fromEntries(this.facts.entries())
    };
  }
}
