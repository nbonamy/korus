import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import { sdkSourceAliases, sdkSourceRoot } from '../../vite.sdk-aliases';

const useSdkSources = process.env.CODEX_APP_SDK_SOURCE === '1';

/** Two small pages for the iOS app: the engine (no UI) and the transcript (the shared conversation pane). */
export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [vue()],
  resolve: { dedupe: ['vue'], alias: {
    '@workspace/core': path.resolve(__dirname, '../../core/src'),
    '@workspace/vue': path.resolve(__dirname, '../../vue/src'),
    ...(useSdkSources ? sdkSourceAliases : {}),
  } },
  server: { fs: { allow: [path.resolve(__dirname, '../..'), ...(useSdkSources ? [sdkSourceRoot] : [])] } },
  build: {
    outDir: path.resolve(__dirname, '../ios/Web'),
    emptyOutDir: true,
    rollupOptions: { input: { engine: path.resolve(__dirname, 'engine.html'), transcript: path.resolve(__dirname, 'transcript.html') } },
  },
});
