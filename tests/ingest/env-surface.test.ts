import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const workflowPath = resolve(process.cwd(), ".github/workflows/ingest-live.yml");
const envExamplePath = resolve(process.cwd(), ".env.example");
const readmePath = resolve(process.cwd(), "README.md");

const forbiddenEnvNames = [
  "ASSEMBLY_API_BASE_URL",
  "ASSEMBLY_RESPONSE_TYPE",
  "ASSEMBLY_PAGE_INDEX",
  "ASSEMBLY_MEMBER_DIRECTORY_PATH",
  "ASSEMBLY_MEMBER_HISTORY_PATH",
  "ASSEMBLY_VOTES_PATH",
  "ASSEMBLY_PLENARY_SCHEDULE_PATH",
  "ASSEMBLY_PLENARY_LAW_BILLS_PATH",
  "ASSEMBLY_PLENARY_BUDGET_BILLS_PATH",
  "ASSEMBLY_PLENARY_SETTLEMENT_BILLS_PATH",
  "ASSEMBLY_PLENARY_OTHER_BILLS_PATH",
  "ASSEMBLY_PLENARY_MINUTES_PATH",
  "ASSEMBLY_LIVE_PATH",
  "ASSEMBLY_ASSEMBLY_NO",
  "ASSEMBLY_PLENARY_UNIT_CD",
  "ASSEMBLY_API_AUTH_LOCATION",
  "ASSEMBLY_API_AUTH_NAME",
  "ASSEMBLY_STRICT_SOURCE_POLICY",
  "ASSEMBLY_LIVE_BASE_URL",
  "ASSEMBLY_MEMBER_PROFILE_CONCURRENCY",
  "ASSEMBLY_OFFICIAL_TALLY_CONCURRENCY"
];

const supportedIngestEnvNames = [
  "ASSEMBLY_API_KEY",
  "ASSEMBLY_PAGE_SIZE",
  "ASSEMBLY_BILL_FEED_CONCURRENCY",
  "ASSEMBLY_VOTE_DETAIL_CONCURRENCY",
  "ASSEMBLY_BILL_VOTE_SUMMARY_CONCURRENCY",
  "ASSEMBLY_FETCH_TIMEOUT_MS",
  "ASSEMBLY_FETCH_RETRIES"
];

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("supported Assembly env surface", () => {
  it("keeps forbidden env names out of the ingest workflow", () => {
    const workflow = read(workflowPath);

    for (const envName of forbiddenEnvNames) {
      expect(workflow).not.toContain(envName);
    }

    for (const envName of supportedIngestEnvNames) {
      expect(workflow).toContain(envName);
    }
  });

  it("keeps forbidden env names out of .env.example", () => {
    const envExample = read(envExamplePath);

    for (const envName of forbiddenEnvNames) {
      expect(envExample).not.toContain(envName);
    }

    for (const envName of supportedIngestEnvNames) {
      expect(envExample).toContain(envName);
    }
  });

  it("documents only the supported ingest env surface in README", () => {
    const readme = read(readmePath);

    for (const envName of forbiddenEnvNames) {
      expect(readme).not.toContain(envName);
    }

    for (const envName of supportedIngestEnvNames) {
      expect(readme).toContain(envName);
    }
  });
});
