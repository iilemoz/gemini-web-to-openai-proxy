/**
 * Valid states for an Agent Run.
 */
export const AgentState = {
  QUEUED: 'queued',
  PLANNING: 'planning',
  RUNNING: 'running',
  WAITING_FOR_APPROVAL: 'waiting_for_approval',
  RECOVERING: 'recovering',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
};

export class AgentStateMachine {
  constructor(initialState = AgentState.QUEUED) {
    this.currentState = initialState;
    this.history = [{ state: initialState, timestamp: Date.now() }];
  }

  transition(nextState, reason = '') {
    if (!Object.values(AgentState).includes(nextState)) {
      throw new Error(`Invalid agent state: '${nextState}'`);
    }

    // Terminal states cannot transition
    if ([AgentState.COMPLETED, AgentState.FAILED, AgentState.CANCELLED].includes(this.currentState)) {
      throw new Error(`Cannot transition from terminal state '${this.currentState}' to '${nextState}'`);
    }

    this.currentState = nextState;
    this.history.push({ state: nextState, reason, timestamp: Date.now() });
    return this.currentState;
  }

  get state() {
    return this.currentState;
  }

  isTerminal() {
    return [AgentState.COMPLETED, AgentState.FAILED, AgentState.CANCELLED].includes(this.currentState);
  }
}
