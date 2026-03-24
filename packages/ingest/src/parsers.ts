import type {
  MemberRecord,
  MemberProfile,
  MeetingRecord,
  OfficialTally,
  RollCallRecord,
  SourceRecord,
  SourceStatus,
  VoteCode,
  VoteFactRecord,
  VoteVisibility
} from "@lawmaker-monitor/schemas";
import type { RawSnapshotEntry } from "./raw-snapshot.js";

import {
  asArray,
  ensureUrl,
  parseXmlDocument,
  pickFirst,
  readBoolean,
  readString,
  sha256,
  toNumber
} from "./utils.js";

export type SourceContext = {
  sourceUrl: string;
  retrievedAt: string;
  snapshotId: string;
};

type OfficialVoteParseResult = {
  members: MemberRecord[];
  rollCalls: RollCallRecord[];
  voteFacts: VoteFactRecord[];
  sources: SourceRecord[];
};

export type OfficialVoteParseOptions = {
  currentMembers?: MemberRecord[];
};

type AgendaContext = SourceContext;
type MeetingContext = SourceContext;

export type AgendaRecord = {
  meetingId?: string;
  agendaId?: string;
  billId?: string;
  billName: string;
  committeeName?: string;
  summary?: string;
};

export type LiveSignal = {
  isLive: boolean;
  title?: string;
  committeeName?: string;
};

export type CurrentAssemblyContext = {
  assemblyNo: number;
  label: string;
  unitCd: string;
};

export type MemberTenureRecord = {
  memberId: string;
  name: string;
  assemblyNo: number;
  unitCd?: string;
  startDate: string;
  endDate: string | null;
};

export type MemberInfoParseResult = {
  members: MemberRecord[];
  currentAssembly: Omit<CurrentAssemblyContext, "unitCd"> | null;
};

export type MemberProfileAllRecord = {
  naasCd: string;
  name: string;
  party: string;
  district: string | null;
  assemblyNo: number;
  committeeMemberships: string[];
  photoUrl: string | null;
  officialProfileUrl: string | null;
  officialExternalUrl: string | null;
  profile?: MemberProfile;
  proportionalFlag: boolean;
};

export type MemberProfileAllParseResult = {
  profiles: MemberProfileAllRecord[];
  currentAssembly: Omit<CurrentAssemblyContext, "unitCd"> | null;
};

export type CommitteeRosterRecord = {
  memberId: string;
  memberName: string;
  party: string | null;
  district: string | null;
  committeeName: string;
};

export type CommitteeOverviewRecord = {
  committeeName: string;
  committeeType: string | null;
  memberLimit: number | null;
  currentMemberCount: number | null;
};

export type BillVoteSummaryRecord = {
  billId: string;
  billNo: string;
  billName: string;
  committeeName: string | null;
  officialSourceUrl: string;
  officialTally: OfficialTally;
  summary: string | null;
};

function normalizeCommitteeMemberships(value: string): string[] {
  const normalized = value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#160;/gi, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .trim();

  const rawCandidates = normalized
    .split(/\n|,|\/|·/)
    .map((item) => item.trim())
    .filter(Boolean);

  const committees = rawCandidates.flatMap((candidate) => {
    const matches = candidate.match(/[가-힣A-Za-z0-9()\s]+위원회/g);
    if (!matches) {
      return [];
    }

    return matches.map((match) => match.replace(/\s+/g, " ").trim());
  });

  return [...new Set(committees)];
}

function findItems(root: unknown): Record<string, unknown>[] {
  if (!root || typeof root !== "object") {
    return [];
  }

  const node = root as Record<string, unknown>;

  if ("response" in node) {
    return findItems(node.response);
  }

  if ("body" in node) {
    return findItems(node.body);
  }

  if ("items" in node) {
    return findItems(node.items);
  }

  if ("item" in node) {
    return asArray(node.item).filter(
      (candidate): candidate is Record<string, unknown> =>
        !!candidate && typeof candidate === "object" && !Array.isArray(candidate)
    );
  }

  if ("rows" in node) {
    return findItems(node.rows);
  }

  if ("row" in node) {
    return asArray(node.row).filter(
      (candidate): candidate is Record<string, unknown> =>
        !!candidate && typeof candidate === "object" && !Array.isArray(candidate)
    );
  }

  for (const value of Object.values(node)) {
    const nested = findItems(value);
    if (nested.length > 0) {
      return nested;
    }
  }

  return [];
}

