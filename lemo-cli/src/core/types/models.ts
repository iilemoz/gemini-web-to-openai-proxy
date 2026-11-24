/**
 * Model Metadata Types
 * Corresponds to verified OpenAI-compatible /v1/models response from Lemo Backend
 */

export interface ModelCapabilities {
  chat?: boolean;
  stream?: boolean;
  tools?: boolean;
  vision?: boolean;
  json?: boolean;
}

export interface BackendModel {
  id: string;
  object: 'model';
  created?: number;
  owned_by: string;
  capabilities?: ModelCapabilities;
  description?: string;
  root?: string;
  parent?: string | null;
}

export interface ModelListResponse {
  object: 'list';
  data: BackendModel[];
}
