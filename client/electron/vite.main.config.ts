import { defineConfig } from 'vite';
import dotenv from 'dotenv';
import path from 'node:path';
import { sdkSourceAliases, sdkSourcesEnabled } from '../../vite.sdk-aliases';
import { build as buildPreload } from 'esbuild';

dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
const useSdkSources = sdkSourcesEnabled;

export default defineConfig({
  plugins: [{ name: 'browser-extension-preload', async generateBundle() {
    const result = await buildPreload({ entryPoints: [path.resolve(__dirname, 'src/preload/browser-extensions.ts')], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], write: false });
    this.emitFile({ type: 'asset', fileName: 'browser-extensions-preload.cjs', source: result.outputFiles[0].text });
  } }],
  resolve: {
    alias: [
      { find: '@workspace/core', replacement: path.resolve(__dirname, '../../core/src') },
      ...(useSdkSources ? sdkSourceAliases : []),
    ],
  },
  build: {
    sourcemap: true,
    minify: false,
    rollupOptions: {
      external: ['autolib'],
    },
  },
});
