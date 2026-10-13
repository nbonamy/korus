import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { product } from '../core/src/product';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { configuredRelay } from './relay-config';

/** The phone learns its relay at build time from the same variables the laptop daemon reads. */
function buildRelay() {
  let dotenv = '';
  try { dotenv = readFileSync(path.resolve(__dirname, '../.env'), 'utf8'); } catch { /* CI supplies variables directly. */ }
  return configuredRelay(process.env, dotenv);
}

export default defineConfig({
  define: { __COMPANION_RELAY__: JSON.stringify(buildRelay()) },
  plugins: [vue(), {
    name: 'product-title',
    transformIndexHtml: (html) => html.replace('<title>Workspace</title>', `<title>${product.name}</title>`),
  }],
  resolve: { dedupe: ['vue'], alias: {
    '@workspace/core': path.resolve(__dirname, '../core/src'),
    '@workspace/vue': path.resolve(__dirname, '../vue/src'),
  } },
  server: { host: '127.0.0.1' },
});
