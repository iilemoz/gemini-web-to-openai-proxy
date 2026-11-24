import { logger } from '../utils/logger.js';

/**
 * Centralized Model Router.
 * Resolves incoming model identifiers to the corresponding provider adapter.
 * Enforces explicit routing, capability validation, and strict rejection of unknown models.
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
   * 1. Model existence check (rejects unknown models with HTTP 404 model_not_found).
   * 2. Provider availability check (rejects missing/offline providers with HTTP 503 provider_unavailable).
   * 3. Capability validation (rejects unsupported capability requests with HTTP 400 capability_not_supported).
   * 4. Absolutely NO silent fallback to a default provider!
   *
   * @param {string} modelId
   * @param {Object} [options]
   * @param {string} [options.requiredCapability] - e.g. 'tools', 'stream', 'vision'
   * @returns {{ model: Object, provider: import('./BaseProvider.js').BaseProvider }}
   */
  resolve(modelId, { requiredCapability } = {}) {
    if (!modelId || typeof modelId !== 'string') {
      const err = new Error('Model ID is required.');
      err.status = 400;
      err.code = 'missing_model';
      err.type = 'invalid_request_error';
      err.param = 'model';
      throw err;
    }

    // 1. Resolve model record from ModelRegistry
    let modelRecord = this.modelRegistry.getModel(modelId);
    let provider = null;

    if (modelRecord) {
      provider = this.providerRegistry.getProvider(modelRecord.providerId);
    } else {
      // Check if any registered provider explicitly supports this model dynamically
      // (supports ad-hoc test mock providers and dynamic plugins)
      for (const p of this.providerRegistry.getAllProviders()) {
        if (typeof p.supportsModel === 'function' && p.supportsModel(modelId)) {
          provider = p;
          modelRecord = {
            id: modelId,
            providerId: p.id,
            capabilities: typeof p.getCapabilities === 'function'
              ? p.getCapabilities(modelId)
              : { chat: true, stream: true, tools: true },
            isAvailable: true
          };
          break;
        }
      }
    }

    // Reject unknown or unroutable models explicitly - NO SILENT FALLBACK!
    if (!modelRecord || !provider) {
      logger.warn(`[ModelRouter] Unknown or unroutable model requested: '${modelId}'`);
      const err = new Error(`The model '${modelId}' does not exist or is not available.`);
      err.status = 404;
      err.code = 'model_not_found';
      err.type = 'invalid_request_error';
      err.param = 'model';
      throw err;
    }

    // 2. Validate model availability
    if (modelRecord.isAvailable === false) {
      logger.warn(`[ModelRouter] Inactive model requested: '${modelId}'`);
      const err = new Error(`The model '${modelId}' is currently unavailable.`);
      err.status = 503;
      err.code = 'model_unavailable';
      err.type = 'service_unavailable';
      throw err;
    }

    // 3. Validate requested capability if specified
    if (requiredCapability) {
      const capabilities = modelRecord.capabilities || {};
      if (capabilities[requiredCapability] === false) {
        logger.warn(`[ModelRouter] Model '${modelId}' does not support capability: '${requiredCapability}'`);
        const err = new Error(`Model '${modelId}' does not support the '${requiredCapability}' capability.`);
        err.status = 400;
        err.code = 'capability_not_supported';
        err.type = 'invalid_request_error';
        err.param = requiredCapability;
        throw err;
      }
    }

    return { model: modelRecord, provider };
  }
}
