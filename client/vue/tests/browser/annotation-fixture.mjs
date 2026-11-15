import { sdkSourcePlugin } from '../../../../vite.sdk-aliases.ts';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import { chromium } from 'playwright';

// Native selection painting and focus behavior need Chromium; jsdom has neither.
// Serves `source` (a module that mounts into #app) and hands `run` a ready page.
export async function withAnnotationFixture(source, run) {
  const root = fileURLToPath(new URL('../../../..', import.meta.url));
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'annotation-fixture-'));
  const server = await createServer({
    configFile: false, root, logLevel: 'error', cacheDir: path.join(fixture, 'vite-cache'),
    resolve: { alias: { '@workspace/core': path.join(root, 'core/src') } },
    plugins: [sdkSourcePlugin, vue(), {
      name: 'annotation-fixture',
      configureServer(server) {
        server.middlewares.use('/annotation-fixture', (_request, response) => {
          response.setHeader('Content-Type', 'text/html');
          response.end('<div id="app"></div><script type="module" src="/annotation-entry.js"></script>');
        });
      },
      resolveId(id) { if (id === '/annotation-entry.js') return '\0annotation-entry'; },
      load(id) { if (id === '\0annotation-entry') return source; },
    }],
    server: { host: '127.0.0.1', port: 0 },
  });
  const browser = await chromium.launch();
  try {
    await server.listen();
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    page.setDefaultTimeout(5_000);
    page.setDefaultNavigationTimeout(30_000); // Cold Vite transforms.
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.resolvedUrls.local[0] + 'annotation-fixture');
    await run(page);
    return errors;
  } finally {
    await browser.close(); await server.close(); await rm(fixture, { recursive: true, force: true });
  }
}
