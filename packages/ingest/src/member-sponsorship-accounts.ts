import { load } from "cheerio";

import type {
  AccountabilitySummaryItem,
  MemberSponsorshipAccount,
  MemberSponsorshipAccountsExport
} from "@lawmaker-monitor/schemas";

const GIVE_ORIGIN = "https://www.give.go.kr";
const GIVE_LIST_PATH =
  "/portal/supporter/supporterSearch/list.do?gubCd=GUB101&search=Y&menuNo=200025&pageSize=5";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_CONCURRENCY = 4;

const REQUEST_HEADERS = {
  Accept: "text/html,application/xhtml+xml",
  "User-Agent":
    "Mozilla/5.0 (compatible; LawmakerMonitor/1.0; +https://kuil09.github.io/lawmaker-monitor/)"
};

export type SponsorshipDirectoryMember = Pick<
  AccountabilitySummaryItem,
  | "memberId"
  | "name"
  | "party"
  | "district"
  | "officialExternalUrl"
  | "officialProfileUrl"
>;

export type OfficialSupporterRecord = {
  memberName: string;
  supporterName: string;
  party: string;
  district: string | null;
  congressNo: string;
  supportNo: string | null;
  sourceUrl: string;
  donationUrl: string | null;
  homepageUrl: string | null;
};

export type SponsorshipCollectionResult = {
  exportData: MemberSponsorshipAccountsExport;
  warnings: string[];
  stats: {
    directoryMembers: number;
    officialSupporters: number;
    officialRoutes: number;
  };
};

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\u200b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeName(value: string): string {
  return value.replace(/\s+/g, "").trim();
}

function toAbsoluteUrl(
  value: string | undefined,
  baseUrl: string
): string | null {
  if (!value?.trim()) {
    return null;
  }

  try {
    const url = new URL(value.trim(), baseUrl);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function toHttpsUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const url = new URL(value);
  url.protocol = "https:";
  return url.toString();
}

function buildGiveListUrl(pageIndex: number): string {
  const url = new URL(GIVE_LIST_PATH, GIVE_ORIGIN);
  url.searchParams.set("pageIndex", String(pageIndex));
  return url.toString();
}

function extractMemberName(supporterName: string): string {
  return normalizeName(
    supporterName.replace(/^국회의원/, "").replace(/후원회$/, "")
  );
}

function parsePageIndex(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  try {
    const pageIndex = Number(
      new URL(value, GIVE_ORIGIN).searchParams.get("pageIndex")
    );
    return Number.isInteger(pageIndex) && pageIndex > 0 ? pageIndex : null;
  } catch {
    return null;
  }
}

export function parseOfficialSupporterListPage(html: string): {
  records: OfficialSupporterRecord[];
  maxPage: number;
} {
  const $ = load(html);
  const records: OfficialSupporterRecord[] = [];

  $("#listPcbody > tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 5) {
      return;
    }

    const typeText = normalizeWhitespace(cells.eq(0).text());
    if (!typeText.startsWith("국회의원")) {
      return;
    }

    const supporterAnchor = cells.eq(2).find("a").first();
    const supporterName = normalizeWhitespace(supporterAnchor.text());
    const congressNo =
      supporterAnchor
        .attr("onclick")
        ?.match(/pop_intro\(['"](\d+)['"]\)/)?.[1] ?? null;
    if (!supporterName || !congressNo) {
      return;
    }

    const donationAnchor = cells
      .eq(4)
      .find('a[href*="/portal/give.do"]')
      .first();
    const supportNo =
      donationAnchor.attr("href")?.match(/[?&]supportNo=(\d+)/)?.[1] ?? null;
    const homepageAnchor = cells.eq(4).find("a.red").first();
    const homepageUrl = toHttpsUrl(
      toAbsoluteUrl(homepageAnchor.attr("href"), GIVE_ORIGIN)
    );

    records.push({
      memberName: extractMemberName(supporterName),
      supporterName,
      party: normalizeWhitespace(cells.eq(1).text()),
      district: normalizeWhitespace(cells.eq(3).text()) || null,
      congressNo,
      supportNo,
      sourceUrl: new URL(
        `/portal/supporter/supporterSearch/congressView.do?viewType=BODY&congressNo=${encodeURIComponent(
          congressNo
        )}`,
        GIVE_ORIGIN
      ).toString(),
      donationUrl: supportNo
        ? new URL(
            `/portal/give.do?supportNo=${encodeURIComponent(supportNo)}`,
            GIVE_ORIGIN
          ).toString()
        : null,
      homepageUrl
    });
  });

  const pageIndexes = $("a[href*='pageIndex=']")
    .map((_, anchor) => parsePageIndex($(anchor).attr("href")))
    .get()
    .filter((value): value is number => value !== null);

  return {
    records,
    maxPage: Math.max(1, ...pageIndexes)
  };
}

async function fetchText(args: {
  fetchImpl: typeof fetch;
  url: string;
  timeoutMs: number;
}): Promise<string> {
  const response = await args.fetchImpl(args.url, {
    headers: REQUEST_HEADERS,
    signal: AbortSignal.timeout(args.timeoutMs)
  });
  if (!response.ok) {
    throw new Error(`${args.url} returned ${response.status}`);
  }
  return response.text();
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  callback: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await callback(items[index]!);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), items.length) },
      () => worker()
    )
  );
  return results;
}

