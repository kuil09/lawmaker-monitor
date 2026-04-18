import {
  ensureUrl,
  parseXmlDocument,
  pickFirst,
  readBoolean,
  readString,
  sha256
} from "../utils.js";
import {
  buildAgendaSummary,
  buildMeetingId,
  createSourceRecord,
  extractBillIdFromUrl,
  extractFirstNumber,
  findItems,
  normalizeAssemblyNo,
  normalizeComparableText,
  normalizeDate,
  normalizeSourceStatus,
  normalizeVoteCode,
  normalizeVoteVisibility
} from "./helpers.js";

import type { RawSnapshotEntry } from "../raw-snapshot.js";
import type {
  AgendaRecord,
  LiveSignal,
  OfficialVoteParseOptions,
  SourceContext
} from "./types.js";
import type {
  MemberRecord,
  MeetingRecord,
  RollCallRecord,
  SourceRecord,
  VoteFactRecord
} from "@lawmaker-monitor/schemas";

type OfficialVoteParseResult = {
  members: MemberRecord[];
  rollCalls: RollCallRecord[];
  voteFacts: VoteFactRecord[];
  sources: SourceRecord[];
};

type AgendaContext = SourceContext;
type MeetingContext = SourceContext;

function createCurrentMemberResolver(currentMembers: MemberRecord[] = []) {
  const membersById = new Map(
    currentMembers.map((member) => [member.memberId, member])
  );
  const membersByNormalizedName = new Map<string, MemberRecord[]>();

  for (const member of currentMembers) {
    const normalizedName = normalizeComparableText(member.name);
    if (!normalizedName) {
      continue;
    }

    const candidates = membersByNormalizedName.get(normalizedName) ?? [];
    candidates.push(member);
    membersByNormalizedName.set(normalizedName, candidates);
  }

  return {
    resolve(
      memberId: string | null,
      memberName: string | null,
      party: string | null
    ): MemberRecord | undefined {
      if (memberId) {
        return membersById.get(memberId);
      }

      const normalizedName = normalizeComparableText(memberName);
      if (!normalizedName) {
        return undefined;
      }

      const candidates = membersByNormalizedName.get(normalizedName) ?? [];
      if (candidates.length === 0) {
        return undefined;
      }

      const normalizedParty = normalizeComparableText(party);
      if (normalizedParty) {
        const partyMatches = candidates.filter(
          (candidate) =>
            normalizeComparableText(candidate.party) === normalizedParty
        );

        if (partyMatches.length === 1) {
          return partyMatches[0];
        }
      }

      return candidates.length === 1 ? candidates[0] : undefined;
    }
  };
}

