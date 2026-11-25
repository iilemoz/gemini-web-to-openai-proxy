import { logger } from '../utils/logger.js';

/**
 * Centralized Model Router.
 * Resolves incoming model identifiers to the corresponding provider adapter.
 * Enforces explicit routing, capability validation, and strict fail-closed rejection of unknown models.
 * Completely prohibits silent fallback to alternate providers.
 */
export class ModelRouter {
  /**
   * @param {import('./ProviderRegistry.js').ProviderRegistry} providerRegistry
   * @param {import('./ModelRegistry.js').ModelRegistry} modelRegistry
   */
  constructor(providerRegistry, modelRegistry) {
    if (!providerRegistry || !modelRegistry) {
      throw new TypeError('ModelRouter requires providerRegistry and modelRegistry.');
    }
    this.providerRegistry = providerRegistry;
    this.modelRegistry = modelRegistry;
  }

  /**
   * Resolve a model request to its registered model metadata and provider adapter.
   *
   * Enforces:
   * 1. Deterministic resolution via ModelRegistry with case-insensitivity.
   * 2. Strict rejection of unknown models with HTTP 404 (model_not_found).
   * 3. Truthful rejection of foreign uninstalled providers (no silent cross-provider routing!).
   * 4. Provider availability check (rejects missing/offline providers with HTTP 503 provider_unavailable).
   * 5. Capability validation (rejects unsupported capability requests with HTTP 400 capability_not_supported).
   * 6. Absolutely NO silent fallback to a default provider!
   *
   * @param {string} modelId
   * @param {Object} [options]
   * @param {string} [options.requiredCapability] - Single required capability (e.g. 'tools')
   * @param {string[]} [options.requiredCapabilities] - Multiple required capabilities (e.g. ['tools', 'vision'])
   * @returns {{ model: Object, provider: import('./BaseProvider.js').BaseProvider, resolution: Object }}
   */
  resolve(modelId, { requiredCapability, requiredCapabilities } = {}) {
    if (!modelId || typeof modelId !== 'string' || !modelId.trim()) {
      const err = new Error('Model ID is required.');
      err.status = 400;
      err.code = 'missing_model';
      err.type = 'invalid_request_error';
      err.param = 'model';
      throw err;
    }

    const cleanModelId = modelId.trim();

    // 1. Resolve model record from ModelRegistry (supports canonical IDs and aliases)
    const resolution = this.modelRegistry.resolve(cleanModelId);
    let modelRecord = null;
    let provider = null;

    if (resolution) {
      modelRecord = resolution.model;
      provider = this.providerRegistry.getProvider(resolution.providerId);

      // If registered model's provider adapter is not installed
      if (!provider) {
        logger.error(`[ModelRouter] Backing provider '${resolution.providerId}' for model '${cleanModelId}' is not installed.`);
        const err = new Error(
          `Provider adapter '${resolution.providerId}' for model '${cleanModelId}' is not installed or available.`
        );
        err.status = 503;
        err.code = 'provider_unavailable';
        err.type = 'service_unavailable';
        throw err;
      }
    } else {
      // Check if any registered provider explicitly supports this model dynamically
      // (supports ad-hoc test mock providers that declare supportsModel)
      for (const p of this.providerRegistry.getAllProviders()) {
        if (typeof p.supportsModel === 'function' && p.supportsModel(cleanModelId)) {
          provider = p;
          modelRecord = {
            id: cleanModelId,
            providerId: p.id,
            upstreamModelId: cleanModelId,
            capabilities: typeof p.getCapabilities === 'function'
              ? p.getCapabilities(cleanModelId)
              : { chat: true, stream: true, tools: true, vision: false, json: false, reasoning: false, responses: true },
            isAvailable: true
          };
          break;
        }
      }
    }

    // 2. Fail closed on unknown or unroutable models - NO SILENT FALLBACK!
    if (!modelRecord || !provider) {
      // Check if the model prefix belongs to a known foreign provider without an installed adapter
      const lower = cleanModelId.toLowerCase();
      const foreignPrefixes = ['gpt-', 'o1-', 'o3-', 'deepseek-', 'claude-'];
      const isForeign = foreignPrefixes.some(prefix => lower.startsWith(prefix));

      if (isForeign) {
        logger.warn(
          `[ModelRouter] Request for model '${cleanModelId}' rejected: Provider adapter is not installed and fallback is disabled.`
        );
        const err = new Error(
          `The model '${cleanModelId}' belongs to an unconfigured provider. Native provider adapter is not installed and cross-provider fallback is disabled.`
        );
        err.status = 404;
        err.code = 'model_not_found';
        err.type = 'invalid_request_error';
        err.param = 'model';
        throw err;
      }

      logger.warn(`[ModelRouter] Unknown or unroutable model requested: '${cleanModelId}'`);
      const err = new Error(`The model '${cleanModelId}' does not exist or is not available.`);
      err.status = 404;
      err.code = 'model_not_found';
      err.type = 'invalid_request_error';
      err.param = 'model';
      throw err;
    }

    // 3. Validate model availability
    if (modelRecord.isAvailable === false) {
      logger.warn(`[ModelRouter] Inactive model requested: '${cleanModelId}'`);
      const err = new Error(`The model '${cleanModelId}' is currently unavailable.`);
      err.status = 503;
      err.code = 'model_unavailable';
      err.type = 'service_unavailable';
      throw err;
    }

    // 5. Validate requested capabilities
    const capabilitiesToCheck = [];
    if (requiredCapability) {
      capabilitiesToCheck.push(requiredCapability);
    }
    if (Array.isArray(requiredCapabilities)) {
      capabilitiesToCheck.push(...requiredCapabilities);
    }

    for (const cap of capabilitiesToCheck) {
      const capabilities = modelRecord.capabilities || {};
      if (capabilities[cap] === false) {
        logger.warn(`[ModelRouter] Model '${modelRecord.id}' does not support capability: '${cap}'`);
        const err = new Error(`Model '${modelRecord.id}' does not support the '${cap}' capability.`);
        err.status = 400;
        err.code = 'capability_not_supported';
        err.type = 'invalid_request_error';
        err.param = cap;
        throw err;
      }
    }

    return {
      model: modelRecord,
      provider,
      resolution: resolution || {
        requestedId: cleanModelId,
        canonicalId: modelRecord.id,
        isAlias: false,
        isSynthetic: false,
        providerId: provider.id,
        upstreamModelId: modelRecord.upstreamModelId || modelRecord.id,
        model: modelRecord
      }
    };
  }
}
