import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  applyMemberAssetsIndexFallbacks,
  buildDebtFocusSummary,
  calculateDebtRatio,
  resolveAssetHistorySnapshot
} from "../../apps/web/src/lib/member-assets.js";

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
  it("resolveAssetHistorySnapshot reuses history for familyIncluded (stable identity)", () => {
    const history = memberAssetsHistoryFixtures.M001;
    expect(resolveAssetHistorySnapshot(history, "familyIncluded")).toBe(
      history
    );
  });

  it("fills missing real-estate and debt totals from member history exports", () => {
    const legacyIndexFixture = structuredClone(memberAssetsIndexFixture);
    for (const member of legacyIndexFixture.members) {
      delete member.latestRealEstateTotal;
      delete member.latestDebtTotal;
    }

    const enrichedIndex = applyMemberAssetsIndexFallbacks(
      legacyIndexFixture,
      memberAssetsHistoryFixtures
    );

    expect(
      enrichedIndex?.members.find((member) => member.memberId === "M001")
    ).toMatchObject({
      latestRealEstateTotal: 510000,
      latestDebtTotal: 0
    });
    expect(
      enrichedIndex?.members.find((member) => member.memberId === "M002")
    ).toMatchObject({
      latestRealEstateTotal: 320000,
      latestDebtTotal: 90000
    });
  });

  it("calculates debt against gross assets rather than net assets", () => {
    const summary = buildDebtFocusSummary(
      memberAssetsHistoryFixtures.M002,
      "familyIncluded"
    );

    expect(summary).toMatchObject({
      debtAmount: 90000,
      grossAssetAmount: 360000,
      netAssetAmount: 270000,
      debtRatio: 0.25,
      status: "below-half"
    });
  });

  it("preserves ratios over 100% and refuses non-positive denominators", () => {
    expect(calculateDebtRatio(-20, 100)).toBe(1.25);
    expect(calculateDebtRatio(-100, 100)).toBeNull();
    expect(calculateDebtRatio(-120, 100)).toBeNull();
  });
});
