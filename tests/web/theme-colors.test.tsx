import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workspaceRoot = resolve(".");

function readSource(relativePath: string): string {
  return readFileSync(resolve(workspaceRoot, relativePath), "utf8");
}

describe("product color system", () => {
  it("uses lemon-lime for product emphasis without changing party identity", () => {
    const tokens = readSource("apps/web/src/styles/tokens.css");
    const watchQueue = readSource("apps/web/src/styles/watch-queue.css");
    const memberShare = readSource("apps/web/src/styles/member-share.css");
    const partyColors = readSource("apps/web/src/lib/geo-utils.ts");

    expect(tokens).toContain("--accent: #5b6c00");
    expect(tokens).toContain("--accent-highlight: #d8f33f");
    expect(tokens).toContain("--accent-on-highlight: #171512");

    expect(watchQueue).toContain("--wq-accent-highlight: #d8f33f");
    expect(watchQueue).toContain("background: var(--wq-accent-highlight)");
    expect(watchQueue).not.toContain("--wq-alert");
    expect(watchQueue).not.toContain("--watch-red");

    expect(memberShare).toContain(
      "border-top-color: var(--wq-accent-highlight, #d8f33f)"
    );
    expect(memberShare).toContain(
      "background: var(--wq-accent-highlight, #d8f33f)"
    );

    expect(partyColors).toContain("국민의힘: [220, 50, 32, 230]");
  });

  it("keeps the active primary navigation indicator inside the masthead", () => {
    const watchQueue = readSource("apps/web/src/styles/watch-queue.css");

    expect(watchQueue).not.toContain("bottom: -20px");
    expect(watchQueue).toMatch(
      /\.v2-global-nav__link\[aria-current="page"\]::after \{[\s\S]*?bottom: -1px;/
    );
  });
});