function extractFirstNumber(value: unknown, fallback = 0): number {
  const normalized = readString(value);
  if (!normalized) {
    return fallback;
  }

  const match = normalized.match(/\d+/);
  if (!match) {
    return fallback;
  }

  const parsed = Number.parseInt(match[0], 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeDate(value: unknown): string | undefined {
  const normalized = readString(value);
  if (!normalized) {
    return undefined;
  }

  const compactIso = normalized.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compactIso) {
    const [, year, month, day] = compactIso;
    return `${year}-${month}-${day}`;
  }

  const isoLike = normalized.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/);
  if (isoLike) {
    const year = isoLike[1];
    const month = isoLike[2];
    const day = isoLike[3];
    if (!year || !month || !day) {
      return normalized;
    }
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const shortMonth = normalized.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (shortMonth) {
    const day = shortMonth[1];
    const monthToken = shortMonth[2];
    const yearToken = shortMonth[3];
    if (!day || !monthToken || !yearToken) {
      return normalized;
    }
    const monthMap: Record<string, string> = {
      jan: "01",
      feb: "02",
      mar: "03",
      apr: "04",
      may: "05",
      jun: "06",
      jul: "07",
      aug: "08",
      sep: "09",
      oct: "10",
      nov: "11",
      dec: "12"
    };
    const month = monthMap[monthToken.toLowerCase()];
    const year =
      yearToken.length === 2 ? `20${yearToken.padStart(2, "0")}` : yearToken.padStart(4, "0");

    if (month) {
      return `${year}-${month}-${day.padStart(2, "0")}`;
    }
  }

  return normalized;
}

function normalizeAssemblyNo(record: Record<string, unknown>): number {
  const direct = extractFirstNumber(
    pickFirst(record, [
      "assemblyNo",
      "ASSEMBLY_NO",
      "daesu",
      "AGE",
      "DAE_NUM",
      "daeNum",
      "PROFILE_SJ",
      "profileSj",
      "UNIT_NM",
      "unitNm"
    ])
  );

  if (direct > 0) {
    return direct;
  }

  const unitCd = pickFirst(record, ["UNIT_CD", "unitCd"]);
  if (unitCd && /^\d{4,}$/.test(unitCd)) {
    return Number.parseInt(unitCd.slice(-2), 10);
  }

  return 0;
}

function buildMeetingId(args: {
  assemblyNo: number;
  sessionNo: number;
  meetingNo: number;
  meetingDate?: string;
}): string {
  const dateToken = args.meetingDate?.replace(/\D/g, "") ?? "unknown";
  return `plenary-${args.assemblyNo || 0}-${args.sessionNo || 0}-${args.meetingNo || 0}-${dateToken}`;
}

function normalizeVoteVisibility(record: Record<string, unknown>): VoteVisibility {
  const raw = pickFirst(record, [
    "voteVisibility",
    "VOTE_VISIBILITY",
    "voteMethod",
    "VOTE_METHOD",
    "votngMthdNm",
    "anonymousYn",
    "ANONYMOUS_YN",
    "VOTE_KIND",
    "voteKind",
    "BALLOT_KIND",
    "ballotKind"
  ])?.toLowerCase();

  if (!raw) {
    return "unknown";
  }

  if (raw.includes("secret") || raw.includes("무기명") || raw === "y") {
    return "secret";
  }

  if (raw.includes("named") || raw.includes("호명")) {
    return "named";
  }

  if (raw.includes("record") || raw.includes("전자") || raw.includes("기록")) {
    return "recorded";
  }

  return "unknown";
}

function extractBillIdFromUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const url = new URL(value);
    return url.searchParams.get("billId") ?? undefined;
  } catch {
    return undefined;
  }
}

function normalizeOptionalUrl(value: unknown): string | null {
  const normalized = readString(value);
  if (!normalized) {
    return null;
  }

  try {
    return new URL(normalized).toString();
  } catch {
    return null;
  }
}

function normalizeUrlAgainstAssemblyOrigin(value: unknown): string | null {
  const normalized = readString(value);
  if (!normalized) {
    return null;
  }

  try {
    return new URL(normalized, "https://open.assembly.go.kr").toString();
  } catch {
    return null;
  }
}

