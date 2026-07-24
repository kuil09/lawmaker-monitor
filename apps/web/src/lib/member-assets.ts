import type {
  MemberAssetsHistoryExport,
  MemberAssetsIndexExport
} from "@lawmaker-monitor/schemas";

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

export type AssetAllocationSummary = {
  positiveAssetTotal: number;
  realEstateAmount: number;
  otherAssetAmount: number;
  realEstateShare: number;
};

export type DebtRatioStatus =
  | "none"
  | "below-half"
  | "half-or-more"
  | "assets-exceeded"
  | "unavailable";

export type DebtFocusSummary = {
  debtAmount: number;
  debtRatio: number | null;
  grossAssetAmount: number;
  netAssetAmount: number;
  status: DebtRatioStatus;
};

export type AssetScopeMode = "familyIncluded" | "selfOnly";

export type AssetHistorySnapshot = Pick<
  MemberAssetsHistoryExport,
  "series" | "categorySeries" | "latestSummary"
>;

export function getFamilyGapLatest(
  history: MemberAssetsHistoryExport | null
): number | null {
  if (!history?.selfOnly) {
    return null;
  }

  return (
    history.latestSummary.currentAmount -
    history.selfOnly.latestSummary.currentAmount
  );
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

  // Use `history` directly so familyIncluded snapshots stay referentially stable.
  return history;
}

function getCategoryAmountAtDate(
  history: AssetHistorySnapshot | null,
  categoryLabel: string,
  reportedAt: string
): number {
  if (!history) {
    return 0;
  }

  const series = history.categorySeries.find(
    (entry) => entry.categoryLabel === categoryLabel
  );
  return (
    series?.points.find((point) => point.reportedAt === reportedAt)
      ?.currentAmount ?? 0
  );
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

  const buildingAmount = getCategoryAmountAtDate(
    history,
    "건물",
    latestReportedAt
  );
  const landAmount = getCategoryAmountAtDate(history, "토지", latestReportedAt);
  const latestAmount = buildingAmount + landAmount;
  const firstAmount = explicitRealEstateCategoryLabels.reduce(
    (sum, categoryLabel) =>
      sum + getCategoryAmountAtDate(history, categoryLabel, firstReportedAt),
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

export function getLatestRealEstateTotalFromHistory(
  history: MemberAssetsHistoryExport | null,
  scopeMode: AssetScopeMode = "familyIncluded"
): number | null {
  return (
    buildRealEstateFocusSummary(resolveAssetHistorySnapshot(history, scopeMode))
      ?.latestAmount ?? null
  );
}

export function calculateDebtRatio(
  netAssetAmount: number,
  debtAmount: number
): number | null {
  const grossAssetAmount = netAssetAmount + debtAmount;
  if (grossAssetAmount <= 0) {
    return null;
  }

  return debtAmount / grossAssetAmount;
}

export function getLatestDebtTotalFromHistory(
  history: MemberAssetsHistoryExport | null,
  scopeMode: AssetScopeMode = "familyIncluded"
): number | null {
  const snapshot = resolveAssetHistorySnapshot(history, scopeMode);
  if (!snapshot || snapshot.series.length === 0) {
    return null;
  }

  return Math.max(
    getCategoryAmountAtDate(
      snapshot,
      "채무",
      snapshot.latestSummary.reportedAt
    ),
    0
  );
}

export function buildDebtFocusSummary(
  history: MemberAssetsHistoryExport | null,
  scopeMode: AssetScopeMode = "familyIncluded"
): DebtFocusSummary | null {
  const snapshot = resolveAssetHistorySnapshot(history, scopeMode);
  const debtAmount = getLatestDebtTotalFromHistory(history, scopeMode);
  if (!snapshot || debtAmount == null) {
    return null;
  }

  const netAssetAmount = snapshot.latestSummary.currentAmount;
  const grossAssetAmount = netAssetAmount + debtAmount;
  const debtRatio = calculateDebtRatio(netAssetAmount, debtAmount);
  const status: DebtRatioStatus =
    debtRatio == null
      ? "unavailable"
      : debtAmount === 0
        ? "none"
        : debtRatio >= 1
          ? "assets-exceeded"
          : debtRatio >= 0.5
            ? "half-or-more"
            : "below-half";

  return {
    debtAmount,
    debtRatio,
    grossAssetAmount,
    netAssetAmount,
    status
  };
}

export function buildLatestAssetAllocationSummary(
  history: MemberAssetsHistoryExport | null,
  scopeMode: AssetScopeMode = "familyIncluded"
): AssetAllocationSummary | null {
  const snapshot = resolveAssetHistorySnapshot(history, scopeMode);
  if (!snapshot || snapshot.series.length === 0) {
    return null;
  }

  const latestReportedAt = snapshot.latestSummary.reportedAt;
  const positiveAssetTotal = snapshot.categorySeries.reduce((sum, series) => {
    const amount =
      series.points.find((point) => point.reportedAt === latestReportedAt)
        ?.currentAmount ?? 0;
    return amount > 0 ? sum + amount : sum;
  }, 0);

  if (positiveAssetTotal <= 0) {
    return null;
  }

  const realEstateAmount = Math.max(
    getLatestRealEstateTotalFromHistory(history, scopeMode) ?? 0,
    0
  );
  const normalizedRealEstateAmount = Math.min(
    realEstateAmount,
    positiveAssetTotal
  );
  const otherAssetAmount = Math.max(
    positiveAssetTotal - normalizedRealEstateAmount,
    0
  );

  return {
    positiveAssetTotal,
    realEstateAmount: normalizedRealEstateAmount,
    otherAssetAmount,
    realEstateShare: normalizedRealEstateAmount / positiveAssetTotal
  };
}

export function applyMemberAssetsIndexFallbacks(
  index: MemberAssetsIndexExport | null,
  histories: Record<string, MemberAssetsHistoryExport | undefined>
): MemberAssetsIndexExport | null {
  if (!index) {
    return null;
  }

  let hasChanges = false;
  const members = index.members.map((entry) => {
    if (entry.latestRealEstateTotal != null && entry.latestDebtTotal != null) {
      return entry;
    }

    const history = histories[entry.memberId] ?? null;
    const fallbackRealEstateTotal =
      entry.latestRealEstateTotal ??
      getLatestRealEstateTotalFromHistory(history);
    const fallbackDebtTotal =
      entry.latestDebtTotal ?? getLatestDebtTotalFromHistory(history);
    if (fallbackRealEstateTotal == null && fallbackDebtTotal == null) {
      return entry;
    }

    hasChanges = true;
    return {
      ...entry,
      ...(fallbackRealEstateTotal == null
        ? {}
        : { latestRealEstateTotal: fallbackRealEstateTotal }),
      ...(fallbackDebtTotal == null
        ? {}
        : { latestDebtTotal: fallbackDebtTotal })
    };
  });

  if (!hasChanges) {
    return index;
  }

  return {
    ...index,
    members
  };
}

export const applyMemberAssetsIndexRealEstateFallbacks =
  applyMemberAssetsIndexFallbacks;
