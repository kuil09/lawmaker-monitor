import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.PAGES_BASE_PATH ?? "/",
  plugins: [react()],
  resolve: {
    alias: {
      "@lawmaker-monitor/schemas": resolve(__dirname, "../../packages/schemas/src/index.ts")
    }
  },
  esbuild: {
    keepNames: true
  },
  build: {
    chunkSizeWarningLimit: 2000
  }
});
