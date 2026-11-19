import { sdkSourcePlugin } from '../../../../vite.sdk-aliases.ts';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import { chromium } from 'playwright';

// Reuse Vite transforms and Chromium across a suite. Each run has its own
// context, including storage, routes, emulated media, and clock.
export async function startAnnotationFixture(sources) {
  const root = fileURLToPath(new URL('../../../..', import.meta.url));
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'annotation-fixture-'));
  const entries = new Map(Object.entries(sources).map(([name, source], index) => [
    name, { source, url: `/annotation-entry-${index}.js` },
  ]));
  const modules = new Map([...entries.values()].map(({ source, url }) => [url, source]));
  let server, browser;
  async function close() {
    try {
      await browser?.close();
    } finally {
      try { await server?.close(); }
      finally { await rm(fixture, { recursive: true, force: true }); }
    }
  }
  try {
    server = await createServer({
      configFile: false, root, logLevel: 'error', cacheDir: path.join(fixture, 'vite-cache'),
      resolve: { alias: { '@workspace/core': path.join(root, 'core/src') } },
      plugins: [sdkSourcePlugin, vue(), {
        name: 'annotation-fixture',
        configureServer(server) {
          server.middlewares.use('/annotation-fixture', (request, response) => {
            const name = new URL(request.url, 'http://localhost').searchParams.get('entry');
            const entry = entries.get(name);
            if (!entry) { response.statusCode = 404; response.end(); return; }
            response.setHeader('Content-Type', 'text/html');
            response.end(`<div id="app"></div><script type="module" src="${entry.url}"></script>`);
          });
        },
        resolveId(id) { if (modules.has(id)) return '\0' + id; },
        load(id) { if (id.startsWith('\0')) return modules.get(id.slice(1)); },
      }],
      // Automated fixtures keep their initial module state while shared SDK sources are being edited.
      server: { host: '127.0.0.1', port: 0, hmr: false },
    });
    await server.listen();
    browser = await chromium.launch();
  } catch (error) {
    await close();
    throw error;
  }
  return {
    async run(name, run) {
      if (!entries.has(name)) throw new Error(`Unknown browser fixture: ${name}`);
      const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(5_000);
        page.setDefaultNavigationTimeout(30_000); // Cold Vite transforms.
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(server.resolvedUrls.local[0] + `annotation-fixture?entry=${encodeURIComponent(name)}`);
        await run(page);
        return errors;
      } finally {
        await context.close();
      }
    },
    close,
  };
}

export async function withAnnotationFixture(source, run) {
  const fixture = await startAnnotationFixture({ main: source });
  try {
    return await fixture.run('main', run);
  } finally {
    await fixture.close();
  }
}
