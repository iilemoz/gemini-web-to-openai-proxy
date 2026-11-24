import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  defaultModel: process.env.DEFAULT_MODEL || 'gemini-flash',
  geminiSecure1psid: process.env.GEMINI_SECURE_1PSID || '',
  geminiSecure1psidts: process.env.GEMINI_SECURE_1PSIDTS || '',
  proxyApiKey: process.env.PROXY_API_KEY || '',
  
  // Available model aliases mapped to Google Gemini backend
  models: [
    {
      id: 'gemini-flash',
      object: 'model',
      created: 1715500000,
      owned_by: 'google',
      permission: [],
      root: 'gemini-flash',
      parent: null,
      description: 'Google Gemini 2.5 Flash / Gemini 3 Flash (Fast & Pure HTTP)'
    },

    {
      id: 'gemini-2.5-flash',
      object: 'model',
      created: 1715500000,
      owned_by: 'google',
      permission: [],
      root: 'gemini-2.5-flash',
      parent: null,
      description: 'Google Gemini 2.5 Flash Flagship Speed Alias'
    },
    {
      id: 'gemini-pro',
      object: 'model',
      created: 1715500000,
      owned_by: 'google',
      permission: [],
      root: 'gemini-pro',
      parent: null,
      description: 'Google Gemini 2.5 Pro / Gemini 3 Pro (Complex Reasoning & Deep Knowledge)'
    },
    {
      id: 'gemini-2.5-pro',
      object: 'model',
      created: 1715500000,
      owned_by: 'google',
      permission: [],
      root: 'gemini-2.5-pro',
      parent: null,
      description: 'Google Gemini 2.5 Pro Alias'
    },
    {
      id: 'gemini-thinking',
      object: 'model',
      created: 1715500000,
      owned_by: 'google',
      permission: [],
      root: 'gemini-thinking',
      parent: null,
      description: 'Google Gemini Thinking with Deep Reasoning stream'
    },
    {
      id: 'gemini-2.5-thinking',
      object: 'model',
      created: 1715500000,
      owned_by: 'google',
      permission: [],
      root: 'gemini-2.5-thinking',
      parent: null,
      description: 'Google Gemini 2.5 Thinking Model'
    },
    {
      id: 'gemini-lite',
      object: 'model',
      created: 1715500000,
      owned_by: 'google',
      permission: [],
      root: 'gemini-lite',
      parent: null,
      description: 'Google Gemini Lite'
    }
  ]
};
