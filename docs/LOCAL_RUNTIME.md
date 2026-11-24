# Local Agent Runtime

The Local Agent Runtime connects authorized AI agents and IDEs to your local development environment without exposing local network ports to the public internet.

---

## Features

- **Workspace Path Traversal Guard**: Prevents path traversal (`../`) outside authorized project folders.
- **Device Pairing Workflow**: Secure token-based handshake (`/v1/runtime/devices/pair`) prevents unauthorized device access.
- **Session Isolation**: Active workspace sessions track root paths and permissions independently.
- **Cross-Platform Terminal**: Runs PowerShell on Windows (`powershell.exe`) and Bash on POSIX, with configurable execution timeouts and output truncation.

---

## Configuration

In `.env`:
```env
WORKSPACE_ROOTS=C:\Users\Ahmed\Desktop\MyProject
LOCAL_DEVICE_SECRET=your-random-device-secret
```

## Device Pairing

To pair a local machine:
1. Generate pairing token: `POST /v1/runtime/devices/pair`
2. Connect client providing token and machine metadata.
3. Access local tools (`read_file`, `write_file`, `execute_command`) securely.
