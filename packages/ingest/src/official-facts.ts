import { parseLikmsVoteInfoHtml } from "./likms-votes.js";
import {
  buildMeetingId,
  createSourceRecord,
  normalizeComparableText
} from "./parsers/helpers.js";
import { sha256 } from "./utils.js";

import type {
  CommitteeCareerRecord,
  OfficialMinutesAttendanceMeeting
} from "./official-attendance.js";
import type { BillVoteSummaryRecord } from "./parsers.js";
import type { RawSnapshotEntry } from "./raw-snapshot.js";
import type { MemberTenureIndex } from "./tenure.js";
import type {
  AttendanceFactRecord,
  MemberRecord,
  RollCallRecord,
  SourceRecord,
  VoteCode,
  VoteFactRecord
} from "@lawmaker-monitor/schemas";

type VoteMemberListPayload = {
  entry: RawSnapshotEntry;
  html: string;
};

type OfficialVoteMergeResult = {
  rollCalls: RollCallRecord[];
  voteFacts: VoteFactRecord[];
  sources: SourceRecord[];
};

const namedVoteCodes = new Set<VoteCode>(["yes", "no", "abstain", "invalid"]);

function isDateWithinTenure(
  date: string,
  memberId: string,
  tenureIndex: MemberTenureIndex
): boolean {
  return (tenureIndex.get(memberId) ?? []).some(
    (period) =>
      date.localeCompare(period.startDate) >= 0 &&
      (!period.endDate || date.localeCompare(period.endDate) <= 0)
  );
}

function normalizeOfficialProfileUrl(
  value: string | null | undefined
): string | null {
  if (!value || value.startsWith("javascript:")) {
    return null;
  }

  try {
    const url = new URL(value, "https://www.assembly.go.kr");
    if (
      url.hostname !== "www.assembly.go.kr" ||
      !url.pathname.includes("/members/")
    ) {
      return null;
    }
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().toLowerCase();
  } catch {
    return null;
  }
}

function buildCurrentMemberResolvers(
  members: MemberRecord[],
  tenureIndex: MemberTenureIndex
) {
  const currentMembers = members.filter((member) => member.isCurrentMember);
  const byName = new Map<string, MemberRecord[]>();
  const byProfileUrl = new Map<string, MemberRecord[]>();

  for (const member of currentMembers) {
    const nameKey = normalizeComparableText(member.name);
    byName.set(nameKey, [...(byName.get(nameKey) ?? []), member]);

    for (const value of [
      member.officialProfileUrl,
      member.officialExternalUrl
    ]) {
      const profileKey = normalizeOfficialProfileUrl(value);
      if (!profileKey) {
        continue;
      }
      byProfileUrl.set(profileKey, [
        ...(byProfileUrl.get(profileKey) ?? []),
        member
      ]);
    }
  }

  return {
    resolve(args: {
      memberName: string | null | undefined;
      officialProfileUrl?: string | null;
      voteDate: string;
    }): MemberRecord | null {
      const profileKey = normalizeOfficialProfileUrl(args.officialProfileUrl);
      const profileCandidates = profileKey
        ? (byProfileUrl.get(profileKey) ?? []).filter((member) =>
            isDateWithinTenure(args.voteDate, member.memberId, tenureIndex)
          )
        : [];
      if (profileCandidates.length === 1) {
        return profileCandidates[0] ?? null;
      }
      if (profileCandidates.length > 1) {
        throw new Error(
          `Official profile URL maps to multiple current members: ${args.officialProfileUrl}.`
        );
      }

      const nameKey = normalizeComparableText(args.memberName);
      if (!nameKey) {
        return null;
      }
      const nameCandidates = (byName.get(nameKey) ?? []).filter((member) =>
        isDateWithinTenure(args.voteDate, member.memberId, tenureIndex)
      );
      if (nameCandidates.length === 1) {
        return nameCandidates[0] ?? null;
      }
      if (nameCandidates.length > 1) {
        throw new Error(
          `Official vote member name is ambiguous on ${args.voteDate}: ${args.memberName}.`
        );
      }

      return null;
    },
    currentMembers
  };
}

