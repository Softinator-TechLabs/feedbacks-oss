import { defineConfig } from "vite";
import { resolve } from "node:path";
import { readdirSync } from "node:fs";

const comparisons = Object.fromEntries(
  readdirSync(resolve(import.meta.dirname, "site/compare"))
    .filter((name) => name.endsWith(".html"))
    .map((name) => [
      `compare-${name.slice(0, -5)}`,
      resolve(import.meta.dirname, "site/compare", name),
    ]),
);

export default defineConfig({
  root: "site",
  build: {
    outDir: "../dist/site",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "site/index.html"),
        privacy: resolve(import.meta.dirname, "site/privacy.html"),
        ...comparisons,
      },
    },
  },
  server: { host: "127.0.0.1", port: 4174, strictPort: true },
});
