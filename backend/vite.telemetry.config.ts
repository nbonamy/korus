import { defineConfig } from "vite";
import path from "node:path";
export default defineConfig({
  resolve: {
    alias: { "@workspace/core": path.resolve(__dirname, "../core/src") },
  },
  build: {
    ssr: path.resolve(__dirname, "src/telemetry/service-entry.ts"),
    outDir: "dist-telemetry",
    emptyOutDir: true,
    rollupOptions: {
      external: [/^node:/],
      output: { entryFileNames: "service.mjs", format: "es" },
    },
  },
});