function normalizeOfficialExternalUrl(
  homepage: unknown,
  officialProfileUrl: string | null
): string | null {
  const normalizedHomepage = normalizeOptionalUrl(homepage);
  if (!normalizedHomepage) {
    return null;
  }

  const homepageUrl = new URL(normalizedHomepage);
  if (homepageUrl.hostname.endsWith("assembly.go.kr")) {
    if (!officialProfileUrl) {
      return null;
    }

    try {
      const profileUrl = new URL(officialProfileUrl);
      if (homepageUrl.toString() === profileUrl.toString()) {
        return null;
      }
    } catch {
      return null;
    }

    return null;
  }

  if (officialProfileUrl && normalizedHomepage === officialProfileUrl) {
    return null;
  }

  return normalizedHomepage;
}

function toEnglishProfileSlug(value: string | null | undefined): string | null {
  const normalized = value?.replace(/[^A-Za-z]/g, "").toUpperCase() ?? "";
  return normalized ? normalized : null;
}

function toOrdinalLabel(value: number): string {
  const remainder = value % 100;
  if (remainder >= 11 && remainder <= 13) {
    return `${value}th`;
  }

  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

function buildOfficialProfileUrl(assemblyNo: number, englishName: string | null | undefined): string | null {
  const slug = toEnglishProfileSlug(englishName);
  if (!slug || assemblyNo <= 0) {
    return null;
  }

  return `https://www.assembly.go.kr/members/${toOrdinalLabel(assemblyNo)}/${slug}`;
}

function normalizeAssemblyLabel(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return normalized;
  }

  return normalized.includes("국회") ? normalized : `${normalized} 국회`;
}

function extractAssemblyNumbers(value: string | null | undefined): number[] {
  const normalized = value ?? "";
  return [...new Set((normalized.match(/\d{1,2}/g) ?? [])
    .map((token) => Number.parseInt(token, 10))
    .filter((token) => Number.isFinite(token) && token > 0))]
    .sort((left, right) => left - right);
}

function normalizeNullableText(value: unknown): string | null {
  const normalized = readString(value)?.replace(/\s+/g, " ").trim();
  return normalized ? normalized : null;
}

function normalizeMultilineText(value: unknown): string | null {
  const normalized = readString(value)
    ?.replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return normalized ? normalized : null;
}

function normalizeCurrentSegment(value: unknown): string | null {
  const normalized = readString(value);
  if (!normalized) {
    return null;
  }

  const segments = normalized
    .split("/")
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  return segments.at(-1) ?? null;
}

function normalizeNameList(value: unknown): string[] {
  const normalized = readString(value);
  if (!normalized) {
    return [];
  }

  return [...new Set(
    normalized
      .split(/\n|,|\/|·/)
      .map((item) => item.trim())
      .filter(Boolean)
  )];
}

function buildMemberInfoProfile(values: {
  nameHanja?: string | null;
  nameEnglish?: string | null;
  birthType?: string | null;
  birthDate?: string | null;
  roleName?: string | null;
  reelectionLabel?: string | null;
  electedAssembliesLabel?: string | null;
  gender?: string | null;
  representativeCommitteeName?: string | null;
  affiliatedCommitteeName?: string | null;
  briefHistory?: string | null;
  officeRoom?: string | null;
  officePhone?: string | null;
  email?: string | null;
  aideNames?: string[];
  chiefSecretaryNames?: string[];
  secretaryNames?: string[];
}): MemberProfile | undefined {
  const profile: MemberProfile = {
    nameHanja: values.nameHanja ?? null,
    nameEnglish: values.nameEnglish ?? null,
    birthType: values.birthType ?? null,
    birthDate: values.birthDate ?? null,
    roleName: values.roleName ?? null,
    reelectionLabel: values.reelectionLabel ?? null,
    electedAssembliesLabel: values.electedAssembliesLabel ?? null,
    gender: values.gender ?? null,
    representativeCommitteeName: values.representativeCommitteeName ?? null,
    affiliatedCommitteeName: values.affiliatedCommitteeName ?? null,
    briefHistory: values.briefHistory ?? null,
    officeRoom: values.officeRoom ?? null,
    officePhone: values.officePhone ?? null,
    email: values.email ?? null,
    aideNames: values.aideNames ?? [],
    chiefSecretaryNames: values.chiefSecretaryNames ?? [],
    secretaryNames: values.secretaryNames ?? []
  };

  const hasScalarValue = Object.entries(profile).some(([key, item]) => {
    if (Array.isArray(item)) {
      return item.length > 0;
    }

    if (key === "briefHistory") {
      return Boolean(item);
    }

    return item !== null && item !== undefined;
  });

  return hasScalarValue ? profile : undefined;
}

