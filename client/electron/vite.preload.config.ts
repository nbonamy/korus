import { defineConfig } from 'vite';
import path from 'node:path';
import { sdkSourceAliases } from '../../vite.sdk-aliases';

const useSdkSources = process.env.CODEX_APP_SDK_SOURCE === '1';

export default defineConfig({
  resolve: {
    alias: {
      '@workspace/core': path.resolve(__dirname, '../../core/src'),
      ...(useSdkSources ? sdkSourceAliases : {}),
    },
  },
  build: {
    sourcemap: true,
    minify: false,
  },
});
