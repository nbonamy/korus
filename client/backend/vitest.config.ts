import { sdkSourceAliases } from '../../vite.sdk-aliases';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: sdkSourceAliases },
  test: {
    testTimeout: 2_500,
    hookTimeout: 2_500,
    environment: 'node',
    // Keep installed SDKs in Vitest's module graph so host discovery fixtures
    // can intercept Node I/O just as they do in local-source development.
    server: { deps: { inline: [/@korus-dev\/(?:multi-agent-sdk|codex-sdk)/] } },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**'],
      thresholds: {
        statements: 85,
      },
    },
  },
});
