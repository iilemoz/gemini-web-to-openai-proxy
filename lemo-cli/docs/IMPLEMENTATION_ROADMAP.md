# Lemo CLI Implementation Roadmap

This document outlines the phased roadmap for developing **Lemo CLI** from foundation through production release.

---

## Roadmap Overview

```
+--------------------------------------------------------------------------+
|  Phase 4.0: Foundation, Architecture & Setup (COMPLETED)                 |
|  - CLI scaffold, Commander parser, banner, config manager, types, tests  |
+--------------------------------------------------------------------------+
                                    |
                                    v
+--------------------------------------------------------------------------+
|  Phase 4.1: Backend Integration & Interactive Chat Mode                  |
|  - Typed API client, SSE streaming, REPL loop, model selector            |
+--------------------------------------------------------------------------+
                                    |
                                    v
+--------------------------------------------------------------------------+
|  Phase 4.2: Agent Core & Autonomous Execution Loop                       |
|  - Agent state machine, task planning, context window, prompt templates  |
+--------------------------------------------------------------------------+
                                    |
                                    v
+--------------------------------------------------------------------------+
|  Phase 4.3: Local Tools & Security Boundaries                            |
|  - Read/write tools, shell runner, human confirmation gatekeeper         |
+--------------------------------------------------------------------------+
                                    |
                                    v
+--------------------------------------------------------------------------+
|  Phase 4.4: Gemini End-to-End Real-World Verification                    |
|  - E2E tests against Lemo Backend (Guest & Account modes), coding tasks  |
+--------------------------------------------------------------------------+
                                    |
                                    v
+--------------------------------------------------------------------------+
|  Phase 4.5: Packaging, Distribution & Final Polish                       |
|  - Binary distribution, npm packaging, documentation, manual pages       |
+--------------------------------------------------------------------------+
```

---

## Phase 4.0: Foundation, Architecture & Environment Setup (Current Phase)

- **Status:** COMPLETED
- **Objectives:**
  - Establish subproject structure (`lemo-cli/`) with zero modifications to Phase 3 backend code.
  - Implement TypeScript compilation pipeline with strict flags (`exactOptionalPropertyTypes`, `strictNullChecks`).
  - Build universal configuration manager (`ConfigManager`) supporting Windows and POSIX config directories.
  - Implement logging system with automatic credential/Bearer token redaction.
  - Build CLI entry point with banner, `--help`, `--version`, and `config` command suite.
  - Author automated test suite for all foundational components.
- **Deliverables:**
  - `lemo-cli/src/core/` (types, config, logging, errors)
  - `lemo-cli/src/cli/` (entry point, config commands, banner)
  - `lemo-cli/tests/` (22 unit & integration tests)
  - `lemo-cli/docs/ARCHITECTURE.md`
  - `lemo-cli/docs/IMPLEMENTATION_ROADMAP.md`
- **Verification Criteria:**
  - 100% of CLI unit tests pass (`npm test`).
  - Zero TypeScript compiler or lint errors (`npm run typecheck`, `npm run build`).
  - Zero backend regressions (all 107 Phase 3 backend tests passing).

---

## Phase 4.1: Backend Integration & Interactive Chat Mode

- **Prerequisites:** Phase 4.0 signed off.
- **Objectives:**
  - Implement `LemoApiClient` in `src/api/` consuming Lemo Universal Backend via standard `/v1/*` endpoints.
  - Add Server-Sent Events (SSE) streaming client with reconnect and timeout safeguards.
  - Implement interactive terminal REPL in `src/chat/` using Node.js `readline`.
  - Add real-time token rendering with ANSI styling, syntax highlighting, and spinner indicators.
  - Implement in-session slash commands: `/help`, `/model`, `/clear`, `/config`, `/exit`.
  - Support model discovery via `GET /v1/models` and dynamic model switching.
- **Key Deliverables:**
  - `src/api/client.ts`, `src/api/stream.ts`
  - `src/chat/repl.ts`, `src/chat/session.ts`, `src/chat/renderer.ts`
  - `src/cli/commands/chat.ts`
  - Unit and mock integration tests in `tests/api.test.mjs`, `tests/chat.test.mjs`.
