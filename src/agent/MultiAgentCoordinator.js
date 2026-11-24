import { agentOrchestrator } from './AgentOrchestrator.js';
import { persistentMemory } from '../memory/index.js';
import { logger } from '../utils/logger.js';

export const AgentRoles = {
  ARCHITECT: {
    role: 'Software Architect',
    description: 'Analyzes requirements, designs technical architecture, breaks down complex tasks into sub-tasks.'
  },
  DEVELOPER: {
    role: 'Software Developer',
    description: 'Implements code solutions, modifies files, builds features, and executes actions.'
  },
  REVIEWER: {
    role: 'Code Reviewer',
    description: 'Audits code quality, inspects diffs, evaluates security, suggests refactoring.'
  },
  DEBUGGER: {
    role: 'Debugger & Diagnostics',
    description: 'Investigates errors, runs diagnostic tools, performs root-cause analysis and repairs.'
  },
  TESTER: {
    role: 'Quality Assurance Tester',
    description: 'Verifies functionality, executes tests, ensures zero regressions.'
  }
};

/**
 * MultiAgentCoordinator enables collaborative multi-agent workflows
 * passing context and handoffs across specialized roles.
 */
export class MultiAgentCoordinator {
  constructor(orchestrator = agentOrchestrator, memory = persistentMemory) {
    this.orchestrator = orchestrator;
    this.memory = memory;
  }

  async runPipeline({
    task,
    roles = ['architect', 'developer', 'tester'],
    workspaceRoot = process.cwd(),
    modelProvider = null
  }) {
    logger.info(`[MultiAgentCoordinator] Starting multi-agent pipeline with roles: ${roles.join(' -> ')}`);
    const pipelineResults = [];
    let cumulativeContext = `Primary User Task: "${task}"\n`;

    for (const roleKey of roles) {
      const roleDef = Object.entries(AgentRoles).find(([k]) => k.toLowerCase() === roleKey.toLowerCase())?.[1]
        || { role: roleKey, description: 'Specialized Agent' };

      const subtaskPrompt = `${cumulativeContext}\nYour active role is: ${roleDef.role} (${roleDef.description}). Perform your phase for this task.`;

      const run = this.orchestrator.createRun({
        task: subtaskPrompt,
        role: roleDef.role,
        workspaceRoot,
        modelProvider
      });

      await this.orchestrator.startRun(run.id);
      const completedRun = this.orchestrator.getRun(run.id);

      const stepSummary = completedRun.result?.summary || 'Completed role phase';
      pipelineResults.push({
        role: roleDef.role,
        runId: run.id,
        summary: stepSummary
      });

      cumulativeContext += `\n[Phase Output from ${roleDef.role}]:\n${stepSummary}\n`;
    }

    // Persist final pipeline result in memory
    await this.memory.setFact(`pipeline_${Date.now()}`, {
      task,
      roles,
      results: pipelineResults
    }, { tags: ['pipeline', 'multi-agent'] });

    return {
      task,
      status: 'completed',
      stages: pipelineResults,
      finalOutput: pipelineResults[pipelineResults.length - 1]?.summary || ''
    };
  }
}

export const multiAgentCoordinator = new MultiAgentCoordinator();
