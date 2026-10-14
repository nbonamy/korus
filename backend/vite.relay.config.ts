import { defineConfig } from 'vite';
import path from 'node:path';
export default defineConfig({
  resolve: { alias: { '@workspace/core': path.resolve(__dirname, '../core/src') } },
  ssr: { noExternal: true },
  build: { ssr: path.resolve(__dirname, 'src/companion/relay-main.ts'), outDir: 'relay-dist', emptyOutDir: true, sourcemap: true,
    rollupOptions: { external: [/^node:/], output: { entryFileNames: 'relay.mjs', format: 'es' } } },
});
