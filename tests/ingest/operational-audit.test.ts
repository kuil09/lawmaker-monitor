import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import {
  assertFreshTimestamp,
  assertMinutesSummaryProgress
} from "../../packages/ingest/src/source-monitoring.js";
import { isTransientRequestError } from "../../packages/ingest/src/request-policy.js";
import { selectPendingMinutesDocuments } from "../../packages/ingest/src/minutes-summary-policy.js";
import {
  buildExtractiveMinutesSummary,
  createLlamaServerSummarizer,
  isPublishableExtractiveMinutesSummary,
  NoPublishableMinutesSourceError,
  type MinutesSummaryGroup
} from "../../packages/ingest/src/minutes-summarization.js";

describe("operational audit regressions", () => {
  it("detects a stalled summary backlog even when a no-progress run updated the state", () => {
    const now = new Date("2026-10-23T00:00:00Z");
    expect(() =>
      assertMinutesSummaryProgress(
        {
          updatedAt: "2026-10-22T23:00:00Z",
          remainingDocuments: 1700,
          lastProgressAt: "2026-10-20T00:00:00Z"
        },
        now
      )
    ).toThrow("Pending minutes summary progress");
    expect(() =>
      assertMinutesSummaryProgress(
        { updatedAt: "2026-10-22T23:00:00Z", remainingDocuments: 1700 },
        now
      )
    ).not.toThrow();
    expect(() =>
      assertMinutesSummaryProgress(
        { updatedAt: "2026-10-01T00:00:00Z", remainingDocuments: 0 },
        now
      )
    ).not.toThrow();
  });
  it("hashes final Parquet bytes rather than normalized JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "published-checksum-"));
    try {
      await mkdir(join(dir, "manifests"));
      await mkdir(join(dir, "curated"));
      const bytes = Buffer.from("PAR1published binary bytesPAR1");
      await writeFile(join(dir, "curated/members.parquet"), bytes);
      await writeFile(
        join(dir, "manifests/latest.json"),
        JSON.stringify({
          datasets: {
            members: {
              path: "curated/members.parquet",
              checksumSha256: "normalized-json-hash",
              rowCount: 3
            }
          },
          exports: {}
        })
      );
      execFileSync(process.execPath, [
        "scripts/finalize-data-manifest.mjs",
        dir
      ]);
      const manifest = JSON.parse(
        await readFile(join(dir, "manifests/latest.json"), "utf8")
      );
      expect(manifest.datasets.members).toMatchObject({
        rowCount: 3,
        checksumSha256: createHash("sha256").update(bytes).digest("hex")
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects stale or invalid live snapshots while allowing the weekend gap", () => {
    const now = new Date("2026-10-19T00:00:00Z");
    expect(() =>
      assertFreshTimestamp("2026-10-16T10:00:00Z", "ingest", 96, now)
    ).not.toThrow();
    expect(() =>
      assertFreshTimestamp("2026-10-10T10:00:00Z", "ingest", 96, now)
    ).toThrow("older than");
    expect(() => assertFreshTimestamp("invalid", "ingest", 96, now)).toThrow();
  });

  it("retries Playwright timeouts but does not retry parser errors", () => {
    expect(
      isTransientRequestError(
        new Error("apiRequestContext.post: Timeout 20000ms exceeded.")
      )
    ).toBe(true);
    expect(
      isTransientRequestError(
        new Error("Official catalog returned no data array.")
      )
    ).toBe(false);
  });

  it("retains source Latin text and a long complete sentence across generation and reuse", async () => {
    const source =
      "원문에 등장한 n번방 사건의 피해자 보호와 제도 개선이 필요합니다.";
    const summarize = createLlamaServerSummarizer({
      endpoint: "http://127.0.0.1:1",
      modelId: "unused"
    });
    const summary = await summarize({
      group: {} as MinutesSummaryGroup,
      text: source
    });
    expect(summary).toBe(source);
    expect(isPublishableExtractiveMinutesSummary(summary)).toBe(true);
    const longSentence = `${"피해자를 보호하기 위한 제도 개선과 충분한 경제적인 지원이 필요하며 ".repeat(10)}이를 검토해야 합니다.`;
    expect(longSentence.length).toBeGreaterThan(260);
    expect(buildExtractiveMinutesSummary(longSentence)).toBe(longSentence);
    await expect(
      summarize({ group: {} as MinutesSummaryGroup, text: "감사합니다." })
    ).rejects.toBeInstanceOf(NoPublishableMinutesSourceError);
  });

  it("gives unattempted work a turn and defers transient failures", () => {
    const documents = [
      { id: "stuck", publishedDate: "2026-10-20" },
      { id: "new", publishedDate: "2026-10-19" },
      { id: "cooling", publishedDate: "2026-10-21" }
    ];
    const selected = selectPendingMinutesDocuments({
      documents,
      targetDate: "2026-10-22",
      maxDocuments: 1,
      isCurrent: () => false,
      lastAttemptAt: (d) =>
        d.id === "stuck" ? "2026-10-21T00:00:00Z" : undefined,
      nextRetryAt: (d) =>
        d.id === "cooling" ? "2026-10-23T00:00:00Z" : undefined,
      now: new Date("2026-10-22T00:00:00Z")
    });
    expect(selected.map((d) => d.id)).toEqual(["new"]);
  });
});
