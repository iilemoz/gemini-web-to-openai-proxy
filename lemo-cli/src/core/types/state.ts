/**
 * Application State Types
 */

import type { OperatingMode, LemoConfig } from './config.js';

export interface AppState {
  mode: OperatingMode;
  activeModel: string;
  workspaceDir: string;
  backendConnected: boolean;
  config: LemoConfig;
}
