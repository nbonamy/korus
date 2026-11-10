import { excalidrawAssets } from '../../client/vue/vite.excalidraw-assets';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import { appleCryptoBuild } from '../native/build';
import { sdkSourceAliases, sdkSourceRoot, sdkSourcesEnabled } from '../../vite.sdk-aliases';

const android = process.env.COMPANION_PLATFORM === 'android';
const useSdkSources = sdkSourcesEnabled;

/** Bundled mobile pages: the background engine, shared conversation pane and changes. */
export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [{
    name: 'mobile-public-product',
    enforce: 'pre',
    transform(source, id) {
      if (id !== path.resolve(__dirname, '../../core/src/product.json')) return;
      const product = JSON.parse(source);
      return JSON.stringify({ ...product, repository: product.releaseRepository });
    },
  }, vue(), excalidrawAssets(), ...(android ? [] : [appleCryptoBuild()])],
  resolve: { dedupe: ['vue', '@korus-dev/multi-agent-sdk/core', '@korus-dev/agent-ui-sdk'], alias: [
    ...(android ? [] : [
      { find: '@chainsafe/libp2p-noise', replacement: path.resolve(__dirname, '../src/apple-crypto/noise.ts') },
      { find: '@libp2p/crypto/keys', replacement: path.resolve(__dirname, '../src/apple-crypto/keys.ts') },
    ]),
    { find: '@workspace/core', replacement: path.resolve(__dirname, '../../core/src') },
    { find: '@workspace/vue', replacement: path.resolve(__dirname, '../../client/vue/src') },
    ...sdkSourceAliases,
  ] },
  server: { fs: { allow: [path.resolve(__dirname, '../..'), ...(useSdkSources ? [sdkSourceRoot] : [])] } },
  build: {
    outDir: path.resolve(__dirname, android ? '../android/app/src/main/assets/web' : '../ios/Web'),
    emptyOutDir: true,
    rollupOptions: { input: { changes: path.resolve(__dirname, 'changes.html'), engine: path.resolve(__dirname, 'engine.html'), transcript: path.resolve(__dirname, 'transcript.html') } },
  },
});
