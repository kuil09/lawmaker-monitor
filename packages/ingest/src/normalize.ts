import type {
  MeetingRecord,
  MemberProfile,
  MemberRecord,
  NormalizedBundle,
  RollCallRecord,
  SourceRecord
} from "@lawmaker-monitor/schemas";

import type { AgendaRecord, LiveSignal } from "./parsers.js";

type NormalizeInput = {
  members: NormalizedBundle["members"];
  rollCalls: NormalizedBundle["rollCalls"];
  voteFacts: NormalizedBundle["voteFacts"];
  meetings: NormalizedBundle["meetings"];
  sources: NormalizedBundle["sources"];
  agendas: AgendaRecord[];
  liveSignal?: LiveSignal | null;
};

function uniqueBy<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Map<string, T>();

  for (const item of items) {
    seen.set(getKey(item), item);
  }

  return [...seen.values()];
}

function scoreMemberMatch(left: MemberRecord, right: MemberRecord): number {
  if (left.name !== right.name || left.assemblyNo !== right.assemblyNo) {
    return -1;
  }

  let score = 2;
  if (left.party && right.party && left.party === right.party) {
    score += 2;
  }
  if (left.district && right.district && left.district === right.district) {
    score += 1;
  }

  return score;
}

function findFallbackMemberKey(
  merged: Map<string, MemberRecord>,
  member: MemberRecord
): string | undefined {
  let bestKey: string | undefined;
  let bestScore = -1;

  for (const [key, candidate] of merged.entries()) {
    if (key === member.memberId) {
      continue;
    }

    const score = scoreMemberMatch(candidate, member);
    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }

  return bestScore >= 2 ? bestKey : undefined;
}

function mergeMembers(members: MemberRecord[]): MemberRecord[] {
  const merged = new Map<string, MemberRecord>();

  for (const member of members) {
    const targetKey = merged.has(member.memberId)
      ? member.memberId
      : findFallbackMemberKey(merged, member) ?? member.memberId;
    const existing = merged.get(targetKey);
    if (!existing) {
      merged.set(targetKey, member);
      continue;
    }

    merged.set(targetKey, {
      ...existing,
      ...member,
      memberId: existing.memberId,
      name: member.name || existing.name,
      party: member.party || existing.party,
      district: member.district ?? existing.district ?? null,
      committeeMemberships: [
        ...new Set([...(existing.committeeMemberships ?? []), ...(member.committeeMemberships ?? [])])
      ],
      photoUrl: member.photoUrl ?? existing.photoUrl ?? null,
      officialProfileUrl: member.officialProfileUrl ?? existing.officialProfileUrl ?? null,
      officialExternalUrl: member.officialExternalUrl ?? existing.officialExternalUrl ?? null,
      profile: mergeMemberProfile(existing.profile, member.profile),
      isCurrentMember: existing.isCurrentMember || member.isCurrentMember,
      proportionalFlag: member.proportionalFlag ?? existing.proportionalFlag,
      assemblyNo: member.assemblyNo || existing.assemblyNo
    });
  }

  return [...merged.values()];
}

function mergeUniqueStrings(left: string[] = [], right: string[] = []): string[] {
  return [...new Set([...left, ...right].filter(Boolean))];
}

