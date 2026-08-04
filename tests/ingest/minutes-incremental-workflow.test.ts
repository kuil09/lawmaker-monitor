import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function readRepositoryFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("incremental minutes workflows", () => {
  it("mirrors only the Korean calendar date without historical backfill", () => {
    const workflow = readRepositoryFile(
      ".github/workflows/mirror-documents.yml"
    );

    expect(workflow).toContain('default: "20"');
    expect(workflow).toContain("timeout-minutes: 60");
    expect(workflow).toContain("MIRROR_MODE: assembly_minutes_catalog");
    expect(workflow).toContain(
      "MIRROR_DOWNLOAD_CONCURRENCY: ${{ vars.MIRROR_DOWNLOAD_CONCURRENCY || '4' }}"
    );
    expect(workflow).toContain(
      "MIRROR_MAX_DOWNLOADS: ${{ github.event_name == 'workflow_dispatch' && inputs.max_downloads || vars.MIRROR_MAX_DOWNLOADS || '20' }}"
    );
    expect(workflow).toContain('MIRROR_TIMEOUT_MS: "60000"');
    expect(workflow).toContain('MIRROR_INCLUDE_APPENDICES: "false"');
    expect(workflow).toContain("retry_existing_only:");
    expect(workflow).toContain(
      "MIRROR_RETRY_EXISTING_ONLY: ${{ inputs.retry_existing_only && 'true' || 'false' }}"
    );
    expect(workflow).toContain('MIRROR_LATEST_DATE_ONLY: "true"');
    expect(workflow).toContain("Validate indexed minutes repair");
    expect(workflow).toContain("Validate indexed repair configuration");
    expect(workflow).toContain(
      "Indexed minutes repair requires DATA_REPO and DATA_REPO_PAT."
    );
    expect(workflow).toContain(
      "RETRY_EXISTING_ONLY: ${{ inputs.retry_existing_only && 'true' || 'false' }}"
    );
    expect(workflow).toContain(
      '-f "retry_existing_only=${RETRY_EXISTING_ONLY}"'
    );
    expect(workflow).not.toContain(
      '-f include_appendices="${MIRROR_INCLUDE_APPENDICES}"'
    );
    expect(workflow).toContain("Start minutes summaries");
    expect(workflow).toContain("gh workflow run summarize-minutes.yml");
    expect(workflow).toContain(
      '-f target_date="${{ steps.mirror-progress.outputs.cutoff_date }}"'
    );
    expect(workflow).not.toContain("Continue pending minutes backfill");
    expect(workflow).not.toContain("backfill_start_date:");
    expect(workflow).not.toContain("backfill_windows:");
    expect(workflow).toContain("group: published-data-${{ vars.DATA_REPO");
    expect(workflow).toContain("queue: max");
    expect(workflow).toContain("Retry failed minutes mirror");
    expect(workflow).toContain("GH_REPO: ${{ github.repository }}");
    expect(workflow).toContain('-f retry_attempt="0"');
  });

  it("summarizes one same-day batch with a single data commit", () => {
    const workflow = readRepositoryFile(
      ".github/workflows/summarize-minutes.yml"
    );

    expect(workflow).toContain('default: "20"');
    expect(workflow).toContain('default: "160"');
    expect(workflow).toContain(
      "MINUTES_SUMMARY_CONCURRENCY: ${{ vars.MINUTES_SUMMARY_CONCURRENCY || '4' }}"
    );
    expect(workflow).toContain(
      "MINUTES_SUMMARY_REQUEST_TIMEOUT_MS: ${{ vars.MINUTES_SUMMARY_REQUEST_TIMEOUT_MS || '60000' }}"
    );
    expect(workflow).toContain("timeout-minutes: 60");
    expect(workflow).toContain("Resolve Korean summary date");
    expect(workflow).toContain(
      '.publishedDate == $target_date and (.transcriptRelativePath // "") != ""'
    );
    expect(workflow).toContain("Commit and push summary changes");
    expect(
      workflow.match(
        /"\$\{GITHUB_WORKSPACE\}\/scripts\/publish-data-repo\.sh"/g
      )
    ).toHaveLength(1);
    expect(workflow).not.toContain("Continue pending minutes summaries");
    expect(workflow).toContain("group: published-data-${{ vars.DATA_REPO");
    expect(workflow).toContain("queue: max");
    expect(workflow).toContain("Retry failed summary batch");
    expect(workflow).toContain('MAX_RETRY_ATTEMPTS: "3"');
    expect(workflow).toContain('-f retry_attempt="${NEXT_RETRY_ATTEMPT}"');
    expect(workflow).not.toContain("workflow_run:");
  });

  it("publishes generated data through the shared retrying helper", () => {
    const workflowPaths = [
      ".github/workflows/build-data.yml",
      ".github/workflows/mirror-documents.yml",
      ".github/workflows/mirror-property-disclosures.yml",
      ".github/workflows/summarize-minutes.yml"
    ];

    for (const workflowPath of workflowPaths) {
      const workflow = readRepositoryFile(workflowPath);
      expect(workflow).toContain(
        '"${GITHUB_WORKSPACE}/scripts/publish-data-repo.sh"'
      );
      expect(workflow).toContain("queue: max");
      expect(workflow).not.toContain("git push origin");
    }
  });

  it("passes the request timeout into the local model client", () => {
    const script = readRepositoryFile(
      "packages/ingest/src/scripts/summarize-minutes.ts"
    );

    expect(script).toContain(
      'readPositiveInteger("MINUTES_SUMMARY_MAX_DOCUMENTS", 20)'
    );
    expect(script).toContain(
      'readPositiveInteger("MINUTES_SUMMARY_MAX_GROUPS", 160)'
    );
    expect(script).toContain(
      '"MINUTES_SUMMARY_REQUEST_TIMEOUT_MS",\n      60_000'
    );
    expect(script).toContain("timeoutMs: config.requestTimeoutMs");
  });
});
