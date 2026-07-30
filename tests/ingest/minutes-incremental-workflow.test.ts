import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function readRepositoryFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("incremental minutes workflows", () => {
  it("keeps document mirroring in bounded, resumable runs", () => {
    const workflow = readRepositoryFile(
      ".github/workflows/mirror-documents.yml"
    );

    expect(workflow).toContain('default: "20"');
    expect(workflow).toContain(
      "MIRROR_CATCHUP_WINDOWS_PER_RUN: ${{ vars.MIRROR_CATCHUP_WINDOWS_PER_RUN || '2' }}"
    );
    expect(workflow).toContain("timeout-minutes: 30");
    expect(workflow).toContain("Continue pending minutes backfill");
  });

  it("keeps AI summarization in small checkpointed batches", () => {
    const workflow = readRepositoryFile(
      ".github/workflows/summarize-minutes.yml"
    );

    expect(workflow).toContain('default: "1"');
    expect(workflow).toContain('default: "8"');
    expect(workflow).toContain(
      "MINUTES_SUMMARY_CONCURRENCY: ${{ vars.MINUTES_SUMMARY_CONCURRENCY || '2' }}"
    );
    expect(workflow).toContain(
      "MINUTES_SUMMARY_REQUEST_TIMEOUT_MS: ${{ vars.MINUTES_SUMMARY_REQUEST_TIMEOUT_MS || '60000' }}"
    );
    expect(workflow).toContain("timeout-minutes: 30");
    expect(workflow).toContain("Commit and push summary changes");
    expect(workflow).toContain("Continue pending minutes summaries");
  });

  it("passes the request timeout into the local model client", () => {
    const script = readRepositoryFile(
      "packages/ingest/src/scripts/summarize-minutes.ts"
    );

    expect(script).toContain(
      'readPositiveInteger("MINUTES_SUMMARY_MAX_DOCUMENTS", 1)'
    );
    expect(script).toContain(
      'readPositiveInteger("MINUTES_SUMMARY_MAX_GROUPS", 8)'
    );
    expect(script).toContain(
      '"MINUTES_SUMMARY_REQUEST_TIMEOUT_MS",\n      60_000'
    );
    expect(script).toContain("timeoutMs: config.requestTimeoutMs");
  });
});
