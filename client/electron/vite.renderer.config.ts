import { excalidrawAssets } from '../vue/vite.excalidraw-assets';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import { sdkSourceAliases, sdkSourceRoot } from '../../vite.sdk-aliases';

const useSdkSources = process.env.CODEX_APP_SDK_SOURCE === '1';

export default defineConfig({
  root: path.resolve(__dirname, 'src/renderer'),
  optimizeDeps: useSdkSources ? {
    // Source aliases must stay in Vite's module graph for SDK HMR. Their CJS
    // dependencies remain eligible for normal dependency optimization.
    exclude: Object.keys(sdkSourceAliases),
  } : {
    // The SDK is a linked local package during development. Rebuild dependency
    // chunks on startup so its Vue code and scoped CSS always use matching IDs.
    // Keep prebundling enabled because SDK dependencies such as elkjs are CJS.
    force: true,
  },
  resolve: {
    alias: {
      '@workspace/core': path.resolve(__dirname, '../../core/src'),
      '@workspace/vue': path.resolve(__dirname, '../vue/src'),
      ...(useSdkSources ? sdkSourceAliases : {}),
    },
    dedupe: ['vue'],
  },
  server: {
    port: 5174,
    fs: {
      allow: [
        path.resolve(__dirname, '../..'),
        ...(useSdkSources ? [sdkSourceRoot] : []),
      ],
    },
  },
  plugins: [vue(), excalidrawAssets()],
  build: {
    outDir: path.resolve(__dirname, '.vite/renderer/main_window'),
    emptyOutDir: true,
    sourcemap: true,
  },
});
