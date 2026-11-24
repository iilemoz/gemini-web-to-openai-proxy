/**
 * Architectural Boundary: API Client Module
 *
 * Scheduled for implementation in Phase 4.1.
 * Will handle communication with the Lemo Universal AI API Backend:
 * - Model discovery (/v1/models)
 * - Chat completions (/v1/chat/completions) with SSE streaming
 * - Health verification (/health)
 */

export interface ApiClientConfig {
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
}
