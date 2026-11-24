/**
 * Assembles and formats context for the model during agent execution cycles.
 */
export class AgentContext {
  constructor({ task, workspaceRoot = process.cwd(), role = 'Developer Agent', permissions = ['none', 'all'] }) {
    this.task = task;
    this.workspaceRoot = workspaceRoot;
    this.role = role;
    this.permissions = permissions;
  }

  buildSystemPrompt(availableTools = []) {
    return `You are a universal autonomous AI Agent in role: "${this.role}".
Your workspace root is: "${this.workspaceRoot}".
Your objective is to solve the user's task accurately, step-by-step.
Follow this workflow:
1. Understand the goal.
2. Check your environment and relevant files.
3. Formulate and execute necessary tool actions.
4. Verify results after modifying or creating files.
5. When the task is complete, provide a concise final summary.

Available tools count: ${availableTools.length}.
Execute only approved tools using standard <tool_call> JSON format.`;
  }
}
