import type { MemberRecord } from "@lawmaker-monitor/schemas";

export type MemberTenureRecord = {
  memberId: string;
  name: string;
  assemblyNo: number;
  unitCd?: string;
  startDate: string;
  endDate: string | null;
};

export type MemberTenurePeriod = {
  startDate: string;
  endDate: string | null;
};

export type MemberTenureIndex = Map<string, MemberTenurePeriod[]>;

function isDateWithinPeriod(date: string, period: MemberTenurePeriod): boolean {
  if (date.localeCompare(period.startDate) < 0) {
    return false;
  }

  if (period.endDate && date.localeCompare(period.endDate) > 0) {
    return false;
  }

  return true;
}

function getTenureCandidates(
  currentMembers: MemberRecord[],
  tenure: MemberTenureRecord
): MemberRecord[] {
  const exactMatches = currentMembers.filter(
    (member) =>
      member.memberId === tenure.memberId &&
      member.assemblyNo === tenure.assemblyNo
  );
  if (exactMatches.length > 0) {
    return exactMatches;
  }

  return currentMembers.filter(
    (member) =>
      member.name === tenure.name && member.assemblyNo === tenure.assemblyNo
  );
}

export function buildMemberTenureIndex(args: {
  members: MemberRecord[];
  tenures: MemberTenureRecord[];
  assemblyNo: number;
}): MemberTenureIndex {
  const currentMembers = args.members.filter(
    (member) => member.assemblyNo === args.assemblyNo && member.isCurrentMember
  );
  const index: MemberTenureIndex = new Map();

  for (const tenure of args.tenures) {
    if (tenure.assemblyNo !== args.assemblyNo) {
      continue;
    }

    const candidates = getTenureCandidates(currentMembers, tenure);
    if (candidates.length !== 1) {
      continue;
    }

    const targetMember = candidates[0];
    if (!targetMember) {
      continue;
    }

    const periods = index.get(targetMember.memberId) ?? [];
    periods.push({
      startDate: tenure.startDate,
      endDate: tenure.endDate
    });
    index.set(targetMember.memberId, periods);
  }

  return index;
}

export function getEligibleRollCallIdsByMember(args: {
  members: MemberRecord[];
  assemblyNo: number;
  rollCalls: Array<{
    rollCallId: string;
    voteDatetime: string;
    assemblyNo: number;
  }>;
  tenureIndex: MemberTenureIndex;
}): Map<string, Set<string>> {
  const eligibleRollCallsByMember = new Map<string, Set<string>>();

  for (const member of args.members) {
    if (member.assemblyNo !== args.assemblyNo || !member.isCurrentMember) {
      continue;
    }

    const periods = args.tenureIndex.get(member.memberId) ?? [];
    const eligible = new Set<string>();

    for (const rollCall of args.rollCalls) {
      if (rollCall.assemblyNo !== args.assemblyNo) {
        continue;
      }

      const date = rollCall.voteDatetime.slice(0, 10);
      if (periods.some((period) => isDateWithinPeriod(date, period))) {
        eligible.add(rollCall.rollCallId);
      }
    }

    eligibleRollCallsByMember.set(member.memberId, eligible);
  }

  return eligibleRollCallsByMember;
}

export function getEligibleVotingDatesByMember(args: {
  members: MemberRecord[];
  assemblyNo: number;
  votingDates: string[];
  tenureIndex: MemberTenureIndex;
}): Map<string, Set<string>> {
  const eligibleDatesByMember = new Map<string, Set<string>>();

  for (const member of args.members) {
    if (member.assemblyNo !== args.assemblyNo || !member.isCurrentMember) {
      continue;
    }

    const periods = args.tenureIndex.get(member.memberId) ?? [];
    const eligibleDates = new Set<string>();

    for (const votingDate of args.votingDates) {
      if (periods.some((period) => isDateWithinPeriod(votingDate, period))) {
        eligibleDates.add(votingDate);
      }
    }

    eligibleDatesByMember.set(member.memberId, eligibleDates);
  }

  return eligibleDatesByMember;
}

export function assertCurrentMembersHaveTenure(args: {
  members: MemberRecord[];
  assemblyNo: number;
  tenureIndex: MemberTenureIndex;
}): void {
  const missingMembers = getCurrentMembersMissingTenure(args).map(
    (member) => member.name
  );

  if (missingMembers.length > 0) {
    throw new Error(
      `Current members are missing tenure history: ${missingMembers.slice(0, 10).join(", ")}`
    );
  }
}

export function getCurrentMembersMissingTenure(args: {
  members: MemberRecord[];
  assemblyNo: number;
  tenureIndex: MemberTenureIndex;
}): MemberRecord[] {
  return args.members
    .filter(
      (member) =>
        member.assemblyNo === args.assemblyNo && member.isCurrentMember
    )
    .filter((member) => !args.tenureIndex.get(member.memberId)?.length);
}
