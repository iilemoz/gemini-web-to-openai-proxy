import { modelRegistry } from '../providers/index.js';

/**
 * GET /v1/models
 * Returns all registered and available genuine models in OpenAI list format.
 * Omits synthetic/legacy aliases from public advertisement.
 */
export function listModels(req, res) {
  const models = modelRegistry.listModels({ availableOnly: false, includeAliases: false, includeSynthetic: false });
  res.json({
    object: 'list',
    data: models
  });
}

/**
 * GET /v1/models/:model
 * Returns a single model definition by ID or alias.
 */
export function getModel(req, res) {
  const { model } = req.params;

  const resolution = modelRegistry.resolve(model);

  if (!resolution) {
    return res.status(404).json({
      error: {
        message: `The model '${model}' does not exist.`,
        type:    'invalid_request_error',
        param:   'model',
        code:    'model_not_found'
      }
    });
  }

  const found = resolution.model;
  res.json({
    id: resolution.isAlias ? model : found.id,
    object: 'model',
    created: found.created,
    owned_by: found.owned_by,
    permission: found.permission || [],
    root: found.id,
    parent: resolution.isAlias ? found.id : found.parent,
    description: found.description,
    capabilities: found.capabilities
  });
}
