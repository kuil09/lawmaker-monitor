import { describe, expect, it } from "vitest";

import {
  loadBuildDataRawInputs,
  resolveBuildDataRuntimeConfig
} from "../../packages/ingest/src/build-data/input-stage.js";
import { buildNormalizedStage } from "../../packages/ingest/src/build-data/normalize-stage.js";

describe("build-data pipeline stages", () => {
  it("loads raw inputs from fixtures and assembles the normalized bundle stage", async () => {
    const runtimeConfig = resolveBuildDataRuntimeConfig({
      repositoryRoot: process.cwd(),
      env: {
        RAW_DIR: "tests/fixtures",
        DATA_REPO_DIR: "tests/fixtures/property_mirror"
      }
    });

    const rawInputs = await loadBuildDataRawInputs(runtimeConfig);

    expect(rawInputs.snapshotId).toBe("fixture-snapshot-20260322-114500");
    expect(rawInputs.memberInfoEntries.length).toBeGreaterThan(0);
    expect(rawInputs.voteEntries).toHaveLength(2);

    const normalized = await buildNormalizedStage(rawInputs);

    expect(normalized.currentAssembly).toMatchObject({
      assemblyNo: 22,
      label: "제22대 국회"
    });
    expect(normalized.bundle.members.length).toBeGreaterThan(0);
    expect(normalized.bundle.rollCalls.length).toBeGreaterThan(0);
    expect(
      normalized.propertyMemberContext.currentMembers.map(
        (member) => member.memberId
      )
    ).toEqual(["M001", "M002", "M003"]);
  });
});
