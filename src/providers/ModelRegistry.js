import { logger } from '../utils/logger.js';

/**
 * Centralized Model Registry.
 * Maintains canonical model definitions, aliases, capabilities, and provider associations.
 * Enforces canonical model uniqueness, provider identity validation, upstream model validation,
 * case-insensitive resolution, and rejection of alias collisions or circular alias chains.
 */
export class ModelRegistry {
  constructor() {
    /** @type {Map<string, Object>} Lowercase canonical model ID -> model record */
    this.models = new Map();
    /** @type {Map<string, string>} Lowercase alias ID -> lowercase canonical model ID */
    this.aliases = new Map();
    /** @type {Map<string, Object>} Lowercase alias ID -> alias metadata (for legacy/synthetic tracking) */
    this.aliasMetadata = new Map();
  }

  /**
   * Register a model definition.
   * @param {Object} modelDef
   * @param {string} modelDef.id - Canonical model ID (e.g. 'gemini-2.5-flash')
   * @param {string} modelDef.providerId - Backing provider ID (e.g. 'gemini')
   * @param {string} [modelDef.upstreamModelId] - Provider's upstream model identifier
   * @param {string} [modelDef.name] - Display name
   * @param {string} [modelDef.description] - Model description
   * @param {string[]} [modelDef.aliases] - Alternate model aliases
   * @param {Object} [modelDef.capabilities] - Model capabilities (chat, stream, tools, vision, json, reasoning, responses)
   * @param {boolean} [modelDef.isAvailable=true] - Availability flag
   * @param {string} [modelDef.owned_by] - Provider/Owner string
   * @param {number} [modelDef.created] - Unix epoch timestamp
   */
  registerModel(modelDef) {
    if (!modelDef || !modelDef.id || typeof modelDef.id !== 'string' || !modelDef.id.trim()) {
      throw new TypeError('Model definition must include a valid non-empty string "id".');
    }
    if (!modelDef.providerId || typeof modelDef.providerId !== 'string' || !modelDef.providerId.trim()) {
      throw new TypeError(`Model '${modelDef.id}' must specify a valid string "providerId".`);
    }

    const canonicalId = modelDef.id.trim();
    const lowerCanonical = canonicalId.toLowerCase();

    // Enforce canonical uniqueness
    if (this.models.has(lowerCanonical)) {
      throw new Error(`Model '${canonicalId}' is already registered.`);
    }

    // Ensure canonical ID does not collide with an existing alias
    if (this.aliases.has(lowerCanonical)) {
      throw new Error(`Model ID '${canonicalId}' conflicts with an existing alias.`);
    }

    const cleanAliases = [];
    const seenInDef = new Set();

    if (Array.isArray(modelDef.aliases)) {
      for (const rawAlias of modelDef.aliases) {
        if (!rawAlias || typeof rawAlias !== 'string' || !rawAlias.trim()) {
          throw new TypeError(`Model '${canonicalId}' contains an invalid alias.`);
        }
        const alias = rawAlias.trim();
        const lowerAlias = alias.toLowerCase();

        if (lowerAlias === lowerCanonical) {
          throw new Error(`Alias '${alias}' cannot be identical to canonical model ID '${canonicalId}'.`);
        }

        if (seenInDef.has(lowerAlias)) {
          throw new Error(`Duplicate alias '${alias}' in model definition for '${canonicalId}'.`);
        }
        seenInDef.add(lowerAlias);

        if (this.models.has(lowerAlias)) {
          throw new Error(`Alias '${alias}' conflicts with an existing canonical model.`);
        }

        if (this.aliases.has(lowerAlias)) {
          throw new Error(`Alias '${alias}' conflicts with an existing alias.`);
        }

        cleanAliases.push(alias);
      }
    }

    const upstreamModelId = (typeof modelDef.upstreamModelId === 'string' && modelDef.upstreamModelId.trim())
      ? modelDef.upstreamModelId.trim()
      : canonicalId;

    const normalizedRecord = {
      id: canonicalId,
      object: 'model',
      providerId: modelDef.providerId.trim(),
      upstreamModelId,
      name: modelDef.name || canonicalId,
      description: modelDef.description || '',
      aliases: cleanAliases,
      capabilities: {
        chat: true,
        stream: true,
        tools: true,
        vision: false,
        json: false,
        reasoning: false,
        responses: true,
        ...(modelDef.capabilities || {})
      },
      isAvailable: modelDef.isAvailable !== false,
      isSyntheticAlias: Boolean(modelDef.isSyntheticAlias),
      owned_by: modelDef.owned_by || modelDef.providerId.trim(),
      created: modelDef.created || 1715500000,
      permission: [],
      root: canonicalId,
      parent: null
    };

    this.models.set(lowerCanonical, normalizedRecord);

    // Register aliases pointing directly to lowercase canonical ID (no chaining)
    for (const alias of cleanAliases) {
      const lowerAlias = alias.toLowerCase();
      this.aliases.set(lowerAlias, lowerCanonical);
      this.aliasMetadata.set(lowerAlias, {
        alias,
        canonicalId,
        isSynthetic: false
      });
    }

    logger.info(
      `[ModelRegistry] Registered model: [${canonicalId}] (Provider: ${normalizedRecord.providerId}, Upstream: ${upstreamModelId}, Aliases: ${cleanAliases.join(', ') || 'none'})`
    );
  }

