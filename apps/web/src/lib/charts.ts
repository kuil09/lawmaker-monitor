import type {
  AccountabilitySummaryItem,
  AccountabilityMoverWindow,
  AccountabilityTrendsExport,
  LatestVoteItem
} from "@lawmaker-monitor/schemas";

import type { AccountabilityMetric } from "./accountability.js";
import { getMetricCount, getMetricRate, rankAccountabilityItems } from "./accountability.js";

export type MemberChartDatum = {
  memberId: string;
  name: string;
  party: string;
  photoUrl: string | null;
  count: number;
  rate: number;
  totalRecordedVotes: number;
  noCount: number;
  abstainCount: number;
  absentCount: number;
};

export type PartyChartDatum = {
  party: string;
  noCount: number;
  abstainCount: number;
  absentCount: number;
  combinedCount: number;
  combinedRate: number;
  totalRecordedVotes: number;
};

export type RecentVoteChartDatum = {
  rollCallId: string;
  billName: string;
  shortBillName: string;
  yes: number;
  no: number;
  abstain: number;
};

export type WeeklyTrendChartDatum = {
  weekStart: string;
  weekEnd: string;
  label: string;
  yesShare: number | null;
  noShare: number | null;
  abstainShare: number | null;
  absentShare: number | null;
  yesCount: number;
  noCount: number;
  abstainCount: number;
  absentCount: number;
  eligibleVoteCount: number;
  negativeRate: number;
};

export type AccountabilityMoverChartDatum = {
  memberId: string;
  name: string;
  party: string;
  photoUrl: string | null;
  officialProfileUrl: string | null;
  previousCount: number;
  currentCount: number;
  delta: number;
  previousRate: number;
  currentRate: number;
};

