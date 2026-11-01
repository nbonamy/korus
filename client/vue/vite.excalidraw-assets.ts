import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/** Ship editor fonts and MIT notices with both hosts, without a hosted dependency. */
export function excalidrawAssets(): Plugin {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const source = path.join(root, 'node_modules/@excalidraw/excalidraw/dist/prod');
  return {
    name: 'app-excalidraw-assets',
    async generateBundle() {
      for (const file of await readdir(path.join(source, 'fonts'), { recursive: true, withFileTypes: true })) {
        if (!file.isFile()) continue;
        const absolute = path.join(file.parentPath, file.name);
        this.emitFile({ type: 'asset', fileName: `excalidraw/${path.relative(source, absolute).split(path.sep).join('/')}`, source: await readFile(absolute) });
      }
      for (const name of ['excalidraw', 'mermaid-to-excalidraw']) {
        this.emitFile({ type: 'asset', fileName: `excalidraw/${name}-LICENSE.txt`, source: await readFile(name === 'excalidraw' ? path.join(root, 'licenses/excalidraw-MIT.txt') : path.join(root, `node_modules/@excalidraw/${name}/LICENSE`)) });
      }
    },
    configureServer(server) {
      server.middlewares.use('/excalidraw/fonts', async (request, response, next) => {
        const target = path.resolve(source, 'fonts', `.${decodeURIComponent(request.url ?? '/')}`);
        if (!target.startsWith(path.join(source, 'fonts') + path.sep)) return next();
        try { response.setHeader('Content-Type', 'font/woff2'); response.end(await readFile(target)); } catch { next(); }
      });
    },
  };
}
