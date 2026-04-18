import {
  getEligibleRollCallIdsByMember,
  getEligibleVotingDatesByMember,
  type MemberTenureIndex
} from "./tenure.js";
import { sha256 } from "./utils.js";

import type {
  AccountabilitySummaryExport,
  AccountabilityTrendsExport,
  ConstituencyBoundariesIndexExport,
  CurrentAssembly,
  HexmapStaticIndexExport,
  LatestVotesExport,
  Manifest,
  MemberAssetsIndexExport,
  MemberPublicProfile,
  MemberActivityCalendarExport,
  MemberActivityCalendarMemberDetailExport,
  NormalizedBundle,
  VoteCode
} from "@lawmaker-monitor/schemas";

type BuildArtifactsInput = {
  bundle: NormalizedBundle;
  dataRepoBaseUrl: string;
  currentAssembly: CurrentAssembly;
  latestVotes?: LatestVotesExport;
  accountabilitySummary?: AccountabilitySummaryExport;
  accountabilityTrends?: AccountabilityTrendsExport;
  memberActivityCalendar?: MemberActivityCalendarExport;
  memberAssetsIndex?: MemberAssetsIndexExport;
  assetDisclosuresDataset?: {
    content: string;
    rowCount: number;
  };
  assetDisclosureRecordsDataset?: {
    content: string;
    rowCount: number;
  };
  assetDisclosureCategoriesDataset?: {
    content: string;
    rowCount: number;
  };
  assetDisclosureItemsDataset?: {
    content: string;
    rowCount: number;
  };
  constituencyBoundariesIndex?: ConstituencyBoundariesIndexExport;
  hexmapStaticIndex?: HexmapStaticIndexExport;
};

type ExportBuildOptions = {
  tenureIndex?: MemberTenureIndex;
};

type PublicVoteCode = Exclude<VoteCode, "absent">;
type MemberCentricVoteCode = Extract<
  VoteCode,
  "yes" | "no" | "abstain" | "absent"
>;
type PartyLineMajorityVoteCode = Exclude<MemberCentricVoteCode, "absent">;
type VoteHighlight = {
  memberId: string | null;
  memberName: string;
  party: string;
  photoUrl?: string | null;
  officialProfileUrl?: string | null;
  officialExternalUrl?: string | null;
  profile?: MemberPublicProfile;
  voteCode: VoteCode;
};
type LatestVoteCounts = {
  yes: number;
  no: number;
  abstain: number;
  absent: number;
  invalid: number;
  unknown: number;
};
type CalendarState = "yes" | "no" | "abstain" | "unknown" | "absent";
type DayBucket = {
  yesCount: number;
  noCount: number;
  abstainCount: number;
  absentCount: number;
  unknownCount: number;
};
type MemberVoteRecord = {
  rollCallId: string;
  billName: string;
  committeeName: string | null;
  voteDatetime: string;
  voteCode: MemberCentricVoteCode;
  officialSourceUrl: string | null;
};
type CommitteeSummary = {
  committeeName: string;
  eligibleRollCallCount: number;
  participatedRollCallCount: number;
  absentRollCallCount: number;
  participationRate: number;
  yesCount: number;
  noCount: number;
  abstainCount: number;
  isCurrentCommittee: boolean;
  recentVoteRecords: MemberVoteRecord[];
};
type HomeCommitteeAlert = {
  committeeName: string;
  participationRate: number;
  eligibleRollCallCount: number;
  participatedRollCallCount: number;
  message: string;
};
type WindowVoteCounts = {
  eligibleCount: number;
  noCount: number;
  abstainCount: number;
  absentCount: number;
  partyLineOpportunityCount: number;
  partyLineParticipationCount: number;
  partyLineDefectionCount: number;
};
type VoteFactLookup = Map<string, NormalizedBundle["voteFacts"][number]>;
type PartyLineMajority = {
  party: string;
  voteCode: PartyLineMajorityVoteCode;
  participantCount: number;
};
type WeekRange = {
  weekStart: string;
  weekEnd: string;
};
type AbsentListStatus = "verified" | "unavailable";
type RollCallVoteResolution = {
  counts: LatestVoteCounts;
  explicitCounts: LatestVoteCounts;
  absentListStatus?: AbsentListStatus;
  explicitAbsentMemberIds: Set<string>;
  verifiedDerivedAbsentMemberIds: Set<string>;
  missingEligibleMemberIds: Set<string>;
};

const highlightVoteOrder: PublicVoteCode[] = [
  "abstain",
  "no",
  "yes",
  "invalid",
  "unknown"
];
export const MEMBER_ACTIVITY_MEMBER_DETAILS_DIR =
  "exports/member_activity_calendar_members";
export const MAX_PUBLISHED_JSON_BYTES = 95 * 1024 * 1024;

type MemberActivityCalendarArtifacts = {
  memberActivityCalendar: MemberActivityCalendarExport;
  memberDetails: MemberActivityCalendarMemberDetailExport[];
};

export function buildMemberActivityCalendarMemberDetailPath(
  memberId: string
): string {
  return `${MEMBER_ACTIVITY_MEMBER_DETAILS_DIR}/${memberId}.json`;
}

export function serializePublishedJson(value: unknown): string {
  return JSON.stringify(value);
}

export function assertPublishedJsonFileSize(
  path: string,
  content: string,
  maxBytes = MAX_PUBLISHED_JSON_BYTES
): void {
  const contentBytes = Buffer.byteLength(content, "utf8");
  if (contentBytes <= maxBytes) {
    return;
  }

  const toMegabytes = (value: number): string =>
    (value / (1024 * 1024)).toFixed(2);
  throw new Error(
    `${path} is ${toMegabytes(contentBytes)} MB, exceeding the ${toMegabytes(maxBytes)} MB publish limit.`
  );
}

function toPublicVoteCode(voteCode: VoteCode): PublicVoteCode {
  return voteCode === "absent" ? "abstain" : voteCode;
}

function sortRollCallsByLatest(
  items: NormalizedBundle["rollCalls"]
): NormalizedBundle["rollCalls"] {
  return [...items].sort((left, right) => {
    const leftValue = left.voteDatetime;
    const rightValue = right.voteDatetime;
    return rightValue.localeCompare(leftValue);
  });
}

function toKoreanDateKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 10);
  }

  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Seoul"
  }).format(date);
}

function compareDateKeys(left: string, right: string): number {
  return left.localeCompare(right);
}

function parseDateKeyToUtc(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function formatUtcDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDaysToDateKey(value: string, amount: number): string {
  const date = parseDateKeyToUtc(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return formatUtcDateKey(date);
}

function getWeekStartKey(value: string): string {
  const date = parseDateKeyToUtc(value);
  const offsetFromMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offsetFromMonday);
  return formatUtcDateKey(date);
}

function buildRecentWeekRanges(
  votingDates: string[],
  limit: number
): WeekRange[] {
  if (votingDates.length === 0) {
    return [];
  }

  const latestWeekStart = getWeekStartKey(
    votingDates[votingDates.length - 1] ?? votingDates[0] ?? ""
  );
  return Array.from({ length: limit }, (_, index) => {
    const weekStart = addDaysToDateKey(
      latestWeekStart,
      (index - (limit - 1)) * 7
    );
    return {
      weekStart,
      weekEnd: addDaysToDateKey(weekStart, 6)
    };
  });
}

function createDayBucket(): DayBucket {
  return {
    yesCount: 0,
    noCount: 0,
    abstainCount: 0,
    absentCount: 0,
    unknownCount: 0
  };
}

function createLatestVoteCounts(): LatestVoteCounts {
  return {
    yes: 0,
    no: 0,
    abstain: 0,
    absent: 0,
    invalid: 0,
    unknown: 0
  };
}

function toCalendarBucketKey(voteCode: VoteCode): keyof DayBucket {
  switch (voteCode) {
    case "yes":
      return "yesCount";
    case "no":
      return "noCount";
    case "abstain":
      return "abstainCount";
    case "absent":
      return "absentCount";
    default:
      return "unknownCount";
  }
}

function createWindowVoteCounts(): WindowVoteCounts {
  return {
    eligibleCount: 0,
    noCount: 0,
    abstainCount: 0,
    absentCount: 0,
    partyLineOpportunityCount: 0,
    partyLineParticipationCount: 0,
    partyLineDefectionCount: 0
  };
}

function normalizeCommitteeName(
  value: string | null | undefined
): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized ? normalized : null;
}

