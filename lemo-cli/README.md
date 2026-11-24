# Lemo CLI

> Standalone Terminal AI Assistant & Coding Agent

Lemo CLI is an interactive terminal application designed for seamless interaction with the Lemo Universal AI API Backend.

## Features (Phase 4.0 Foundation)

- **Strict Separation of Concerns**: Communicates exclusively with the Lemo Universal AI API Backend.
- **Cross-Platform**: Full support for Windows CMD, Windows PowerShell, Windows Terminal, and POSIX environments.
- **Robust Configuration**: Windows-compatible config paths (`%APPDATA%/lemo` or `~/.config/lemo`) with schema validation and secret redaction.
- **Structured Error Handling & Logging**: Clean error reporting and leveled logging that never exposes secrets or sensitive keys.
- **Future Ready**: Defined architectural boundaries for Chat Mode and Agent Mode.

## Quick Start

```bash
# Display help and version
node bin/lemo.js --help
node bin/lemo.js --version

# View or set configuration
node bin/lemo.js config show
node bin/lemo.js config set --base-url http://127.0.0.1:3000/v1
```

## License

MIT © Lemo