export function parseOfficialVoteXml(
  xml: string,
  context: SourceContext,
  options: OfficialVoteParseOptions = {}
): OfficialVoteParseResult {
  const parsed = parseXmlDocument(xml);
  const rows = findItems(parsed);
  const sourceRecord = createSourceRecord(context, xml);
  const rollCallsById = new Map<string, RollCallRecord>();
  const membersById = new Map<string, MemberRecord>();
  const voteFacts: VoteFactRecord[] = [];
  const currentMemberResolver = createCurrentMemberResolver(
    options.currentMembers
  );

  for (const row of rows) {
    const assemblyNo = normalizeAssemblyNo(row);
    const rawBillNo = pickFirst(row, [
      "BILL_NO",
      "billNo",
      "agendaId",
      "AGENDA_ID"
    ]);
    const rawMemberName = pickFirst(row, [
      "HG_NM",
      "hgNm",
      "MEMBER_NAME",
      "memberName"
    ]);

    if (
      assemblyNo <= 0 ||
      rawBillNo === "의안번호" ||
      rawMemberName === "의원"
    ) {
      continue;
    }

    const sessionNo = extractFirstNumber(
      pickFirst(row, [
        "SESSION_CD",
        "sessionCd",
        "MEETINGSESSION",
        "meetingSession"
      ])
    );
    const meetingNo = extractFirstNumber(
      pickFirst(row, [
        "CURRENTS_CD",
        "currentsCd",
        "CHA",
        "cha",
        "CONFER_NUM",
        "conferNum"
      ])
    );
    const rawVoteDatetime =
      pickFirst(row, [
        "VOTE_DATE",
        "voteDate",
        "voteDatetime",
        "VOTE_DATETIME",
        "RGS_PROC_DT"
      ]) ?? context.retrievedAt;
    const meetingDate =
      normalizeDate(rawVoteDatetime) ?? normalizeDate(context.retrievedAt);
    const voteDatetime = readString(rawVoteDatetime) ?? context.retrievedAt;
    const meetingId =
      pickFirst(row, ["meetingId", "MEETING_ID", "CONF_ID", "confId"]) ??
      buildMeetingId({ assemblyNo, sessionNo, meetingNo, meetingDate });
    const billId =
      pickFirst(row, ["BILL_ID", "billId"]) ??
      extractBillIdFromUrl(
        pickFirst(row, ["BILL_URL", "billUrl", "BILL_NAME_URL", "billNameUrl"])
      );
    const agendaId =
      rawBillNo ??
      pickFirst(row, ["agendaId", "AGENDA_ID", "SUB_NUM", "subNum"]) ??
      billId;
    const rollCallId =
      pickFirst(row, ["rollCallId", "ROLL_CALL_ID", "voteId", "VOTE_ID"]) ??
      `${meetingId}:${billId ?? agendaId ?? "unknown-bill"}`;

    const rawMemberId =
      pickFirst(row, [
        "MONA_CD",
        "monaCd",
        "MEMBER_NO",
        "memberNo",
        "MEMBER_ID",
        "memberId"
      ]) ?? null;
    const rawParty =
      pickFirst(row, ["POLY_NM", "polyNm", "party", "PARTY"]) ?? null;
    const matchedCurrentMember = currentMemberResolver.resolve(
      rawMemberId,
      rawMemberName ?? null,
      rawParty
    );
    const memberId = rawMemberId ?? matchedCurrentMember?.memberId ?? null;
    const memberName = rawMemberName ?? matchedCurrentMember?.name ?? null;
    const party = rawParty ?? matchedCurrentMember?.party ?? null;
    let voteVisibility = normalizeVoteVisibility(row);

    if (voteVisibility === "unknown" && (memberId || memberName)) {
      voteVisibility = "recorded";
    }

    if (!memberId && !memberName) {
      continue;
    }

    const sourceStatus = normalizeSourceStatus(row);
    const officialSourceUrl = ensureUrl(
      pickFirst(row, [
        "BILL_URL",
        "billUrl",
        "BILL_NAME_URL",
        "billNameUrl",
        "officialSourceUrl"
      ]),
      context.sourceUrl
    );
    const sourceHash = sha256(`${sourceRecord.contentSha256}:${rollCallId}`);

    if (!rollCallsById.has(rollCallId)) {
      rollCallsById.set(rollCallId, {
        rollCallId,
        assemblyNo,
        meetingId,
        agendaId,
        billId,
        billName:
          pickFirst(row, [
            "BILL_NAME",
            "billName",
            "LAW_TITLE",
            "lawTitle",
            "SUB_NAME",
            "subName"
          ]) ?? "Unknown bill",
        committeeName: pickFirst(row, [
          "CURR_COMMITTEE",
          "currCommittee",
          "COMMITTEE_NAME",
          "committeeName"
        ]),
        voteDatetime,
        voteVisibility,
        sourceStatus,
        officialSourceUrl,
        summary: pickFirst(row, [
          "LAW_TITLE",
          "lawTitle",
          "summary",
          "SUMMARY"
        ]),
        snapshotId: context.snapshotId,
        sourceHash
      });
    }

    if (memberId && memberName && !membersById.has(memberId)) {
      const district = pickFirst(row, [
        "ORIG_NM",
        "origNm",
        "district",
        "DISTRICT"
      ]);
      membersById.set(memberId, {
        memberId,
        name: memberName,
        party: party ?? "Unknown",
        district,
        committeeMemberships: [],
        photoUrl: null,
        officialProfileUrl: null,
        officialExternalUrl: null,
        isCurrentMember: false,
        proportionalFlag:
          readBoolean(
            row.proportionalFlag ?? row.PROPORTIONAL_FLAG ?? row.reeleGbnNm
          ) ?? district === "비례대표",
        assemblyNo
      });
    }

    voteFacts.push({
      rollCallId,
      memberId,
      memberName,
      party,
      voteCode: normalizeVoteCode(row),
      publishedAt:
        readString(
          pickFirst(row, [
            "publishedAt",
            "PUBLISHED_AT",
            "VOTE_DATE",
            "voteDate",
            "registerDate"
          ])
        ) ?? context.retrievedAt,
      retrievedAt: context.retrievedAt,
      sourceHash
    });
  }

  return {
    members: [...membersById.values()],
    rollCalls: [...rollCallsById.values()],
    voteFacts,
    sources: [sourceRecord]
  };
}

export function parseVoteDetailPayload(
  payload: string,
  context: SourceContext,
  options: OfficialVoteParseOptions = {}
): OfficialVoteParseResult {
  return parseOfficialVoteXml(payload, context, options);
}