function tallyFromLikms(
  info: ReturnType<typeof parseLikmsVoteInfoHtml>
): NonNullable<RollCallRecord["officialTally"]> {
  return {
    registeredCount: info.registeredCount,
    presentCount: info.presentCount,
    yesCount: info.yesCount,
    noCount: info.noCount,
    abstainCount: info.abstainCount,
    invalidCount: 0
  };
}

function assertSameTally(
  billId: string,
  left: NonNullable<RollCallRecord["officialTally"]>,
  right: NonNullable<RollCallRecord["officialTally"]>
): void {
  for (const key of [
    "registeredCount",
    "presentCount",
    "yesCount",
    "noCount",
    "abstainCount",
    "invalidCount"
  ] as const) {
    if (left[key] !== right[key]) {
      throw new Error(
        `Official vote tallies disagree for ${billId}: ${key} ${left[key]} != ${right[key]}.`
      );
    }
  }
}

function createRollCallFromLikms(args: {
  info: ReturnType<typeof parseLikmsVoteInfoHtml>;
  summary: BillVoteSummaryRecord | undefined;
  entry: RawSnapshotEntry;
  assemblyNo: number;
  snapshotId: string;
}): RollCallRecord {
  const meetingId = buildMeetingId({
    assemblyNo: args.assemblyNo,
    sessionNo: 0,
    meetingNo: 0,
    meetingDate: args.info.voteDate
  });
  const rollCallId = `${meetingId}:${args.info.billId}`;

  return {
    rollCallId,
    assemblyNo: args.assemblyNo,
    meetingId,
    agendaId: args.info.billNo,
    billId: args.info.billId,
    billName: args.info.billName,
    committeeName: args.summary?.committeeName ?? null,
    voteDatetime: args.info.voteDate,
    voteVisibility: "recorded",
    sourceStatus: "confirmed",
    officialSourceUrl: args.summary?.officialSourceUrl ?? args.entry.sourceUrl,
    officialTally: tallyFromLikms(args.info),
    summary: args.summary?.summary ?? null,
    snapshotId: args.snapshotId,
    sourceHash: sha256(`${args.entry.checksumSha256}:${rollCallId}`)
  };
}

