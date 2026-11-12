import { sdkSourceAliases } from '../../vite.sdk-aliases';
import { defineConfig } from "vitest/config";
import path from "node:path";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: [{ find: "@workspace/core", replacement: path.resolve(__dirname, "../../core/src") }, ...sdkSourceAliases],
  },
  test: {
    testTimeout: 2_500,
    hookTimeout: 2_500,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts", "src/**/*.vue"],
      exclude: [
        "src/**/*.d.ts",
        "src/**/__tests__/**",
      ],
      thresholds: {
        statements: 85,
      },
    },
  },
});