  /**
   * Register a legacy cross-provider compatibility alias (e.g. gpt-4o -> gemini-flash).
   * Used strictly when explicit opt-in flag ENABLE_LEGACY_CROSS_PROVIDER_ALIASES is enabled.
   *
   * @param {string} alias - Legacy alias
   * @param {string} targetCanonicalId - Existing canonical model ID
   * @param {string} [description] - Optional documentation description
   */
  registerLegacyAlias(alias, targetCanonicalId, description = '') {
    if (!alias || typeof alias !== 'string' || !alias.trim()) {
      throw new TypeError('Legacy alias must be a non-empty string.');
    }
    if (!targetCanonicalId || typeof targetCanonicalId !== 'string' || !targetCanonicalId.trim()) {
      throw new TypeError('Target canonical ID must be a non-empty string.');
    }

    const cleanAlias = alias.trim();
    const lowerAlias = cleanAlias.toLowerCase();
    const lowerTarget = targetCanonicalId.trim().toLowerCase();

    const targetModel = this.models.get(lowerTarget);
    if (!targetModel) {
      throw new Error(`Cannot register legacy alias '${cleanAlias}': Target model '${targetCanonicalId}' is not registered.`);
    }

    if (this.models.has(lowerAlias)) {
      throw new Error(`Legacy alias '${cleanAlias}' conflicts with an existing canonical model.`);
    }
    if (this.aliases.has(lowerAlias)) {
      throw new Error(`Legacy alias '${cleanAlias}' conflicts with an existing alias.`);
    }

    this.aliases.set(lowerAlias, lowerTarget);
    this.aliasMetadata.set(lowerAlias, {
      alias: cleanAlias,
      canonicalId: targetModel.id,
      isSynthetic: true,
      description: description || `Legacy compatibility alias mapped to ${targetModel.id}`
    });

    logger.warn(
      `[ModelRegistry] Registered synthetic legacy alias: [${cleanAlias}] -> [${targetModel.id}] (Deprecated compatibility mode)`
    );
  }

  /**
   * Check if an identifier is a registered legacy / synthetic alias.
   * @param {string} modelId
   * @returns {boolean}
   */
  isLegacyAlias(modelId) {
    if (!modelId || typeof modelId !== 'string') return false;
    const meta = this.aliasMetadata.get(modelId.trim().toLowerCase());
    return Boolean(meta?.isSynthetic);
  }

  /**
   * Resolve a model by canonical ID or alias (case-insensitive).
   * Returns canonical model record or null.
   * @param {string} modelId
   * @returns {Object|null}
   */
  getModel(modelId) {
    if (!modelId || typeof modelId !== 'string') return null;
    const lower = modelId.trim().toLowerCase();

    // Check canonical models
    if (this.models.has(lower)) {
      return this.models.get(lower);
    }

    // Check aliases
    const canonicalLower = this.aliases.get(lower);
    if (canonicalLower && this.models.has(canonicalLower)) {
      return this.models.get(canonicalLower);
    }

    return null;
  }

