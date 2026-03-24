import type { AccountabilitySummaryItem } from "@lawmaker-monitor/schemas";

export type AccountabilityMetric = "combined" | "absent" | "abstain" | "no";
export type LeaderboardMetric = "yes" | "no" | "abstain" | "absent";

export function getYesCount(item: AccountabilitySummaryItem): number {
  return Math.max(0, item.totalRecordedVotes - item.noCount - item.abstainCount - item.absentCount);
}

export function getYesRate(item: AccountabilitySummaryItem): number {
  return item.totalRecordedVotes > 0 ? getYesCount(item) / item.totalRecordedVotes : 0;
}

export function getMetricCount(item: AccountabilitySummaryItem, metric: AccountabilityMetric): number {
  switch (metric) {
    case "combined":
      return item.noCount + item.abstainCount + item.absentCount;
    case "absent":
      return item.absentCount;
    case "abstain":
      return item.abstainCount;
    case "no":
      return item.noCount;
  }
}

export function getLeaderboardMetricCount(
  item: AccountabilitySummaryItem,
  metric: LeaderboardMetric
): number {
  switch (metric) {
    case "yes":
      return getYesCount(item);
    case "no":
      return item.noCount;
    case "abstain":
      return item.abstainCount;
    case "absent":
      return item.absentCount;
  }
}

export function getLeaderboardMetricRate(
  item: AccountabilitySummaryItem,
  metric: LeaderboardMetric
): number {
  switch (metric) {
    case "yes":
      return getYesRate(item);
    case "no":
      return item.noRate;
    case "abstain":
      return item.abstainRate;
    case "absent":
      return item.absentRate;
  }
}

export function getMetricRate(item: AccountabilitySummaryItem, metric: AccountabilityMetric): number {
  switch (metric) {
    case "combined":
      return item.noRate + item.abstainRate + item.absentRate;
    case "absent":
      return item.absentRate;
    case "abstain":
      return item.abstainRate;
    case "no":
      return item.noRate;
  }
}

export function rankAccountabilityItems(
  items: AccountabilitySummaryItem[],
  metric: AccountabilityMetric
): AccountabilitySummaryItem[] {
  return [...items].sort((left, right) => {
    const rightCount = getMetricCount(right, metric);
    const leftCount = getMetricCount(left, metric);
    if (rightCount !== leftCount) {
      return rightCount - leftCount;
    }

    const rightRate = getMetricRate(right, metric);
    const leftRate = getMetricRate(left, metric);
    if (rightRate !== leftRate) {
      return rightRate - leftRate;
    }

    if (right.totalRecordedVotes !== left.totalRecordedVotes) {
      return right.totalRecordedVotes - left.totalRecordedVotes;
    }

    return left.name.localeCompare(right.name, "ko-KR");
  });
}

export function rankSupportItems(items: AccountabilitySummaryItem[]): AccountabilitySummaryItem[] {
  return rankLeaderboardItems(items, "yes");
}

export function rankLeaderboardItems(
  items: AccountabilitySummaryItem[],
  metric: LeaderboardMetric
): AccountabilitySummaryItem[] {
  return [...items].sort((left, right) => {
    const rightRate = getLeaderboardMetricRate(right, metric);
    const leftRate = getLeaderboardMetricRate(left, metric);
    if (rightRate !== leftRate) {
      return rightRate - leftRate;
    }

    const rightCount = getLeaderboardMetricCount(right, metric);
    const leftCount = getLeaderboardMetricCount(left, metric);
    if (rightCount !== leftCount) {
      return rightCount - leftCount;
    }

    if (right.totalRecordedVotes !== left.totalRecordedVotes) {
      return right.totalRecordedVotes - left.totalRecordedVotes;
    }

    return left.name.localeCompare(right.name, "ko-KR");
  });
}
