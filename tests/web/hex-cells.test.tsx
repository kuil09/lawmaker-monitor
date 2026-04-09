import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("h3-js", () => ({
  polygonToCells: vi.fn(() => ["8730c16f0ffffff", "8730c16f1ffffff"]),
  cellToBoundary: vi.fn(() => [
    [35.13, 129.08],
    [35.14, 129.09],
    [35.15, 129.1]
  ])
}));

import {
  buildStaticHexCells,
  getHexCellsBounds,
  hydrateHexCells,
  type SummaryItem
} from "../../apps/web/src/lib/hex-cells.js";

const fixturesDir = resolve(process.cwd(), "tests/fixtures/contracts");
const accountabilitySummaryFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, "accountability_summary.json"), "utf8")
);
const busanTopologyFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, "constituency_province_busan.topo.json"), "utf8")
);

describe("hex-cells", () => {
  it("builds static province cells from topology and hydrates them with district-member data", () => {
    const staticResult = buildStaticHexCells(busanTopologyFixture, "부산");
    const summaryItems = accountabilitySummaryFixture.items
      .filter((item: { district?: string | null }) => Boolean(item.district))
      .map((item: {
        memberId: string;
        name: string;
        party: string;
        district: string;
        absentRate: number;
        noRate: number;
        abstainRate: number;
      }) => ({
        memberId: item.memberId,
        name: item.name,
        party: item.party,
        district: item.district,
        absentRate: item.absentRate,
        noRate: item.noRate,
        abstainRate: item.abstainRate
      })) satisfies SummaryItem[];

    expect(staticResult.detailRes).toBeGreaterThanOrEqual(6);
    expect(staticResult.cells.length).toBeGreaterThan(0);
    expect(staticResult.timings.staticHexComputeMs).toBeGreaterThanOrEqual(0);
    expect(staticResult.cells[0]).toMatchObject({
      districtKey: "부산남구",
      districtLabel: "부산 남구",
      provinceShortName: "부산"
    });

    const hydrated = hydrateHexCells(staticResult.cells, summaryItems, "absence");
    expect(hydrated[0]).toMatchObject({
      districtKey: "부산남구",
      districtLabel: "부산 남구",
      provinceShortName: "부산",
      memberIds: ["M002"],
      memberNames: ["박민"],
      metric: 0.5
    });
    expect(getHexCellsBounds(hydrated)).toEqual([
      [129.08, 35.13],
      [129.1, 35.15]
    ]);
  });
});
