import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import { appleCryptoBuild } from '../native/build';
import { sdkSourceAliases, sdkSourceRoot } from '../../vite.sdk-aliases';

const useSdkSources = process.env.CODEX_APP_SDK_SOURCE === '1';

/** Bundled pages for the iOS app: the engine (no UI) and the transcript (the shared conversation pane). */
export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [vue(), appleCryptoBuild()],
  resolve: { dedupe: ['vue'], alias: {
    '@chainsafe/libp2p-noise': path.resolve(__dirname, '../src/apple-crypto/noise.ts'),
    '@libp2p/crypto/keys': path.resolve(__dirname, '../src/apple-crypto/keys.ts'),
    '@workspace/core': path.resolve(__dirname, '../../core/src'),
    '@workspace/vue': path.resolve(__dirname, '../../vue/src'),
    ...(useSdkSources ? sdkSourceAliases : {}),
  } },
  server: { fs: { allow: [path.resolve(__dirname, '../..'), ...(useSdkSources ? [sdkSourceRoot] : [])] } },
  build: {
    outDir: path.resolve(__dirname, '../ios/Web'),
    emptyOutDir: true,
    rollupOptions: { input: { changes: path.resolve(__dirname, 'changes.html'), engine: path.resolve(__dirname, 'engine.html'), transcript: path.resolve(__dirname, 'transcript.html') } },
  },
});