async function collectOfficialSupporters(args: {
  fetchImpl: typeof fetch;
  timeoutMs: number;
  concurrency: number;
}): Promise<OfficialSupporterRecord[]> {
  const firstHtml = await fetchText({
    fetchImpl: args.fetchImpl,
    url: buildGiveListUrl(1),
    timeoutMs: args.timeoutMs
  });
  const firstPage = parseOfficialSupporterListPage(firstHtml);
  const remainingPages = Array.from(
    { length: Math.max(0, firstPage.maxPage - 1) },
    (_, index) => index + 2
  );
  const remainingRecords = await mapWithConcurrency(
    remainingPages,
    args.concurrency,
    async (pageIndex) =>
      parseOfficialSupporterListPage(
        await fetchText({
          fetchImpl: args.fetchImpl,
          url: buildGiveListUrl(pageIndex),
          timeoutMs: args.timeoutMs
        })
      ).records
  );

  return [...firstPage.records, ...remainingRecords.flat()];
}

function buildUnverifiedRecord(args: {
  member: SponsorshipDirectoryMember;
  supporter: OfficialSupporterRecord;
  generatedAt: string;
}): MemberSponsorshipAccount {
  return {
    recordId: `sponsorship-${args.member.memberId}-unverified`,
    memberId: args.member.memberId,
    status: "unverified",
    sourceUrl: args.supporter.sourceUrl,
    reviewedAt: args.generatedAt,
    reason:
      "The official sponsorship committee and donation links are published without direct payment details.",
    ...(args.supporter.donationUrl
      ? { donationUrl: args.supporter.donationUrl }
      : {})
  };
}

export function pickOfficialSupporter(
  member: SponsorshipDirectoryMember,
  candidates: OfficialSupporterRecord[]
): OfficialSupporterRecord | null {
  const sameParty = candidates.filter(
    (candidate) =>
      normalizeName(candidate.party) === normalizeName(member.party)
  );
  const safeCandidates = sameParty.length > 0 ? sameParty : [];
  if (safeCandidates.length === 1) {
    return safeCandidates[0] ?? null;
  }

  if (safeCandidates.length > 1 && member.district) {
    const normalizedDistrict = normalizeName(member.district);
    const districtMatch = safeCandidates.find((candidate) => {
      const candidateDistrict = normalizeName(candidate.district ?? "");
      return (
        candidateDistrict.includes(normalizedDistrict) ||
        normalizedDistrict.includes(candidateDistrict)
      );
    });
    if (districtMatch) {
      return districtMatch;
    }
  }

  return null;
}

export async function collectMemberSponsorshipAccounts(args: {
  members: SponsorshipDirectoryMember[];
  assemblyNo: number;
  assemblyLabel: string;
  snapshotId: string;
  generatedAt?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  concurrency?: number;
}): Promise<SponsorshipCollectionResult> {
  const generatedAt = args.generatedAt ?? new Date().toISOString();
  const fetchImpl = args.fetchImpl ?? globalThis.fetch;
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const concurrency = args.concurrency ?? DEFAULT_CONCURRENCY;
  const warnings: string[] = [];
  const supporters = await collectOfficialSupporters({
    fetchImpl,
    timeoutMs,
    concurrency
  });
  const supportersByMemberName = new Map<string, OfficialSupporterRecord[]>();
  for (const supporter of supporters) {
    const normalizedMemberName = normalizeName(supporter.memberName);
    const existing = supportersByMemberName.get(normalizedMemberName) ?? [];
    existing.push(supporter);
    supportersByMemberName.set(normalizedMemberName, existing);
  }
  const membersWithSupporters = args.members.flatMap((member) => {
    const supporter = pickOfficialSupporter(
      member,
      supportersByMemberName.get(normalizeName(member.name)) ?? []
    );
    if (!supporter) {
      return [];
    }
    return [{ member, supporter }];
  });

  const accounts = membersWithSupporters.map(({ member, supporter }) =>
    buildUnverifiedRecord({ member, supporter, generatedAt })
  );
  accounts.sort((left, right) => left.memberId.localeCompare(right.memberId));

  return {
    exportData: {
      generatedAt,
      snapshotId: `${args.snapshotId}:sponsorship`,
      assemblyNo: args.assemblyNo,
      assemblyLabel: args.assemblyLabel,
      accounts
    },
    warnings,
    stats: {
      directoryMembers: args.members.length,
      officialSupporters: membersWithSupporters.length,
      officialRoutes: accounts.length
    }
  };
}
