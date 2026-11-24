import crypto from 'node:crypto';
import { workspaceManager } from './local/WorkspaceManager.js';
import { terminalManager } from './local/TerminalManager.js';
import { deviceManager } from './local/DeviceManager.js';
import { registerLocalTools } from './local/registerLocalTools.js';

class RuntimeSessionManager {
  constructor() {
    this.sessions = new Map();
  }

  createSession({ workspacePath = process.cwd(), type = 'local', metadata = {} } = {}) {
    const id = `sess_${crypto.randomUUID()}`;
    const session = {
      id,
      type,
      workspacePath,
      createdAt: Date.now(),
      status: 'active',
      metadata
    };
    this.sessions.set(id, session);
    workspaceManager.addRoot(workspacePath);
    return session;
  }

  getSession(id) {
    return this.sessions.get(id);
  }

  listSessions() {
    return Array.from(this.sessions.values());
  }

  deleteSession(id) {
    return this.sessions.delete(id);
  }
}

export const sessionManager = new RuntimeSessionManager();

export {
  workspaceManager,
  terminalManager,
  deviceManager,
  registerLocalTools
};
