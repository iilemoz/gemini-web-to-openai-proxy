import { ProviderRegistry } from './ProviderRegistry.js';
import { ModelRegistry } from './ModelRegistry.js';
import { ModelRouter } from './ModelRouter.js';
import { GeminiProvider } from './gemini/index.js';
import { OpenAIProvider } from './openai/index.js';
import { BaseProvider, ProviderAdapter } from './BaseProvider.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

export { ProviderRegistry, ModelRegistry, ModelRouter, GeminiProvider, OpenAIProvider, BaseProvider, ProviderAdapter };

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
 * Helper to register or re-register the native OpenAI provider into the registries.
 * @param {Object} [options]
 */
export function registerOpenAIProvider(options = {}) {
  const apiKey = options.apiKey || config.openaiApiKey;
  const baseUrl = options.baseUrl || config.openaiBaseUrl;
  const timeoutMs = options.timeoutMs || config.openaiTimeoutMs;
  const maxRetries = options.maxRetries ?? config.openaiMaxRetries;
  const organization = options.organization || config.openaiOrganization;
  const project = options.project || config.openaiProject;

  const openAIProvider = new OpenAIProvider({
    apiKey,
    baseUrl,
    timeoutMs,
    maxRetries,
    organization,
    project
  });

  const validation = openAIProvider.validateConfig();
  if (!validation.valid) {
    logger.warn(`[ProviderSetup] OpenAI configuration invalid: ${validation.errors?.join(' ')}`);
    return null;
  }

  if (providerRegistry.hasProvider(openAIProvider.id)) {
    providerRegistry.unregister(openAIProvider.id);
  }

  providerRegistry.register(openAIProvider);

  for (const modelDef of openAIProvider.getModels()) {
    if (!modelRegistry.hasModel(modelDef.id)) {
      modelRegistry.registerModel({
        ...modelDef,
        providerId: openAIProvider.id,
        owned_by: 'openai'
      });
    }
  }

  logger.info(`[ProviderSetup] Native OpenAI Provider registered successfully (${openAIProvider.getModels().length} models).`);
  return openAIProvider;
}

// Register OpenAI provider if explicitly enabled and credentials configured
if (config.openaiEnabled) {
  if (config.openaiApiKey) {
    try {
      registerOpenAIProvider();
    } catch (err) {
      logger.error(`[ProviderSetup] Failed to register OpenAI provider: ${err.message}`);
    }
  } else {
    logger.warn('[ProviderSetup] OPENAI_ENABLED is true, but OPENAI_API_KEY is not configured. Native OpenAI provider not registered.');
  }
}

// Register legacy cross-provider compatibility aliases ONLY if explicitly enabled
if (config.enableLegacyProviderAliases) {
  logger.warn(
    '[ProviderSetup] ENABLE_LEGACY_CROSS_PROVIDER_ALIASES=true: Registering synthetic cross-provider compatibility aliases.'
  );
  const legacyAliases = [
    { alias: 'gpt-4o', target: 'gemini-flash', description: 'Legacy GPT-4o compatibility alias -> gemini-flash' },
    { alias: 'gpt-4', target: 'gemini-flash', description: 'Legacy GPT-4 compatibility alias -> gemini-flash' },
    { alias: 'deepseek-chat', target: 'gemini-flash', description: 'Legacy DeepSeek Chat compatibility alias -> gemini-flash' },
    { alias: 'deepseek-coder', target: 'gemini-flash', description: 'Legacy DeepSeek Coder compatibility alias -> gemini-flash' },
    { alias: 'deepseek-reasoner', target: 'gemini-thinking', description: 'Legacy DeepSeek Reasoner compatibility alias -> gemini-thinking' }
  ];

  for (const item of legacyAliases) {
    try {
      modelRegistry.registerLegacyAlias(item.alias, item.target, item.description);
    } catch (err) {
      logger.error(`[ProviderSetup] Failed to register legacy alias '${item.alias}': ${err.message}`);
    }
  }
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
