import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: {
    '@workspace/core': path.resolve(__dirname, '../core/src'),
    '@workspace/vue': path.resolve(__dirname, '../vue/src'),
  } },
  test: {
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,vue}'],
      exclude: ['src/main.ts', 'src/**/*.d.ts', 'src/**/__tests__/**'],
      thresholds: { statements: 85 },
    },
  },
});
