import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("open graph metadata", () => {
  it("publishes a complete large-card preview", async () => {
    const html = await readFile(
      resolve(process.cwd(), "apps/web/index.html"),
      "utf8"
    );

    expect(html).toContain('property="og:title"');
    expect(html).toContain('property="og:description"');
    expect(html).toContain(
      'content="https://kuil09.github.io/lawmaker-monitor/og-card.png"'
    );
    expect(html).toContain('property="og:image:width" content="1200"');
    expect(html).toContain('property="og:image:height" content="630"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
  });
});