function countExplicitVotes(
  votes: NormalizedBundle["voteFacts"]
): LatestVoteCounts {
  const counts = createLatestVoteCounts();

  for (const vote of votes) {
    if (vote.voteCode === "absent") {
      counts.absent += 1;
      continue;
    }

    counts[toPublicVoteCode(vote.voteCode)] += 1;
  }

  return counts;
}

function resolveRollCallVoteCounts(args: {
  rollCall: NormalizedBundle["rollCalls"][number];
  votes: NormalizedBundle["voteFacts"];
  eligibleCurrentMembers: NormalizedBundle["members"];
}): RollCallVoteResolution {
  const explicitCounts = countExplicitVotes(args.votes);
  const canDeriveAbsences =
    args.rollCall.voteVisibility === "recorded" ||
    args.rollCall.voteVisibility === "named";
  const recordedVoteMemberIds = new Set(
    args.votes
      .map((vote) => vote.memberId)
      .filter((memberId): memberId is string => Boolean(memberId))
  );
  const explicitAbsentMemberIds = new Set(
    args.votes
      .filter((vote) => vote.voteCode === "absent")
      .map((vote) => vote.memberId)
      .filter((memberId): memberId is string => Boolean(memberId))
  );
  const missingEligibleMemberIds = new Set(
    canDeriveAbsences
      ? args.eligibleCurrentMembers
          .filter((member) => !recordedVoteMemberIds.has(member.memberId))
          .map((member) => member.memberId)
      : []
  );
  const rowPresentCount =
    explicitCounts.yes +
    explicitCounts.no +
    explicitCounts.abstain +
    explicitCounts.invalid;
  const officialTally = args.rollCall.officialTally;
  const officialAbsentCount = officialTally
    ? Math.max(officialTally.registeredCount - officialTally.presentCount, 0)
    : null;
  let absentListStatus: AbsentListStatus | undefined;
  let verifiedDerivedAbsentMemberIds = new Set<string>();

  if (canDeriveAbsences) {
    if (officialTally) {
      const expectedDerivedAbsentCount = Math.max(
        (officialAbsentCount ?? 0) - explicitAbsentMemberIds.size,
        0
      );
      const presentMatches = rowPresentCount === officialTally.presentCount;
      const missingMatches =
        missingEligibleMemberIds.size === expectedDerivedAbsentCount;
      if (presentMatches && missingMatches) {
        absentListStatus = "verified";
        verifiedDerivedAbsentMemberIds = new Set(missingEligibleMemberIds);
      } else {
        absentListStatus = "unavailable";
      }
    } else {
      absentListStatus =
        missingEligibleMemberIds.size === 0 ? "verified" : "unavailable";
    }
  }

  const counts = officialTally
    ? {
        yes: officialTally.yesCount,
        no: officialTally.noCount,
        abstain: officialTally.abstainCount,
        absent: officialAbsentCount ?? 0,
        invalid: officialTally.invalidCount ?? 0,
        unknown: 0
      }
    : {
        ...explicitCounts,
        absent: explicitAbsentMemberIds.size
      };

  return {
    counts,
    explicitCounts,
    absentListStatus,
    explicitAbsentMemberIds,
    verifiedDerivedAbsentMemberIds,
    missingEligibleMemberIds
  };
}

function accumulateVoteCounts(
  target: WindowVoteCounts,
  voteCode?: VoteCode
): void {
  target.eligibleCount += 1;

  if (voteCode === "no") {
    target.noCount += 1;
    return;
  }

  if (voteCode === "abstain") {
    target.abstainCount += 1;
    return;
  }

  if (!voteCode || voteCode === "absent") {
    target.absentCount += 1;
  }
}

function resolveCalendarState(bucket: DayBucket): CalendarState {
  const rankedStates: Array<{
    state: CalendarState;
    count: number;
    priority: number;
  }> = [
    { state: "absent", count: bucket.absentCount, priority: 4 },
    { state: "no", count: bucket.noCount, priority: 3 },
    { state: "abstain", count: bucket.abstainCount, priority: 2 },
    { state: "yes", count: bucket.yesCount, priority: 1 }
  ];
  const bestMatch = rankedStates.reduce<{
    state: CalendarState;
    count: number;
    priority: number;
  } | null>((currentBest, candidate) => {
    if (candidate.count === 0) {
      return currentBest;
    }

    if (!currentBest) {
      return candidate;
    }

    if (candidate.count > currentBest.count) {
      return candidate;
    }

    if (
      candidate.count === currentBest.count &&
      candidate.priority > currentBest.priority
    ) {
      return candidate;
    }

    return currentBest;
  }, null);

  return bestMatch?.state ?? "unknown";
}

function isNegativeState(
  state: CalendarState,
  includeAbsent: boolean
): boolean {
  if (state === "no" || state === "abstain") {
    return true;
  }

  if (includeAbsent && state === "absent") {
    return true;
  }

  return false;
}

function calculateCurrentStreak(
  states: CalendarState[],
  includeAbsent: boolean
): number {
  let streak = 0;

  for (let index = states.length - 1; index >= 0; index -= 1) {
    if (!isNegativeState(states[index] ?? "unknown", includeAbsent)) {
      break;
    }

    streak += 1;
  }

  return streak;
}

function calculateLongestStreak(
  states: CalendarState[],
  includeAbsent: boolean
): number {
  let longest = 0;
  let current = 0;

  for (const state of states) {
    if (isNegativeState(state, includeAbsent)) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }

  return longest;
}

function resolvePublicAssembly(bundle: NormalizedBundle): {
  assemblyNo: number;
  assemblyLabel: string;
} {
  const assemblyNumbers = new Set<number>();

  for (const member of bundle.members) {
    assemblyNumbers.add(member.assemblyNo);
  }

  for (const rollCall of bundle.rollCalls) {
    assemblyNumbers.add(rollCall.assemblyNo);
  }

  if (assemblyNumbers.size !== 1) {
    throw new Error("Public exports must contain exactly one Assembly.");
  }

  const assemblyNo = [...assemblyNumbers][0];
  if (!assemblyNo) {
    throw new Error("Failed to resolve the current Assembly.");
  }

  return {
    assemblyNo,
    assemblyLabel: `제${assemblyNo}대 국회`
  };
}

function buildCurrentAssemblyMembers(
  bundle: NormalizedBundle,
  assemblyNo: number
) {
  return bundle.members.filter(
    (member) => member.assemblyNo === assemblyNo && member.isCurrentMember
  );
}

