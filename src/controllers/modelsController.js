import { modelRegistry } from '../providers/index.js';

/**
 * GET /v1/models
 * Returns all registered and available models in OpenAI list format.
 */
export function listModels(req, res) {
  const models = modelRegistry.listModels({ availableOnly: false, includeAliases: true });
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

  const found = modelRegistry.getModel(model);

  if (!found) {
    return res.status(404).json({
      error: {
        message: `The model '${model}' does not exist.`,
        type:    'invalid_request_error',
        param:   'model',
        code:    'model_not_found'
      }
    });
  }

  res.json({
    id: model,
    object: 'model',
    created: found.created,
    owned_by: found.owned_by,
    permission: found.permission || [],
    root: found.id,
    parent: found.parent,
    description: found.description,
    capabilities: found.capabilities
  });
}
