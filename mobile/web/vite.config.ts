import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';

/** Two small pages for the iOS app: the engine (no UI) and the transcript (the shared conversation pane). */
export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [vue()],
  resolve: { dedupe: ['vue'], alias: {
    '@workspace/core': path.resolve(__dirname, '../../core/src'),
    '@workspace/vue': path.resolve(__dirname, '../../vue/src'),
  } },
  build: {
    outDir: path.resolve(__dirname, '../ios/Web'),
    emptyOutDir: true,
    rollupOptions: { input: { engine: path.resolve(__dirname, 'engine.html'), transcript: path.resolve(__dirname, 'transcript.html') } },
  },
});
