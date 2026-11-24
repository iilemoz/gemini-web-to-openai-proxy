import { logger } from '../utils/logger.js';

/**
 * Centralized Model Registry.
 * Maintains canonical model definitions, aliases, capabilities, and provider associations.
 */
export class ModelRegistry {
  constructor() {
    /** @type {Map<string, Object>} Canonical model ID -> model record */
    this.models = new Map();
    /** @type {Map<string, string>} Alias ID -> canonical model ID */
    this.aliases = new Map();
  }

  /**
   * Register a model definition.
   * @param {Object} modelDef
   * @param {string} modelDef.id - Canonical model ID (e.g. 'gemini-2.5-flash')
   * @param {string} modelDef.providerId - Backing provider ID (e.g. 'gemini')
   * @param {string} [modelDef.name] - Display name
   * @param {string} [modelDef.description] - Model description
   * @param {string[]} [modelDef.aliases] - Alternate model aliases
   * @param {Object} [modelDef.capabilities] - Model capabilities (chat, stream, tools, vision, json)
   * @param {boolean} [modelDef.isAvailable=true] - Availability flag
   * @param {string} [modelDef.owned_by] - Provider/Owner string
   * @param {number} [modelDef.created] - Unix epoch timestamp
   */
  registerModel(modelDef) {
    if (!modelDef || !modelDef.id || typeof modelDef.id !== 'string') {
      throw new TypeError('Model definition must include a valid non-empty string "id".');
    }
    if (!modelDef.providerId || typeof modelDef.providerId !== 'string') {
      throw new TypeError(`Model '${modelDef.id}' must specify a valid string "providerId".`);
    }

    const canonicalId = modelDef.id;

    if (this.models.has(canonicalId)) {
      throw new Error(`Model '${canonicalId}' is already registered.`);
    }

    const normalizedRecord = {
      id: canonicalId,
      object: 'model',
      providerId: modelDef.providerId,
      name: modelDef.name || canonicalId,
      description: modelDef.description || '',
      aliases: Array.isArray(modelDef.aliases) ? [...modelDef.aliases] : [],
      capabilities: {
        chat: true,
        stream: true,
        tools: true,
        vision: false,
        json: false,
        ...(modelDef.capabilities || {})
      },
      isAvailable: modelDef.isAvailable !== false,
      owned_by: modelDef.owned_by || modelDef.providerId,
      created: modelDef.created || 1715500000,
      permission: [],
      root: canonicalId,
      parent: null
    };

    this.models.set(canonicalId, normalizedRecord);

    // Register aliases
    for (const alias of normalizedRecord.aliases) {
      if (this.models.has(alias) && alias !== canonicalId) {
        throw new Error(`Alias '${alias}' conflicts with an existing canonical model.`);
      }
      this.aliases.set(alias, canonicalId);
    }

    logger.info(
      `[ModelRegistry] Registered model: [${canonicalId}] (Provider: ${modelDef.providerId}, Aliases: ${normalizedRecord.aliases.join(', ') || 'none'})`
    );
  }

  /**
   * Resolve a model by canonical ID or alias.
   * @param {string} modelId
   * @returns {Object|null}
   */
  getModel(modelId) {
    if (!modelId || typeof modelId !== 'string') return null;

    // Check canonical models
    if (this.models.has(modelId)) {
      return this.models.get(modelId);
    }

    // Check aliases
    const canonicalId = this.aliases.get(modelId);
    if (canonicalId && this.models.has(canonicalId)) {
      return this.models.get(canonicalId);
    }

    return null;
  }

  /**
   * Check if a model exists by ID or alias.
   * @param {string} modelId
   * @returns {boolean}
   */
  hasModel(modelId) {
    return Boolean(this.getModel(modelId));
  }

  /**
   * Returns list of models formatted for OpenAI /v1/models endpoint.
   * @param {{ availableOnly?: boolean, includeAliases?: boolean }} [options]
   * @returns {Array<Object>}
   */
  listModels({ availableOnly = false, includeAliases = true } = {}) {
    const list = [];
    const seenIds = new Set();

    for (const model of this.models.values()) {
      if (availableOnly && !model.isAvailable) continue;

      if (!seenIds.has(model.id)) {
        list.push({
          id: model.id,
          object: 'model',
          created: model.created,
          owned_by: model.owned_by,
          permission: model.permission || [],
          root: model.root,
          parent: model.parent,
          description: model.description,
          capabilities: model.capabilities
        });
        seenIds.add(model.id);
      }

      if (includeAliases && Array.isArray(model.aliases)) {
        for (const alias of model.aliases) {
          if (!seenIds.has(alias)) {
            list.push({
              id: alias,
              object: 'model',
              created: model.created,
              owned_by: model.owned_by,
              permission: model.permission || [],
              root: model.id,
              parent: model.id,
              description: `${model.description} (Alias for ${model.id})`,
              capabilities: model.capabilities
            });
            seenIds.add(alias);
          }
        }
      }
    }

    return list;
  }

  /**
   * Unregister a model (primarily for tests).
   * @param {string} modelId
   * @returns {boolean}
   */
  unregisterModel(modelId) {
    const model = this.getModel(modelId);
    if (!model) return false;

    if (Array.isArray(model.aliases)) {
      for (const alias of model.aliases) {
        this.aliases.delete(alias);
      }
    }
    this.aliases.delete(modelId);
    return this.models.delete(model.id);
  }

  /**
   * Clear all models (primarily for tests).
   */
  clear() {
    this.models.clear();
    this.aliases.clear();
  }
}
