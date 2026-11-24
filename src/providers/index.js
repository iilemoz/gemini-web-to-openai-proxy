import { GeminiProvider } from './gemini/index.js';
import { logger } from '../utils/logger.js';

/**
 * Central Provider Registry.
 * Pure HTTP Google Gemini Web Provider (Guest & Account Modes).
 */
class ProviderRegistry {
  constructor() {
    this.providers = new Map();
    this.defaultProvider = null;
  }

  /**
   * Register an AI provider.
   * @param {import('./BaseProvider.js').BaseProvider} provider
   * @param {boolean} isDefault
   */
  register(provider, isDefault = false) {
    this.providers.set(provider.name, provider);
    if (isDefault || !this.defaultProvider) {
      this.defaultProvider = provider;
    }
    logger.info(`Provider registered: [${provider.name}] (default: ${isDefault})`);
  }

  /**
   * Finds the best provider for the requested model.
   * @param {string} modelId
   * @returns {import('./BaseProvider.js').BaseProvider}
   */
  getProviderForModel(modelId) {
    return this.defaultProvider;
  }
}

export const registry = new ProviderRegistry();

// Initialize Google Gemini provider as the sole, default provider
const geminiProvider = new GeminiProvider();
registry.register(geminiProvider, true);