function mergeMemberProfile(
  existing: MemberProfile | undefined,
  incoming: MemberProfile | undefined
): MemberProfile | undefined {
  if (!existing && !incoming) {
    return undefined;
  }

  return {
    nameHanja: incoming?.nameHanja ?? existing?.nameHanja ?? null,
    nameEnglish: incoming?.nameEnglish ?? existing?.nameEnglish ?? null,
    birthType: incoming?.birthType ?? existing?.birthType ?? null,
    birthDate: incoming?.birthDate ?? existing?.birthDate ?? null,
    roleName: incoming?.roleName ?? existing?.roleName ?? null,
    reelectionLabel: incoming?.reelectionLabel ?? existing?.reelectionLabel ?? null,
    electedAssembliesLabel:
      incoming?.electedAssembliesLabel ?? existing?.electedAssembliesLabel ?? null,
    gender: incoming?.gender ?? existing?.gender ?? null,
    representativeCommitteeName:
      incoming?.representativeCommitteeName ?? existing?.representativeCommitteeName ?? null,
    affiliatedCommitteeName:
      incoming?.affiliatedCommitteeName ?? existing?.affiliatedCommitteeName ?? null,
    briefHistory: incoming?.briefHistory ?? existing?.briefHistory ?? null,
    officeRoom: incoming?.officeRoom ?? existing?.officeRoom ?? null,
    officePhone: incoming?.officePhone ?? existing?.officePhone ?? null,
    email: incoming?.email ?? existing?.email ?? null,
    aideNames: mergeUniqueStrings(existing?.aideNames, incoming?.aideNames),
    chiefSecretaryNames: mergeUniqueStrings(
      existing?.chiefSecretaryNames,
      incoming?.chiefSecretaryNames
    ),
    secretaryNames: mergeUniqueStrings(existing?.secretaryNames, incoming?.secretaryNames)
  };
}

function mergeRollCalls(rollCalls: RollCallRecord[], agendas: AgendaRecord[]): RollCallRecord[] {
  const agendasByMeetingAgenda = new Map<string, AgendaRecord>();
  const agendasByBillId = new Map<string, AgendaRecord>();

  for (const agenda of agendas) {
    if (agenda.meetingId && agenda.agendaId) {
      agendasByMeetingAgenda.set(`${agenda.meetingId}:${agenda.agendaId}`, agenda);
    }

    if (agenda.billId) {
      agendasByBillId.set(agenda.billId, agenda);
    }
  }

  return rollCalls.map((rollCall) => {
    const agenda =
      (rollCall.billId ? agendasByBillId.get(rollCall.billId) : undefined) ??
      (rollCall.agendaId
        ? agendasByMeetingAgenda.get(`${rollCall.meetingId}:${rollCall.agendaId}`)
        : undefined);

    if (!agenda) {
      return rollCall;
    }

    return {
      ...rollCall,
      billId: rollCall.billId ?? agenda.billId,
      billName: rollCall.billName === "Unknown bill" ? agenda.billName : rollCall.billName,
      committeeName: rollCall.committeeName ?? agenda.committeeName,
      summary: rollCall.summary ?? agenda.summary
    };
  });
}

function mergeMeetings(meetings: MeetingRecord[], liveSignal?: LiveSignal | null): MeetingRecord[] {
  const deduped = uniqueBy(meetings, (meeting) => meeting.meetingId);
  if (!liveSignal || !liveSignal.isLive) {
    return deduped;
  }

  const matchByTitle = liveSignal.title
    ? deduped.find((meeting) => liveSignal.title?.includes(String(meeting.sessionNo)) || liveSignal.title?.includes(String(meeting.meetingNo)))
    : undefined;
  const fallback = [...deduped].sort((left, right) => right.meetingDate.localeCompare(left.meetingDate))[0];
  const targetMeetingId = matchByTitle?.meetingId ?? fallback?.meetingId;

  return deduped.map((meeting) =>
    meeting.meetingId === targetMeetingId
      ? {
          ...meeting,
          isLive: true
        }
      : meeting
  );
}

function mergeSources(sources: SourceRecord[]): SourceRecord[] {
  return uniqueBy(sources, (source) => `${source.sourceUrl}:${source.contentSha256}`);
}

export function createNormalizedBundle(input: NormalizeInput): NormalizedBundle {
  return {
    members: mergeMembers(input.members),
    rollCalls: uniqueBy(mergeRollCalls(input.rollCalls, input.agendas), (rollCall) => rollCall.rollCallId),
    voteFacts: uniqueBy(
      input.voteFacts,
      (voteFact) =>
        `${voteFact.rollCallId}:${
          voteFact.memberId ??
          `name=${voteFact.memberName ?? ""};party=${voteFact.party ?? ""}`
        }:${voteFact.voteCode}:${voteFact.retrievedAt}`
    ),
    meetings: mergeMeetings(input.meetings, input.liveSignal),
    sources: mergeSources(input.sources)
  };
}
