import { excalidrawAssets } from '../vue/vite.excalidraw-assets';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import { sdkSourceAliases, sdkSourceRoot, sdkSourcesEnabled, sdkSourcePackages } from '../../vite.sdk-aliases';

const useSdkSources = sdkSourcesEnabled;

export default defineConfig({
  root: path.resolve(__dirname, 'src/renderer'),
  optimizeDeps: useSdkSources ? {
    // Source aliases must stay in Vite's module graph for SDK HMR. Their CJS
    // dependencies remain eligible for normal dependency optimization.
    exclude: sdkSourcePackages,
  } : undefined,
  resolve: {
    alias: [
      { find: '@workspace/core', replacement: path.resolve(__dirname, '../../core/src') },
      { find: '@workspace/vue', replacement: path.resolve(__dirname, '../vue/src') },
      ...(useSdkSources ? sdkSourceAliases : []),
    ],
    dedupe: ['vue', 'element-plus'],
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
