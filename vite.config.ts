import { defineConfig } from "vite";
export default defineConfig({
  build: { outDir: "dist/web", emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/readyz": "http://127.0.0.1:3000",
    },
  },
});
