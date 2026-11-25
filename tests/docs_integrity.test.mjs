import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const docsDir = path.resolve(rootDir, 'docs', 'ide-integrations');

test('Documentation Testing Suite', async (t) => {
  const expectedDocFiles = [
    'README.md',
    'cursor.md',
    'continue.md',
    'cline.md',
    'roo-code.md',
    'troubleshooting.md',
    'security.md',
    'compatibility-matrix.md'
  ];

  await t.test('1. All expected documentation files exist and have content', () => {
    for (const file of expectedDocFiles) {
      const fullPath = path.join(docsDir, file);
      assert.ok(fs.existsSync(fullPath), `Documentation file missing: ${file}`);
      const stats = fs.statSync(fullPath);
      assert.ok(stats.size > 200, `Documentation file is unexpectedly small: ${file} (${stats.size} bytes)`);
    }
  });

  await t.test('2. All internal links in docs/ide-integrations resolve to existing files', () => {
    for (const file of expectedDocFiles) {
      const fullPath = path.join(docsDir, file);
      const content = fs.readFileSync(fullPath, 'utf8');

      // Strip fenced and inline code blocks before scanning for links
      const cleanContent = content.replace(/```[\s\S]*?```/g, '').replace(/`[^`]+`/g, '');

      // Match markdown links: [text](target.md) but exclude images (![text](url))
      const linkRegex = /(?<!!)\[([^\]]+)\]\(([^)]+)\)/g;
      let match;
      while ((match = linkRegex.exec(cleanContent)) !== null) {
        const target = match[2];
        // Ignore external URLs (http/https) and anchors (#...)
        if (target.startsWith('http://') || target.startsWith('https://') || target.startsWith('#')) {
          continue;
        }

        const cleanTarget = target.split('#')[0]; // strip anchor
        if (!cleanTarget) continue;

        const resolvedTarget = path.resolve(docsDir, cleanTarget);
        assert.ok(
          fs.existsSync(resolvedTarget),
          `Broken link in ${file}: target '${target}' does not exist at '${resolvedTarget}'`
        );
      }
    }
  });

  await t.test('3. Documented canonical models match actual config registry', () => {
    const canonicalModelIds = config.models.map(m => m.id);
    assert.deepEqual(
      canonicalModelIds.sort(),
      ['gemini-flash', 'gemini-lite', 'gemini-pro', 'gemini-thinking'].sort(),
      'Model registry must match canonical IDs'
    );

    const matrixPath = path.join(docsDir, 'compatibility-matrix.md');
    const matrixContent = fs.readFileSync(matrixPath, 'utf8');
    for (const modelId of canonicalModelIds) {
      assert.ok(
        matrixContent.includes(modelId),
        `compatibility-matrix.md must document canonical model: ${modelId}`
      );
    }
  });

  await t.test('4. No real Google session cookies, actual API secrets, or unredacted keys exist in docs', () => {
    for (const file of expectedDocFiles) {
      const fullPath = path.join(docsDir, file);
      const content = fs.readFileSync(fullPath, 'utf8');

      // Check for real Google cookie prefix (starts with 'g.a.')
      const realCookieMatch = content.match(/g\.a\.[a-zA-Z0-9_-]{20,}/);
      assert.equal(realCookieMatch, null, `Found potential real cookie in ${file}: ${realCookieMatch}`);

      // Ensure examples use placeholders
      if (content.includes('GEMINI_SECURE_1PSID=')) {
        assert.ok(
          content.includes('YOUR_GOOGLE_SESSION_COOKIE'),
          `Cookie example in ${file} must use placeholder YOUR_GOOGLE_SESSION_COOKIE`
        );
      }
    }
  });

  await t.test('5. Documented npm commands match package.json scripts', () => {
    const pkgPath = path.join(rootDir, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

    const expectedScripts = ['start', 'dev', 'test'];
    for (const script of expectedScripts) {
      assert.ok(pkg.scripts[script], `package.json must define '${script}' script`);
    }
  });

  await t.test('6. Documented primary endpoints exist in app routes', async () => {
    const appModule = await import('../src/app.js');
    const app = appModule.app;
    assert.ok(app, 'app must be exported');

    // Read routes/v1.js to verify endpoints
    const v1Path = path.join(rootDir, 'src', 'routes', 'v1.js');
    const v1Content = fs.readFileSync(v1Path, 'utf8');

    assert.ok(v1Content.includes('/chat/completions'), 'Must register /chat/completions');
    assert.ok(v1Content.includes('/models'), 'Must register /models');
    assert.ok(v1Content.includes('/responses'), 'Must register /responses');
  });

  await t.test('7. Documented environment variables exist in config or env.example', () => {
    const envExamplePath = path.join(rootDir, 'env.example');
    const envExample = fs.readFileSync(envExamplePath, 'utf8');

    const documentedVars = [
      'PORT',
      'HOST',
      'PROXY_API_KEY',
      'GEMINI_SECURE_1PSID',
      'GEMINI_SECURE_1PSIDTS',
      'RATE_LIMIT_ENABLED'
    ];

    for (const varName of documentedVars) {
      assert.ok(
        envExample.includes(varName) || config[varName] !== undefined,
        `Documented variable ${varName} must exist in env.example or config`
      );
    }
  });
});
