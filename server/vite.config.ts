import { defineConfig } from "vite";
import path from "node:path";
export default defineConfig({
  resolve: {
    alias: { "@workspace/core": path.resolve(__dirname, "../core/src") },
  },
  build: {
    ssr: path.resolve(__dirname, "api/main.ts"),
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      external: [/^node:/],
      output: { entryFileNames: "api.mjs", format: "es" },
    },
  },
});
