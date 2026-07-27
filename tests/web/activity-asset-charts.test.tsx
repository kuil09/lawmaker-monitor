import { describe, expect, it } from "vitest";

import {
  buildAssetChartRows,
  buildAssetCompareChartRows,
  buildAssetCompositionItems,
  sortAssetCategorySeries
} from "../../apps/web/src/lib/activity-asset-charts.js";

import type { AssetHistorySnapshot } from "../../apps/web/src/lib/member-assets.js";
import type { MemberAssetsHistoryExport } from "@lawmaker-monitor/schemas";

const snapshot: AssetHistorySnapshot = {
  latestSummary: {
    reportedAt: "2026-03-27",
    currentAmount: 600,
    previousAmount: 300,
    changeAmount: 300,
    changeRate: 1
  },
  series: [
    {
      reportedAt: "2025-03-27",
      currentAmount: 300,
      previousAmount: null,
      changeAmount: null,
      changeRate: null
    },
    {
      reportedAt: "2026-03-27",
      currentAmount: 600,
      previousAmount: 300,
      changeAmount: 300,
      changeRate: 1
    }
  ],
  categorySeries: [
    {
      categoryKey: "deposit",
      categoryLabel: "예금",
      points: [
        {
          reportedAt: "2025-03-27",
          currentAmount: 100,
          previousAmount: null,
          changeAmount: null
        },
        {
          reportedAt: "2026-03-27",
          currentAmount: 200,
          previousAmount: 100,
          changeAmount: 100
        }
      ]
    },
    {
      categoryKey: "building",
      categoryLabel: "건물",
      points: [
        {
          reportedAt: "2025-03-27",
          currentAmount: 200,
          previousAmount: null,
          changeAmount: null
        },
        {
          reportedAt: "2026-03-27",
          currentAmount: 400,
          previousAmount: 200,
          changeAmount: 200
        }
      ]
    }
  ]
};

describe("activity asset chart models", () => {
  it("orders categories and builds stable chart rows outside the page component", () => {
    const ordered = sortAssetCategorySeries(snapshot);
    expect(ordered.map((series) => series.categoryLabel)).toEqual([
      "건물",
      "예금"
    ]);

    expect(
      buildAssetChartRows(snapshot, ["building", "deposit"])
    ).toMatchObject([
      { label: "25.03.27", total: 300, building: 200, deposit: 100 },
      { label: "26.03.27", total: 600, building: 400, deposit: 200 }
    ]);
  });

  it("normalizes composition shares and aligns comparison dates", () => {
    const ordered = sortAssetCategorySeries(snapshot);
    expect(buildAssetCompositionItems(snapshot, ordered)).toMatchObject([
      { categoryLabel: "건물", amount: 400, share: 2 / 3 },
      { categoryLabel: "예금", amount: 200, share: 1 / 3 }
    ]);

    const left = snapshot as MemberAssetsHistoryExport;
    const right = {
      ...snapshot,
      series: [snapshot.series[1]]
    } as MemberAssetsHistoryExport;
    expect(buildAssetCompareChartRows(left, right)).toMatchObject([
      { reportedAt: "2025-03-27", leftTotal: 300 },
      { reportedAt: "2026-03-27", leftTotal: 600, rightTotal: 600 }
    ]);
  });
});
