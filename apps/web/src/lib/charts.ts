import type { AccountabilityTrendsExport } from "@lawmaker-monitor/schemas";

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

export type PartyLineTrendChartDatum = {
  weekStart: string;
  weekEnd: string;
  label: string;
  opportunityCount: number;
  participationCount: number;
  defectionCount: number;
  defectionRate: number | null;
};

export type PartyLineMoverChartDatum = {
  memberId: string;
  name: string;
  party: string;
  photoUrl: string | null;
  officialProfileUrl: string | null;
  previousOpportunityCount: number;
  previousParticipationCount: number;
  previousDefectionCount: number;
  currentOpportunityCount: number;
  currentParticipationCount: number;
  currentDefectionCount: number;
  previousRate: number;
  currentRate: number;
  deltaRate: number;
};

function formatWeekLabel(value: string): string {
  const [year, month, day] = value.split("-").map((part) => Number(part));
  if (!year || !month || !day) {
    return value;
  }

  return `${month}/${day}`;
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
          ? (week.noCount + week.abstainCount + week.absentCount) /
            week.eligibleVoteCount
          : 0
    };
  });
}

export function buildPartyLineTrendChartData(
  trends: AccountabilityTrendsExport | null
): PartyLineTrendChartDatum[] {
  if (!trends) {
    return [];
  }

  return trends.weeks.map((week) => ({
    weekStart: week.weekStart,
    weekEnd: week.weekEnd,
    label: formatWeekLabel(week.weekStart),
    opportunityCount: week.partyLineOpportunityCount,
    participationCount: week.partyLineParticipationCount,
    defectionCount: week.partyLineDefectionCount,
    defectionRate:
      week.partyLineOpportunityCount > 0
        ? week.partyLineParticipationCount > 0
          ? week.partyLineDefectionCount / week.partyLineParticipationCount
          : 0
        : null
  }));
}

export function buildPartyLineMoverChartData(
  trends: AccountabilityTrendsExport | null,
  limit = 8
): PartyLineMoverChartDatum[] {
  if (!trends) {
    return [];
  }

  return trends.movers
    .map((mover) => {
      const previousOpportunityCount =
        mover.previousWindowPartyLineOpportunityCount;
      const previousParticipationCount =
        mover.previousWindowPartyLineParticipationCount;
      const previousDefectionCount =
        mover.previousWindowPartyLineDefectionCount;
      const currentOpportunityCount =
        mover.currentWindowPartyLineOpportunityCount;
      const currentParticipationCount =
        mover.currentWindowPartyLineParticipationCount;
      const currentDefectionCount = mover.currentWindowPartyLineDefectionCount;
      const previousRate =
        previousParticipationCount > 0
          ? previousDefectionCount / previousParticipationCount
          : 0;
      const currentRate =
        currentParticipationCount > 0
          ? currentDefectionCount / currentParticipationCount
          : 0;

      return {
        memberId: mover.memberId,
        name: mover.name,
        party: mover.party,
        photoUrl: mover.photoUrl ?? null,
        officialProfileUrl: mover.officialProfileUrl ?? null,
        previousOpportunityCount,
        previousParticipationCount,
        previousDefectionCount,
        currentOpportunityCount,
        currentParticipationCount,
        currentDefectionCount,
        previousRate,
        currentRate,
        deltaRate: currentRate - previousRate
      };
    })
    .filter(
      (mover) =>
        mover.deltaRate > 0 &&
        (mover.previousOpportunityCount > 0 ||
          mover.currentOpportunityCount > 0)
    )
    .sort((left, right) => {
      if (right.deltaRate !== left.deltaRate) {
        return right.deltaRate - left.deltaRate;
      }

      if (right.currentDefectionCount !== left.currentDefectionCount) {
        return right.currentDefectionCount - left.currentDefectionCount;
      }

      if (right.currentRate !== left.currentRate) {
        return right.currentRate - left.currentRate;
      }

      return left.name.localeCompare(right.name, "ko-KR");
    })
    .slice(0, limit);
}