function buildMemberInfoMatchKey(member: Pick<MemberRecord, "name" | "party" | "district" | "assemblyNo">): string {
  return [
    member.assemblyNo,
    normalizeComparableText(member.name),
    normalizeComparableText(member.party),
    normalizeComparableText(member.district)
  ].join("|");
}

function parseLegacyMemberInfoRow(row: Record<string, unknown>): MemberRecord | null {
  const memberId = pickFirst(row, ["MONA_CD", "monaCd"]);
  const name = pickFirst(row, ["HG_NM", "hgNm"]);
  const party = pickFirst(row, ["POLY_NM", "polyNm"]);
  const districts = pickFirst(row, ["ORIG_NM", "origNm"]);
  const units = pickFirst(row, ["UNITS", "units", "UNIT_NM", "unitNm"]);
  const assemblyNumbers = extractAssemblyNumbers(units);
  const assemblyNo = assemblyNumbers.at(-1) ?? 0;

  if (!memberId || !name || !party || assemblyNo <= 0) {
    return null;
  }

  const officialProfileUrl = buildOfficialProfileUrl(
    assemblyNo,
    pickFirst(row, ["ENG_NM", "engNm"])
  );

  return {
    memberId,
    name,
    party,
    district: districts ?? null,
    committeeMemberships: normalizeCommitteeMemberships(
      pickFirst(row, ["CMITS", "cmits", "CMIT_NM", "cmitNm"]) ?? ""
    ),
    photoUrl: normalizeOptionalUrl(pickFirst(row, ["DEPT_IMG_URL", "deptImgUrl"])),
    officialProfileUrl,
    officialExternalUrl: normalizeOfficialExternalUrl(
      pickFirst(row, ["HOMEPAGE", "homepage"]),
      officialProfileUrl
    ),
    isCurrentMember: true,
    proportionalFlag:
      pickFirst(row, ["ELECT_GBN_NM", "electGbnNm", "ORIG_NM", "origNm"]) === "비례대표",
    assemblyNo
  };
}

export function parseLegacyMemberInfoXml(xml: string): MemberInfoParseResult {
  const parsed = parseXmlDocument(xml);
  const rows = findItems(parsed);
  const members: MemberRecord[] = [];
  let currentAssemblyNo = 0;

  for (const row of rows) {
    const member = parseLegacyMemberInfoRow(row);
    if (!member) {
      continue;
    }

    currentAssemblyNo = Math.max(currentAssemblyNo, member.assemblyNo);
    members.push(member);
  }

  return {
    members,
    currentAssembly:
      currentAssemblyNo > 0
        ? {
            assemblyNo: currentAssemblyNo,
            label: normalizeAssemblyLabel(`제${currentAssemblyNo}대`)
          }
        : null
  };
}

function extractDateTokens(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  const matches =
    value.match(/\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/g) ??
    value.match(/\d{1,2}-[A-Za-z]{3}-\d{2,4}/g) ??
    [];

  return matches
    .map((token) => normalizeDate(token))
    .filter((token): token is string => Boolean(token));
}

function normalizeTenurePeriod(record: Record<string, unknown>): {
  startDate: string;
  endDate: string | null;
} | null {
  const frtoDate = pickFirst(record, ["FRTO_DATE", "frtoDate", "PROFILE_DATE", "profileDate"]);
  const profile = pickFirst(record, ["PROFILE_SJ", "profileSj"]);
  const tokens = [...extractDateTokens(frtoDate), ...extractDateTokens(profile)];
  const uniqueTokens = [...new Set(tokens)].sort();
  const startDate = uniqueTokens[0];

  if (!startDate) {
    return null;
  }

  return {
    startDate,
    endDate: uniqueTokens[1] ?? null
  };
}

function normalizeSourceStatus(record: Record<string, unknown>): SourceStatus {
  const raw = pickFirst(record, [
    "sourceStatus",
    "SOURCE_STATUS",
    "status",
    "STATUS",
    "procStatus",
    "PROC_STATUS"
  ])?.toLowerCase();

  if (!raw) {
    return "confirmed";
  }

  if (raw === "confirmed" || raw === "확정") {
    return "confirmed";
  }

  return "provisional";
}

