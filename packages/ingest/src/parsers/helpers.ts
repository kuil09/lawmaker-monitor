import type {
  SourceRecord,
  SourceStatus,
  VoteCode,
  VoteVisibility
} from "@lawmaker-monitor/schemas";

import {
  asArray,
  pickFirst,
  readBoolean,
  readString,
  sha256
} from "../utils.js";
import type { SourceContext } from "./types.js";

export function normalizeCommitteeMemberships(value: string): string[] {
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

export function findItems(root: unknown): Record<string, unknown>[] {
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

export function extractFirstNumber(value: unknown, fallback = 0): number {
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

export function normalizeDate(value: unknown): string | undefined {
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

export function normalizeAssemblyNo(record: Record<string, unknown>): number {
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

export function buildMeetingId(args: {
  assemblyNo: number;
  sessionNo: number;
  meetingNo: number;
  meetingDate?: string;
}): string {
  const dateToken = args.meetingDate?.replace(/\D/g, "") ?? "unknown";
  return `plenary-${args.assemblyNo || 0}-${args.sessionNo || 0}-${args.meetingNo || 0}-${dateToken}`;
}

export function normalizeVoteVisibility(record: Record<string, unknown>): VoteVisibility {
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

export function extractBillIdFromUrl(value: string | undefined): string | undefined {
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

export function normalizeOptionalUrl(value: unknown): string | null {
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

export function normalizeUrlAgainstAssemblyOrigin(value: unknown): string | null {
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

export function normalizeOfficialExternalUrl(
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

export function buildOfficialProfileUrl(
  assemblyNo: number,
  englishName: string | null | undefined
): string | null {
  const slug = toEnglishProfileSlug(englishName);
  if (!slug || assemblyNo <= 0) {
    return null;
  }

  return `https://www.assembly.go.kr/members/${toOrdinalLabel(assemblyNo)}/${slug}`;
}

export function normalizeAssemblyLabel(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return normalized;
  }

  return normalized.includes("국회") ? normalized : `${normalized} 국회`;
}

export function extractAssemblyNumbers(value: string | null | undefined): number[] {
  const normalized = value ?? "";
  return [...new Set((normalized.match(/\d{1,2}/g) ?? [])
    .map((token) => Number.parseInt(token, 10))
    .filter((token) => Number.isFinite(token) && token > 0))]
    .sort((left, right) => left - right);
}

export function normalizeNullableText(value: unknown): string | null {
  const normalized = readString(value)?.replace(/\s+/g, " ").trim();
  return normalized ? normalized : null;
}

export function normalizeMultilineText(value: unknown): string | null {
  const normalized = readString(value)
    ?.replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return normalized ? normalized : null;
}

export function normalizeCurrentSegment(value: unknown): string | null {
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

export function normalizeNameList(value: unknown): string[] {
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

export function normalizeSourceStatus(record: Record<string, unknown>): SourceStatus {
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

export function normalizeVoteCode(record: Record<string, unknown>): VoteCode {
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

export function normalizeComparableText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

export function buildAgendaSummary(record: Record<string, unknown>): string | undefined {
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
