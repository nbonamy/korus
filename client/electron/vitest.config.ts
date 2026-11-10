import { sdkSourceAliases } from '../../vite.sdk-aliases';
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: [
      { find: '@workspace/core', replacement: path.resolve(__dirname, '../../core/src') },
      ...sdkSourceAliases,
    ],
  },
  test: {
    testTimeout: 2_500,
    hookTimeout: 2_500,
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'src/main/mcp/**/*.ts',
        'src/main/snapshot-service.ts',
        'src/main/**/*.ts',
      ],
      exclude: [
        'src/renderer/**/*.d.ts',
        'src/test/**',
        'src/**/__tests__/**',
      ],
      thresholds: {
        statements: 85,
      },
    },
  },
});
