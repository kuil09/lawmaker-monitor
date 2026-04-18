import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { applyMemberAssetsIndexRealEstateFallbacks } from "../../apps/web/src/lib/member-assets.js";

const fixturesDir = resolve(process.cwd(), "tests/fixtures/contracts");
const memberAssetsIndexFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, "member_assets_index.json"), "utf8")
);
const memberAssetsHistoryFixtures = {
  M001: JSON.parse(
    readFileSync(
      resolve(fixturesDir, "member_assets_history/M001.json"),
      "utf8"
    )
  ),
  M002: JSON.parse(
    readFileSync(
      resolve(fixturesDir, "member_assets_history/M002.json"),
      "utf8"
    )
  )
};

describe("member-assets", () => {
  it("fills missing real-estate totals from member history exports", () => {
    const legacyIndexFixture = structuredClone(memberAssetsIndexFixture);
    for (const member of legacyIndexFixture.members) {
      delete member.latestRealEstateTotal;
    }

    const enrichedIndex = applyMemberAssetsIndexRealEstateFallbacks(
      legacyIndexFixture,
      memberAssetsHistoryFixtures
    );

    expect(
      enrichedIndex?.members.find((member) => member.memberId === "M001")
    ).toMatchObject({
      latestRealEstateTotal: 510000
    });
    expect(
      enrichedIndex?.members.find((member) => member.memberId === "M002")
    ).toMatchObject({
      latestRealEstateTotal: 320000
    });
  });
});
