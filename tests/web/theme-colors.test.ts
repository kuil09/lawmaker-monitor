import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url));

function readSource(relativePath: string): string {
  return readFileSync(resolve(workspaceRoot, relativePath), "utf8");
}

describe("product color system", () => {
  it("uses lemon-lime for product emphasis without changing party identity", () => {
    const tokens = readSource("apps/web/src/styles/tokens.css");
    const watchQueue = readSource("apps/web/src/styles/watch-queue.css");
    const partyColors = readSource("apps/web/src/lib/geo-utils.ts");

    expect(tokens).toContain("--accent: #5b6c00");
    expect(tokens).toContain("--accent-highlight: #d8f33f");
    expect(tokens).toContain("--accent-on-highlight: #171512");

    expect(watchQueue).toContain("--wq-accent-highlight: #d8f33f");
    expect(watchQueue).toContain("background: var(--wq-accent-highlight)");
    expect(watchQueue).not.toContain("--wq-alert");
    expect(watchQueue).not.toContain("--watch-red");

    expect(partyColors).toContain("국민의힘: [220, 50, 32, 230]");
  });
});
