import { config } from '../config/index.js';

/**
 * GET /v1/models
 * Returns all supported model definitions in OpenAI list format.
 */
export function listModels(req, res) {
  res.json({
    object: 'list',
    data:   config.models
  });
}

/**
 * GET /v1/models/:model
 * Returns a single model definition by ID.
 * Most OpenAI SDKs call this endpoint to validate a model before sending requests.
 */
export function getModel(req, res) {
  const { model } = req.params;

  const found = config.models.find(m => m.id === model);

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

  res.json(found);
}
