import { Router } from 'express';
import { handleChatCompletion } from '../controllers/chatController.js';
import { listModels, getModel } from '../controllers/modelsController.js';

export const v1Router = Router();

// ── Chat Completions ─────────────────────────────────────────────────────────
v1Router.post('/chat/completions', handleChatCompletion);

// ── Models ───────────────────────────────────────────────────────────────────
// GET /v1/models         → full list (OpenAI-compatible)
// GET /v1/models/:model  → single model lookup (required by most OpenAI SDKs)
v1Router.get('/models',       listModels);
v1Router.get('/models/:model', getModel);
