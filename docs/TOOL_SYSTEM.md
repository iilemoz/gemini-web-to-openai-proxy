# Universal Tool System

The Universal Tool System provides a unified, secure, schema-validated execution platform for tools invoked by models, IDEs, or autonomous agents.

---

## Architecture

```text
src/tools/
├── registry/
│   ├── ToolRegistry.js       # Central registry storing tool metadata and handlers
│   ├── ToolSchema.js         # JSON Schema definition and validator
│   └── ToolDiscovery.js      # Filter tools by permissions and execution target
├── adapters/
│   ├── OpenAIToolAdapter.js   # Adapts tools to OpenAI function calling format
│   ├── GeminiToolAdapter.js   # Adapts tools to Gemini function/prompt format
│   └── MCPToolAdapter.js      # Adapts tools to Model Context Protocol
├── dispatcher/
│   ├── ToolDispatcher.js      # Validates, checks permissions, executes with timeout
│   ├── ToolValidator.js       # JSON schema input validator
│   └── ToolResultFormatter.js # Normalizes output and error formats
└── builtins/
    └── index.js              # Core utilities (echo, calculator, system_info)
```

---

## Registered Tool Categories

### 1. Builtin Utilities
- `echo`: Returns message (used for ping and sanity tests).
- `calculator`: Evaluates safe arithmetic expressions.
- `system_info`: Inspects host OS, architecture, memory, and Node version.

### 2. Filesystem Tools (Local Runtime)
- `list_files`: Lists directory contents with optional recursive traversal.
- `read_file`: Reads UTF-8 file contents (with binary file detection).
- `write_file`: Creates or replaces files.
- `edit_file`: Performs exact substring replacement.
- `delete_file`: Removes files within authorized workspace roots.
- `create_directory`: Creates directories recursively.
- `get_file_info`: Retrieves size, permissions, and modification timestamps.

### 3. Terminal & Process Tools
- `execute_command`: Runs shell commands (PowerShell on Windows, Bash on POSIX) with configurable timeouts.
- `list_processes`: Lists running processes.
- `stop_process`: Terminates a running process.

### 4. Git & Project Tools
- `git_status`: Returns current git status.
- `git_diff`: Displays unstaged or staged file diffs.
- `git_log`: Returns recent commits.
- `git_commit`: Commits staged changes.
- `git_branch`: Lists, creates, or switches branches.
- `analyze_project`: Detects language, dependencies, package manager, and test framework.
- `get_project_structure`: Returns directory tree overview.

### 5. Developer & Diagnostic Tools
- `search_code`: Fast text and regex search with line numbers and matched snippets.
- `find_by_name`: Finds files and directories matching filename patterns.
- `run_diagnostics`: Validates `package.json`, runs syntax checks (`node --check`), and verifies git workspace.

---

## Security & Permission Model

Every tool defines its required permissions:
- `none`: Safe read-only utilities.
- `read:fs`: Workspace file read access.
- `write:fs`: Workspace file creation and edits.
- `execute:terminal`: Shell execution within workspace boundaries.

The `ToolDispatcher` checks granted permissions before every execution. Any unauthorized call is immediately rejected with a descriptive security error.