function getEligibleCurrentMembersForRollCall(args: {
  currentMembers: NormalizedBundle["members"];
  eligibleRollCallIdsByMember?: Map<string, Set<string>>;
  rollCallId: string;
}) {
  if (!args.eligibleRollCallIdsByMember) {
    return [];
  }

  return args.currentMembers.filter((member) =>
    args.eligibleRollCallIdsByMember?.get(member.memberId)?.has(args.rollCallId)
  );
}

function buildVoteFactLookupKey(rollCallId: string, memberId: string): string {
  return `${rollCallId}:${memberId}`;
}

function createVoteFactLookup(
  voteFacts: NormalizedBundle["voteFacts"],
  rollCallIds: Set<string>
): VoteFactLookup {
  const lookup: VoteFactLookup = new Map();

  for (const voteFact of voteFacts) {
    if (!rollCallIds.has(voteFact.rollCallId)) {
      continue;
    }

    if (!voteFact.memberId) {
      continue;
    }

    lookup.set(
      buildVoteFactLookupKey(voteFact.rollCallId, voteFact.memberId),
      voteFact
    );
  }

  return lookup;
}

function createVoteCodeLookup(
  voteFactLookup: VoteFactLookup
): Map<string, VoteCode> {
  const lookup = new Map<string, VoteCode>();

  for (const [key, voteFact] of voteFactLookup.entries()) {
    lookup.set(key, voteFact.voteCode);
  }

  return lookup;
}

function resolveVoteFactRecord(args: {
  rollCallId: string;
  memberId: string;
  voteFactLookup: VoteFactLookup;
}): NormalizedBundle["voteFacts"][number] | undefined {
  return args.voteFactLookup.get(
    buildVoteFactLookupKey(args.rollCallId, args.memberId)
  );
}

function normalizePartyLabel(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized ? normalized : null;
}

function resolveMemberPartyForRollCall(args: {
  rollCallId: string;
  member: NormalizedBundle["members"][number];
  voteFactLookup: VoteFactLookup;
}): string | null {
  const voteFact = resolveVoteFactRecord({
    rollCallId: args.rollCallId,
    memberId: args.member.memberId,
    voteFactLookup: args.voteFactLookup
  });

  return (
    normalizePartyLabel(voteFact?.party) ??
    normalizePartyLabel(args.member.party)
  );
}

function getMemberCentricEligibleCurrentMembersForRollCall(args: {
  currentMembers: NormalizedBundle["members"];
  eligibleRollCallIdsByMember?: Map<string, Set<string>>;
  rollCallId: string;
}): NormalizedBundle["members"] {
  if (!args.eligibleRollCallIdsByMember) {
    return args.currentMembers;
  }

  return args.currentMembers.filter((member) =>
    args.eligibleRollCallIdsByMember?.get(member.memberId)?.has(args.rollCallId)
  );
}

function resolveMemberCentricVoteCode(args: {
  rollCallId: string;
  memberId: string;
  voteCodeLookup: Map<string, VoteCode>;
}): MemberCentricVoteCode {
  const explicitVoteCode = args.voteCodeLookup.get(
    `${args.rollCallId}:${args.memberId}`
  );

  if (
    explicitVoteCode === "yes" ||
    explicitVoteCode === "no" ||
    explicitVoteCode === "abstain"
  ) {
    return explicitVoteCode;
  }

  return "absent";
}

function resolvePartyLineMajorityVoteCode(args: {
  yesCount: number;
  noCount: number;
  abstainCount: number;
}): PartyLineMajorityVoteCode | null {
  const participantCount = args.yesCount + args.noCount + args.abstainCount;
  if (participantCount < 2) {
    return null;
  }

  if (args.yesCount > participantCount / 2) {
    return "yes";
  }

  if (args.noCount > participantCount / 2) {
    return "no";
  }

  if (args.abstainCount > participantCount / 2) {
    return "abstain";
  }

  return null;
}

function buildPartyLineMajoritiesByRollCall(args: {
  currentMembers: NormalizedBundle["members"];
  eligibleRollCalls: NormalizedBundle["rollCalls"];
  voteCodeLookup: Map<string, VoteCode>;
  voteFactLookup: VoteFactLookup;
  eligibleRollCallIdsByMember?: Map<string, Set<string>>;
}): Map<string, Map<string, PartyLineMajority>> {
  const majoritiesByRollCall = new Map<
    string,
    Map<string, PartyLineMajority>
  >();

  for (const rollCall of args.eligibleRollCalls) {
    const eligibleMembers = getMemberCentricEligibleCurrentMembersForRollCall({
      currentMembers: args.currentMembers,
      eligibleRollCallIdsByMember: args.eligibleRollCallIdsByMember,
      rollCallId: rollCall.rollCallId
    });
    const partyCounts = new Map<
      string,
      { yesCount: number; noCount: number; abstainCount: number }
    >();

    for (const member of eligibleMembers) {
      const party = resolveMemberPartyForRollCall({
        rollCallId: rollCall.rollCallId,
        member,
        voteFactLookup: args.voteFactLookup
      });
      if (!party) {
        continue;
      }

      const voteCode = resolveMemberCentricVoteCode({
        rollCallId: rollCall.rollCallId,
        memberId: member.memberId,
        voteCodeLookup: args.voteCodeLookup
      });
      if (voteCode === "absent") {
        continue;
      }

      const currentCounts = partyCounts.get(party) ?? {
        yesCount: 0,
        noCount: 0,
        abstainCount: 0
      };
      if (voteCode === "yes") {
        currentCounts.yesCount += 1;
      } else if (voteCode === "no") {
        currentCounts.noCount += 1;
      } else {
        currentCounts.abstainCount += 1;
      }

      partyCounts.set(party, currentCounts);
    }

    const majorityByParty = new Map<string, PartyLineMajority>();
    for (const [party, counts] of partyCounts.entries()) {
      const voteCode = resolvePartyLineMajorityVoteCode(counts);
      if (!voteCode) {
        continue;
      }

      majorityByParty.set(party, {
        party,
        voteCode,
        participantCount: counts.yesCount + counts.noCount + counts.abstainCount
      });
    }

    majoritiesByRollCall.set(rollCall.rollCallId, majorityByParty);
  }

  return majoritiesByRollCall;
}

function accumulatePartyLineCounts(args: {
  target: Pick<
    WindowVoteCounts,
    | "partyLineOpportunityCount"
    | "partyLineParticipationCount"
    | "partyLineDefectionCount"
  >;
  majorityVoteCode: PartyLineMajorityVoteCode;
  voteCode: MemberCentricVoteCode;
}): void {
  args.target.partyLineOpportunityCount += 1;

  if (args.voteCode === "absent") {
    return;
  }

  args.target.partyLineParticipationCount += 1;
  if (args.voteCode !== args.majorityVoteCode) {
    args.target.partyLineDefectionCount += 1;
  }
}

