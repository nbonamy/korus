import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "node:path";
import { readFileSync } from "node:fs";
const product = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../core/src/product.json"), "utf8"),
) as { name: string };
const tokens = readFileSync(
  path.resolve(__dirname, "../../client/vue/src/styles/variables.css"),
  "utf8",
)
  .split("\n")
  .filter((line) => !line.startsWith("@import"))
  .join("\n");

// Portable static bundle: origins and credentials belong to the protected proxy,
// never VITE_* inputs. Only the product label and app semantic tokens enter HTML.
export default defineConfig({
  root: path.resolve(__dirname, "src"),
  envDir: false,
  envPrefix: [],
  plugins: [
    vue(),
    {
      name: "console-theme",
      transformIndexHtml: (html) =>
        html.replace(
          "<title>Usage console</title>",
          `<title>${product.name} Console</title><style>${tokens}</style>`,
        ),
    },
  ],
  define: { __PRODUCT_NAME__: JSON.stringify(product.name) },
  resolve: {
    alias: { "@workspace/core": path.resolve(__dirname, "../../core/src") },
  },
  build: { outDir: path.resolve(__dirname, "dist"), emptyOutDir: true },
});
