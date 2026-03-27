import type {
  AccountabilitySummaryExport,
  AccountabilitySummaryItem,
  MemberActivityCalendarExport,
  MemberActivityCalendarMember
} from "@lawmaker-monitor/schemas";

import { getYesCount } from "./accountability.js";
import { getMemberAttendanceSummary } from "./member-activity.js";

export type DistributionMemberPoint = {
  memberId: string;
  name: string;
  party: string;
  district: string | null;
  photoUrl?: string | null;
  officialProfileUrl?: string | null;
  officialExternalUrl?: string | null;
  totalRecordedVotes: number;
  yesCount: number;
  noCount: number;
  abstainCount: number;
  absentVoteCount: number;
  yesRate: number;
  noRate: number;
  abstainRate: number;
  absentRate: number;
  negativeRate: number;
  disruptionRate: number;
  attendanceRate: number;
  eligibleDays: number;
  attendedDays: number;
  yesDays: number;
  noDays: number;
  abstainDays: number;
  absentDayCount: number;
  negativeDayCount: number;
  currentNegativeStreak: number;
  currentNegativeOrAbsentStreak: number;
  longestNegativeStreak: number;
  longestNegativeOrAbsentStreak: number;
  committeeMemberships: string[];
  committeeCount: number;
  activity: MemberActivityCalendarMember;
  accountability: AccountabilitySummaryItem;
};

export type DistributionPartySummary = {
  party: string;
  memberCount: number;
  averageAttendanceRate: number;
  averageSupportRate: number;
  averageNegativeRate: number;
  averageAbsenceRate: number;
  topCurrentStreak: number;
};

const CHART_DOMAIN_FALLBACK: [number, number] = [0, 100];
const CHART_DOMAIN_STEP = 5;
const MIN_CHART_DOMAIN_PADDING = 3;
const MIN_CHART_DOMAIN_SPAN = 15;

function roundDownToStep(value: number): number {
  return Math.floor(value / CHART_DOMAIN_STEP) * CHART_DOMAIN_STEP;
}

function roundUpToStep(value: number): number {
  return Math.ceil(value / CHART_DOMAIN_STEP) * CHART_DOMAIN_STEP;
}

export function buildDistributionChartDomain(values: number[]): [number, number] {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  if (finiteValues.length === 0) {
    return CHART_DOMAIN_FALLBACK;
  }

  const minValue = Math.min(...finiteValues);
  const maxValue = Math.max(...finiteValues);
  const rawSpan = maxValue - minValue;
  const padding = Math.max(rawSpan * 0.14, MIN_CHART_DOMAIN_PADDING);

  let lowerBound = roundDownToStep(Math.max(CHART_DOMAIN_FALLBACK[0], minValue - padding));
  let upperBound = roundUpToStep(Math.min(CHART_DOMAIN_FALLBACK[1], maxValue + padding));

  if (upperBound - lowerBound < MIN_CHART_DOMAIN_SPAN) {
    const midpoint = (minValue + maxValue) / 2;
    lowerBound = roundDownToStep(Math.max(CHART_DOMAIN_FALLBACK[0], midpoint - MIN_CHART_DOMAIN_SPAN / 2));
    upperBound = roundUpToStep(Math.min(CHART_DOMAIN_FALLBACK[1], midpoint + MIN_CHART_DOMAIN_SPAN / 2));
  }

  if (upperBound - lowerBound < MIN_CHART_DOMAIN_SPAN) {
    if (lowerBound <= CHART_DOMAIN_FALLBACK[0]) {
      upperBound = Math.min(CHART_DOMAIN_FALLBACK[1], lowerBound + MIN_CHART_DOMAIN_SPAN);
    } else if (upperBound >= CHART_DOMAIN_FALLBACK[1]) {
      lowerBound = Math.max(CHART_DOMAIN_FALLBACK[0], upperBound - MIN_CHART_DOMAIN_SPAN);
    }
  }

  return [lowerBound, upperBound];
}