function buildMemberVoteRecordsByMember(args: {
  currentMembers: NormalizedBundle["members"];
  assemblyRollCalls: NormalizedBundle["rollCalls"];
  voteCodeLookup: Map<string, VoteCode>;
  eligibleRollCallIdsByMember?: Map<string, Set<string>>;
}): Map<string, MemberVoteRecord[]> {
  const recordsByMember = new Map<string, MemberVoteRecord[]>();
  const allAssemblyRollCallIds = new Set(
    args.assemblyRollCalls.map((rollCall) => rollCall.rollCallId)
  );

  for (const member of args.currentMembers) {
    const eligibleRollCallIds =
      args.eligibleRollCallIdsByMember?.get(member.memberId) ??
      allAssemblyRollCallIds;
    const currentRecords: MemberVoteRecord[] = [];

    for (const rollCall of args.assemblyRollCalls) {
      if (!eligibleRollCallIds.has(rollCall.rollCallId)) {
        continue;
      }

      currentRecords.push({
        rollCallId: rollCall.rollCallId,
        billName: rollCall.billName,
        committeeName: rollCall.committeeName ?? null,
        voteDatetime: rollCall.voteDatetime,
        voteCode: resolveMemberCentricVoteCode({
          rollCallId: rollCall.rollCallId,
          memberId: member.memberId,
          voteCodeLookup: args.voteCodeLookup
        }),
        officialSourceUrl: rollCall.officialSourceUrl ?? null
      });
    }

    recordsByMember.set(member.memberId, currentRecords);
  }

  for (const records of recordsByMember.values()) {
    records.sort((left, right) =>
      right.voteDatetime.localeCompare(left.voteDatetime)
    );
  }

  return recordsByMember;
}

function buildCommitteeSummariesByMember(args: {
  currentMembers: NormalizedBundle["members"];
  assemblyRollCalls: NormalizedBundle["rollCalls"];
  voteCodeLookup: Map<string, VoteCode>;
  memberVoteRecordsByMember: Map<string, MemberVoteRecord[]>;
  eligibleRollCallIdsByMember?: Map<string, Set<string>>;
}): Map<string, CommitteeSummary[]> {
  const summariesByMember = new Map<string, CommitteeSummary[]>();

  for (const member of args.currentMembers) {
    const eligibleRollCallIds =
      args.eligibleRollCallIdsByMember?.get(member.memberId) ??
      new Set(args.assemblyRollCalls.map((rollCall) => rollCall.rollCallId));
    const summaryByCommittee = new Map<
      string,
      Omit<
        CommitteeSummary,
        "participationRate" | "isCurrentCommittee" | "recentVoteRecords"
      >
    >();

    for (const rollCall of args.assemblyRollCalls) {
      if (!eligibleRollCallIds.has(rollCall.rollCallId)) {
        continue;
      }

      const committeeName = normalizeCommitteeName(rollCall.committeeName);
      if (!committeeName) {
        continue;
      }

      const currentSummary = summaryByCommittee.get(committeeName) ?? {
        committeeName,
        eligibleRollCallCount: 0,
        participatedRollCallCount: 0,
        absentRollCallCount: 0,
        yesCount: 0,
        noCount: 0,
        abstainCount: 0
      };
      currentSummary.eligibleRollCallCount += 1;

      const voteCode = resolveMemberCentricVoteCode({
        rollCallId: rollCall.rollCallId,
        memberId: member.memberId,
        voteCodeLookup: args.voteCodeLookup
      });
      if (voteCode === "yes") {
        currentSummary.participatedRollCallCount += 1;
        currentSummary.yesCount += 1;
      } else if (voteCode === "no") {
        currentSummary.participatedRollCallCount += 1;
        currentSummary.noCount += 1;
      } else if (voteCode === "abstain") {
        currentSummary.participatedRollCallCount += 1;
        currentSummary.abstainCount += 1;
      } else {
        currentSummary.absentRollCallCount += 1;
      }

      summaryByCommittee.set(committeeName, currentSummary);
    }

    const currentCommittees = new Set(
      (member.committeeMemberships ?? [])
        .map((committeeName) => normalizeCommitteeName(committeeName))
        .filter((committeeName): committeeName is string =>
          Boolean(committeeName)
        )
    );
    const voteRecords =
      args.memberVoteRecordsByMember.get(member.memberId) ?? [];
    const summaries = [...summaryByCommittee.values()]
      .map((summary) => ({
        ...summary,
        participationRate:
          summary.eligibleRollCallCount === 0
            ? 0
            : summary.participatedRollCallCount / summary.eligibleRollCallCount,
        isCurrentCommittee: currentCommittees.has(summary.committeeName),
        recentVoteRecords: voteRecords
          .filter(
            (record) =>
              normalizeCommitteeName(record.committeeName) ===
              summary.committeeName
          )
          .slice(0, 3)
      }))
      .filter((summary) => summary.eligibleRollCallCount > 0)
      .sort((left, right) => {
        if (right.eligibleRollCallCount !== left.eligibleRollCallCount) {
          return right.eligibleRollCallCount - left.eligibleRollCallCount;
        }

        return left.committeeName.localeCompare(right.committeeName, "ko-KR");
      });

    summariesByMember.set(member.memberId, summaries);
  }

  return summariesByMember;
}

function buildHomeCommitteeAlerts(
  summaries: CommitteeSummary[]
): HomeCommitteeAlert[] {
  return summaries
    .filter(
      (summary) =>
        summary.isCurrentCommittee &&
        summary.eligibleRollCallCount >= 5 &&
        summary.participationRate < 0.5
    )
    .map((summary) => ({
      committeeName: summary.committeeName,
      participationRate: summary.participationRate,
      eligibleRollCallCount: summary.eligibleRollCallCount,
      participatedRollCallCount: summary.participatedRollCallCount,
      message: "현재 소속 위원회 표결 참여율이 낮습니다."
    }));
}

function toPublicMemberProfile(
  profile: NormalizedBundle["members"][number]["profile"]
): MemberPublicProfile | undefined {
  if (!profile) {
    return undefined;
  }

  return {
    nameHanja: profile.nameHanja ?? null,
    nameEnglish: profile.nameEnglish ?? null,
    birthType: profile.birthType ?? null,
    birthDate: profile.birthDate ?? null,
    roleName: profile.roleName ?? null,
    reelectionLabel: profile.reelectionLabel ?? null,
    electedAssembliesLabel: profile.electedAssembliesLabel ?? null,
    gender: profile.gender ?? null,
    representativeCommitteeName: profile.representativeCommitteeName ?? null,
    affiliatedCommitteeName: profile.affiliatedCommitteeName ?? null,
    briefHistory: profile.briefHistory ?? null,
    officeRoom: profile.officeRoom ?? null
  };
}

function buildPublicMemberMetadata(
  member: NormalizedBundle["members"][number] | undefined
): {
  photoUrl: string | null;
  officialProfileUrl: string | null;
  officialExternalUrl: string | null;
  profile?: MemberPublicProfile;
} {
  const publicProfile = toPublicMemberProfile(member?.profile);
  return {
    photoUrl: member?.photoUrl ?? null,
    officialProfileUrl: member?.officialProfileUrl ?? null,
    officialExternalUrl: member?.officialExternalUrl ?? null,
    ...(publicProfile ? { profile: publicProfile } : {})
  };
}

function buildLeanLatestVoteMemberMetadata(): Record<string, never> {
  return {};
}

