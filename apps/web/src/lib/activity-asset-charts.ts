import type { AssetHistorySnapshot } from "./member-assets.js";
import type { MemberAssetsHistoryExport } from "@lawmaker-monitor/schemas";

export const assetCategoryPalette = [
  "#5b6c00",
  "#575148",
  "#95622d",
  "#8a6f4d",
  "#6c5a72",
  "#6b7347",
  "#777066",
  "#4e5c2d"
] as const;

const assetCategoryPriority = [
  "건물",
  "토지",
  "예금",
  "증권",
  "채무",
  "부동산에 관한 규정이 준용되는 권리와 자동차·건설기계·선박 및 항공기",
  "정치자금법에 따른 정치자금의 수입 및 지출을 위한 예금계좌의 예금",
  "현금",
  "채권"
] as const;

export type AssetChartRow = {
  reportedAt: string;
  label: string;
  total: number;
  [categoryKey: string]: string | number;
};

export type AssetCompositionItem = {
  categoryKey: string;
  categoryLabel: string;
  amount: number;
  share: number;
  color: string;
};

export type AssetCompareChartRow = {
  reportedAt: string;
  label: string;
  leftTotal?: number;
  rightTotal?: number;
};

export function formatAssetAxisLabel(value: string): string {
  return value.slice(2).replaceAll("-", ".");
}

export function describeFamilyGap(value: number): string {
  if (value > 0) {
    return "가족 명의 순재산이 총액에 더해졌습니다.";
  }

  if (value < 0) {
    return "가족 명의 순채무가 총액을 낮추고 있습니다.";
  }

  return "본인만과 가족 포함 총액이 같습니다.";
}

export function sortAssetCategorySeries(
  history: AssetHistorySnapshot | null
): AssetHistorySnapshot["categorySeries"] {
  if (!history) {
    return [];
  }

  return [...history.categorySeries].sort((left, right) => {
    const leftPriority = assetCategoryPriority.findIndex(
      (value) => value === left.categoryLabel
    );
    const rightPriority = assetCategoryPriority.findIndex(
      (value) => value === right.categoryLabel
    );
    const normalizedLeft = leftPriority === -1 ? 99 : leftPriority;
    const normalizedRight = rightPriority === -1 ? 99 : rightPriority;

    if (normalizedLeft !== normalizedRight) {
      return normalizedLeft - normalizedRight;
    }

    return left.categoryLabel.localeCompare(right.categoryLabel, "ko-KR");
  });
}

export function buildAssetChartRows(
  history: AssetHistorySnapshot | null,
  visibleCategoryKeys: string[]
): AssetChartRow[] {
  if (!history) {
    return [];
  }

  const categoryLookup = new Map(
    history.categorySeries
      .filter((series) => visibleCategoryKeys.includes(series.categoryKey))
      .map(
        (series) =>
          [
            series.categoryKey,
            new Map(
              series.points.map((point) => [
                point.reportedAt,
                point.currentAmount
              ])
            )
          ] as const
      )
  );

  return history.series.map((point) => {
    const row: AssetChartRow = {
      reportedAt: point.reportedAt,
      label: formatAssetAxisLabel(point.reportedAt),
      total: point.currentAmount
    };

    for (const categoryKey of visibleCategoryKeys) {
      row[categoryKey] =
        categoryLookup.get(categoryKey)?.get(point.reportedAt) ?? 0;
    }

    return row;
  });
}

export function buildAssetCompositionItems(
  history: AssetHistorySnapshot | null,
  orderedCategorySeries: AssetHistorySnapshot["categorySeries"]
): AssetCompositionItem[] {
  if (!history) {
    return [];
  }

  const latestReportedAt = history.latestSummary.reportedAt;
  const compositionItems = orderedCategorySeries
    .map((series, index) => ({
      categoryKey: series.categoryKey,
      categoryLabel: series.categoryLabel,
      amount:
        series.points.find((point) => point.reportedAt === latestReportedAt)
          ?.currentAmount ?? 0,
      color:
        assetCategoryPalette[index % assetCategoryPalette.length] ??
        assetCategoryPalette[0]
    }))
    .filter((item) => item.amount > 0);

  const totalAmount = compositionItems.reduce(
    (sum, item) => sum + item.amount,
    0
  );

  if (totalAmount <= 0) {
    return [];
  }

  return compositionItems
    .map((item) => ({
      ...item,
      share: item.amount / totalAmount
    }))
    .sort((left, right) => {
      if (right.amount !== left.amount) {
        return right.amount - left.amount;
      }

      return left.categoryLabel.localeCompare(right.categoryLabel, "ko-KR");
    });
}

export function buildAssetCompareChartRows(
  leftHistory: MemberAssetsHistoryExport | null,
  rightHistory: MemberAssetsHistoryExport | null
): AssetCompareChartRow[] {
  const rowsByDate = new Map<string, AssetCompareChartRow>();

  for (const point of leftHistory?.series ?? []) {
    rowsByDate.set(point.reportedAt, {
      ...(rowsByDate.get(point.reportedAt) ?? {
        reportedAt: point.reportedAt,
        label: formatAssetAxisLabel(point.reportedAt)
      }),
      leftTotal: point.currentAmount
    });
  }

  for (const point of rightHistory?.series ?? []) {
    rowsByDate.set(point.reportedAt, {
      ...(rowsByDate.get(point.reportedAt) ?? {
        reportedAt: point.reportedAt,
        label: formatAssetAxisLabel(point.reportedAt)
      }),
      rightTotal: point.currentAmount
    });
  }

  return [...rowsByDate.values()].sort((left, right) =>
    left.reportedAt.localeCompare(right.reportedAt)
  );
}
