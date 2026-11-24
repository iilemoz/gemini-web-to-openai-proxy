import { ProviderRegistry } from './ProviderRegistry.js';
import { ModelRegistry } from './ModelRegistry.js';
import { ModelRouter } from './ModelRouter.js';
import { GeminiProvider } from './gemini/index.js';
import { BaseProvider, ProviderAdapter } from './BaseProvider.js';
import { logger } from '../utils/logger.js';

export { ProviderRegistry, ModelRegistry, ModelRouter, BaseProvider, ProviderAdapter };

// Initialize singletons
export const providerRegistry = new ProviderRegistry();
export const modelRegistry = new ModelRegistry();
export const modelRouter = new ModelRouter(providerRegistry, modelRegistry);

// Register Google Gemini provider and its native models
const geminiProvider = new GeminiProvider();
providerRegistry.register(geminiProvider);

for (const modelDef of geminiProvider.getModels()) {
  modelRegistry.registerModel({
    ...modelDef,
    providerId: geminiProvider.id,
    owned_by: 'google'
  });
}

/**
 * Backward-compatible registry facade.
 * Allows existing tests and controllers to access the provider subsystem smoothly
 * while delegating explicit routing to ModelRouter.
 */
class LegacyRegistryFacade {
  constructor() {
    this._mockDefaultProvider = null;
  }

  get providers() {
    return providerRegistry.providers;
  }

  get defaultProvider() {
    return this._mockDefaultProvider || providerRegistry.getProvider('gemini');
  }

  set defaultProvider(provider) {
    const gemini = providerRegistry.getProvider('gemini');
    if (provider === gemini) {
      this._mockDefaultProvider = null;
    } else {
      this._mockDefaultProvider = provider;
    }
  }

  /**
   * Register a provider and dynamically register any models it advertises.
   * @param {BaseProvider} provider
   * @param {boolean} [isDefault]
   */
  register(provider, isDefault = false) {
    const id = provider.id || provider.name;
    if (!providerRegistry.hasProvider(id)) {
      providerRegistry.register(provider);
    }

    if (typeof provider.getModels === 'function') {
      for (const m of provider.getModels()) {
        if (!modelRegistry.hasModel(m.id)) {
          modelRegistry.registerModel({
            ...m,
            providerId: id,
            owned_by: m.owned_by || id
          });
        }
      }
    }

    if (isDefault) {
      this._mockDefaultProvider = provider;
    }
  }

  /**
   * Resolves provider for the requested model.
   * If a test has set a mock defaultProvider, that mock is prioritized.
   * Otherwise delegates to the ModelRouter for explicit resolution.
   * @param {string} modelId
   * @returns {BaseProvider}
   */
  getProviderForModel(modelId) {
    if (this._mockDefaultProvider) {
      return this._mockDefaultProvider;
    }
    const resolved = modelRouter.resolve(modelId);
    return resolved.provider;
  }
}

export const registry = new LegacyRegistryFacade();