function truncateLabel(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

function formatWeekLabel(value: string): string {
  const [year, month, day] = value.split("-").map((part) => Number(part));
  if (!year || !month || !day) {
    return value;
  }

  return `${month}/${day}`;
}

function getMoverMetricCount(
  mover: AccountabilityMoverWindow,
  metric: AccountabilityMetric,
  window: "previous" | "current"
): number {
  const prefix = window === "previous" ? "previousWindow" : "currentWindow";

  switch (metric) {
    case "combined":
      return (
        mover[`${prefix}NoCount`] +
        mover[`${prefix}AbstainCount`] +
        mover[`${prefix}AbsentCount`]
      );
    case "no":
      return mover[`${prefix}NoCount`];
    case "abstain":
      return mover[`${prefix}AbstainCount`];
    case "absent":
      return mover[`${prefix}AbsentCount`];
  }
}

function getMoverWindowEligibleCount(
  mover: AccountabilityMoverWindow,
  window: "previous" | "current"
): number {
  return window === "previous"
    ? mover.previousWindowEligibleCount
    : mover.currentWindowEligibleCount;
}

export function buildMemberChartData(
  items: AccountabilitySummaryItem[],
  metric: AccountabilityMetric,
  limit = 10
): MemberChartDatum[] {
  return rankAccountabilityItems(items, metric)
    .slice(0, limit)
    .map((item) => ({
      memberId: item.memberId,
      name: item.name,
      party: item.party,
      photoUrl: item.photoUrl ?? null,
      count: getMetricCount(item, metric),
      rate: getMetricRate(item, metric),
      totalRecordedVotes: item.totalRecordedVotes,
      noCount: item.noCount,
      abstainCount: item.abstainCount,
      absentCount: item.absentCount
    }));
}

export function buildPartyChartData(items: AccountabilitySummaryItem[], limit = 8): PartyChartDatum[] {
  const parties = new Map<string, PartyChartDatum>();

  for (const item of items) {
    const current = parties.get(item.party) ?? {
      party: item.party,
      noCount: 0,
      abstainCount: 0,
      absentCount: 0,
      combinedCount: 0,
      combinedRate: 0,
      totalRecordedVotes: 0
    };

    current.noCount += item.noCount;
    current.abstainCount += item.abstainCount;
    current.absentCount += item.absentCount;
    current.totalRecordedVotes += item.totalRecordedVotes;
    current.combinedCount = current.noCount + current.abstainCount + current.absentCount;
    current.combinedRate =
      current.totalRecordedVotes > 0 ? current.combinedCount / current.totalRecordedVotes : 0;

    parties.set(item.party, current);
  }

  return [...parties.values()]
    .sort((left, right) => {
      if (right.combinedCount !== left.combinedCount) {
        return right.combinedCount - left.combinedCount;
      }

      if (right.noCount !== left.noCount) {
        return right.noCount - left.noCount;
      }

      return left.party.localeCompare(right.party, "ko-KR");
    })
    .slice(0, limit);
}

export function buildRecentVoteChartData(items: LatestVoteItem[], limit = 8): RecentVoteChartDatum[] {
  return items.slice(0, limit).map((item) => ({
    rollCallId: item.rollCallId,
    billName: item.billName,
    shortBillName: truncateLabel(item.billName, 14),
    yes: item.counts.yes,
    no: item.counts.no,
    abstain: item.counts.abstain
  }));
}

export function buildWeeklyTrendChartData(
  trends: AccountabilityTrendsExport | null
): WeeklyTrendChartDatum[] {
  if (!trends) {
    return [];
  }

  return trends.weeks.map((week) => {
    const total =
      week.yesCount + week.noCount + week.abstainCount + week.absentCount;

    return {
      weekStart: week.weekStart,
      weekEnd: week.weekEnd,
      label: formatWeekLabel(week.weekStart),
      yesShare: total > 0 ? (week.yesCount / total) * 100 : null,
      noShare: total > 0 ? (week.noCount / total) * 100 : null,
      abstainShare: total > 0 ? (week.abstainCount / total) * 100 : null,
      absentShare: total > 0 ? (week.absentCount / total) * 100 : null,
      yesCount: week.yesCount,
      noCount: week.noCount,
      abstainCount: week.abstainCount,
      absentCount: week.absentCount,
      eligibleVoteCount: week.eligibleVoteCount,
      negativeRate:
        week.eligibleVoteCount > 0
          ? (week.noCount + week.abstainCount + week.absentCount) / week.eligibleVoteCount
          : 0
    };
  });
}

export function buildMoverChartData(
  trends: AccountabilityTrendsExport | null,
  metric: AccountabilityMetric,
  limit = 8
): AccountabilityMoverChartDatum[] {
  if (!trends) {
    return [];
  }

  return trends.movers
    .map((mover) => {
      const previousCount = getMoverMetricCount(mover, metric, "previous");
      const currentCount = getMoverMetricCount(mover, metric, "current");
      const previousEligibleCount = getMoverWindowEligibleCount(mover, "previous");
      const currentEligibleCount = getMoverWindowEligibleCount(mover, "current");

      return {
        memberId: mover.memberId,
        name: mover.name,
        party: mover.party,
        photoUrl: mover.photoUrl ?? null,
        officialProfileUrl: mover.officialProfileUrl ?? null,
        previousCount,
        currentCount,
        delta: currentCount - previousCount,
        previousRate: previousEligibleCount > 0 ? previousCount / previousEligibleCount : 0,
        currentRate: currentEligibleCount > 0 ? currentCount / currentEligibleCount : 0
      };
    })
    .filter((mover) => mover.delta > 0)
    .sort((left, right) => {
      if (right.delta !== left.delta) {
        return right.delta - left.delta;
      }

      if (right.currentCount !== left.currentCount) {
        return right.currentCount - left.currentCount;
      }

      if (right.currentRate !== left.currentRate) {
        return right.currentRate - left.currentRate;
      }

      return left.name.localeCompare(right.name, "ko-KR");
    })
    .slice(0, limit);
}