function normalizeVoteCode(record: Record<string, unknown>): VoteCode {
  const raw = pickFirst(record, [
    "voteCode",
    "VOTE_CODE",
    "resultCode",
    "RESULT_CODE",
    "voteResult",
    "VOTE_RESULT",
    "votngResultNm",
    "RESULT_VOTE_MOD",
    "resultVoteMod"
  ])?.toLowerCase();

  if (!raw) {
    return "unknown";
  }

  if (["yes", "찬성", "approve", "agree"].some((token) => raw.includes(token))) {
    return "yes";
  }

  if (["no", "반대", "oppose", "reject"].some((token) => raw.includes(token))) {
    return "no";
  }

  if (["abstain", "기권"].some((token) => raw.includes(token))) {
    return "abstain";
  }

  if (["absent", "결석", "불참"].some((token) => raw.includes(token))) {
    return "absent";
  }

  if (["invalid", "무효"].some((token) => raw.includes(token))) {
    return "invalid";
  }

  return "unknown";
}

function normalizeComparableText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function createCurrentMemberResolver(currentMembers: MemberRecord[] = []) {
  const membersById = new Map(currentMembers.map((member) => [member.memberId, member]));
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
    resolve(memberId: string | null, memberName: string | null, party: string | null): MemberRecord | undefined {
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
          (candidate) => normalizeComparableText(candidate.party) === normalizedParty
        );

        if (partyMatches.length === 1) {
          return partyMatches[0];
        }
      }

      return candidates.length === 1 ? candidates[0] : undefined;
    }
  };
}

function buildAgendaSummary(record: Record<string, unknown>): string | undefined {
  const parts = [
    pickFirst(record, ["PROC_RESULT_CD", "procResultCd"]),
    pickFirst(record, ["BILL_KIND", "billKind"]),
    normalizeDate(pickFirst(record, ["RGS_PROC_DT", "rgsProcDt", "RGS_PRESENT_DT", "rgsPresentDt"]))
  ].filter((value): value is string => Boolean(value));

  return parts.length > 0 ? parts.join(" · ") : undefined;
}

