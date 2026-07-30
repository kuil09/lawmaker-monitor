import { createHash } from "node:crypto";

import { load } from "cheerio";

import type {
  AccountabilitySummaryItem,
  MemberSponsorshipAccount,
  MemberSponsorshipAccountsExport
} from "@lawmaker-monitor/schemas";

const GIVE_ORIGIN = "https://www.give.go.kr";
const GIVE_LIST_PATH =
  "/portal/supporter/supporterSearch/list.do?gubCd=GUB101&search=Y&menuNo=200025&pageSize=5";
const CURRENT_ASSEMBLY_START_DATE = "2024-05-30";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_CONCURRENCY = 4;
const MAX_NAVER_CANDIDATES = 5;
const ACCOUNT_NUMBER_PATTERN = /\b\d{2,6}(?:[- ]\d{2,8}){2,5}\b/g;
const PHONE_PREFIXES = new Set([
  "010",
  "011",
  "016",
  "017",
  "018",
  "019",
  "02",
  "031",
  "032",
  "033",
  "041",
  "042",
  "043",
  "044",
  "051",
  "052",
  "053",
  "054",
  "055",
  "061",
  "062",
  "063",
  "064"
]);
const BANK_ALIASES = [
  ["NH농협", "농협"],
  ["농협은행", "농협"],
  ["농협", "농협"],
  ["KB국민", "국민은행"],
  ["국민은행", "국민은행"],
  ["신한은행", "신한은행"],
  ["우리은행", "우리은행"],
  ["하나은행", "하나은행"],
  ["IBK기업", "기업은행"],
  ["기업은행", "기업은행"],
  ["우체국", "우체국"],
  ["SC제일", "SC제일은행"],
  ["제일은행", "SC제일은행"],
  ["카카오뱅크", "카카오뱅크"],
  ["토스뱅크", "토스뱅크"],
  ["케이뱅크", "케이뱅크"],
  ["부산은행", "부산은행"],
  ["대구은행", "iM뱅크"],
  ["iM뱅크", "iM뱅크"],
  ["광주은행", "광주은행"],
  ["전북은행", "전북은행"],
  ["제주은행", "제주은행"],
  ["새마을금고", "새마을금고"],
  ["신협", "신협"],
  ["수협", "수협"]
] as const;

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

export type NaverSearchCandidate = {
  logNo: string;
  title: string;
  snippet: string;
  score: number;
};

export type ExtractedSponsorshipAccount = {
  bankName: string;
  accountNumber: string;
  accountHolder: string;
  sourcePublishedAt: string | null;
};

export type SponsorshipCollectionResult = {
  exportData: MemberSponsorshipAccountsExport;
  warnings: string[];
  stats: {
    directoryMembers: number;
    officialSupporters: number;
    verifiedAccounts: number;
    officialDonationOnly: number;
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

export function extractNaverBlogId(
  value: string | null | undefined
): string | null {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (hostname === "blog.naver.com" || hostname === "m.blog.naver.com") {
      const blogId = url.pathname.split("/").filter(Boolean)[0];
      return blogId && /^[A-Za-z0-9_.-]+$/.test(blogId) ? blogId : null;
    }
    if (hostname.endsWith(".blog.me")) {
      const blogId = hostname.slice(0, -".blog.me".length);
      return blogId && /^[A-Za-z0-9_.-]+$/.test(blogId) ? blogId : null;
    }
  } catch {
    return null;
  }

  return null;
}

function extractLogNo(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value, "https://blog.naver.com");
    const queryLogNo = url.searchParams.get("logNo");
    if (queryLogNo && /^\d+$/.test(queryLogNo)) {
      return queryLogNo;
    }
    const pathLogNo = url.pathname.split("/").filter(Boolean).at(-1);
    return pathLogNo && /^\d+$/.test(pathLogNo) ? pathLogNo : null;
  } catch {
    return null;
  }
}

function scoreNaverSearchCandidate(title: string, snippet: string): number {
  const combined = `${title} ${snippet}`;
  let score = 0;
  if (/후원\s*계좌/.test(combined)) {
    score += 8;
  }
  if (/후원\s*안내/.test(title)) {
    score += 6;
  }
  if (/계좌\s*입금/.test(combined)) {
    score += 4;
  }
  if (BANK_ALIASES.some(([alias]) => combined.includes(alias))) {
    score += 2;
  }
  if (title.includes("후원")) {
    score += 1;
  }
  return score;
}