export function buildLatestVotesExport(
  bundle: NormalizedBundle,
  options: ExportBuildOptions = {}
): LatestVotesExport {
  const { assemblyNo, assemblyLabel } = resolvePublicAssembly(bundle);
  const membersById = new Map(
    bundle.members.map((member) => [member.memberId, member])
  );
  const currentMembers = buildCurrentAssemblyMembers(bundle, assemblyNo);
  const eligibleRollCallIdsByMember = options.tenureIndex
    ? getEligibleRollCallIdsByMember({
        members: bundle.members,
        assemblyNo,
        rollCalls: bundle.rollCalls,
        tenureIndex: options.tenureIndex
      })
    : null;

  const items = sortRollCallsByLatest(bundle.rollCalls).map((rollCall) => {
    const votes = bundle.voteFacts.filter(
      (voteFact) => voteFact.rollCallId === rollCall.rollCallId
    );
    const eligibleCurrentMembers =
      rollCall.voteVisibility === "recorded" ||
      rollCall.voteVisibility === "named"
        ? getEligibleCurrentMembersForRollCall({
            currentMembers,
            eligibleRollCallIdsByMember:
              eligibleRollCallIdsByMember ?? undefined,
            rollCallId: rollCall.rollCallId
          })
        : [];
    const resolution = resolveRollCallVoteCounts({
      rollCall,
      votes,
      eligibleCurrentMembers
    });

    const highlightedVotes = votes
      .map((vote) => ({
        ...vote,
        publicVoteCode: toPublicVoteCode(vote.voteCode)
      }))
      .filter((vote) => vote.voteCode === "no" || vote.voteCode === "abstain")
      .sort(
        (left, right) =>
          highlightVoteOrder.indexOf(left.publicVoteCode) -
          highlightVoteOrder.indexOf(right.publicVoteCode)
      )
      .map((vote) => {
        const member = vote.memberId
          ? membersById.get(vote.memberId)
          : undefined;
        return {
          memberId: vote.memberId ?? null,
          memberName:
            member?.name ?? vote.memberName ?? vote.memberId ?? "이름 미상",
          party: member?.party ?? vote.party ?? "정당 미상",
          ...buildLeanLatestVoteMemberMetadata(),
          voteCode: vote.publicVoteCode
        };
      });

    const recordedAbsentVotes: VoteHighlight[] = votes
      .filter((vote) => vote.voteCode === "absent")
      .map((vote) => {
        const member = vote.memberId
          ? membersById.get(vote.memberId)
          : undefined;
        return {
          memberId: vote.memberId ?? null,
          memberName:
            member?.name ?? vote.memberName ?? vote.memberId ?? "이름 미상",
          party: member?.party ?? vote.party ?? "정당 미상",
          ...buildLeanLatestVoteMemberMetadata(),
          voteCode: "absent" as const
        };
      });
    const derivedAbsentVotes: VoteHighlight[] = eligibleCurrentMembers
      .filter((member) =>
        resolution.verifiedDerivedAbsentMemberIds.has(member.memberId)
      )
      .map((member) => ({
        memberId: member.memberId,
        memberName: member.name,
        party: member.party,
        ...buildLeanLatestVoteMemberMetadata(),
        voteCode: "absent" as const
      }));
    const absentVotes = [...recordedAbsentVotes, ...derivedAbsentVotes].sort(
      (left, right) => left.memberName.localeCompare(right.memberName, "ko-KR")
    );

    const updatedAt =
      votes
        .map((vote) => vote.publishedAt || vote.retrievedAt)
        .sort((left, right) => right.localeCompare(left))[0] ??
      rollCall.voteDatetime;

    return {
      rollCallId: rollCall.rollCallId,
      meetingId: rollCall.meetingId,
      agendaId: rollCall.agendaId,
      billName: rollCall.billName,
      committeeName: rollCall.committeeName,
      voteDatetime: rollCall.voteDatetime,
      voteVisibility: rollCall.voteVisibility,
      sourceStatus: rollCall.sourceStatus,
      counts: resolution.counts,
      highlightedVotes,
      absentVotes,
      absentListStatus: resolution.absentListStatus,
      officialTally: rollCall.officialTally,
      summary: rollCall.summary,
      officialSourceUrl: rollCall.officialSourceUrl,
      updatedAt,
      snapshotId: rollCall.snapshotId,
      sourceHash: rollCall.sourceHash
    };
  });

  const snapshotId =
    items[0]?.snapshotId ?? bundle.rollCalls[0]?.snapshotId ?? "unknown";

  return {
    generatedAt: new Date().toISOString(),
    snapshotId,
    assemblyNo,
    assemblyLabel,
    items
  };
}

export function buildAccountabilitySummaryExport(
  bundle: NormalizedBundle,
  options: ExportBuildOptions = {}
): AccountabilitySummaryExport {
  const { assemblyNo, assemblyLabel } = resolvePublicAssembly(bundle);
  const currentMembers = buildCurrentAssemblyMembers(bundle, assemblyNo);
  const currentMemberIds = new Set(
    currentMembers.map((member) => member.memberId)
  );
  const eligibleRollCalls = bundle.rollCalls.filter(
    (rollCall) =>
      rollCall.assemblyNo === assemblyNo &&
      (rollCall.voteVisibility === "recorded" ||
        rollCall.voteVisibility === "named")
  );
  const eligibleRollCallIdsByMember = options.tenureIndex
    ? getEligibleRollCallIdsByMember({
        members: bundle.members,
        assemblyNo,
        rollCalls: eligibleRollCalls,
        tenureIndex: options.tenureIndex
      })
    : null;
  const allEligibleRollCallIds = new Set(
    eligibleRollCalls.map((rollCall) => rollCall.rollCallId)
  );
  const voteFactLookup = createVoteFactLookup(
    bundle.voteFacts,
    allEligibleRollCallIds
  );
  const voteCodeLookup = createVoteCodeLookup(voteFactLookup);
  const partyLineMajoritiesByRollCall = buildPartyLineMajoritiesByRollCall({
    currentMembers,
    eligibleRollCalls,
    voteCodeLookup,
    voteFactLookup,
    eligibleRollCallIdsByMember: eligibleRollCallIdsByMember ?? undefined
  });
  const latestVoteAtByMember = new Map<string, string>();

  for (const voteFact of bundle.voteFacts) {
    if (!voteFact.memberId) {
      continue;
    }

    if (!allEligibleRollCallIds.has(voteFact.rollCallId)) {
      continue;
    }

    if (
      eligibleRollCallIdsByMember &&
      !eligibleRollCallIdsByMember
        .get(voteFact.memberId)
        ?.has(voteFact.rollCallId)
    ) {
      continue;
    }

    const currentLatest = latestVoteAtByMember.get(voteFact.memberId);
    if (
      !currentLatest ||
      voteFact.publishedAt.localeCompare(currentLatest) > 0
    ) {
      latestVoteAtByMember.set(voteFact.memberId, voteFact.publishedAt);
    }
  }

  const items = bundle.members
    .filter((member) => currentMemberIds.has(member.memberId))
    .map((member) => {
      const eligibleRollCallIds =
        eligibleRollCallIdsByMember?.get(member.memberId) ??
        allEligibleRollCallIds;
      let noCount = 0;
      let abstainCount = 0;
      let absentCount = 0;
      let partyLineOpportunityCount = 0;
      let partyLineParticipationCount = 0;
      let partyLineDefectionCount = 0;

      for (const rollCallId of eligibleRollCallIds) {
        const voteCode = resolveMemberCentricVoteCode({
          rollCallId,
          memberId: member.memberId,
          voteCodeLookup
        });

        if (voteCode === "no") {
          noCount += 1;
        } else if (voteCode === "abstain") {
          abstainCount += 1;
        } else if (voteCode === "absent") {
          absentCount += 1;
        }

        const party = resolveMemberPartyForRollCall({
          rollCallId,
          member,
          voteFactLookup
        });
        const partyMajority = party
          ? partyLineMajoritiesByRollCall.get(rollCallId)?.get(party)
          : undefined;
        if (partyMajority) {
          partyLineOpportunityCount += 1;
          if (voteCode !== "absent") {
            partyLineParticipationCount += 1;
            if (voteCode !== partyMajority.voteCode) {
              partyLineDefectionCount += 1;
            }
          }
        }
      }

      const denominator = eligibleRollCallIds.size || 1;

      return {
        memberId: member.memberId,
        name: member.name,
        party: member.party,
        district: member.district ?? null,
        ...buildPublicMemberMetadata(member),
        assemblyNo: member.assemblyNo,
        totalRecordedVotes: eligibleRollCallIds.size,
        noCount,
        abstainCount,
        absentCount,
        noRate: noCount / denominator,
        abstainRate: abstainCount / denominator,
        absentRate: absentCount / denominator,
        partyLineOpportunityCount,
        partyLineParticipationCount,
        partyLineDefectionCount,
        partyLineDefectionRate:
          partyLineParticipationCount > 0
            ? partyLineDefectionCount / partyLineParticipationCount
            : 0,
        lastVoteAt: latestVoteAtByMember.get(member.memberId) ?? null
      };
    })
    .filter(
      (item) =>
        item.totalRecordedVotes > 0 ||
        item.noCount > 0 ||
        item.abstainCount > 0 ||
        item.absentCount > 0
    )
    .sort((left, right) => {
      const rightNegativeCount =
        right.noCount + right.abstainCount + right.absentCount;
      const leftNegativeCount =
        left.noCount + left.abstainCount + left.absentCount;
      if (rightNegativeCount !== leftNegativeCount) {
        return rightNegativeCount - leftNegativeCount;
      }

      if (right.absentCount !== left.absentCount) {
        return right.absentCount - left.absentCount;
      }

      if (right.noCount !== left.noCount) {
        return right.noCount - left.noCount;
      }

      if (right.abstainCount !== left.abstainCount) {
        return right.abstainCount - left.abstainCount;
      }

      const rightNegativeRate =
        right.noRate + right.abstainRate + right.absentRate;
      const leftNegativeRate = left.noRate + left.abstainRate + left.absentRate;
      if (rightNegativeRate !== leftNegativeRate) {
        return rightNegativeRate - leftNegativeRate;
      }

      return left.name.localeCompare(right.name, "ko-KR");
    });

  const snapshotId = bundle.rollCalls[0]?.snapshotId ?? "unknown";

  return {
    generatedAt: new Date().toISOString(),
    snapshotId,
    assemblyNo,
    assemblyLabel,
    items
  };
}