export function parseVoteDetailEntryPayload(
  entry: Pick<RawSnapshotEntry, "endpointCode" | "sourceUrl">,
  payload: string,
  context: SourceContext,
  options: OfficialVoteParseOptions = {}
): OfficialVoteParseResult {
  if (entry.endpointCode === "nojepdqqaweusdfbi") {
    return parseOfficialVoteXml(payload, context, options);
  }

  throw new Error(
    `Unsupported vote detail endpoint ${entry.endpointCode} from ${entry.sourceUrl}.`
  );
}

export function parseAgendaXml(
  xml: string,
  context: AgendaContext
): { agendas: AgendaRecord[]; sources: SourceRecord[] } {
  const parsed = parseXmlDocument(xml);
  const rows = findItems(parsed);

  const agendas: AgendaRecord[] = [];

  for (const row of rows) {
    const assemblyNo = normalizeAssemblyNo(row);
    const meetingDate = normalizeDate(
      pickFirst(row, [
        "RGS_PROC_DT",
        "rgsProcDt",
        "RGS_PRESENT_DT",
        "rgsPresentDt"
      ])
    );
    const billId = pickFirst(row, ["BILL_ID", "billId"]);
    const agendaId =
      pickFirst(row, ["BILL_NO", "billNo", "SUB_NUM", "subNum"]) ?? billId;
    const billName = pickFirst(row, [
      "BILL_NAME",
      "billName",
      "BILL_NM",
      "billNm"
    ]);

    if (!billName) {
      continue;
    }

    agendas.push({
      meetingId: meetingDate
        ? buildMeetingId({
            assemblyNo,
            sessionNo: 0,
            meetingNo: 0,
            meetingDate
          })
        : undefined,
      agendaId,
      billId,
      billName,
      committeeName: pickFirst(row, [
        "CURR_COMMITTEE",
        "currCommittee",
        "COMMITTEE_NM",
        "committeeNm",
        "COMMITTEE_NAME",
        "committeeName"
      ]),
      summary: buildAgendaSummary(row)
    });
  }

  return {
    agendas,
    sources: [createSourceRecord(context, xml)]
  };
}

export function parseMeetingXml(
  xml: string,
  context: MeetingContext
): { meetings: MeetingRecord[]; sources: SourceRecord[] } {
  const parsed = parseXmlDocument(xml);
  const rows = findItems(parsed);

  const meetings = rows
    .map((row) => {
      const assemblyNo = normalizeAssemblyNo(row);
      const sessionNo = extractFirstNumber(
        pickFirst(row, ["MEETINGSESSION", "meetingSession"])
      );
      const meetingNo = extractFirstNumber(
        pickFirst(row, ["CHA", "cha", "CONFER_NUM", "conferNum"])
      );
      const meetingDate = normalizeDate(
        pickFirst(row, [
          "MEETTING_DATE",
          "meetingDate",
          "CONF_DATE",
          "confDate"
        ])
      );
      const title = pickFirst(row, ["TITLE", "title"]);

      if (!meetingDate || !title) {
        return undefined;
      }

      const meeting: MeetingRecord = {
        meetingId: buildMeetingId({
          assemblyNo,
          sessionNo,
          meetingNo,
          meetingDate
        }),
        meetingType: title.includes("본회의")
          ? "Plenary Session"
          : "Plenary Meeting",
        sessionNo,
        meetingNo,
        meetingDate,
        isLive: false
      };

      return meeting;
    })
    .filter((meeting): meeting is MeetingRecord => Boolean(meeting));

  return {
    meetings,
    sources: [createSourceRecord(context, xml)]
  };
}

export function parseLiveSignalXml(xml: string): LiveSignal | null {
  const parsed = parseXmlDocument(xml);
  const rows = findItems(parsed);

  const liveRow =
    rows.find((row) => readBoolean(row.LBRD_STAT ?? row.lbrdStat) === true) ??
    rows[0];
  if (!liveRow) {
    return null;
  }

  const liveStatus = pickFirst(liveRow, [
    "LBRD_STAT",
    "lbrdStat"
  ])?.toLowerCase();
  const isLive =
    readBoolean(liveRow.LBRD_STAT ?? liveRow.lbrdStat) ??
    Boolean(
      liveStatus &&
      ["개의", "live", "on", "진행"].some((token) => liveStatus.includes(token))
    );
  const title = pickFirst(liveRow, ["CONF_NM", "confNm"]);
  const committeeName = pickFirst(liveRow, ["CMIT_NM", "cmitNm"]);

  if (!title && !committeeName) {
    return null;
  }

  return {
    isLive,
    title,
    committeeName
  };
}
