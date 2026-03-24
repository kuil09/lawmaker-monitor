import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@lawmaker-monitor/schemas": resolve(__dirname, "./packages/schemas/src/index.ts")
    }
  },
  test: {
    projects: [
      {
        test: {
          name: "ingest",
          include: ["tests/ingest/**/*.test.ts"],
          environment: "node",
          setupFiles: ["./vitest.setup.ts"]
        }
      },
      {
        test: {
          name: "web",
          include: ["tests/web/**/*.test.tsx"],
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"]
        }
      }
    ]
  }
});
