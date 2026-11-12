import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { test } from 'vitest';
import { createServer } from 'vite';

test('desktop dev loads the conversation SDK before displaying the connecting splash', async () => {
  const root = path.resolve(import.meta.dirname, '../../../..');
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'desktop-startup-'));
  const server = await createServer({
    configFile: path.join(root, 'client/electron/vite.renderer.config.ts'),
    cacheDir,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0 },
    plugins: [{
      name: 'desktop-startup-fixture',
      resolveId(id) { if (id === '/startup-fixture.js') return '\0startup-fixture'; },
      load(id) {
        if (id !== '\0startup-fixture') return;
        return `
import { mountAppVueApp } from '@workspace/vue/bootstrap';
import { createApp, h } from 'vue';
import Landing from '@workspace/vue/components/CodexLoginLanding.vue';
import { i18n } from '@workspace/vue/i18n';
// Evaluate the real bootstrap graph, without a daemon or provider session.
if (typeof mountAppVueApp !== 'function') throw new Error('Bootstrap unavailable');
createApp({render: () => h(Landing, {variant: 'connecting'})}).use(i18n).mount('#app');
`;
      },
      configureServer(server) {
        server.middlewares.use('/startup-probe', (_req, res) => {
          res.setHeader('Content-Type', 'text/html');
          res.end('<!doctype html><div id="app"></div><script type="module" src="/startup-fixture.js"></script>');
        });
      },
    }],
  });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/startup-probe`);
    try {
      await page.locator('.codex-login--connecting').waitFor({ timeout: 15_000 });
    } catch (error) {
      throw new Error(`Desktop startup failed: ${errors.join('; ')}`, { cause: error });
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});