export function parseNaverSearchCandidates(
  html: string
): NaverSearchCandidate[] {
  const $ = load(html);
  const candidates = new Map<string, NaverSearchCandidate>();

  $("a.s_link").each((_, anchor) => {
    const href = $(anchor).attr("href");
    const logNo = extractLogNo(href);
    if (!logNo) {
      return;
    }

    const resultBlock = $(anchor).closest("table");
    const title = normalizeWhitespace($(anchor).text());
    const snippet = normalizeWhitespace(resultBlock.text()).replace(title, "");
    const candidate = {
      logNo,
      title,
      snippet,
      score: scoreNaverSearchCandidate(title, snippet)
    };
    const existing = candidates.get(logNo);
    if (!existing || candidate.score > existing.score) {
      candidates.set(logNo, candidate);
    }
  });

  return [...candidates.values()]
    .filter((candidate) => candidate.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || right.logNo.localeCompare(left.logNo)
    );
}

function parseKoreanPublishedDate(value: string): string | null {
  const match = value.match(
    /(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})(?:\.\s*(\d{1,2}):(\d{2}))?/
  );
  if (!match) {
    return null;
  }

  const [, year, month, day, hour = "00", minute = "00"] = match;
  const normalized = `${year}-${month!.padStart(2, "0")}-${day!.padStart(
    2,
    "0"
  )}T${hour.padStart(2, "0")}:${minute}:00+09:00`;
  return Number.isNaN(Date.parse(normalized)) ? null : normalized;
}

function normalizeAccountNumber(value: string): string {
  return value.replace(/\s+/g, "-").replace(/-+/g, "-");
}

function isPlausibleAccountNumber(value: string): boolean {
  const segments = value.split(/[- ]+/);
  const digits = value.replace(/\D/g, "");
  if (segments.length < 3 || digits.length < 10 || digits.length > 18) {
    return false;
  }

  return !(
    segments.length === 3 &&
    PHONE_PREFIXES.has(segments[0] ?? "") &&
    digits.length <= 11
  );
}

function findBankName(context: string): string | null {
  return BANK_ALIASES.find(([alias]) => context.includes(alias))?.[1] ?? null;
}