export function buildAccountabilityTrendsExport(
  bundle: NormalizedBundle,
  options: ExportBuildOptions = {}
): AccountabilityTrendsExport {
  const { assemblyNo, assemblyLabel } = resolvePublicAssembly(bundle);
  const currentMembers = buildCurrentAssemblyMembers(bundle, assemblyNo);
  const eligibleRollCalls = bundle.rollCalls.filter(
    (rollCall) =>
      rollCall.assemblyNo === assemblyNo &&
      (rollCall.voteVisibility === "recorded" ||
        rollCall.voteVisibility === "named")
  );
  const votingDates = [
    ...new Set(
      eligibleRollCalls.map((rollCall) =>
        toKoreanDateKey(rollCall.voteDatetime)
      )
    )
  ].sort(compareDateKeys);
  const weekRanges = buildRecentWeekRanges(votingDates, 12);
  const weekByStart = new Map(
    weekRanges.map((range) => [
      range.weekStart,
      {
        ...range,
        yesCount: 0,
        noCount: 0,
        abstainCount: 0,
        absentCount: 0,
        eligibleVoteCount: 0,
        partyLineOpportunityCount: 0,
        partyLineParticipationCount: 0,
        partyLineDefectionCount: 0
      }
    ])
  );
  const eligibleRollCallIdsByMember = options.tenureIndex
    ? getEligibleRollCallIdsByMember({
        members: bundle.members,
        assemblyNo,
        rollCalls: eligibleRollCalls,
        tenureIndex: options.tenureIndex
      })
    : null;
  const eligibleRollCallIds = new Set(
    eligibleRollCalls.map((rollCall) => rollCall.rollCallId)
  );
  const voteFactLookup = createVoteFactLookup(
    bundle.voteFacts,
    eligibleRollCallIds
  );
  const voteCodeLookup = createVoteCodeLookup(voteFactLookup);
  const partyLineMajoritiesByRollCall = buildPartyLineMajoritiesByRollCall({
    currentMembers,
    eligibleRollCalls,
    voteCodeLookup,
    voteFactLookup,
    eligibleRollCallIdsByMember: eligibleRollCallIdsByMember ?? undefined
  });
  const relevantWeeks = weekRanges.slice(-8);
  const previousWindowStarts = new Set(
    relevantWeeks.slice(0, 4).map((range) => range.weekStart)
  );
  const currentWindowStarts = new Set(
    relevantWeeks.slice(4).map((range) => range.weekStart)
  );
  const moversByMember = new Map(
    currentMembers.map((member) => [
      member.memberId,
      {
        memberId: member.memberId,
        name: member.name,
        party: member.party,
        photoUrl: member.photoUrl ?? null,
        officialProfileUrl: member.officialProfileUrl ?? null,
        previous: createWindowVoteCounts(),
        current: createWindowVoteCounts()
      }
    ])
  );

  for (const rollCall of eligibleRollCalls) {
    const weekStart = getWeekStartKey(toKoreanDateKey(rollCall.voteDatetime));
    const weeklyTrend = weekByStart.get(weekStart);
    const isPreviousWindow = previousWindowStarts.has(weekStart);
    const isCurrentWindow = currentWindowStarts.has(weekStart);
    const eligibleMembers = getMemberCentricEligibleCurrentMembersForRollCall({
      currentMembers,
      eligibleRollCallIdsByMember: eligibleRollCallIdsByMember ?? undefined,
      rollCallId: rollCall.rollCallId
    });

    for (const member of eligibleMembers) {
      const voteCode = resolveMemberCentricVoteCode({
        rollCallId: rollCall.rollCallId,
        memberId: member.memberId,
        voteCodeLookup
      });
      const party = resolveMemberPartyForRollCall({
        rollCallId: rollCall.rollCallId,
        member,
        voteFactLookup
      });
      const partyMajority = party
        ? partyLineMajoritiesByRollCall.get(rollCall.rollCallId)?.get(party)
        : undefined;
      if (weeklyTrend) {
        weeklyTrend.eligibleVoteCount += 1;
        if (voteCode === "yes") {
          weeklyTrend.yesCount += 1;
        } else if (voteCode === "no") {
          weeklyTrend.noCount += 1;
        } else if (voteCode === "abstain") {
          weeklyTrend.abstainCount += 1;
        } else if (voteCode === "absent") {
          weeklyTrend.absentCount += 1;
        }
        if (partyMajority) {
          accumulatePartyLineCounts({
            target: weeklyTrend,
            majorityVoteCode: partyMajority.voteCode,
            voteCode
          });
        }
      }

      const mover = moversByMember.get(member.memberId);
      if (!mover) {
        continue;
      }

      if (isPreviousWindow) {
        accumulateVoteCounts(mover.previous, voteCode);
        if (partyMajority) {
          accumulatePartyLineCounts({
            target: mover.previous,
            majorityVoteCode: partyMajority.voteCode,
            voteCode
          });
        }
      } else if (isCurrentWindow) {
        accumulateVoteCounts(mover.current, voteCode);
        if (partyMajority) {
          accumulatePartyLineCounts({
            target: mover.current,
            majorityVoteCode: partyMajority.voteCode,
            voteCode
          });
        }
      }
    }
  }

  const snapshotId = bundle.rollCalls[0]?.snapshotId ?? "unknown";

  return {
    generatedAt: new Date().toISOString(),
    snapshotId,
    assemblyNo,
    assemblyLabel,
    weeks: weekRanges.map(
      (range) =>
        weekByStart.get(range.weekStart) ?? {
          ...range,
          yesCount: 0,
          noCount: 0,
          abstainCount: 0,
          absentCount: 0,
          eligibleVoteCount: 0,
          partyLineOpportunityCount: 0,
          partyLineParticipationCount: 0,
          partyLineDefectionCount: 0
        }
    ),
    movers: currentMembers
      .map((member) => {
        const mover = moversByMember.get(member.memberId);
        return {
          memberId: member.memberId,
          name: member.name,
          party: member.party,
          photoUrl: member.photoUrl ?? null,
          officialProfileUrl: member.officialProfileUrl ?? null,
          ...(toPublicMemberProfile(member.profile)
            ? { profile: toPublicMemberProfile(member.profile) }
            : {}),
          previousWindowEligibleCount: mover?.previous.eligibleCount ?? 0,
          previousWindowNoCount: mover?.previous.noCount ?? 0,
          previousWindowAbstainCount: mover?.previous.abstainCount ?? 0,
          previousWindowAbsentCount: mover?.previous.absentCount ?? 0,
          previousWindowPartyLineOpportunityCount:
            mover?.previous.partyLineOpportunityCount ?? 0,
          previousWindowPartyLineParticipationCount:
            mover?.previous.partyLineParticipationCount ?? 0,
          previousWindowPartyLineDefectionCount:
            mover?.previous.partyLineDefectionCount ?? 0,
          currentWindowEligibleCount: mover?.current.eligibleCount ?? 0,
          currentWindowNoCount: mover?.current.noCount ?? 0,
          currentWindowAbstainCount: mover?.current.abstainCount ?? 0,
          currentWindowAbsentCount: mover?.current.absentCount ?? 0,
          currentWindowPartyLineOpportunityCount:
            mover?.current.partyLineOpportunityCount ?? 0,
          currentWindowPartyLineParticipationCount:
            mover?.current.partyLineParticipationCount ?? 0,
          currentWindowPartyLineDefectionCount:
            mover?.current.partyLineDefectionCount ?? 0
        };
      })
      .filter(
        (member) =>
          member.previousWindowEligibleCount > 0 ||
          member.currentWindowEligibleCount > 0
      )
  };
}

