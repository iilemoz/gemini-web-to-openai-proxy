import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { validateStartupConfig } from '../src/config/validator.js';
import { config } from '../src/config/index.js';
import { safeCompareTokens, authMiddleware } from '../src/middleware/auth.js';
import { createCorsMiddleware } from '../src/middleware/corsConfig.js';
import { redactSensitiveText, sanitizeLogValue } from '../src/utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Helper to construct a mock valid configuration object
function createMockConfig(overrides = {}) {
  return {
    port: 3000,
    host: '127.0.0.1',
    nodeEnv: 'development',
    isProduction: false,
    defaultModel: 'gemini-flash',
    geminiSecure1psid: '',
    geminiSecure1psidts: '',
    geminiSecure1psidcc: '',
    proxyApiKey: '',
    allowCookiePassthrough: false,
    rateLimitEnabled: true,
    rateLimitMax: 120,
    rateLimitWindowMs: 60000,
    corsOrigin: '*',
    upstreamProxy: '',
    connectionTimeoutMs: 15000,
    requestTimeoutMs: 120000,
    streamingIdleTimeoutMs: 60000,
    shutdownGracePeriodMs: 30000,
    models: [
      { id: 'gemini-flash', object: 'model' },
      { id: 'gemini-pro', object: 'model' },
      { id: 'gemini-thinking', object: 'model' },
      { id: 'gemini-lite', object: 'model' }
    ],
    ...overrides
  };
}

