import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["api/**/*.ts", "web/**/*.ts"],
      exclude: ["**/__tests__/**"],
      thresholds: { statements: 85 },
    },
  },
});
