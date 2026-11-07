import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 500,
    hookTimeout: 500,
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
