# Cloud Agent Runtime

The Cloud Agent Runtime executes tool actions inside isolated ephemeral sandboxes.

---

## Architecture & Docker Isolation

- **Docker Sandboxing**: If Docker is installed and running, sandboxes run inside isolated containers (e.g. `node:20-alpine`) with strict resource limits:
  - Memory: `--memory 512m`
  - CPU: `--cpus 1.0`
  - Network: `--network none` (or restricted bridge)
- **Zero-Failure Process Fallback**: If Docker is missing, stopped, or disabled, the runtime automatically falls back to an isolated process environment without crashing the server.

---

## Managing Sandboxes

```http
# Check Status
GET /v1/runtime/cloud/status

# Create Sandbox
POST /v1/runtime/cloud/sandboxes
Content-Type: application/json
{ "memoryLimit": "512m" }

# Execute Command
POST /v1/runtime/cloud/sandboxes/:id/exec
Content-Type: application/json
{ "command": "npm test" }

# Destroy Sandbox
DELETE /v1/runtime/cloud/sandboxes/:id
```
