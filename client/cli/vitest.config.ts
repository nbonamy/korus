import { sdkSourceAliases } from '../../vite.sdk-aliases';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: sdkSourceAliases },
  test: {
    testTimeout: 2_500,
    hookTimeout: 2_500,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
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