- **Verification Criteria:**
  - Chat streaming operates seamlessly without dropped chunks.
  - Backend models dynamically listed and selectable.
  - Clean error recovery when backend is offline or returns HTTP error statuses.

---

## Phase 4.2: Agent Core & Autonomous Execution Loop

- **Prerequisites:** Phase 4.1 signed off.
- **Objectives:**
  - Implement Agent state machine: `IDLE`, `PLANNING`, `AWAITING_APPROVAL`, `EXECUTING_TOOL`, `REFLECTING`, `COMPLETED`, `FAILED`.
  - Build system prompt generator tailored for terminal agent coding workflows.
  - Manage agent conversation context and sliding-window compression to avoid token budget overflow.
  - Implement tool call parsing and formatting conforming to OpenAI function calling specifications.
  - Enforce maximum turn iterations (`maxSteps`) and timeout controls to prevent infinite loops.
- **Key Deliverables:**
  - `src/agent/engine.ts`, `src/agent/state.ts`, `src/agent/prompts.ts`, `src/agent/context.ts`
  - `src/cli/commands/agent.ts`
  - Unit tests for agent state transitions and tool call schemas.
- **Verification Criteria:**
  - Agent state transitions correctly without deadlocks.
  - Malformed tool calls from model handled gracefully with corrective prompt injections.

---

## Phase 4.3: Local Tools & Security Boundaries

- **Prerequisites:** Phase 4.2 signed off.
- **Objectives:**
  - Implement core coding tool suite:
    - `read_file`: Safe file inspection with line-range support.
    - `write_file`: File creation and overwriting with diff preview.
    - `edit_file`: Targeted string replacement with context check.
    - `list_directory`: Recursive or flat filesystem tree scanning.
    - `execute_command`: Child process execution with streaming stdout/stderr.
  - Implement **Interactive Human Approval Gatekeeper**:
    - Distinguish between read-only actions and mutating actions.
    - Mutating actions (write, edit, exec) require user confirmation `[Y/n]`.
    - Display unified diffs for file edits prior to user acceptance.
  - Add execution safety: command timeout, working directory confinement, sensitive file blacklists (`.env`, `.git/credentials`).
- **Key Deliverables:**
  - `src/tools/definitions.ts`, `src/tools/filesystem.ts`, `src/tools/terminal.ts`
  - `src/tools/security/gatekeeper.ts`, `src/tools/security/diff.ts`
  - Comprehensive unit and mock security tests in `tests/tools.test.mjs`.
- **Verification Criteria:**
  - No file modifications or shell executions occur without explicit approval (unless explicitly configured).
  - Dangerous commands and path traversal attempts blocked.

---

## Phase 4.4: Gemini End-to-End Real-World Verification

- **Prerequisites:** Phase 4.3 signed off.
- **Objectives:**
  - Connect Lemo CLI to live Lemo Backend running with real upstream Gemini provider.
  - Test real-world scenarios:
    - Interactive Chat: Multi-turn streaming chat using `gemini-2.5-flash` and `gemini-2.5-pro`.
    - Autonomous Agent: End-to-end task (e.g., inspect codebase, fix a bug, run automated tests, verify success).
  - Verify error handling against rate limits, token exhaustion, and network disruptions.
- **Key Deliverables:**
  - `tests/e2e/chat.e2e.test.mjs`, `tests/e2e/agent.e2e.test.mjs`
  - Real-world verification logs and audit report.
- **Verification Criteria:**
  - 100% pass on real-world multi-step coding task.
  - Zero hangs or unhandled promise rejections.

---

## Phase 4.5: Packaging, Distribution & Final Polish

- **Prerequisites:** Phase 4.4 signed off.
- **Objectives:**
  - Package Lemo CLI for global installation (`npm install -g lemo-cli`).
  - Validate standalone global binary execution (`lemo` command in terminal).
  - Finalize user documentation, man pages, shell completion scripts (bash/zsh).
  - Final UX polish: spinner animations, formatted markdown rendering in terminal.
- **Key Deliverables:**
  - Production `npm pack` artifact.
  - Complete user guide in `docs/USER_GUIDE.md`.
  - Release audit report.
- **Verification Criteria:**
  - Clean global installation on Windows, macOS, and Linux.
  - All commands and features function as documented.
