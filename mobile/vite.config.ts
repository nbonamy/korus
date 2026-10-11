import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { product } from '../core/src/product';
import path from 'node:path';

export default defineConfig({
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
