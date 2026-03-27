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
  averageNegativeRate: number;
  averageAbsenceRate: number;
  topCurrentStreak: number;
};

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