export function buildMemberActivityCalendarArtifacts(
  bundle: NormalizedBundle,
  options: ExportBuildOptions = {}
): MemberActivityCalendarArtifacts {
  const { assemblyNo, assemblyLabel } = resolvePublicAssembly(bundle);
  const eligibleRollCalls = bundle.rollCalls.filter(
    (rollCall) =>
      rollCall.voteVisibility === "recorded" ||
      rollCall.voteVisibility === "named"
  );
  const assemblyRollCalls = eligibleRollCalls.filter(
    (rollCall) => rollCall.assemblyNo === assemblyNo
  );
  const votingDates = [
    ...new Set(
      assemblyRollCalls.map((rollCall) =>
        toKoreanDateKey(rollCall.voteDatetime)
      )
    )
  ].sort(compareDateKeys);
  const currentMembers = buildCurrentAssemblyMembers(bundle, assemblyNo);
  const membersById = new Map(
    currentMembers.map((member) => [member.memberId, member])
  );
  const assemblyRollCallIds = new Set(
    assemblyRollCalls.map((rollCall) => rollCall.rollCallId)
  );
  const eligibleDatesByMember = options.tenureIndex
    ? getEligibleVotingDatesByMember({
        members: bundle.members,
        assemblyNo,
        votingDates,
        tenureIndex: options.tenureIndex
      })
    : null;
  const eligibleRollCallIdsByMember = options.tenureIndex
    ? getEligibleRollCallIdsByMember({
        members: bundle.members,
        assemblyNo,
        rollCalls: assemblyRollCalls,
        tenureIndex: options.tenureIndex
      })
    : null;
  const voteFactLookup = createVoteFactLookup(
    bundle.voteFacts,
    assemblyRollCallIds
  );
  const voteCodeLookup = createVoteCodeLookup(voteFactLookup);
  const memberVoteRecordsByMember = buildMemberVoteRecordsByMember({
    currentMembers,
    assemblyRollCalls,
    voteCodeLookup,
    eligibleRollCallIdsByMember: eligibleRollCallIdsByMember ?? undefined
  });
  const committeeSummariesByMember = buildCommitteeSummariesByMember({
    currentMembers,
    assemblyRollCalls,
    voteCodeLookup,
    memberVoteRecordsByMember,
    eligibleRollCallIdsByMember: eligibleRollCallIdsByMember ?? undefined
  });
  const bucketsByMember = new Map<string, Map<string, DayBucket>>();
  const snapshotId = bundle.rollCalls[0]?.snapshotId ?? "unknown";
  const generatedAt = new Date().toISOString();

  for (const member of currentMembers) {
    const eligibleRollCallIds =
      eligibleRollCallIdsByMember?.get(member.memberId) ?? assemblyRollCallIds;
    const memberBuckets = new Map<string, DayBucket>();

    for (const rollCall of assemblyRollCalls) {
      if (!eligibleRollCallIds.has(rollCall.rollCallId)) {
        continue;
      }

      const dayKey = toKoreanDateKey(rollCall.voteDatetime);
      const bucket = memberBuckets.get(dayKey) ?? createDayBucket();
      const voteCode = resolveMemberCentricVoteCode({
        rollCallId: rollCall.rollCallId,
        memberId: member.memberId,
        voteCodeLookup
      });
      bucket[toCalendarBucketKey(voteCode)] += 1;
      memberBuckets.set(dayKey, bucket);
    }

    bucketsByMember.set(member.memberId, memberBuckets);
  }

  const memberDetails: MemberActivityCalendarMemberDetailExport[] = [];
  const members = [...membersById.values()]
    .map((member) => {
      const dayBuckets =
        bucketsByMember.get(member.memberId) ?? new Map<string, DayBucket>();
      const voteRecords = memberVoteRecordsByMember.get(member.memberId) ?? [];
      const dayStates = [...dayBuckets.entries()]
        .sort(([left], [right]) => compareDateKeys(left, right))
        .map(([date, bucket]) => ({
          date,
          yesCount: bucket.yesCount,
          noCount: bucket.noCount,
          abstainCount: bucket.abstainCount,
          absentCount: bucket.absentCount,
          unknownCount: bucket.unknownCount,
          totalRollCalls:
            bucket.yesCount +
            bucket.noCount +
            bucket.abstainCount +
            bucket.absentCount +
            bucket.unknownCount,
          state: resolveCalendarState(bucket)
        }));

      const eligibleDates =
        eligibleDatesByMember?.get(member.memberId) ?? new Set(votingDates);
      const normalizedDayStates = dayStates;
      const stateByDate = new Map(
        normalizedDayStates.map((dayState) => [dayState.date, dayState.state])
      );
      const sequence = [...eligibleDates]
        .sort(compareDateKeys)
        .map((date) => stateByDate.get(date) ?? "absent");
      const negativeDays = sequence.filter(
        (state) => state === "no" || state === "abstain"
      ).length;
      const absentDays = sequence.filter((state) => state === "absent").length;
      const committeeSummaries =
        committeeSummariesByMember.get(member.memberId) ?? [];
      memberDetails.push({
        generatedAt,
        snapshotId,
        assemblyNo,
        assemblyLabel,
        memberId: member.memberId,
        voteRecords
      });

      return {
        memberId: member.memberId,
        name: member.name,
        party: member.party,
        committeeMemberships: member.committeeMemberships ?? [],
        ...buildPublicMemberMetadata(member),
        currentNegativeStreak: calculateCurrentStreak(sequence, false),
        currentNegativeOrAbsentStreak: calculateCurrentStreak(sequence, true),
        longestNegativeStreak: calculateLongestStreak(sequence, false),
        longestNegativeOrAbsentStreak: calculateLongestStreak(sequence, true),
        negativeDays,
        absentDays,
        committeeSummaries,
        homeCommitteeAlerts: buildHomeCommitteeAlerts(committeeSummaries),
        dayStates: normalizedDayStates,
        voteRecordCount: voteRecords.length,
        voteRecordsPath: buildMemberActivityCalendarMemberDetailPath(
          member.memberId
        ),
        voteRecords: []
      };
    })
    .sort((left, right) => {
      if (right.currentNegativeStreak !== left.currentNegativeStreak) {
        return right.currentNegativeStreak - left.currentNegativeStreak;
      }

      if (right.negativeDays !== left.negativeDays) {
        return right.negativeDays - left.negativeDays;
      }

      return left.name.localeCompare(right.name, "ko-KR");
    });
  return {
    memberActivityCalendar: {
      generatedAt,
      snapshotId,
      assemblyNo,
      assemblyLabel,
      assembly: {
        assemblyNo,
        label: assemblyLabel,
        startDate: votingDates[0] ?? "",
        endDate: votingDates[votingDates.length - 1] ?? "",
        votingDates,
        members
      }
    },
    memberDetails: memberDetails.sort((left, right) =>
      left.memberId.localeCompare(right.memberId, "ko-KR")
    )
  };
}

