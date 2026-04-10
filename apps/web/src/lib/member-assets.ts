import type { MemberAssetsHistoryExport } from "@lawmaker-monitor/schemas";

export const explicitRealEstateCategoryLabels = ["건물", "토지"] as const;
export const mixedAssetCategoryLabels = [
  "부동산에 관한 규정이 준용되는 권리와 자동차·건설기계·선박 및 항공기"
] as const;

export type RealEstateFocusSummary = {
  buildingAmount: number;
  hasExplicitCategory: boolean;
  hasMixedCategory: boolean;
  landAmount: number;
  latestAmount: number;
  deltaAmount: number;
};

export type AssetScopeMode = "familyIncluded" | "selfOnly";

export type AssetHistorySnapshot = Pick<
  MemberAssetsHistoryExport,
  "series" | "categorySeries" | "latestSummary"
>;

export function getFamilyGapLatest(history: MemberAssetsHistoryExport | null): number | null {
  if (!history?.selfOnly) {
    return null;
  }

  return history.latestSummary.currentAmount - history.selfOnly.latestSummary.currentAmount;
}

export function resolveAssetHistorySnapshot(
  history: MemberAssetsHistoryExport | null,
  scopeMode: AssetScopeMode
): AssetHistorySnapshot | null {
  if (!history) {
    return null;
  }

  if (scopeMode === "selfOnly" && history.selfOnly) {
    return history.selfOnly;
  }

  return {
    series: history.series,
    categorySeries: history.categorySeries,
    latestSummary: history.latestSummary
  };
}

function getCategoryAmountAtDate(
  history: AssetHistorySnapshot | null,
  categoryLabel: string,
  reportedAt: string
): number {
  if (!history) {
    return 0;
  }

  const series = history.categorySeries.find((entry) => entry.categoryLabel === categoryLabel);
  return series?.points.find((point) => point.reportedAt === reportedAt)?.currentAmount ?? 0;
}

export function buildRealEstateFocusSummary(
  history: AssetHistorySnapshot | null
): RealEstateFocusSummary | null {
  if (!history || history.series.length === 0) {
    return null;
  }

  const firstReportedAt = history.series[0]?.reportedAt;
  const latestReportedAt = history.latestSummary.reportedAt;

  if (!firstReportedAt || !latestReportedAt) {
    return null;
  }

  const buildingAmount = getCategoryAmountAtDate(history, "건물", latestReportedAt);
  const landAmount = getCategoryAmountAtDate(history, "토지", latestReportedAt);
  const latestAmount = buildingAmount + landAmount;
  const firstAmount = explicitRealEstateCategoryLabels.reduce(
    (sum, categoryLabel) => sum + getCategoryAmountAtDate(history, categoryLabel, firstReportedAt),
    0
  );

  return {
    buildingAmount,
    hasExplicitCategory: history.categorySeries.some((series) =>
      explicitRealEstateCategoryLabels.includes(
        series.categoryLabel as (typeof explicitRealEstateCategoryLabels)[number]
      )
    ),
    hasMixedCategory: history.categorySeries.some((series) =>
      mixedAssetCategoryLabels.includes(
        series.categoryLabel as (typeof mixedAssetCategoryLabels)[number]
      )
    ),
    landAmount,
    latestAmount,
    deltaAmount: latestAmount - firstAmount
  };
}