export function createSourceRecord(context: SourceContext, raw: string): SourceRecord {
  return {
    sourceUrl: context.sourceUrl,
    sourceSystem: new URL(context.sourceUrl).hostname,
    retrievedAt: context.retrievedAt,
    contentSha256: sha256(raw)
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
  const currentMemberResolver = createCurrentMemberResolver(options.currentMembers);

  for (const row of rows) {
    const assemblyNo = normalizeAssemblyNo(row);
    const rawBillNo = pickFirst(row, ["BILL_NO", "billNo", "agendaId", "AGENDA_ID"]);
    const rawMemberName = pickFirst(row, ["HG_NM", "hgNm", "MEMBER_NAME", "memberName"]);

    if (assemblyNo <= 0 || rawBillNo === "의안번호" || rawMemberName === "의원") {
      continue;
    }

    const sessionNo = extractFirstNumber(
      pickFirst(row, ["SESSION_CD", "sessionCd", "MEETINGSESSION", "meetingSession"])
    );
    const meetingNo = extractFirstNumber(
      pickFirst(row, ["CURRENTS_CD", "currentsCd", "CHA", "cha", "CONFER_NUM", "conferNum"])
    );
    const rawVoteDatetime =
      pickFirst(row, ["VOTE_DATE", "voteDate", "voteDatetime", "VOTE_DATETIME", "RGS_PROC_DT"]) ??
      context.retrievedAt;
    const meetingDate = normalizeDate(rawVoteDatetime) ?? normalizeDate(context.retrievedAt);
    const voteDatetime = readString(rawVoteDatetime) ?? context.retrievedAt;
    const meetingId =
      pickFirst(row, ["meetingId", "MEETING_ID", "CONF_ID", "confId"]) ??
      buildMeetingId({ assemblyNo, sessionNo, meetingNo, meetingDate });
    const billId =
      pickFirst(row, ["BILL_ID", "billId"]) ??
      extractBillIdFromUrl(pickFirst(row, ["BILL_URL", "billUrl", "BILL_NAME_URL", "billNameUrl"]));
    const agendaId =
      rawBillNo ??
      pickFirst(row, ["agendaId", "AGENDA_ID", "SUB_NUM", "subNum"]) ??
      billId;
    const rollCallId =
      pickFirst(row, ["rollCallId", "ROLL_CALL_ID", "voteId", "VOTE_ID"]) ??
      `${meetingId}:${billId ?? agendaId ?? "unknown-bill"}`;

    const rawMemberId =
      pickFirst(row, ["MONA_CD", "monaCd", "MEMBER_NO", "memberNo", "MEMBER_ID", "memberId"]) ??
      null;
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
      pickFirst(row, ["BILL_URL", "billUrl", "BILL_NAME_URL", "billNameUrl", "officialSourceUrl"]),
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
          pickFirst(row, ["BILL_NAME", "billName", "LAW_TITLE", "lawTitle", "SUB_NAME", "subName"]) ??
          "Unknown bill",
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
        summary: pickFirst(row, ["LAW_TITLE", "lawTitle", "summary", "SUMMARY"]),
        snapshotId: context.snapshotId,
        sourceHash
      });
    }

    if (memberId && memberName && !membersById.has(memberId)) {
      const district = pickFirst(row, ["ORIG_NM", "origNm", "district", "DISTRICT"]);
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
          readBoolean(row.proportionalFlag ?? row.PROPORTIONAL_FLAG ?? row.reeleGbnNm) ??
          district === "비례대표",
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
          pickFirst(row, ["publishedAt", "PUBLISHED_AT", "VOTE_DATE", "voteDate", "registerDate"])
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
      pickFirst(row, ["RGS_PROC_DT", "rgsProcDt", "RGS_PRESENT_DT", "rgsPresentDt"])
    );
    const billId = pickFirst(row, ["BILL_ID", "billId"]);
    const agendaId = pickFirst(row, ["BILL_NO", "billNo", "SUB_NUM", "subNum"]) ?? billId;
    const billName = pickFirst(row, ["BILL_NAME", "billName", "BILL_NM", "billNm"]);

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
      const sessionNo = extractFirstNumber(pickFirst(row, ["MEETINGSESSION", "meetingSession"]));
      const meetingNo = extractFirstNumber(pickFirst(row, ["CHA", "cha", "CONFER_NUM", "conferNum"]));
      const meetingDate = normalizeDate(
        pickFirst(row, ["MEETTING_DATE", "meetingDate", "CONF_DATE", "confDate"])
      );
      const title = pickFirst(row, ["TITLE", "title"]);

      if (!meetingDate || !title) {
        return undefined;
      }

      const meeting: MeetingRecord = {
        meetingId: buildMeetingId({ assemblyNo, sessionNo, meetingNo, meetingDate }),
        meetingType: title.includes("본회의") ? "Plenary Session" : "Plenary Meeting",
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

  const liveRow = rows.find((row) => readBoolean(row.LBRD_STAT ?? row.lbrdStat) === true) ?? rows[0];
  if (!liveRow) {
    return null;
  }

  const liveStatus = pickFirst(liveRow, ["LBRD_STAT", "lbrdStat"])?.toLowerCase();
  const isLive =
    readBoolean(liveRow.LBRD_STAT ?? liveRow.lbrdStat) ??
    Boolean(liveStatus && ["개의", "live", "on", "진행"].some((token) => liveStatus.includes(token)));
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

export function parseMemberProfileAllXml(xml: string): MemberProfileAllParseResult {
  const parsed = parseXmlDocument(xml);
  const rows = findItems(parsed);
  const candidateProfiles: MemberProfileAllRecord[] = [];
  let currentAssemblyNo = 0;

  for (const row of rows) {
    const naasCd = pickFirst(row, ["NAAS_CD", "naasCd"]);
    const name = pickFirst(row, ["NAAS_NM", "naasNm"]);
    const party = normalizeCurrentSegment(pickFirst(row, ["PLPT_NM", "plptNm"]));
    const district = normalizeCurrentSegment(pickFirst(row, ["ELECD_NM", "elecdNm"]));
    const electionDivision = normalizeCurrentSegment(
      pickFirst(row, ["ELECD_DIV_NM", "elecdDivNm"])
    );
    const representativeCommitteeName = normalizeNullableText(
      pickFirst(row, ["CMIT_NM", "cmitNm"])
    );
    const affiliatedCommitteeName = normalizeNullableText(
      pickFirst(row, ["BLNG_CMIT_NM", "blngCmitNm"])
    );
    const electedAssembliesLabel = normalizeNullableText(
      pickFirst(row, ["GTELT_ERACO", "gteltEraco"])
    );
    const units = electedAssembliesLabel;
    const assemblyNumbers = extractAssemblyNumbers(units);
    const assemblyNo = assemblyNumbers.at(-1) ?? 0;

    currentAssemblyNo = Math.max(currentAssemblyNo, assemblyNo);

    if (!naasCd || !name || !party || assemblyNo <= 0) {
      continue;
    }

    const nameEnglish = normalizeNullableText(pickFirst(row, ["NAAS_EN_NM", "naasEnNm"]));
    const officialProfileUrl = buildOfficialProfileUrl(
      assemblyNo,
      nameEnglish
    );
    const committeeMemberships = [
      ...normalizeCommitteeMemberships(affiliatedCommitteeName ?? ""),
      ...normalizeCommitteeMemberships(representativeCommitteeName ?? "")
    ];

    candidateProfiles.push({
      naasCd,
      name,
      party,
      district: district ?? null,
      committeeMemberships: [...new Set(committeeMemberships)],
      photoUrl: normalizeUrlAgainstAssemblyOrigin(pickFirst(row, ["NAAS_PIC", "naasPic"])),
      officialProfileUrl,
      officialExternalUrl: normalizeOfficialExternalUrl(
        pickFirst(row, ["NAAS_HP_URL", "naasHpUrl"]),
        officialProfileUrl
      ),
      profile: buildMemberInfoProfile({
        nameHanja: normalizeNullableText(pickFirst(row, ["NAAS_CH_NM", "naasChNm"])),
        nameEnglish,
        birthType: normalizeNullableText(pickFirst(row, ["BIRDY_DIV_CD", "birdyDivCd"])),
        birthDate: normalizeDate(pickFirst(row, ["BIRDY_DT", "birdyDt"])) ?? null,
        roleName: normalizeNullableText(pickFirst(row, ["DTY_NM", "dtyNm"])),
        reelectionLabel: normalizeNullableText(pickFirst(row, ["RLCT_DIV_NM", "rlctDivNm"])),
        electedAssembliesLabel,
        gender: normalizeNullableText(pickFirst(row, ["NTR_DIV", "ntrDiv"])),
        representativeCommitteeName,
        affiliatedCommitteeName,
        briefHistory: normalizeMultilineText(pickFirst(row, ["BRF_HST", "brfHst"])),
        officeRoom: normalizeNullableText(pickFirst(row, ["OFFM_RNUM_NO", "offmRnumNo"])),
        officePhone: normalizeNullableText(pickFirst(row, ["NAAS_TEL_NO", "naasTelNo"])),
        email: normalizeNullableText(
          pickFirst(row, ["NAAS_EMAIL_ADDR", "naasEmailAddr"])
        ),
        aideNames: normalizeNameList(pickFirst(row, ["AIDE_NM", "aideNm"])),
        chiefSecretaryNames: normalizeNameList(
          pickFirst(row, ["CHF_SCRT_NM", "chfScrtNm"])
        ),
        secretaryNames: normalizeNameList(pickFirst(row, ["SCRT_NM", "scrtNm"]))
      }),
      proportionalFlag:
        electionDivision === "비례대표" ||
        electionDivision === "전국구" ||
        district === "비례대표",
      assemblyNo
    });
  }

  const profiles =
    currentAssemblyNo > 0
      ? candidateProfiles.filter((member) => member.assemblyNo === currentAssemblyNo)
      : candidateProfiles;

  return {
    profiles,
    currentAssembly:
      currentAssemblyNo > 0
        ? {
            assemblyNo: currentAssemblyNo,
            label: normalizeAssemblyLabel(`제${currentAssemblyNo}대`)
          }
        : null
  };
}

export function parseMemberInfoXml(xml: string): MemberInfoParseResult {
  return parseLegacyMemberInfoXml(xml);
}

export function parseMemberHistoryXml(xml: string): MemberTenureRecord[] {
  const parsed = parseXmlDocument(xml);
  const rows = findItems(parsed);

  const records: MemberTenureRecord[] = [];

  for (const row of rows) {
    const memberId = pickFirst(row, ["MONA_CD", "monaCd", "memberId", "MEMBER_ID"]);
    const name = pickFirst(row, ["HG_NM", "hgNm", "name", "NAME"]);
    const unitCd = pickFirst(row, ["UNIT_CD", "unitCd"]);
    const assemblyNo = normalizeAssemblyNo(row);
    const period = normalizeTenurePeriod(row);

    if (!memberId || !name || assemblyNo <= 0 || !period) {
      continue;
    }

    records.push({
      memberId,
      name,
      assemblyNo,
      ...(unitCd ? { unitCd } : {}),
      startDate: period.startDate,
      endDate: period.endDate
    });
  }

  return records;
}

export function parseCommitteeRosterXml(xml: string): CommitteeRosterRecord[] {
  const parsed = parseXmlDocument(xml);
  const rows = findItems(parsed);

  return rows
    .map((row) => {
      const memberId = pickFirst(row, ["MONA_CD", "monaCd"]);
      const memberName = pickFirst(row, ["HG_NM", "hgNm"]);
      const committeeName = pickFirst(row, ["DEPT_NM", "deptNm"]);

      if (!memberId || !memberName || !committeeName) {
        return undefined;
      }

      return {
        memberId,
        memberName,
        party: pickFirst(row, ["POLY_NM", "polyNm"]) ?? null,
        district: pickFirst(row, ["ORIG_NM", "origNm"]) ?? null,
        committeeName
      };
    })
    .filter((row): row is CommitteeRosterRecord => Boolean(row));
}

export function parseCommitteeOverviewXml(xml: string): CommitteeOverviewRecord[] {
  const parsed = parseXmlDocument(xml);
  const rows = findItems(parsed);

  const records: CommitteeOverviewRecord[] = [];

  for (const row of rows) {
    const committeeName = pickFirst(row, ["COMMITTEE_NAME", "committeeName"]);
    if (!committeeName) {
      continue;
    }

    const memberLimitRaw = pickFirst(row, ["LIMIT_CNT", "limitCnt"]);
    const currentMemberCountRaw = pickFirst(row, ["CURR_CNT", "currCnt"]);

    records.push({
      committeeName,
      committeeType: pickFirst(row, ["CMT_DIV_NM", "cmtDivNm"]) ?? null,
      memberLimit: memberLimitRaw === undefined ? null : toNumber(memberLimitRaw),
      currentMemberCount:
        currentMemberCountRaw === undefined ? null : toNumber(currentMemberCountRaw)
    });
  }

  return records;
}

export function parseBillVoteSummaryXml(xml: string): BillVoteSummaryRecord[] {
  const parsed = parseXmlDocument(xml);
  const rows = findItems(parsed);

  return rows
    .map((row) => {
      const billId = pickFirst(row, ["BILL_ID", "billId"]);
      const billNo = pickFirst(row, ["BILL_NO", "billNo"]);
      const billName = pickFirst(row, ["BILL_NAME", "billName"]);
      const registeredCountRaw = pickFirst(row, ["MEMBER_TCNT", "memberTcnt"]);
      const presentCountRaw = pickFirst(row, ["VOTE_TCNT", "voteTcnt"]);
      const yesCountRaw = pickFirst(row, ["YES_TCNT", "yesTcnt"]);
      const noCountRaw = pickFirst(row, ["NO_TCNT", "noTcnt"]);
      const abstainCountRaw = pickFirst(row, ["BLANK_TCNT", "blankTcnt"]);
      const officialSourceUrl = normalizeOptionalUrl(
        pickFirst(row, ["LINK_URL", "linkUrl"])
      );

      if (
        !billId ||
        !billNo ||
        !billName ||
        registeredCountRaw === undefined ||
        presentCountRaw === undefined ||
        yesCountRaw === undefined ||
        noCountRaw === undefined ||
        abstainCountRaw === undefined ||
        !officialSourceUrl
      ) {
        return undefined;
      }

      const registeredCount = toNumber(registeredCountRaw);
      const presentCount = toNumber(presentCountRaw);
      const yesCount = toNumber(yesCountRaw);
      const noCount = toNumber(noCountRaw);
      const abstainCount = toNumber(abstainCountRaw);

      return {
        billId,
        billNo,
        billName,
        committeeName: pickFirst(row, ["CURR_COMMITTEE", "currCommittee"]) ?? null,
        officialSourceUrl,
        officialTally: {
          registeredCount,
          presentCount,
          yesCount,
          noCount,
          abstainCount,
          invalidCount: 0
        },
        summary: buildAgendaSummary(row) ?? null
      };
    })
    .filter((row): row is BillVoteSummaryRecord => Boolean(row));
}
