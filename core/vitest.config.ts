import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 2_500,
    hookTimeout: 2_500,
    environment: 'node',
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