export function buildMemberActivityCalendarExport(
  bundle: NormalizedBundle,
  options: ExportBuildOptions = {}
): MemberActivityCalendarExport {
  return buildMemberActivityCalendarArtifacts(bundle, options)
    .memberActivityCalendar;
}

export function buildMemberActivityCalendarMemberDetailExports(
  bundle: NormalizedBundle,
  options: ExportBuildOptions = {}
): MemberActivityCalendarMemberDetailExport[] {
  return buildMemberActivityCalendarArtifacts(bundle, options).memberDetails;
}

export function buildManifest(input: BuildArtifactsInput): Manifest {
  const { bundle, dataRepoBaseUrl, currentAssembly } = input;
  const latestVotes = input.latestVotes ?? buildLatestVotesExport(bundle);
  const accountabilitySummary =
    input.accountabilitySummary ?? buildAccountabilitySummaryExport(bundle);
  const accountabilityTrends =
    input.accountabilityTrends ?? buildAccountabilityTrendsExport(bundle);
  const memberActivityCalendar =
    input.memberActivityCalendar ?? buildMemberActivityCalendarExport(bundle);
  const memberAssetsIndex = input.memberAssetsIndex;
  const constituencyBoundariesIndex = input.constituencyBoundariesIndex;
  const hexmapStaticIndex = input.hexmapStaticIndex;
  const normalizedPayloads = {
    members: toNdjson(bundle.members),
    rollCalls: toNdjson(bundle.rollCalls),
    voteFacts: toNdjson(bundle.voteFacts),
    meetings: toNdjson(bundle.meetings),
    sources: toNdjson(bundle.sources)
  };

  const createDatasetFile = (
    path: string,
    content: string,
    rowCount?: number
  ) => ({
    path,
    url: new URL(path, `${dataRepoBaseUrl.replace(/\/$/, "")}/`).toString(),
    checksumSha256: sha256(content),
    rowCount
  });
  const createPublishedExportFile = (
    path: string,
    payload: unknown,
    rowCount?: number
  ) => createDatasetFile(path, serializePublishedJson(payload), rowCount);

  return {
    schemaVersion: "v1",
    snapshotId: latestVotes.snapshotId,
    updatedAt: latestVotes.generatedAt,
    dataRepoBaseUrl,
    currentAssembly,
    datasets: {
      members: createDatasetFile(
        "curated/members.parquet",
        normalizedPayloads.members,
        bundle.members.length
      ),
      rollCalls: createDatasetFile(
        "curated/roll_calls.parquet",
        normalizedPayloads.rollCalls,
        bundle.rollCalls.length
      ),
      voteFacts: createDatasetFile(
        "curated/vote_facts.parquet",
        normalizedPayloads.voteFacts,
        bundle.voteFacts.length
      ),
      meetings: createDatasetFile(
        "curated/meetings.parquet",
        normalizedPayloads.meetings,
        bundle.meetings.length
      ),
      sources: createDatasetFile(
        "curated/sources.parquet",
        normalizedPayloads.sources,
        bundle.sources.length
      ),
      ...(input.assetDisclosuresDataset
        ? {
            assetDisclosures: createDatasetFile(
              "curated/asset_disclosures.parquet",
              input.assetDisclosuresDataset.content,
              input.assetDisclosuresDataset.rowCount
            )
          }
        : {}),
      ...(input.assetDisclosureRecordsDataset
        ? {
            assetDisclosureRecords: createDatasetFile(
              "curated/asset_disclosure_records.parquet",
              input.assetDisclosureRecordsDataset.content,
              input.assetDisclosureRecordsDataset.rowCount
            )
          }
        : {}),
      ...(input.assetDisclosureCategoriesDataset
        ? {
            assetDisclosureCategories: createDatasetFile(
              "curated/asset_disclosure_categories.parquet",
              input.assetDisclosureCategoriesDataset.content,
              input.assetDisclosureCategoriesDataset.rowCount
            )
          }
        : {}),
      ...(input.assetDisclosureItemsDataset
        ? {
            assetDisclosureItems: createDatasetFile(
              "curated/asset_disclosure_items.parquet",
              input.assetDisclosureItemsDataset.content,
              input.assetDisclosureItemsDataset.rowCount
            )
          }
        : {})
    },
    exports: {
      latestVotes: createPublishedExportFile(
        "exports/latest_votes.json",
        latestVotes,
        latestVotes.items.length
      ),
      accountabilitySummary: createPublishedExportFile(
        "exports/accountability_summary.json",
        accountabilitySummary,
        accountabilitySummary.items.length
      ),
      accountabilityTrends: createPublishedExportFile(
        "exports/accountability_trends.json",
        accountabilityTrends,
        accountabilityTrends.movers.length
      ),
      memberActivityCalendar: createPublishedExportFile(
        "exports/member_activity_calendar.json",
        memberActivityCalendar,
        memberActivityCalendar.assembly.members.length
      ),
      ...(memberAssetsIndex
        ? {
            memberAssetsIndex: createPublishedExportFile(
              "exports/member_assets_index.json",
              memberAssetsIndex,
              memberAssetsIndex.members.length
            )
          }
        : {}),
      ...(constituencyBoundariesIndex
        ? {
            constituencyBoundariesIndex: createPublishedExportFile(
              "exports/constituency_boundaries/index.json",
              constituencyBoundariesIndex,
              constituencyBoundariesIndex.provinces.length
            )
          }
        : {}),
      ...(hexmapStaticIndex
        ? {
            hexmapStaticIndex: createPublishedExportFile(
              "exports/hexmap_static/index.json",
              hexmapStaticIndex,
              hexmapStaticIndex.provinces.length
            )
          }
        : {})
    }
  };
}

export function toNdjson(items: unknown[]): string {
  return items.map((item) => JSON.stringify(item)).join("\n");
}
