import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: "site",
  build: {
    outDir: "../dist/site",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "site/index.html"),
        privacy: resolve(import.meta.dirname, "site/privacy.html"),
      },
    },
  },
  server: { host: "127.0.0.1", port: 4174, strictPort: true },
});
