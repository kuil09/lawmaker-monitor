import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("Parquet materialization", () => {
  it("keeps mixed-precision vote publication dates as strings", async () => {
    const sql = await readFile(
      new URL(
        "../../packages/ingest/sql/materialize_parquet.sql",
        import.meta.url
      ),
      "utf8"
    );
    const voteFactsCopy = sql.match(
      /COPY \(\s*SELECT \* FROM read_ndjson\([\s\S]*?\)\s*\) TO 'curated\/vote_facts\.parquet'/
    )?.[0];

    expect(voteFactsCopy).toBeDefined();
    expect(voteFactsCopy).toContain("publishedAt: 'VARCHAR'");
    expect(voteFactsCopy).not.toContain("read_ndjson_auto");
  });
});