export function buildDistributionMembers(
  accountabilitySummary: AccountabilitySummaryExport,
  activityCalendar: MemberActivityCalendarExport
): DistributionMemberPoint[] {
  const activityMembersById = new Map(
    activityCalendar.assembly.members.map((member) => [member.memberId, member])
  );

  return accountabilitySummary.items
    .flatMap((item) => {
      const activityMember = activityMembersById.get(item.memberId);
      if (!activityMember) {
        return [];
      }

      const attendanceSummary = getMemberAttendanceSummary(activityMember);
      const yesCount = getYesCount(item);
      const negativeRate = item.noRate + item.abstainRate;
      const disruptionRate = negativeRate + item.absentRate;

      return [
        {
          memberId: item.memberId,
          name: item.name,
          party: item.party,
          district: item.district ?? null,
          photoUrl: item.photoUrl,
          officialProfileUrl: item.officialProfileUrl,
          officialExternalUrl: item.officialExternalUrl,
          totalRecordedVotes: item.totalRecordedVotes,
          yesCount,
          noCount: item.noCount,
          abstainCount: item.abstainCount,
          absentVoteCount: item.absentCount,
          yesRate: item.totalRecordedVotes > 0 ? yesCount / item.totalRecordedVotes : 0,
          noRate: item.noRate,
          abstainRate: item.abstainRate,
          absentRate: item.absentRate,
          negativeRate,
          disruptionRate,
          attendanceRate: attendanceSummary.attendanceRate,
          eligibleDays: attendanceSummary.eligibleDays,
          attendedDays: attendanceSummary.attendedDays,
          yesDays: attendanceSummary.yesDays,
          noDays: attendanceSummary.noDays,
          abstainDays: attendanceSummary.abstainDays,
          absentDayCount: activityMember.absentDays,
          negativeDayCount: activityMember.negativeDays,
          currentNegativeStreak: activityMember.currentNegativeStreak,
          currentNegativeOrAbsentStreak: activityMember.currentNegativeOrAbsentStreak,
          longestNegativeStreak: activityMember.longestNegativeStreak,
          longestNegativeOrAbsentStreak: activityMember.longestNegativeOrAbsentStreak,
          committeeMemberships: activityMember.committeeMemberships,
          committeeCount: activityMember.committeeMemberships.length,
          activity: activityMember,
          accountability: item
        }
      ];
    })
    .sort((left, right) => {
      if (right.disruptionRate !== left.disruptionRate) {
        return right.disruptionRate - left.disruptionRate;
      }

      if (left.attendanceRate !== right.attendanceRate) {
        return left.attendanceRate - right.attendanceRate;
      }

      if (right.currentNegativeOrAbsentStreak !== left.currentNegativeOrAbsentStreak) {
        return right.currentNegativeOrAbsentStreak - left.currentNegativeOrAbsentStreak;
      }

      if (right.totalRecordedVotes !== left.totalRecordedVotes) {
        return right.totalRecordedVotes - left.totalRecordedVotes;
      }

      return left.name.localeCompare(right.name, "ko-KR");
    });
}

export function getDefaultDistributionMemberId(
  members: DistributionMemberPoint[]
): string | null {
  return members[0]?.memberId ?? null;
}

export function buildDistributionPartySummaries(
  members: DistributionMemberPoint[]
): DistributionPartySummary[] {
  const groups = new Map<string, DistributionMemberPoint[]>();

  for (const member of members) {
    const current = groups.get(member.party) ?? [];
    current.push(member);
    groups.set(member.party, current);
  }

  return [...groups.entries()]
    .map(([party, partyMembers]) => {
      const totalAttendanceRate = partyMembers.reduce(
        (sum, member) => sum + member.attendanceRate,
        0
      );
      const totalSupportRate = partyMembers.reduce(
        (sum, member) => sum + member.yesRate,
        0
      );
      const totalNegativeRate = partyMembers.reduce(
        (sum, member) => sum + member.negativeRate,
        0
      );
      const totalAbsenceRate = partyMembers.reduce(
        (sum, member) => sum + member.absentRate,
        0
      );
      const topCurrentStreak = partyMembers.reduce(
        (maxValue, member) =>
          Math.max(maxValue, member.currentNegativeOrAbsentStreak),
        0
      );

      return {
        party,
        memberCount: partyMembers.length,
        averageAttendanceRate: totalAttendanceRate / partyMembers.length,
        averageSupportRate: totalSupportRate / partyMembers.length,
        averageNegativeRate: totalNegativeRate / partyMembers.length,
        averageAbsenceRate: totalAbsenceRate / partyMembers.length,
        topCurrentStreak
      };
    })
    .sort((left, right) => {
      if (right.memberCount !== left.memberCount) {
        return right.memberCount - left.memberCount;
      }

      if (right.averageNegativeRate !== left.averageNegativeRate) {
        return right.averageNegativeRate - left.averageNegativeRate;
      }

      return left.party.localeCompare(right.party, "ko-KR");
    });
}
