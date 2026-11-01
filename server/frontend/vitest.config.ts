import { defineConfig } from "vitest/config";
import path from "node:path";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@workspace/core": path.resolve(__dirname, "../../core/src"),
      "@workspace/vue": path.resolve(__dirname, "../../vue/src"),
    },
  },
  test: {
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
