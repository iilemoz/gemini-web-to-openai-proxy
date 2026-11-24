import { EventEmitter } from 'node:events';

/**
 * Event bus for agent lifecycle, logging, and real-time streaming updates.
 */
export class AgentEvents extends EventEmitter {
  emitStateChange(runId, from, to, reason) {
    this.emit('state', { runId, from, to, reason, timestamp: Date.now() });
  }

  emitStep(runId, stepNumber, message) {
    this.emit('step', { runId, stepNumber, message, timestamp: Date.now() });
  }

  emitToolCall(runId, toolCall) {
    this.emit('tool_call', { runId, toolCall, timestamp: Date.now() });
  }

  emitToolResult(runId, toolResult) {
    this.emit('tool_result', { runId, toolResult, timestamp: Date.now() });
  }

  emitComplete(runId, summary) {
    this.emit('complete', { runId, summary, timestamp: Date.now() });
  }

  emitError(runId, error) {
    this.emit('agent_error', { runId, error: error.message || String(error), timestamp: Date.now() });
    if (this.listenerCount('error') > 0) {
      this.emit('error', { runId, error: error.message || String(error), timestamp: Date.now() });
    }
  }
}

export const agentEvents = new AgentEvents();
