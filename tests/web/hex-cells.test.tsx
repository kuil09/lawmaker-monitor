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

  it("matches special-city district aliases and keeps unmatched districts visible as neutral cells", () => {
    const hydrated = hydrateHexCells(
      [
        {
          h3Index: "881f1d4895fffff",
          districtKey: "세종세종시갑",
          districtLabel: "세종 세종시갑",
          provinceShortName: "세종"
        },
        {
          h3Index: "881f1d4897fffff",
          districtKey: "전북군산시김제시부안군갑",
          districtLabel: "전북 군산시김제시부안군갑",
          provinceShortName: "전북"
        }
      ],
      [
        {
          memberId: "M100",
          name: "김세종",
          party: "더불어민주당",
          district: "세종특별자치시갑",
          absentRate: 0.1,
          noRate: 0.2,
          abstainRate: 0.05
        }
      ] satisfies SummaryItem[],
      "negative"
    );

    expect(hydrated).toHaveLength(2);
    expect(hydrated[0]).toMatchObject({
      districtKey: "세종세종시갑",
      memberIds: ["M100"],
      memberNames: ["김세종"],
      memberCount: 1,
      party: "더불어민주당",
      metric: 0.25
    });
    expect(hydrated[1]).toMatchObject({
      districtKey: "전북군산시김제시부안군갑",
      memberIds: [],
      memberNames: [],
      memberCount: 0,
      metricMemberCount: 0,
      party: "",
      metric: 0
    });
  });

  it("hydrates asset metrics separately from member presence so missing asset disclosures stay neutral", () => {
    const summaryItems = [
      {
        memberId: "M002",
        name: "박민",
        party: "미래개혁당",
        district: "부산 남구",
        absentRate: 0.5,
        noRate: 0.1,
        abstainRate: 0.1,
        realEstateTotal: 320000,
        assetTotal: 270000
      },
      {
        memberId: "M001",
        name: "김아라",
        party: "미래개혁당",
        district: "서울 중구",
        absentRate: 0.0,
        noRate: 0.0,
        abstainRate: 0.0,
        realEstateTotal: null,
        assetTotal: null
      }
    ] satisfies SummaryItem[];
    const hydratedAssetTotal = hydrateHexCells(
      [
        {
          h3Index: "8730c16f0ffffff",
          districtKey: "부산남구",
          districtLabel: "부산 남구",
          provinceShortName: "부산"
        },
        {
          h3Index: "8730e1d88ffffff",
          districtKey: "서울중구",
          districtLabel: "서울 중구",
          provinceShortName: "서울"
        }
      ],
      summaryItems,
      "assetTotal"
    );

    expect(hydratedAssetTotal[0]).toMatchObject({
      districtKey: "부산남구",
      memberCount: 1,
      metricMemberCount: 1,
      metric: 270000
    });
    expect(hydratedAssetTotal[1]).toMatchObject({
      districtKey: "서울중구",
      memberCount: 1,
      metricMemberCount: 0,
      metric: 0,
      memberNames: ["김아라"]
    });

    const hydratedRealEstate = hydrateHexCells(
      [
        {
          h3Index: "8730c16f0ffffff",
          districtKey: "부산남구",
          districtLabel: "부산 남구",
          provinceShortName: "부산"
        },
        {
          h3Index: "8730e1d88ffffff",
          districtKey: "서울중구",
          districtLabel: "서울 중구",
          provinceShortName: "서울"
        }
      ],
      summaryItems,
      "realEstate"
    );

    expect(hydratedRealEstate[0]).toMatchObject({
      districtKey: "부산남구",
      memberCount: 1,
      metricMemberCount: 1,
      metric: 320000
    });
    expect(hydratedRealEstate[1]).toMatchObject({
      districtKey: "서울중구",
      memberCount: 1,
      metricMemberCount: 0,
      metric: 0,
      memberNames: ["김아라"]
    });
  });
});
