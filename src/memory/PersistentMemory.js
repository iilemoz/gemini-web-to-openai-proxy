import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

/**
 * PersistentMemory provides structured file-backed key-value and fact storage
 * across agent sessions and restarts.
 */
export class PersistentMemory {
  constructor({ storagePath = path.join(os.tmpdir(), 'gemini_agent_memory.json') } = {}) {
    this.storagePath = storagePath;
    this.facts = new Map();
    this.sessions = new Map();
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    try {
      const data = await fs.readFile(this.storagePath, 'utf8');
      const parsed = JSON.parse(data);
      if (parsed.facts) {
        for (const [k, v] of Object.entries(parsed.facts)) {
          this.facts.set(k, v);
        }
      }
      if (parsed.sessions) {
        for (const [k, v] of Object.entries(parsed.sessions)) {
          this.sessions.set(k, v);
        }
      }
    } catch {
      // File doesn't exist yet, start clean
    }
    this.initialized = true;
  }

  async persist() {
    const payload = {
      facts: Object.fromEntries(this.facts.entries()),
      sessions: Object.fromEntries(this.sessions.entries()),
      updatedAt: Date.now()
    };
    await fs.mkdir(path.dirname(this.storagePath), { recursive: true });
    await fs.writeFile(this.storagePath, JSON.stringify(payload, null, 2), 'utf8');
  }

  async setFact(key, value, { tags = [], scope = 'global' } = {}) {
    await this.init();
    this.facts.set(key, {
      value,
      tags,
      scope,
      updatedAt: Date.now()
    });
    await this.persist();
  }

  async getFact(key) {
    await this.init();
    const entry = this.facts.get(key);
    return entry ? entry.value : null;
  }

  async searchFacts(query) {
    await this.init();
    const q = query.toLowerCase();
    const results = [];
    for (const [key, entry] of this.facts.entries()) {
      const matchKey = key.toLowerCase().includes(q);
      const matchVal = JSON.stringify(entry.value).toLowerCase().includes(q);
      const matchTags = entry.tags.some(t => t.toLowerCase().includes(q));
      if (matchKey || matchVal || matchTags) {
        results.push({ key, ...entry });
      }
    }
    return results;
  }

  async saveSessionState(sessionId, state) {
    await this.init();
    this.sessions.set(sessionId, {
      state,
      savedAt: Date.now()
    });
    await this.persist();
  }

  async getSessionState(sessionId) {
    await this.init();
    return this.sessions.get(sessionId) || null;
  }

  async clear() {
    this.facts.clear();
    this.sessions.clear();
    try {
      await fs.unlink(this.storagePath);
    } catch {
      // ignore
    }
  }
}

export const persistentMemory = new PersistentMemory();
