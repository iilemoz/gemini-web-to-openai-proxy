import { logger } from '../utils/logger.js';
import { BaseProvider } from './BaseProvider.js';

/**
 * Centralized Provider Registry.
 * Responsible for managing the lifecycle, registration, and discovery of AI providers.
 * Enforces explicit provider resolution without hardcoded fallback.
 */
export class ProviderRegistry {
  constructor() {
    /** @type {Map<string, BaseProvider>} */
    this.providers = new Map();
  }

  /**
   * Register an AI provider adapter.
   * @param {BaseProvider} provider
   */
  register(provider) {
    if (!provider) {
      throw new TypeError('Cannot register undefined or null provider.');
    }

    const id = provider.id || provider.name;
    if (!id || typeof id !== 'string') {
      throw new TypeError('Provider must have a valid non-empty string "id" or "name".');
    }

    if (this.providers.has(id)) {
      throw new Error(`Provider with ID '${id}' is already registered.`);
    }

    // Ensure id is normalized on the instance
    provider.id = id;
    provider.name = provider.name || id;

    this.providers.set(id, provider);
    logger.info(`[ProviderRegistry] Registered provider: [${id}] (${provider.name})`);
  }

  /**
   * Retrieve a provider by ID.
   * @param {string} id
   * @returns {BaseProvider|null}
   */
  getProvider(id) {
    if (!id || typeof id !== 'string') return null;
    return this.providers.get(id) || null;
  }

  /**
   * Check if a provider is registered.
   * @param {string} id
   * @returns {boolean}
   */
  hasProvider(id) {
    if (!id) return false;
    return this.providers.has(id);
  }

  /**
   * Return all registered providers as an array.
   * @returns {BaseProvider[]}
   */
  getAllProviders() {
    return Array.from(this.providers.values());
  }

  /**
   * Unregister a provider (primarily for tests).
   * @param {string} id
   * @returns {boolean}
   */
  unregister(id) {
    return this.providers.delete(id);
  }

  /**
   * Initialize all registered providers.
   * @returns {Promise<void>}
   */
  async initializeAll() {
    for (const provider of this.providers.values()) {
      if (!provider.isInitialized && typeof provider.initialize === 'function') {
        await provider.initialize();
      }
    }
  }

  /**
   * Clear all registered providers (primarily for tests).
   */
  clear() {
    this.providers.clear();
  }
}
