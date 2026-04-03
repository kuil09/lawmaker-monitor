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
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          deckgl: ["@deck.gl/core", "@deck.gl/layers", "@deck.gl/react", "@deck.gl/aggregation-layers"],
          maplibre: ["maplibre-gl", "react-map-gl/maplibre"]
        }
      }
    }
  }
});