export function extractSponsorshipAccountFromNaverPost(args: {
  html: string;
  memberName: string;
  supporterName: string;
  minimumPublishedDate?: string;
}): ExtractedSponsorshipAccount | null {
  const $ = load(args.html);
  const contentRoot = $(".se-main-container").first();
  const rawText =
    contentRoot.length > 0 ? contentRoot.text() : $("body").first().text();
  const text = normalizeWhitespace(rawText);
  const publishedAt = parseKoreanPublishedDate(
    $(".se_publishDate, ._postAddDate").first().text()
  );
  const minimumPublishedDate =
    args.minimumPublishedDate ?? CURRENT_ASSEMBLY_START_DATE;

  if (
    !text.includes(args.memberName) ||
    !text.includes("후원") ||
    !publishedAt ||
    publishedAt.slice(0, 10) < minimumPublishedDate
  ) {
    return null;
  }

  const holderPattern = new RegExp(
    `(?:국회의원\\s*)?${escapeRegExp(args.memberName)}\\s*후원회`
  );
  const holderMatch = text.match(holderPattern);
  if (!holderMatch) {
    return null;
  }

  for (const match of text.matchAll(ACCOUNT_NUMBER_PATTERN)) {
    const accountNumber = normalizeAccountNumber(match[0]);
    if (!isPlausibleAccountNumber(accountNumber)) {
      continue;
    }

    const start = Math.max(0, (match.index ?? 0) - 180);
    const end = Math.min(
      text.length,
      (match.index ?? 0) + match[0].length + 180
    );
    const context = text.slice(start, end);
    const bankName = findBankName(context);
    if (!bankName || !context.includes("후원")) {
      continue;
    }

    return {
      bankName,
      accountNumber,
      accountHolder: normalizeWhitespace(holderMatch[0]),
      sourcePublishedAt: publishedAt
    };
  }

  return null;
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

function buildNaverSearchUrl(blogId: string): string {
  const url = new URL("/PostSearchList.naver", "https://blog.naver.com");
  url.searchParams.set("blogId", blogId);
  url.searchParams.set("SearchText", "후원");
  url.searchParams.set("directAccess", "true");
  return url.toString();
}

function buildNaverPostFetchUrl(blogId: string, logNo: string): string {
  const url = new URL("/PostView.naver", "https://blog.naver.com");
  url.searchParams.set("blogId", blogId);
  url.searchParams.set("logNo", logNo);
  url.searchParams.set("redirect", "Dlog");
  url.searchParams.set("widgetTypeCall", "true");
  url.searchParams.set("directAccess", "true");
  return url.toString();
}

async function findNaverSponsorshipAccount(args: {
  member: SponsorshipDirectoryMember;
  supporter: OfficialSupporterRecord;
  sourceUrl: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}): Promise<
  | (ExtractedSponsorshipAccount & {
      sourceUrl: string;
    })
  | null
> {
  const blogId = extractNaverBlogId(args.sourceUrl);
  if (!blogId) {
    return null;
  }

  const searchHtml = await fetchText({
    fetchImpl: args.fetchImpl,
    url: buildNaverSearchUrl(blogId),
    timeoutMs: args.timeoutMs
  });
  const candidates = parseNaverSearchCandidates(searchHtml).slice(
    0,
    MAX_NAVER_CANDIDATES
  );

  for (const candidate of candidates) {
    const postHtml = await fetchText({
      fetchImpl: args.fetchImpl,
      url: buildNaverPostFetchUrl(blogId, candidate.logNo),
      timeoutMs: args.timeoutMs
    });
    const account = extractSponsorshipAccountFromNaverPost({
      html: postHtml,
      memberName: args.member.name,
      supporterName: args.supporter.supporterName
    });
    if (account) {
      return {
        ...account,
        sourceUrl: `https://blog.naver.com/${encodeURIComponent(
          blogId
        )}/${encodeURIComponent(candidate.logNo)}`
      };
    }
  }

  return null;
}

function buildVerifiedRecord(args: {
  member: SponsorshipDirectoryMember;
  supporter: OfficialSupporterRecord;
  account: ExtractedSponsorshipAccount & { sourceUrl: string };
  generatedAt: string;
}): MemberSponsorshipAccount {
  const recordHash = createHash("sha256")
    .update(
      `${args.member.memberId}\0${args.account.sourceUrl}\0${args.account.accountNumber}`
    )
    .digest("hex")
    .slice(0, 12);

  return {
    recordId: `sponsorship-${args.member.memberId}-${recordHash}`,
    memberId: args.member.memberId,
    status: "verified",
    bankName: args.account.bankName,
    accountNumber: args.account.accountNumber,
    accountHolder: args.account.accountHolder,
    sourceUrl: args.account.sourceUrl,
    verifiedAt: args.generatedAt,
    ...(args.supporter.donationUrl
      ? { donationUrl: args.supporter.donationUrl }
      : {})
  };
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
      "The official sponsorship committee is registered, but a current direct-deposit account was not found on a member-owned official page.",
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

  const accounts = await mapWithConcurrency(
    membersWithSupporters,
    concurrency,
    async ({ member, supporter }): Promise<MemberSponsorshipAccount> => {
      const sourceUrls = [
        supporter.homepageUrl,
        member.officialExternalUrl ?? null
      ].filter(
        (value, index, values): value is string =>
          Boolean(value) && values.indexOf(value) === index
      );

      for (const sourceUrl of sourceUrls) {
        if (!extractNaverBlogId(sourceUrl)) {
          continue;
        }

        try {
          const account = await findNaverSponsorshipAccount({
            member,
            supporter,
            sourceUrl,
            fetchImpl,
            timeoutMs
          });
          if (account) {
            return buildVerifiedRecord({
              member,
              supporter,
              account,
              generatedAt
            });
          }
        } catch (error) {
          warnings.push(
            `${member.name} (${member.memberId}) sponsorship page failed: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }

      return buildUnverifiedRecord({ member, supporter, generatedAt });
    }
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
      verifiedAccounts: accounts.filter(
        (account) => account.status === "verified"
      ).length,
      officialDonationOnly: accounts.filter(
        (account) => account.status === "unverified"
      ).length
    }
  };
}