export function mergeOfficialVoteFacts(args: {
  members: MemberRecord[];
  rollCalls: RollCallRecord[];
  voteFacts: VoteFactRecord[];
  summaries: BillVoteSummaryRecord[];
  voteMemberListPayloads: VoteMemberListPayload[];
  assemblyNo: number;
  snapshotId: string;
  snapshotRetrievedAt: string;
  tenureIndex: MemberTenureIndex;
}): OfficialVoteMergeResult {
  const resolver = buildCurrentMemberResolvers(args.members, args.tenureIndex);
  const summariesByBillId = new Map(
    args.summaries.map((summary) => [summary.billId, summary])
  );
  const rollCallsById = new Map(
    args.rollCalls.map((rollCall) => [rollCall.rollCallId, rollCall])
  );
  const rollCallsByBillId = new Map(
    args.rollCalls.flatMap((rollCall) =>
      rollCall.billId ? [[rollCall.billId, rollCall] as const] : []
    )
  );
  let voteFacts = [...args.voteFacts];
  const completeRollCallIds = new Set<string>();
  const sources: SourceRecord[] = [];

  for (const { entry, html } of args.voteMemberListPayloads) {
    const info = parseLikmsVoteInfoHtml(html);
    const expectedBillId = entry.metadata?.billId;
    if (expectedBillId && expectedBillId !== info.billId) {
      throw new Error(
        `Official LIKMS payload contains ${info.billId}, expected ${expectedBillId}.`
      );
    }

    const summary = summariesByBillId.get(info.billId);
    const embeddedTally = tallyFromLikms(info);
    if (summary) {
      assertSameTally(info.billId, summary.officialTally, embeddedTally);
    }

    let rollCall = rollCallsByBillId.get(info.billId);
    if (!rollCall) {
      rollCall = createRollCallFromLikms({
        info,
        summary,
        entry,
        assemblyNo: args.assemblyNo,
        snapshotId: args.snapshotId
      });
      rollCallsById.set(rollCall.rollCallId, rollCall);
      rollCallsByBillId.set(info.billId, rollCall);
    } else {
      rollCall = {
        ...rollCall,
        officialTally: summary?.officialTally ?? embeddedTally
      };
      rollCallsById.set(rollCall.rollCallId, rollCall);
      rollCallsByBillId.set(info.billId, rollCall);
    }

    const voteDate = info.voteDate;
    const currentMemberIds = new Set(
      resolver.currentMembers
        .filter((member) =>
          isDateWithinTenure(voteDate, member.memberId, args.tenureIndex)
        )
        .map((member) => member.memberId)
    );
    voteFacts = voteFacts.filter((fact) => {
      if (fact.rollCallId !== rollCall.rollCallId) {
        return true;
      }
      const member = resolver.resolve({
        memberName: fact.memberName,
        voteDate
      });
      return !(
        (fact.memberId && currentMemberIds.has(fact.memberId)) ||
        (member && currentMemberIds.has(member.memberId))
      );
    });

    for (const record of info.records) {
      const member = resolver.resolve({
        memberName: record.memberName,
        officialProfileUrl: record.officialProfileUrl,
        voteDate
      });
      if (!member) {
        continue;
      }

      voteFacts.push({
        rollCallId: rollCall.rollCallId,
        memberId: member.memberId,
        memberName: member.name,
        party: member.party,
        voteCode: record.voteCode,
        publishedAt: info.voteDate,
        retrievedAt: entry.retrievedAt,
        sourceHash: sha256(
          `${entry.checksumSha256}:${rollCall.rollCallId}:${member.memberId}:${record.voteCode}`
        )
      });
    }

    completeRollCallIds.add(rollCall.rollCallId);
    sources.push(
      createSourceRecord(
        {
          sourceUrl: entry.sourceUrl,
          retrievedAt: entry.retrievedAt,
          snapshotId: args.snapshotId
        },
        html
      )
    );
  }

  for (const [billId, summary] of summariesByBillId) {
    const rollCall = rollCallsByBillId.get(billId);
    if (!rollCall) {
      continue;
    }
    rollCallsById.set(rollCall.rollCallId, {
      ...rollCall,
      officialTally: summary.officialTally
    });
    const namedFactCount = voteFacts.filter(
      (fact) =>
        fact.rollCallId === rollCall.rollCallId &&
        namedVoteCodes.has(fact.voteCode)
    ).length;
    if (namedFactCount === summary.officialTally.presentCount) {
      completeRollCallIds.add(rollCall.rollCallId);
    }
  }

  for (const rollCallId of completeRollCallIds) {
    const rollCall = rollCallsById.get(rollCallId);
    if (!rollCall) {
      continue;
    }
    const voteDate = rollCall.voteDatetime.slice(0, 10);
    const representedMemberIds = new Set(
      voteFacts
        .filter(
          (fact) =>
            fact.rollCallId === rollCallId && namedVoteCodes.has(fact.voteCode)
        )
        .flatMap((fact) => {
          const member =
            resolver.currentMembers.find(
              (candidate) => candidate.memberId === fact.memberId
            ) ??
            resolver.resolve({
              memberName: fact.memberName,
              voteDate
            });
          return member ? [member.memberId] : [];
        })
    );

    for (const member of resolver.currentMembers) {
      if (
        !isDateWithinTenure(voteDate, member.memberId, args.tenureIndex) ||
        representedMemberIds.has(member.memberId)
      ) {
        continue;
      }

      voteFacts.push({
        rollCallId,
        memberId: member.memberId,
        memberName: member.name,
        party: member.party,
        voteCode: "absent",
        publishedAt: rollCall.voteDatetime,
        retrievedAt: args.snapshotRetrievedAt,
        sourceHash: sha256(
          `${rollCall.sourceHash}:${member.memberId}:recorded-vote-nonparticipation`
        )
      });
    }
  }

  return {
    rollCalls: [...rollCallsById.values()],
    voteFacts,
    sources
  };
}

