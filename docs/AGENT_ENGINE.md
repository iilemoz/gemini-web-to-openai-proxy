# Agent Orchestrator & Execution Engine

The Agent Orchestrator manages autonomous task planning, multi-turn reasoning loops, tool execution, memory tracking, error recovery, and collaborative multi-agent pipelines.

---

## State Machine

An agent run progresses through strict, validated lifecycle states:

```
[QUEUED] ──> [PLANNING] ──> [RUNNING] ──> [COMPLETED]
                               │    ▲
                               ▼    │
                     [WAITING_FOR_APPROVAL]
                               │
                               ▼
                           [CANCELLED]
                               │
                               ▼
                            [FAILED]
```

- **QUEUED**: Created and initialized.
- **PLANNING**: Formulates initial 4-phase execution plan.
- **RUNNING**: Interacts with the model, executes tools, records findings.
- **WAITING_FOR_APPROVAL**: Paused when human confirmation is required for sensitive operations (in `assisted` or `supervised` autonomy modes).
- **COMPLETED**: Task finished successfully with final report.
- **FAILED**: Unrecoverable error or max iterations reached.
- **CANCELLED**: Aborted by user or client disconnect.

---

## Autonomy Modes

1. **Autonomous**: Executes all authorized tools automatically without pausing.
2. **Supervised**: Automatically executes read-only tools, pauses and requests confirmation for write/execute tools.
3. **Assisted**: Pauses and requests confirmation before executing every tool call.

---

## Specialized Multi-Agent Roles

The infrastructure includes 5 specialized collaborative roles:
- **Architect**: Designs architecture, breaks down complex tasks into phases.
- **Developer**: Writes and refactors code, creates files.
- **Reviewer**: Audits code for safety, quality, and standards compliance.
- **Debugger**: Investigates errors, checks logs, runs diagnostics.
- **Tester**: Executes test suites and validates functionality.

Collaborative multi-agent workflows are executed via `MultiAgentCoordinator.runPipeline()`.