test('PHASE 5.0H.4.3: Cross-Platform Configuration Hardening & Environment Verification', async (t) => {

  await t.test('1. Local Profile Defaults and Dev Mode', async (t2) => {
    await t2.test('Default mock configuration passes startup validation', () => {
      const cfg = createMockConfig();
      const res = validateStartupConfig(cfg);
      assert.equal(res.valid, true);
      assert.equal(res.errors.length, 0);
    });

    await t2.test('Default local binding is loopback 127.0.0.1 and port 3000', () => {
      const cfg = createMockConfig();
      assert.equal(cfg.host, '127.0.0.1');
      assert.equal(cfg.port, 3000);
      assert.equal(cfg.isProduction, false);
    });
  });

  await t.test('2. Production Profile Requirements and Hardening', async (t2) => {
    await t2.test('Rejects production mode without PROXY_API_KEY', () => {
      const cfg = createMockConfig({
        isProduction: true,
        proxyApiKey: ''
      });
      const res = validateStartupConfig(cfg);
      assert.equal(res.valid, false);
      assert.ok(res.errors.some(e => e.includes('PROXY_API_KEY must be configured when running in production mode')));
    });

    await t2.test('Rejects production mode with short PROXY_API_KEY (< 16 chars)', () => {
      const cfg = createMockConfig({
        isProduction: true,
        proxyApiKey: 'short_key_123'
      });
      const res = validateStartupConfig(cfg);
      assert.equal(res.valid, false);
      assert.ok(res.errors.some(e => e.includes('PROXY_API_KEY must be at least 16 characters')));
    });

    await t2.test('Accepts production mode with valid PROXY_API_KEY (>= 16 chars)', () => {
      const cfg = createMockConfig({
        isProduction: true,
        proxyApiKey: 'valid_strong_production_key_1234567890'
      });
      const res = validateStartupConfig(cfg);
      assert.equal(res.valid, true);
      assert.equal(res.errors.length, 0);
    });
  });

  await t.test('3. API Key Validation and Whitespace Consistency', async (t2) => {
    await t2.test('Rejects whitespace-only key in production validation', () => {
      const cfg = createMockConfig({
        isProduction: true,
        proxyApiKey: '                ' // 16 spaces
      });
      const res = validateStartupConfig(cfg);
      assert.equal(res.valid, false);
      assert.ok(res.errors.some(e => e.includes('PROXY_API_KEY must be configured when running in production mode')));
    });

    await t2.test('safeCompareTokens performs constant-time comparison correctly', () => {
      const key = 'secret-token-value-123456';
      assert.equal(safeCompareTokens(key, key), true);
      assert.equal(safeCompareTokens(key, 'wrong-token-value-123456'), false);
      assert.equal(safeCompareTokens('', key), false);
      assert.equal(safeCompareTokens(key, ''), false);
      assert.equal(safeCompareTokens(null, key), false);
      assert.equal(safeCompareTokens(undefined, key), false);
    });
  });

  await t.test('4. Port Configuration Validation', async (t2) => {
    await t2.test('Rejects invalid port numbers (0, negative, >65535, floats, NaN)', () => {
      const invalidPorts = [0, -1, 65536, 70000, 3000.5, NaN, '3000', null, undefined];
      for (const p of invalidPorts) {
        const cfg = createMockConfig({ port: p });
        const res = validateStartupConfig(cfg);
        assert.equal(res.valid, false, `Port ${p} should be rejected`);
        assert.ok(res.errors.some(e => e.includes('Invalid PORT configuration')));
      }
    });

    await t2.test('Accepts boundary and standard ports (1, 80, 443, 3000, 8080, 65535)', () => {
      const validPorts = [1, 80, 443, 3000, 8080, 65535];
      for (const p of validPorts) {
        const cfg = createMockConfig({ port: p });
        const res = validateStartupConfig(cfg);
        assert.equal(res.valid, true, `Port ${p} should be valid`);
      }
    });
  });

  await t.test('5. Timeout Configuration Validation', async (t2) => {
    await t2.test('Rejects sub-minimum timeouts (< 1000ms)', () => {
      const cfg = createMockConfig({ requestTimeoutMs: 500 });
      const res = validateStartupConfig(cfg);
      assert.equal(res.valid, false);
      assert.ok(res.errors.some(e => e.includes('REQUEST_TIMEOUT_MS') && e.includes('at least 1000ms')));
    });

    await t2.test('Rejects excessively large timeouts (> 24 hours)', () => {
      const cfg = createMockConfig({ requestTimeoutMs: 90000000 });
      const res = validateStartupConfig(cfg);
      assert.equal(res.valid, false);
      assert.ok(res.errors.some(e => e.includes('REQUEST_TIMEOUT_MS') && e.includes('Exceeds maximum allowable duration')));
    });

    await t2.test('Rejects non-integer timeouts', () => {
      const cfg = createMockConfig({ streamingIdleTimeoutMs: '60000' });
      const res = validateStartupConfig(cfg);
      assert.equal(res.valid, false);
      assert.ok(res.errors.some(e => e.includes('STREAMING_IDLE_TIMEOUT_MS')));
    });
  });

  await t.test('6. Model Registry Integrity Verification', async (t2) => {
    await t2.test('Rejects empty or non-array models configuration', () => {
      const cfg = createMockConfig({ models: [] });
      const res = validateStartupConfig(cfg);
      assert.equal(res.valid, false);
      assert.ok(res.errors.some(e => e.includes('define at least one valid canonical model')));
    });

    await t2.test('Rejects duplicate model identifiers', () => {
      const cfg = createMockConfig({
        models: [
          { id: 'gemini-flash' },
          { id: 'gemini-flash' }
        ]
      });
      const res = validateStartupConfig(cfg);
      assert.equal(res.valid, false);
      assert.ok(res.errors.some(e => e.includes('Duplicate canonical model identifier detected')));
    });

    await t2.test('In production, requires all 4 canonical models', () => {
      const cfg = createMockConfig({
        isProduction: true,
        proxyApiKey: 'strong_prod_key_1234567890',
        models: [
          { id: 'gemini-flash' },
          { id: 'gemini-pro' }
          // Missing gemini-thinking and gemini-lite
        ]
      });
      const res = validateStartupConfig(cfg);
      assert.equal(res.valid, false);
      assert.ok(res.errors.some(e => e.includes('Missing required canonical model definition: "gemini-thinking"')));
      assert.ok(res.errors.some(e => e.includes('Missing required canonical model definition: "gemini-lite"')));
    });
  });

  await t.test('7. Upstream Proxy URL & Rate Limit Validation', async (t2) => {
    await t2.test('Rejects malformed proxy URLs', () => {
      const cfg = createMockConfig({ upstreamProxy: 'not_a_valid_url_string' });
      const res = validateStartupConfig(cfg);
      assert.equal(res.valid, false);
      assert.ok(res.errors.some(e => e.includes('Invalid upstream proxy URL configuration')));
    });

    await t2.test('Rejects unsupported proxy protocols (e.g. ftp://)', () => {
      const cfg = createMockConfig({ upstreamProxy: 'ftp://proxy.internal:21' });
      const res = validateStartupConfig(cfg);
      assert.equal(res.valid, false);
      assert.ok(res.errors.some(e => e.includes('Invalid upstream proxy protocol')));
    });

    await t2.test('Accepts valid HTTP, HTTPS, and SOCKS proxy URLs', () => {
      const validProxies = [
        'http://127.0.0.1:7890',
        'https://corporate-proxy.internal:8080',
        'socks5://127.0.0.1:1080',
        'socks5h://10.0.0.1:1080'
      ];
      for (const proxy of validProxies) {
        const cfg = createMockConfig({ upstreamProxy: proxy });
        const res = validateStartupConfig(cfg);
        assert.equal(res.valid, true, `Proxy URL ${proxy} should be accepted`);
      }
    });

    await t2.test('Rejects invalid rate limiter bounds', () => {
      const cfg = createMockConfig({ rateLimitEnabled: true, rateLimitMax: -5 });
      const res = validateStartupConfig(cfg);
      assert.equal(res.valid, false);
      assert.ok(res.errors.some(e => e.includes('Invalid RATE_LIMIT_MAX')));
    });
  });

  await t.test('8. CORS Behavior Verification', async (t2) => {
    await t2.test('createCorsMiddleware returns functional handler', () => {
      const corsMiddleware = createCorsMiddleware();
      assert.equal(typeof corsMiddleware, 'function');
    });

    await t2.test('Non-browser requests (no Origin header) are admitted', async () => {
      const corsMiddleware = createCorsMiddleware();
      const req = { headers: {}, method: 'GET' };
      const res = { setHeader: () => {}, getHeader: () => {} };
      await new Promise((resolve, reject) => {
        corsMiddleware(req, res, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
    });
  });

  await t.test('9. Secret Redaction & Sanitization Verification', async (t2) => {
    await t2.test('Redacts Bearer tokens and session cookies from strings', () => {
      const sample = 'Headers: Bearer eyJhbGciOiJIUzI1NiIsIn... and Cookie: __Secure-1PSID=g.a000FAmFTiofNNj5...';
      const redacted = redactSensitiveText(sample);
      assert.ok(!redacted.includes('eyJhbGciOiJIUzI1NiIsIn'));
      assert.ok(!redacted.includes('g.a000FAmFTiofNNj5'));
      assert.ok(redacted.includes('Bearer [REDACTED_TOKEN]'));
      assert.ok(redacted.includes('__Secure-1PSID=[REDACTED]'));
    });

    await t2.test('Recursively sanitizes sensitive headers and error objects', () => {
      const sensitiveObj = {
        authorization: 'Bearer secret_token_12345',
        'x-api-key': 'my_super_secret_proxy_key',
        nested: {
          cookie: '__Secure-1PSID=g.a000FAmFT; __Secure-1PSIDTS=sidts-12345'
        }
      };
      const sanitized = sanitizeLogValue(sensitiveObj);
      assert.equal(sanitized.authorization, '[REDACTED_HEADER]');
      assert.equal(sanitized['x-api-key'], '[REDACTED_HEADER]');
      assert.equal(sanitized.nested.cookie, '[REDACTED_HEADER]');
    });
  });

  await t.test('10. Environment Template & Git Exclusion Integrity', async (t2) => {
    await t2.test('.env.example exists and contains no leaked real secrets', () => {
      const envExamplePath = path.join(rootDir, '.env.example');
      assert.ok(fs.existsSync(envExamplePath), '.env.example must exist');
      const content = fs.readFileSync(envExamplePath, 'utf8');

      // Ensure no live cookies or keys are in .env.example
      assert.ok(!content.includes('g.a000FAmFTiofNNj5'), 'Must not contain actual Google session tokens');
      assert.ok(!content.includes('sidts-CjIBnJZzasu2hq'), 'Must not contain actual sidts tokens');
      assert.ok(!content.includes('APD_SKFZC_UgCtvS1Ok8J'), 'Must not contain actual sidts-cc tokens');

      // Ensure canonical variables are documented
      assert.ok(content.includes('NODE_ENV='));
      assert.ok(content.includes('PORT=3000'));
      assert.ok(content.includes('HOST=127.0.0.1'));
      assert.ok(content.includes('PROXY_API_KEY='));
      assert.ok(content.includes('GEMINI_SECURE_1PSID='));
      assert.ok(content.includes('DEFAULT_MODEL=gemini-flash'));
    });

    await t2.test('.gitignore excludes real .env file from version control', () => {
      const gitignorePath = path.join(rootDir, '.gitignore');
      assert.ok(fs.existsSync(gitignorePath), '.gitignore must exist');
      const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
      const lines = gitignoreContent.split('\n').map(l => l.trim());
      assert.ok(lines.includes('.env'), '.gitignore must explicitly include .env');
    });
  });

  await t.test('11. Cross-Platform Path & Environment Portability', async (t2) => {
    await t2.test('Path resolutions work portably without OS-specific hardcoding', () => {
      const resolvedConfigPath = path.resolve(rootDir, 'src', 'config', 'index.js');
      assert.ok(fs.existsSync(resolvedConfigPath), 'src/config/index.js must exist on any OS');
      const resolvedValidatorPath = path.resolve(rootDir, 'src', 'config', 'validator.js');
      assert.ok(fs.existsSync(resolvedValidatorPath), 'src/config/validator.js must exist on any OS');
    });
  });
});