  /**
   * Detailed resolution returning resolution chain metadata.
   * @param {string} modelId
   * @returns {{
   *   requestedId: string,
   *   canonicalId: string,
   *   isAlias: boolean,
   *   isSynthetic: boolean,
   *   providerId: string,
   *   upstreamModelId: string,
   *   model: Object
   * }|null}
   */
  resolve(modelId) {
    if (!modelId || typeof modelId !== 'string') return null;
    const cleanId = modelId.trim();
    const lower = cleanId.toLowerCase();

    if (this.models.has(lower)) {
      const model = this.models.get(lower);
      return {
        requestedId: cleanId,
        canonicalId: model.id,
        isAlias: false,
        isSynthetic: false,
        providerId: model.providerId,
        upstreamModelId: model.upstreamModelId,
        model
      };
    }

    const canonicalLower = this.aliases.get(lower);
    if (canonicalLower && this.models.has(canonicalLower)) {
      const model = this.models.get(canonicalLower);
      const meta = this.aliasMetadata.get(lower);
      return {
        requestedId: cleanId,
        canonicalId: model.id,
        isAlias: true,
        isSynthetic: Boolean(meta?.isSynthetic),
        providerId: model.providerId,
        upstreamModelId: model.upstreamModelId,
        model
      };
    }

    return null;
  }

  /**
   * Check if a model exists by ID or alias (case-insensitive).
   * @param {string} modelId
   * @returns {boolean}
   */
  hasModel(modelId) {
    return Boolean(this.getModel(modelId));
  }

  /**
   * Returns list of models formatted for OpenAI /v1/models endpoint.
   * Public model list strictly reflects truthful models and providers.
   * Synthetic/legacy aliases are omitted unless explicitly requested.
   *
   * @param {{ availableOnly?: boolean, includeAliases?: boolean, includeSynthetic?: boolean }} [options]
   * @returns {Array<Object>}
   */
  listModels({ availableOnly = false, includeAliases = true, includeSynthetic = false } = {}) {
    const list = [];
    const seenIds = new Set();

    for (const model of this.models.values()) {
      if (availableOnly && !model.isAvailable) continue;

      if (!seenIds.has(model.id.toLowerCase())) {
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
        seenIds.add(model.id.toLowerCase());
      }

      if (includeAliases && Array.isArray(model.aliases)) {
        for (const alias of model.aliases) {
          const lowerAlias = alias.toLowerCase();
          const meta = this.aliasMetadata.get(lowerAlias);
          if (meta?.isSynthetic && !includeSynthetic) {
            continue;
          }

          if (!seenIds.has(lowerAlias)) {
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
            seenIds.add(lowerAlias);
          }
        }
      }
    }

    // Include synthetic aliases if requested
    if (includeAliases && includeSynthetic) {
      for (const [lowerAlias, meta] of this.aliasMetadata.entries()) {
        if (meta.isSynthetic && !seenIds.has(lowerAlias)) {
          const canonicalLower = this.aliases.get(lowerAlias);
          const model = this.models.get(canonicalLower);
          if (model && (!availableOnly || model.isAvailable)) {
            list.push({
              id: meta.alias,
              object: 'model',
              created: model.created,
              owned_by: model.owned_by,
              permission: model.permission || [],
              root: model.id,
              parent: model.id,
              description: meta.description || `Legacy compatibility alias for ${model.id}`,
              capabilities: model.capabilities
            });
            seenIds.add(lowerAlias);
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
    if (!modelId || typeof modelId !== 'string') return false;
    const lower = modelId.trim().toLowerCase();
    const model = this.models.get(lower);
    if (!model) return false;

    if (Array.isArray(model.aliases)) {
      for (const alias of model.aliases) {
        const lowerAlias = alias.toLowerCase();
        this.aliases.delete(lowerAlias);
        this.aliasMetadata.delete(lowerAlias);
      }
    }

    // Clean up any legacy aliases that mapped to this model
    for (const [aliasLower, targetLower] of this.aliases.entries()) {
      if (targetLower === lower) {
        this.aliases.delete(aliasLower);
        this.aliasMetadata.delete(aliasLower);
      }
    }

    this.aliases.delete(lower);
    this.aliasMetadata.delete(lower);
    return this.models.delete(lower);
  }

  /**
   * Clear all models (primarily for tests).
   */
  clear() {
    this.models.clear();
    this.aliases.clear();
    this.aliasMetadata.clear();
  }
}