function isDateWithinCommitteeCareer(
  date: string,
  career: CommitteeCareerRecord & { memberId: string }
): boolean {
  return (
    date.localeCompare(career.startDate) >= 0 &&
    (!career.endDate || date.localeCompare(career.endDate) < 0)
  );
}

export function buildOfficialAttendanceFacts(args: {
  members: MemberRecord[];
  careers: Array<CommitteeCareerRecord & { memberId: string }>;
  meetings: OfficialMinutesAttendanceMeeting[];
  tenureIndex: MemberTenureIndex;
}): AttendanceFactRecord[] {
  const currentMembers = args.members.filter(
    (member) => member.isCurrentMember
  );
  const facts: AttendanceFactRecord[] = [];

  for (const meeting of args.meetings) {
    const eligibleMembers =
      meeting.meetingType === "plenary"
        ? currentMembers.filter((member) =>
            isDateWithinTenure(
              meeting.meetingDate,
              member.memberId,
              args.tenureIndex
            )
          )
        : currentMembers.filter((member) =>
            args.careers.some(
              (career) =>
                career.memberId === member.memberId &&
                career.committeeName === meeting.committeeName &&
                isDateWithinCommitteeCareer(meeting.meetingDate, career)
            )
          );
    const presentNames = new Set(
      meeting.presentNames.map(normalizeComparableText)
    );
    const absentNames = new Set(
      (meeting.absentNames ?? []).map(normalizeComparableText)
    );
    const leaveNames = new Set(meeting.leaveNames.map(normalizeComparableText));
    const tripNames = new Set(meeting.tripNames.map(normalizeComparableText));
    const eligibleByName = new Map<string, MemberRecord[]>();

    for (const member of eligibleMembers) {
      const name = normalizeComparableText(member.name);
      eligibleByName.set(name, [...(eligibleByName.get(name) ?? []), member]);
    }
    for (const [name, candidates] of eligibleByName) {
      if (
        candidates.length > 1 &&
        (presentNames.has(name) ||
          absentNames.has(name) ||
          leaveNames.has(name) ||
          tripNames.has(name))
      ) {
        throw new Error(
          `Official attendance name is ambiguous for ${meeting.documentId}: ${name}.`
        );
      }
      if (
        Number(presentNames.has(name)) +
          Number(absentNames.has(name)) +
          Number(leaveNames.has(name)) +
          Number(tripNames.has(name)) >
        1
      ) {
        throw new Error(
          `Official attendance lists contain conflicting statuses for ${meeting.documentId}: ${name}.`
        );
      }
    }

    for (const member of eligibleMembers) {
      const name = normalizeComparableText(member.name);
      if (
        meeting.requiresExplicitStatus &&
        !presentNames.has(name) &&
        !absentNames.has(name) &&
        !leaveNames.has(name) &&
        !tripNames.has(name)
      ) {
        throw new Error(
          `Official attendance file has no explicit status for ${member.name} on ${meeting.meetingDate}.`
        );
      }
      const status = presentNames.has(name)
        ? "present"
        : absentNames.has(name)
          ? "absent"
          : leaveNames.has(name)
            ? "leave"
            : tripNames.has(name)
              ? "trip"
              : "absent";

      facts.push({
        attendanceId: `${meeting.documentId}:${member.memberId}`,
        memberId: member.memberId,
        memberName: member.name,
        meetingDate: meeting.meetingDate,
        meetingType: meeting.meetingType,
        committeeName: meeting.committeeName,
        status,
        sourceUrl: meeting.sourceUrl,
        retrievedAt: meeting.retrievedAt,
        sourceHash: meeting.sourceHash
      });
    }
  }

  return facts;
}
