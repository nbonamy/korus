import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@workspace/core": path.resolve(__dirname, "../../core/src") },
  },
  ssr: { noExternal: true },
  build: {
    ssr: path.resolve(__dirname, "src/collector/main.ts"),
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      external: [/^node:/, "pg-native"],
      output: {
        entryFileNames: "collector.mjs",
        format: "es",
        codeSplitting: false,
      },
    },
  },
});
