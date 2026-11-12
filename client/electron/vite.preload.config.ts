import { defineConfig } from 'vite';
import path from 'node:path';
import { sdkSourceAliases, sdkSourcesEnabled } from '../../vite.sdk-aliases';

const useSdkSources = sdkSourcesEnabled;

export default defineConfig({
  resolve: {
    alias: [
      { find: '@workspace/core', replacement: path.resolve(__dirname, '../../core/src') },
      ...(useSdkSources ? sdkSourceAliases : []),
    ],
  },
  build: {
    sourcemap: true,
    minify: false,
  },
});
