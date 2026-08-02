import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  chromium,
  request,
  type APIRequestContext,
  type Locator,
  type Page
} from "playwright";

import {
  buildAssemblySearchWindows,
  hasPendingBackfill,
  resolveEffectiveRecentDays,
  resolveNextBackfillCursorDate,
  resolvePublishedBackfillCursor,
  shiftIsoDate,
  sortDatedItemsNewestFirst,
  type AssemblySearchWindow
} from "../assembly-mirror-policy.js";
import {
  buildDocumentId,
  buildDocumentPaths,
  dateInTimeZone,
  detectFileExtension,
  isPastDocumentDate,
  mergeDocumentIndex,
  normalizeDocumentDate,
  selectExistingMirroredMetadata,
  toIndexItem
} from "../document-mirror.js";
import {
  ASSEMBLY_MINUTES_TRANSCRIPT_PARSER_VERSION,
  isOfficialAssemblyMinutesViewerUrl,
  parseAssemblyMinutesViewerHtml
} from "../minutes-transcript.js";
import {
  isOfficialAttendanceRelevantMinutesTitle,
  parseOfficialMinutesAttendanceHtml
} from "../official-attendance.js";
import {
  readJsonFile,
  readPositiveInteger,
  readString,
  retryFetch,
  resolvePathFromRoot,
  sha256,
  sha256Buffer,
  toNumber,
  writeJsonFile
} from "../utils.js";

import type {
  DocumentMirrorState,
  MirroredDocumentIndex,
  MirroredDocumentMetadata,
  MirroredDocumentMetadataLookups
} from "../document-mirror.js";

export type MirrorMode =
  | "generic"
  | "assembly_minutes_search"
  | "assembly_minutes_catalog"
  | "assembly_file_service";

type MirrorConfig = {
  mode: MirrorMode;
  sourceId: string;
  startUrl: string;
  readySelector?: string;
  rowSelector: string;
  titleSelector?: string;
  linkSelector: string;
  linkAttribute: string;
  dateSelector?: string;
  nextSelector?: string;
  maxPages: number;
  maxDownloads: number;
  downloadConcurrency: number;
  pageSize: number;
  pageDelayMs: number;
  timeoutMs: number;
  timeZone: string;
  dataRepoDir: string;
  indexPath: string;
  statePath: string;
  userAgent: string;
  assemblyNo: number;
  recentDays: number;
  backfillStartDate: string;
  backfillDays: number;
  backfillCursorOverride?: string;
  backfillWindowsPerRun: number;
  skipRecent: boolean;
  retryExistingOnly: boolean;
  includeAppendices: boolean;
  serviceInfId?: string;
  serviceInfSeq: number;
};

type MirrorCandidate = {
  documentId?: string;
  title: string;
  sourceUrl: string;
  downloadUrl?: string;
  publishedDate: string | null;
  discoveredFromUrl: string;
  sourceMetadata?: Record<string, string | number | null>;
};

type MirrorOutcome =
  | {
      type: "downloaded";
      metadata: MirroredDocumentMetadata;
      updated: boolean;
      downloaded: DownloadedDocument;
    }
  | {
      type: "unchanged";
      metadata: MirroredDocumentMetadata;
      downloaded: DownloadedDocument;
    };

type DownloadedDocument = {
  body: Buffer;
  responseUrl: string;
  contentType: string;
  contentDisposition?: string;
  sourceMetadata?: Record<string, string | number | null>;
};

type MetadataLookups = MirroredDocumentMetadataLookups;

type CandidateCollectionResult = {
  candidates: MirrorCandidate[];
  pagesVisited: number;
  discoveredCandidates: number;
  recentWindowStartDate?: string;
  recentWindowEndDate?: string;
  nextBackfillCursorDate?: string | null;
  sourceSnapshotSha256?: string;
  sourceSnapshotCount?: number;
  sourceSnapshotUnchanged?: boolean;
};

export type FormValueMap = Map<string, string[]>;

export type AssemblySearchItem = Record<string, unknown>;

type AssemblySearchRecord = {
  indexColl?: string;
  collectionName?: string;
  totalCount?: number;
  resultList?: AssemblySearchItem[];
};

type AssemblySearchResponse = {
  allCount?: number;
  record1?: AssemblySearchRecord;
  record2?: AssemblySearchRecord;
  record3?: AssemblySearchRecord;
  record4?: AssemblySearchRecord;
  record5?: AssemblySearchRecord;
  record6?: AssemblySearchRecord;
  record7?: AssemblySearchRecord;
  record_app?: AssemblySearchRecord;
  record_app_bo?: AssemblySearchRecord;
};

type AssemblyFileServiceItem = {
  infId?: string;
  infSeq?: number;
  fileSeq?: number;
  viewFileNm?: string;
  fileExt?: string;
  ftCrDttm?: string;
  cvtFileSize?: string;
};

type AssemblyFileServiceResponse = {
  data?: AssemblyFileServiceItem[];
};

export type AssemblyMinutesCatalogItem = Record<string, unknown>;

type AssemblyMinutesCatalogResponse = {
  total?: number | string;
  data?: AssemblyMinutesCatalogItem[];
};

export type AssemblyMinutesCatalogService = {
  infId: string;
  kind: "plenary" | "committee";
};

const officialAssemblyOpenDataOrigin = "https://open.assembly.go.kr";
const officialAssemblyMinutesOrigin = "https://record.assembly.go.kr";
const assemblyMinutesCatalogServices: AssemblyMinutesCatalogService[] = [
  {
    infId: "OO1X9P001017YF13038",
    kind: "plenary"
  },
  {
    infId: "OR137O001023MZ19321",
    kind: "committee"
  }
];

const assemblyMinuteRecordKeys = [
  "record1",
  "record2",
  "record3",
  "record4",
  "record5",
  "record6",
  "record7"
] as const;
const assemblyMinuteClassCodes = ["1", "2", "3", "4", "5", "6", "7"] as const;

const assemblyAppendixRecordKeys = ["record_app", "record_app_bo"] as const;

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be configured.`);
  }

  return value;
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) {
    return fallback;
  }

  return ["1", "true", "y", "yes", "on"].includes(raw);
}

function compactDate(date: string): string {
  return date.replaceAll("-", "");
}

function parseServiceInfId(startUrl: string): string | undefined {
  const matched = startUrl.match(/\/selectServicePage\.do\/([^/?#]+)/);
  return matched?.[1];
}

export function resolveMirrorRecentDays(
  mode: MirrorMode,
  configuredDays: number,
  minimumDays: number
): number {
  return mode === "assembly_minutes_search" ||
    mode === "assembly_minutes_catalog"
    ? resolveEffectiveRecentDays(configuredDays, minimumDays)
    : configuredDays;
}

export function resolveMirrorDownloadConcurrency(
  mode: MirrorMode,
  configuredConcurrency: number
): number {
  return mode === "assembly_minutes_catalog" ? 1 : configuredConcurrency;
}

export function resolveMirrorDataRepoDir(
  repositoryRoot: string,
  configuredPath: string | undefined
): string {
  return resolvePathFromRoot(
    repositoryRoot,
    configuredPath?.trim() || join(repositoryRoot, "published-data")
  );
}

function loadConfig(): MirrorConfig {
  const repositoryRoot = resolve(
    fileURLToPath(new URL("../../../../", import.meta.url))
  );
  const startUrl = readRequiredEnv("MIRROR_START_URL");
  const configuredMode = process.env.MIRROR_MODE?.trim() as
    | MirrorMode
    | undefined;
  const serviceInfId =
    process.env.MIRROR_SERVICE_INF_ID?.trim() || parseServiceInfId(startUrl);
  const mode: MirrorMode =
    configuredMode ??
    (startUrl.includes("/mnts/minutes/search.do")
      ? "assembly_minutes_search"
      : "generic");
  const configuredRecentDays = readPositiveInteger("MIRROR_RECENT_DAYS", 3);

  const config: MirrorConfig = {
    mode,
    sourceId:
      process.env.MIRROR_SOURCE_ID?.trim() || "assembly-public-documents",
    startUrl,
    readySelector: process.env.MIRROR_READY_SELECTOR?.trim(),
    rowSelector:
      process.env.MIRROR_ROW_SELECTOR?.trim() ||
      ".sch_rslt .rslt_list > li.list",
    titleSelector:
      process.env.MIRROR_TITLE_SELECTOR?.trim() || ".con .ellipsis a",
    linkSelector:
      process.env.MIRROR_LINK_SELECTOR?.trim() ||
      ".btn_list a[href*='/viewer/minutes/download/pdf.do'], .btn_list a[href*='/viewer/minutes/download/hwp.do'], .btn_list a[href*='/viewer/minutes/download/img.do'], .con .ellipsis a",
    linkAttribute: process.env.MIRROR_LINK_ATTRIBUTE?.trim() || "href",
    dateSelector: process.env.MIRROR_DATE_SELECTOR?.trim() || ".std .date",
    nextSelector:
      process.env.MIRROR_NEXT_SELECTOR?.trim() ||
      ".page_nav a.next:not([disabled])",
    maxPages: readPositiveInteger("MIRROR_MAX_PAGES", 25),
    maxDownloads: readPositiveInteger("MIRROR_MAX_DOWNLOADS", 500),
    downloadConcurrency: resolveMirrorDownloadConcurrency(
      mode,
      readPositiveInteger("MIRROR_DOWNLOAD_CONCURRENCY", 4)
    ),
    pageSize: readPositiveInteger("MIRROR_PAGE_SIZE", 100),
    pageDelayMs: readPositiveInteger("MIRROR_PAGE_DELAY_MS", 1000),
    timeoutMs: readPositiveInteger("MIRROR_TIMEOUT_MS", 20_000),
    timeZone: process.env.MIRROR_TIME_ZONE?.trim() || "Asia/Seoul",
    dataRepoDir: resolveMirrorDataRepoDir(
      repositoryRoot,
      process.env.DATA_REPO_DIR
    ),
    indexPath:
      process.env.MIRROR_INDEX_PATH?.trim() || "raw/index/document_index.json",
    statePath:
      process.env.MIRROR_STATE_PATH?.trim() ||
      "manifests/document_mirror_state.json",
    userAgent:
      process.env.MIRROR_USER_AGENT?.trim() ||
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    assemblyNo: readPositiveInteger("MIRROR_ASSEMBLY_NO", 22),
    recentDays: resolveMirrorRecentDays(
      mode,
      configuredRecentDays,
      readPositiveInteger("MIRROR_MIN_RECENT_DAYS", 30)
    ),
    backfillStartDate:
      process.env.MIRROR_BACKFILL_START_DATE?.trim() || "2024-05-30",
    backfillDays: readPositiveInteger("MIRROR_BACKFILL_DAYS", 7),
    backfillCursorOverride:
      process.env.MIRROR_BACKFILL_CURSOR_OVERRIDE?.trim() || undefined,
    backfillWindowsPerRun: readPositiveInteger(
      "MIRROR_BACKFILL_WINDOWS_PER_RUN",
      1
    ),
    skipRecent: readBooleanEnv("MIRROR_SKIP_RECENT", false),
    retryExistingOnly: readBooleanEnv("MIRROR_RETRY_EXISTING_ONLY", false),
    includeAppendices: readBooleanEnv("MIRROR_INCLUDE_APPENDICES", true),
    serviceInfId,
    serviceInfSeq: readPositiveInteger("MIRROR_SERVICE_INF_SEQ", 1)
  };

  if (config.retryExistingOnly && config.mode !== "assembly_minutes_catalog") {
    throw new Error(
      "MIRROR_RETRY_EXISTING_ONLY is supported only in assembly_minutes_catalog mode."
    );
  }
  if (config.retryExistingOnly && config.backfillCursorOverride) {
    throw new Error(
      "MIRROR_BACKFILL_CURSOR_OVERRIDE cannot be used with MIRROR_RETRY_EXISTING_ONLY."
    );
  }

  return config;
}

async function locatorText(locator: Locator): Promise<string | undefined> {
  try {
    return readString(await locator.textContent());
  } catch {
    return undefined;
  }
}

async function locatorAttribute(
  locator: Locator,
  attribute: string
): Promise<string | undefined> {
  try {
    return readString(await locator.getAttribute(attribute));
  } catch {
    return undefined;
  }
}

async function collectCandidates(
  page: Page,
  config: MirrorConfig
): Promise<MirrorCandidate[]> {
  const rows = page.locator(config.rowSelector);
  const rowCount = await rows.count();
  if (rowCount === 0) {
    return [];
  }

  const candidates: MirrorCandidate[] = [];

  for (let index = 0; index < rowCount; index += 1) {
    const row = rows.nth(index);
    const linkLocator = row.locator(config.linkSelector).first();
    const titleLocator = config.titleSelector
      ? row.locator(config.titleSelector).first()
      : linkLocator;

    const href = await locatorAttribute(linkLocator, config.linkAttribute);
    if (!href) {
      continue;
    }

    const title =
      (await locatorText(titleLocator)) ??
      (await locatorText(linkLocator)) ??
      `Document ${index + 1}`;
    const dateText = config.dateSelector
      ? await locatorText(row.locator(config.dateSelector).first())
      : await locatorText(row);

    candidates.push({
      title,
      sourceUrl: new URL(href, page.url()).toString(),
      publishedDate: normalizeDocumentDate(dateText ?? ""),
      discoveredFromUrl: page.url()
    });
  }

  return candidates;
}

async function hashVisibleRows(
  page: Page,
  rowSelector: string
): Promise<string> {
  const rows = page.locator(rowSelector);
  const texts = await rows.allInnerTexts();
  return sha256(texts.join("\n"));
}

async function goToNextPage(
  page: Page,
  config: MirrorConfig
): Promise<boolean> {
  if (!config.nextSelector) {
    return false;
  }

  const next = page.locator(config.nextSelector).first();
  if ((await next.count()) === 0) {
    return false;
  }

  const before = await hashVisibleRows(page, config.rowSelector);

  try {
    await next.click({ timeout: config.timeoutMs });
    await page.waitForTimeout(config.pageDelayMs);
    await page
      .waitForLoadState("domcontentloaded", { timeout: config.timeoutMs })
      .catch(() => undefined);
  } catch {
    return false;
  }

  const after = await hashVisibleRows(page, config.rowSelector);
  return before !== after;
}

async function collectGenericCandidates(
  page: Page,
  config: MirrorConfig
): Promise<CandidateCollectionResult> {
  const candidates: MirrorCandidate[] = [];
  let pagesVisited = 0;
  let discoveredCandidates = 0;

  for (let pageNumber = 1; pageNumber <= config.maxPages; pageNumber += 1) {
    const pageCandidates = await collectCandidates(page, config);
    if (pageCandidates.length === 0) {
      break;
    }

    pagesVisited += 1;
    discoveredCandidates += pageCandidates.length;
    candidates.push(...pageCandidates);

    const hasNextPage = await goToNextPage(page, config);
    if (!hasNextPage) {
      break;
    }
  }

  return {
    candidates,
    pagesVisited,
    discoveredCandidates
  };
}

function appendFormValue(map: FormValueMap, key: string, value: string): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

function cloneFormValues(source: FormValueMap): FormValueMap {
  return new Map(
    [...source.entries()].map(([key, values]) => [key, [...values]])
  );
}

function setSingleFormValue(
  map: FormValueMap,
  key: string,
  value: string | undefined
): void {
  if (value === undefined) {
    map.delete(key);
    return;
  }

  map.set(key, [value]);
}

function formValuesToSearchParams(map: FormValueMap): URLSearchParams {
  const params = new URLSearchParams();

  for (const [key, values] of map.entries()) {
    for (const value of values) {
      params.append(key, value);
    }
  }

  return params;
}

async function extractAssemblyFormValues(page: Page): Promise<FormValueMap> {
  const entries = await page.evaluate(() => {
    const form = document.querySelector("form[name='frm_sch']");
    if (!(form instanceof HTMLFormElement)) {
      throw new Error("Expected minutes search form to exist on the page.");
    }

    return Array.from(new FormData(form).entries()).map(([key, value]) => [
      key,
      String(value)
    ]) as [string, string][];
  });

  const formValues: FormValueMap = new Map();
  for (const [key, value] of entries) {
    appendFormValue(formValues, key, value);
  }

  return formValues;
}

export function normalizeCompactAssemblyDate(value: unknown): string | null {
  const text = readString(value);
  if (!text) {
    return null;
  }

  if (/^\d{8}(?:\d{6})?$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  }

  return normalizeDocumentDate(text);
}

export function isAssemblyMinutesViewerUrl(value: string): boolean {
  try {
    return new URL(value).pathname === "/assembly/viewer/minutes/xml.do";
  } catch {
    return false;
  }
}

export function buildAssemblyFileServiceSourceSnapshot(
  items: AssemblyFileServiceItem[]
): {
  count: number;
  sha256: string;
} {
  const normalized = [...items]
    .map((item) => ({
      cvtFileSize: readString(item.cvtFileSize) ?? "",
      fileExt: readString(item.fileExt) ?? "",
      fileSeq: toNumber(item.fileSeq),
      ftCrDttm:
        normalizeCompactAssemblyDate(item.ftCrDttm) ??
        readString(item.ftCrDttm) ??
        "",
      infId: readString(item.infId) ?? "",
      infSeq: toNumber(item.infSeq),
      viewFileNm: readString(item.viewFileNm) ?? ""
    }))
    .sort((left, right) => {
      const byFileSeq = left.fileSeq - right.fileSeq;
      if (byFileSeq !== 0) {
        return byFileSeq;
      }

      const byDate = left.ftCrDttm.localeCompare(right.ftCrDttm);
      if (byDate !== 0) {
        return byDate;
      }

      return left.viewFileNm.localeCompare(right.viewFileNm, "ko-KR");
    });

  return {
    count: normalized.length,
    sha256: sha256(JSON.stringify(normalized))
  };
}

export function shouldSkipAssemblyFileServiceRefresh(args: {
  existingState: DocumentMirrorState | null;
  hasBackfillWindow: boolean;
  sourceSnapshotCount: number;
  sourceSnapshotSha256: string;
}): boolean {
  return Boolean(
    !args.hasBackfillWindow &&
    args.existingState?.sourceSnapshotSha256 === args.sourceSnapshotSha256 &&
    args.existingState?.sourceSnapshotCount === args.sourceSnapshotCount
  );
}

function buildAssemblyMinutesCandidate(
  item: AssemblySearchItem,
  config: MirrorConfig,
  discoveredFromUrl: string
): MirrorCandidate | null {
  const minutesId = readString(item.MNTS_ID);
  if (!minutesId) {
    return null;
  }

  const publishedDate = normalizeCompactAssemblyDate(item.DATE);
  const committeeName = readString(item.CMIT_NM);
  const assemblyLabel = readString(item.TH_TEXT);
  const sessionNo = readString(item.SESS);
  const title =
    [
      assemblyLabel,
      sessionNo ? `제${sessionNo}회` : null,
      committeeName,
      "회의록"
    ]
      .filter((value): value is string => Boolean(value))
      .join(" ") || `Minutes ${minutesId}`;

  const viewerUrl = new URL(
    `/assembly/viewer/minutes/xml.do?id=${minutesId}&type=view`,
    config.startUrl
  ).toString();
  return {
    documentId: `${config.sourceId}-minutes-${minutesId}`,
    title,
    sourceUrl: viewerUrl,
    downloadUrl: viewerUrl,
    publishedDate,
    discoveredFromUrl,
    sourceMetadata: {
      minutesId,
      assemblyNo: readString(item.TH) ?? null,
      sessionNo: sessionNo ?? null,
      committeeName: committeeName ?? null,
      meetingSubtitle:
        readString(item.SUB_NAME) ??
        readString(item.SUB_NM) ??
        readString(item.SUB_TITLE) ??
        null,
      meetingFileId: readString(item.FILE_ID) ?? null
    }
  };
}

function buildAssemblyAppendixCandidate(
  item: AssemblySearchItem,
  config: MirrorConfig,
  discoveredFromUrl: string
): MirrorCandidate | null {
  const appendixId = readString(item.APNDX_ID);
  if (!appendixId) {
    return null;
  }

  const downloadUrl = new URL(
    `/assembly/mnts/apdix/apdixDownload.do?fileId=${appendixId}`,
    config.startUrl
  ).toString();

  return {
    documentId: `${config.sourceId}-appendix-${appendixId}`,
    title: readString(item.APNDX_NM) ?? `Appendix ${appendixId}`,
    sourceUrl: downloadUrl,
    downloadUrl,
    publishedDate: normalizeCompactAssemblyDate(item.DATE),
    discoveredFromUrl
  };
}

function buildAssemblyFileServiceCandidate(
  item: AssemblyFileServiceItem,
  config: MirrorConfig
): MirrorCandidate | null {
  const fileSeq = typeof item.fileSeq === "number" ? item.fileSeq : null;
  const infId = readString(item.infId) ?? config.serviceInfId;
  const infSeq =
    typeof item.infSeq === "number" && Number.isFinite(item.infSeq)
      ? item.infSeq
      : config.serviceInfSeq;
  const title = readString(item.viewFileNm);
  const publishedDate = normalizeDocumentDate(readString(item.ftCrDttm) ?? "");

  if (!fileSeq || !infId || !title || !publishedDate) {
    return null;
  }

  const downloadUrl = new URL(
    `/portal/data/file/downloadFileData.do?infId=${encodeURIComponent(infId)}&infSeq=${encodeURIComponent(String(infSeq))}&fileSeq=${encodeURIComponent(String(fileSeq))}`,
    config.startUrl
  ).toString();

  return {
    documentId: `${config.sourceId}-file-${fileSeq}`,
    title,
    sourceUrl: config.startUrl,
    downloadUrl,
    publishedDate,
    discoveredFromUrl: config.startUrl,
    sourceMetadata: {
      fileSeq,
      infId,
      infSeq,
      viewFileNm: title,
      ftCrDttm: publishedDate,
      fileExt: readString(item.fileExt) ?? "pdf",
      cvtFileSize: readString(item.cvtFileSize) ?? null
    }
  };
}

function collectAssemblyCandidatesFromResponse(
  response: AssemblySearchResponse,
  config: MirrorConfig,
  discoveredFromUrl: string,
  includeAppendices: boolean
): MirrorCandidate[] {
  const candidates: MirrorCandidate[] = [];

  for (const key of assemblyMinuteRecordKeys) {
    const record = response[key];
    for (const item of record?.resultList ?? []) {
      const candidate = buildAssemblyMinutesCandidate(
        item,
        config,
        discoveredFromUrl
      );
      if (!candidate) {
        throw new Error(
          `Official Assembly minutes search returned a ${key} row without MNTS_ID.`
        );
      }
      candidates.push(candidate);
    }
  }

  if (!includeAppendices) {
    return candidates;
  }

  for (const key of assemblyAppendixRecordKeys) {
    const record = response[key];
    for (const item of record?.resultList ?? []) {
      const candidate = buildAssemblyAppendixCandidate(
        item,
        config,
        discoveredFromUrl
      );
      if (!candidate) {
        throw new Error(
          `Official Assembly minutes search returned a ${key} row without APNDX_ID.`
        );
      }
      candidates.push(candidate);
    }
  }

  return candidates;
}

export function responsePageCount(
  response: AssemblySearchResponse,
  includeAppendices: boolean,
  pageSize = 10
): number {
  const keys = includeAppendices
    ? [...assemblyMinuteRecordKeys, ...assemblyAppendixRecordKeys]
    : [...assemblyMinuteRecordKeys];

  let totalPages = 1;
  for (const key of keys) {
    const count = response[key]?.totalCount ?? 0;
    totalPages = Math.max(totalPages, Math.ceil(count / pageSize));
  }

  return totalPages;
}

export function assertAssemblySearchResponsesComplete(
  responses: AssemblySearchResponse[],
  includeAppendices: boolean
): void {
  const first = responses[0];
  if (!first) {
    throw new Error("Official Assembly minutes search returned no response.");
  }

  const keys = includeAppendices
    ? [...assemblyMinuteRecordKeys, ...assemblyAppendixRecordKeys]
    : [...assemblyMinuteRecordKeys];
  for (const key of keys) {
    const expected = first[key]?.totalCount ?? 0;
    const received = responses.reduce(
      (total, response) => total + (response[key]?.resultList?.length ?? 0),
      0
    );
    const inconsistentTotal = responses.some((response) => {
      const totalCount = response[key]?.totalCount;
      return totalCount !== undefined && totalCount !== expected;
    });

    if (inconsistentTotal || received !== expected) {
      throw new Error(
        `Official Assembly minutes search was incomplete for ${key}: expected ${expected}, received ${received}.`
      );
    }
  }
}

async function postAssemblySearch(
  api: APIRequestContext,
  config: MirrorConfig,
  params: URLSearchParams
): Promise<AssemblySearchResponse> {
  const response = await api.post(
    new URL("/assembly/mnts/search/search.do", config.startUrl).toString(),
    {
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
        referer: config.startUrl
      },
      data: params.toString(),
      timeout: config.timeoutMs,
      failOnStatusCode: true
    }
  );

  return (await response.json()) as AssemblySearchResponse;
}

export function buildAssemblyMinutesParams(
  baseValues: FormValueMap,
  window: AssemblySearchWindow,
  pageNumber: number,
  pageSize = 10
): URLSearchParams {
  const formValues = cloneFormValues(baseValues);

  formValues.delete("CMIT_CD");
  formValues.delete("SUBJ_CD");
  formValues.delete("SPK_CD");
  setSingleFormValue(formValues, "startDate", compactDate(window.startDate));
  setSingleFormValue(formValues, "endDate", compactDate(window.endDate));
  setSingleFormValue(
    formValues,
    "collection",
    "record1,record2,record3,record4,record5,record6,record7"
  );
  setSingleFormValue(formValues, "CLASS_CD", "1,2,3,4,5,6,7");
  setSingleFormValue(formValues, "query", "");
  setSingleFormValue(formValues, "SPK_NM", "");
  setSingleFormValue(formValues, "SPKSAME", "N");
  setSingleFormValue(formValues, "sort", "RDATE");
  setSingleFormValue(formValues, "searchField", "SPK_CNTS,ITEM_NM,ETC_CNTS");
  setSingleFormValue(formValues, "startCount", String(pageNumber));
  setSingleFormValue(formValues, "listCount", String(pageSize));

  return formValuesToSearchParams(formValues);
}

function buildAssemblyAppendixParams(
  baseValues: FormValueMap,
  window: AssemblySearchWindow,
  pageNumber: number,
  pageSize = 10
): URLSearchParams {
  const formValues = cloneFormValues(baseValues);

  formValues.delete("CMIT_CD");
  formValues.delete("SUBJ_CD");
  formValues.delete("SPK_CD");
  setSingleFormValue(formValues, "startDate", compactDate(window.startDate));
  setSingleFormValue(formValues, "endDate", compactDate(window.endDate));
  setSingleFormValue(formValues, "collection", "record_app,record_app_bo");
  setSingleFormValue(formValues, "query", "");
  setSingleFormValue(formValues, "SPK_NM", "");
  setSingleFormValue(formValues, "SPKSAME", "N");
  setSingleFormValue(formValues, "sort", "RDATE");
  setSingleFormValue(formValues, "searchField", "");
  setSingleFormValue(formValues, "startCount", String(pageNumber));
  setSingleFormValue(formValues, "listCount", String(pageSize));
  formValues.delete("CLASS_CD");

  return formValuesToSearchParams(formValues);
}

async function collectAssemblyCandidates(
  page: Page,
  api: APIRequestContext,
  config: MirrorConfig,
  existingState: DocumentMirrorState | null,
  cutoffDate: string
): Promise<CandidateCollectionResult> {
  const baseValues = await extractAssemblyFormValues(page);
  const coarseWindows = buildAssemblySearchWindows(
    cutoffDate,
    config,
    existingState,
    {
      backfillCursorDate: config.backfillCursorOverride,
      includeRecent: !config.skipRecent,
      maxBackfillWindows: config.backfillWindowsPerRun
    }
  );
  const windows = coarseWindows;
  const candidates: MirrorCandidate[] = [];
  let pagesVisited = 0;
  let discoveredCandidates = 0;

  for (const [windowIndex, window] of windows.entries()) {
    if (windowIndex > 0) {
      await page.waitForTimeout(config.pageDelayMs);
    }
    const minutesFirst = await postAssemblySearch(
      api,
      config,
      buildAssemblyMinutesParams(baseValues, window, 1, config.pageSize)
    );
    const minutesResponses = [minutesFirst];
    pagesVisited += 1;
    const minutesDiscoveryUrl = `${config.startUrl}#minutes:${window.startDate}:${window.endDate}:1`;
    const minutesCandidates = collectAssemblyCandidatesFromResponse(
      minutesFirst,
      config,
      minutesDiscoveryUrl,
      false
    );
    discoveredCandidates += minutesCandidates.length;
    candidates.push(...minutesCandidates);

    const minutePages = Math.min(
      responsePageCount(minutesFirst, false, config.pageSize),
      config.maxPages
    );
    for (let pageNumber = 2; pageNumber <= minutePages; pageNumber += 1) {
      await page.waitForTimeout(config.pageDelayMs);
      const response = await postAssemblySearch(
        api,
        config,
        buildAssemblyMinutesParams(
          baseValues,
          window,
          pageNumber,
          config.pageSize
        )
      );
      minutesResponses.push(response);
      pagesVisited += 1;
      const discoveryUrl = `${config.startUrl}#minutes:${window.startDate}:${window.endDate}:${pageNumber}`;
      const pageCandidates = collectAssemblyCandidatesFromResponse(
        response,
        config,
        discoveryUrl,
        false
      );
      discoveredCandidates += pageCandidates.length;
      candidates.push(...pageCandidates);
    }
    assertAssemblySearchResponsesComplete(minutesResponses, false);

    if (config.includeAppendices) {
      await page.waitForTimeout(config.pageDelayMs);
      const appendixFirst = await postAssemblySearch(
        api,
        config,
        buildAssemblyAppendixParams(baseValues, window, 1, config.pageSize)
      );
      const appendixResponses = [appendixFirst];
      pagesVisited += 1;
      const appendixDiscoveryUrl = `${config.startUrl}#appendix:${window.startDate}:${window.endDate}:1`;
      const appendixCandidates = collectAssemblyCandidatesFromResponse(
        appendixFirst,
        config,
        appendixDiscoveryUrl,
        true
      ).filter((candidate) => candidate.documentId?.includes("-appendix-"));
      discoveredCandidates += appendixCandidates.length;
      candidates.push(...appendixCandidates);

      const appendixPages = Math.min(
        responsePageCount(appendixFirst, true, config.pageSize),
        config.maxPages
      );
      for (let pageNumber = 2; pageNumber <= appendixPages; pageNumber += 1) {
        await page.waitForTimeout(config.pageDelayMs);
        const response = await postAssemblySearch(
          api,
          config,
          buildAssemblyAppendixParams(
            baseValues,
            window,
            pageNumber,
            config.pageSize
          )
        );
        appendixResponses.push(response);
        pagesVisited += 1;
        const discoveryUrl = `${config.startUrl}#appendix:${window.startDate}:${window.endDate}:${pageNumber}`;
        const pageCandidates = collectAssemblyCandidatesFromResponse(
          response,
          config,
          discoveryUrl,
          true
        ).filter((candidate) => candidate.documentId?.includes("-appendix-"));
        discoveredCandidates += pageCandidates.length;
        candidates.push(...pageCandidates);
      }
      assertAssemblySearchResponsesComplete(appendixResponses, true);
    }
  }

  return {
    candidates,
    pagesVisited,
    discoveredCandidates,
    recentWindowStartDate: coarseWindows.find(
      (window) => window.label === "recent"
    )?.startDate,
    recentWindowEndDate: coarseWindows
      .filter((window) => window.label === "recent")
      .at(-1)?.endDate,
    nextBackfillCursorDate: resolveNextBackfillCursorDate({
      cutoffDate,
      config,
      existingState,
      windows: coarseWindows
    })
  };
}

function isDateWithinSearchWindow(
  date: string,
  window: AssemblySearchWindow
): boolean {
  return date >= window.startDate && date <= window.endDate;
}

function mergeAssemblySearchWindows(
  windows: AssemblySearchWindow[]
): AssemblySearchWindow[] {
  const sorted = [...windows].sort((left, right) =>
    left.startDate.localeCompare(right.startDate)
  );
  const merged: AssemblySearchWindow[] = [];
  for (const window of sorted) {
    const previous = merged.at(-1);
    if (previous && window.startDate <= shiftIsoDate(previous.endDate, 1)) {
      previous.endDate =
        previous.endDate >= window.endDate ? previous.endDate : window.endDate;
      continue;
    }
    merged.push({ ...window });
  }
  return merged;
}

function parseAssemblyCatalogTotal(
  response: AssemblyMinutesCatalogResponse,
  service: AssemblyMinutesCatalogService
): number {
  const total =
    typeof response.total === "number"
      ? response.total
      : Number.parseInt(response.total ?? "", 10);
  if (!Number.isInteger(total) || total < 0 || !Array.isArray(response.data)) {
    throw new Error(
      `Official Assembly minutes catalog ${service.infId} returned an invalid total or data array.`
    );
  }
  return total;
}

export function buildAssemblyMinutesCatalogParams(args: {
  service: AssemblyMinutesCatalogService;
  window: AssemblySearchWindow;
  assemblyNo: number;
  rows: number;
}): URLSearchParams {
  const params = new URLSearchParams({
    rows: String(args.rows),
    infId: args.service.infId,
    infSeq: "1",
    DAE_NUM: String(args.assemblyNo),
    CLASS_NAME: "",
    TITLE: "",
    SUB_NAME: ""
  });
  if (args.service.kind === "committee") {
    params.set("COMM_NAME", "");
  }
  params.append("CONF_DATE", args.window.startDate);
  params.append("CONF_DATE", args.window.endDate);
  return params;
}

export function buildAssemblyMinutesSearchFallbackParams(args: {
  meetingDate: string;
  classCode?: string;
  rows?: number;
}): URLSearchParams {
  if (args.classCode && !/^[1-7]$/.test(args.classCode)) {
    throw new Error(
      `Official Assembly minutes search fallback received invalid class code ${args.classCode}.`
    );
  }

  const classCodes = args.classCode
    ? [args.classCode]
    : [...assemblyMinuteClassCodes];
  const compactMeetingDate = compactDate(args.meetingDate);
  return new URLSearchParams({
    startDate: compactMeetingDate,
    endDate: compactMeetingDate,
    collection: classCodes.map((classCode) => `record${classCode}`).join(","),
    CLASS_CD: classCodes.join(","),
    query: "",
    SPK_NM: "",
    SPKSAME: "N",
    sort: "RDATE",
    searchField: "SPK_CNTS,ITEM_NM,ETC_CNTS",
    startCount: "1",
    listCount: String(args.rows ?? 50_000)
  });
}

export function selectCompleteAssemblyMinutesSearchFallbackMeeting(args: {
  response: AssemblySearchResponse;
  minutesId: string;
  meetingDate: string;
  expectedClassCode?: string;
}): { classCode: string; rows: AssemblySearchItem[] } {
  assertAssemblySearchResponsesComplete([args.response], false);
  const matchingClassCodes = assemblyMinuteClassCodes.filter((classCode) =>
    args.response[`record${classCode}`]?.resultList?.some(
      (row) => readString(row.MNTS_ID) === args.minutesId
    )
  );
  if (matchingClassCodes.length !== 1) {
    throw new Error(
      `Official Assembly minutes search fallback resolved ${matchingClassCodes.length} classes for ${args.minutesId}.`
    );
  }
  const classCode = matchingClassCodes[0]!;
  if (args.expectedClassCode && classCode !== args.expectedClassCode) {
    throw new Error(
      `Official Assembly minutes search fallback class mismatch for ${args.minutesId}: expected ${args.expectedClassCode}, received ${classCode}.`
    );
  }
  const recordKey =
    `record${classCode}` as `record${1 | 2 | 3 | 4 | 5 | 6 | 7}`;
  return {
    classCode,
    rows: selectCompleteAssemblyMinutesSearchFallbackRows({
      response: args.response,
      recordKey,
      minutesId: args.minutesId,
      meetingDate: args.meetingDate,
      classCode
    })
  };
}

export function selectCompleteAssemblyMinutesSearchFallbackRows(args: {
  response: AssemblySearchResponse;
  recordKey: `record${1 | 2 | 3 | 4 | 5 | 6 | 7}`;
  minutesId: string;
  meetingDate: string;
  classCode: string;
}): AssemblySearchItem[] {
  if (
    !/^[1-7]$/.test(args.classCode) ||
    args.recordKey !== `record${args.classCode}`
  ) {
    throw new Error(
      `Official Assembly minutes search fallback received mismatched record key ${args.recordKey} and class code ${args.classCode}.`
    );
  }

  const record = args.response[args.recordKey];
  const expected = record?.totalCount;
  const rows = record?.resultList;
  if (
    !Number.isInteger(expected) ||
    expected === undefined ||
    expected < 0 ||
    !Array.isArray(rows) ||
    rows.length !== expected
  ) {
    throw new Error(
      `Official Assembly minutes search fallback was incomplete for ${args.recordKey}: expected ${expected ?? "(missing)"}, received ${rows?.length ?? 0}.`
    );
  }

  const meetingRows = rows.filter(
    (row) => readString(row.MNTS_ID) === args.minutesId
  );
  if (meetingRows.length === 0) {
    throw new Error(
      `Official Assembly minutes search fallback returned no rows for ${args.minutesId}.`
    );
  }
  for (const row of meetingRows) {
    const rowDate = normalizeCompactAssemblyDate(
      readString(row.DATE) ?? readString(row.RDATE)
    );
    const rowClassCode = readString(row.CLASS_CD);
    if (rowDate !== args.meetingDate || rowClassCode !== args.classCode) {
      throw new Error(
        `Official Assembly minutes search fallback returned mismatched meeting metadata for ${args.minutesId}: expected ${args.meetingDate}/class ${args.classCode}, received ${rowDate ?? "(missing)"}/class ${rowClassCode ?? "(missing)"}.`
      );
    }
  }
  return meetingRows;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parseFallbackAttendanceNames(
  attendanceText: string,
  status: "출석" | "청가" | "출장"
): string[] {
  const match = attendanceText.match(
    new RegExp(
      `[◯○]\\s*${status}\\s*(?:의원|위원)\\s*\\(\\s*(\\d+)\\s*인\\s*\\)\\s*([\\s\\S]*?)(?=\\s*[◯○]\\s*|$)`
    )
  );
  if (!match) {
    return [];
  }

  const expected = Number.parseInt(match[1] ?? "", 10);
  const names = (match[2] ?? "")
    .split(/\s+/)
    .map((value) => value.replace(/[^\p{Script=Hangul}]/gu, ""))
    .filter((value) => /^[\p{Script=Hangul}]{2,5}$/u.test(value));
  const uniqueNames = [...new Set(names)];
  if (
    !Number.isInteger(expected) ||
    names.length !== expected ||
    uniqueNames.length !== expected
  ) {
    throw new Error(
      `Official Assembly minutes search fallback ${status} count mismatch: expected ${expected}, received ${uniqueNames.length}.`
    );
  }
  return uniqueNames;
}

function renderFallbackAttendanceSection(
  status: "출석" | "청가" | "출장",
  names: string[]
): string {
  if (names.length === 0) {
    return "";
  }
  return [
    `<p><strong>◯${status} 위원 (${names.length}인)</strong></p>`,
    `<div class="con">${names
      .map(
        (name, index) =>
          `<a href="/members/official-search-${index}"><span class="name">${escapeHtml(name)}</span></a>`
      )
      .join("")}</div>`
  ].join("");
}

export function splitAssemblySearchSpeakerLabel(value: string): {
  name: string;
  role: string | null;
} {
  const normalized = value
    .replaceAll("\u00a0", " ")
    .replace(/\s+/g, " ")
    .trim();
  const rolePattern = "위원장대리|소위원장|위원장|부의장|의장|간사|위원|의원";
  const trailingRole = normalized.match(
    new RegExp(`^([\\p{Script=Hangul}]{2,5})\\s*(${rolePattern})$`, "u")
  );
  if (trailingRole?.[1] && trailingRole[2]) {
    return {
      name: trailingRole[1],
      role: trailingRole[2]
    };
  }

  const leadingRole = normalized.match(/^(.+?)\s+([\p{Script=Hangul}]{2,5})$/u);
  if (leadingRole?.[1] && leadingRole[2]) {
    return {
      name: leadingRole[2],
      role: leadingRole[1]
    };
  }

  const compactLeadingRole = normalized.match(
    new RegExp(`^(${rolePattern})([\\p{Script=Hangul}]{2,5})$`, "u")
  );
  if (compactLeadingRole?.[1] && compactLeadingRole[2]) {
    return {
      name: compactLeadingRole[2],
      role: compactLeadingRole[1]
    };
  }

  return {
    name: normalized,
    role: null
  };
}

export function buildAssemblyMinutesSearchFallbackHtml(args: {
  minutesId: string;
  meetingDate: string;
  meetingTitle: string;
  rows: AssemblySearchItem[];
  sourceUrl: string;
  requireAttendance?: boolean;
}): string {
  const attendanceText = args.rows
    .map((row) => readString(row.ETC_CNTS))
    .filter((value): value is string => Boolean(value))
    .join(" ");
  const requireAttendance = args.requireAttendance ?? true;
  const presentNames = requireAttendance
    ? parseFallbackAttendanceNames(attendanceText, "출석")
    : [];
  if (requireAttendance && presentNames.length === 0) {
    throw new Error(
      `Official Assembly minutes search fallback returned no verified attendance section for ${args.minutesId}.`
    );
  }
  const attendanceSections = [
    renderFallbackAttendanceSection("출석", presentNames),
    renderFallbackAttendanceSection(
      "청가",
      requireAttendance
        ? parseFallbackAttendanceNames(attendanceText, "청가")
        : []
    ),
    renderFallbackAttendanceSection(
      "출장",
      requireAttendance
        ? parseFallbackAttendanceNames(attendanceText, "출장")
        : []
    )
  ].join("");

  const agendaItems = new Map<string, string>();
  for (const row of args.rows) {
    const itemId = readString(row.ITEM_ID) ?? "0";
    const itemTitle = readString(row.ITEM_NM);
    if (itemTitle && !agendaItems.has(itemId)) {
      agendaItems.set(itemId, itemTitle);
    }
  }
  const agendaHtml = [...agendaItems]
    .map(
      ([itemId, title]) =>
        `<a class="tit" id="item${escapeHtml(itemId)}">${escapeHtml(title)}</a>`
    )
    .join("");

  const statementRows = args.rows
    .filter((row) => readString(row.SPK_NM) && readString(row.SPK_CNTS))
    .sort((left, right) => {
      const leftSort = Number.parseInt(readString(left.SPK_SORT) ?? "", 10);
      const rightSort = Number.parseInt(readString(right.SPK_SORT) ?? "", 10);
      const normalizedLeft = Number.isFinite(leftSort)
        ? leftSort
        : Number.MAX_SAFE_INTEGER;
      const normalizedRight = Number.isFinite(rightSort)
        ? rightSort
        : Number.MAX_SAFE_INTEGER;
      return (
        normalizedLeft - normalizedRight ||
        (readString(left.SPK_ID) ?? "").localeCompare(
          readString(right.SPK_ID) ?? ""
        )
      );
    });
  const statementsHtml = statementRows
    .map((row, index) => {
      const itemId = readString(row.ITEM_ID) ?? "0";
      const statementId = readString(row.SPK_ID) ?? `fallback-${index + 1}`;
      const speaker = splitAssemblySearchSpeakerLabel(readString(row.SPK_NM)!);
      const rawSourceMemberId = readString(row.SPK_CD);
      const sourceMemberId =
        rawSourceMemberId && rawSourceMemberId !== "-" ? rawSourceMemberId : "";
      const content = readString(row.SPK_CNTS)!;
      return [
        `<div class="speaker item${escapeHtml(itemId)}" id="spk-${escapeHtml(statementId)}" data-name="${escapeHtml(speaker.name)}" data-pos="${escapeHtml(speaker.role ?? "")}" data-mem_id="${escapeHtml(sourceMemberId)}">`,
        `<div class="talk"><p class="spk_sub">${escapeHtml(content)}</p></div>`,
        "</div>"
      ].join("");
    })
    .join("");
  if (statementsHtml.length === 0) {
    throw new Error(
      `Official Assembly minutes search fallback returned no statements for ${args.minutesId}.`
    );
  }

  const embeddedRows = JSON.stringify(args.rows)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
  return [
    "<!doctype html><html><head>",
    '<meta charset="utf-8">',
    `<meta name="official-search-source" content="${escapeHtml(args.sourceUrl)}">`,
    "</head><body>",
    `<div id="header"><div class="tit"><h2><strong>${escapeHtml(args.meetingTitle)}</strong><span class="date">${escapeHtml(args.meetingDate)}</span></h2></div></div>`,
    `<div class="minutes_header">${attendanceSections}</div>`,
    `<div class="minutes_body">${agendaHtml}${statementsHtml}</div>`,
    `<script id="official-search-rows" type="application/json">${embeddedRows}</script>`,
    "</body></html>"
  ].join("");
}

async function fetchAssemblyMinutesCatalogWindow(args: {
  api: APIRequestContext;
  config: MirrorConfig;
  service: AssemblyMinutesCatalogService;
  window: AssemblySearchWindow;
}): Promise<{
  items: AssemblyMinutesCatalogItem[];
  pagesVisited: number;
  discoveredFromUrl: string;
}> {
  const rows = 50_000;
  const discoveredFromUrl = `${officialAssemblyOpenDataOrigin}/portal/data/service/selectServicePage.do/${args.service.infId}`;
  const items: AssemblyMinutesCatalogItem[] = [];
  let expectedTotal: number | null = null;
  let pageNumber = 1;

  while (expectedTotal === null || items.length < expectedTotal) {
    const payload = await retryFetch(
      async () => {
        const response = await args.api.post(
          `${officialAssemblyOpenDataOrigin}/portal/data/sheet/searchSheetData.do?page=${pageNumber}`,
          {
            headers: {
              "content-type":
                "application/x-www-form-urlencoded; charset=UTF-8",
              "x-requested-with": "XMLHttpRequest",
              referer: discoveredFromUrl
            },
            data: buildAssemblyMinutesCatalogParams({
              service: args.service,
              window: args.window,
              assemblyNo: args.config.assemblyNo,
              rows
            }).toString(),
            timeout: args.config.timeoutMs,
            failOnStatusCode: true
          }
        );
        return (await response.json()) as AssemblyMinutesCatalogResponse;
      },
      {
        retries: 2,
        backoffMs: Math.max(500, args.config.pageDelayMs)
      }
    );
    const total = parseAssemblyCatalogTotal(payload, args.service);
    if (expectedTotal !== null && total !== expectedTotal) {
      throw new Error(
        `Official Assembly minutes catalog ${args.service.infId} changed total during pagination: expected ${expectedTotal}, received ${total}.`
      );
    }
    expectedTotal = total;
    const pageItems = payload.data ?? [];
    if (pageItems.length === 0 && items.length < expectedTotal) {
      throw new Error(
        `Official Assembly minutes catalog ${args.service.infId} stopped before total ${expectedTotal}.`
      );
    }
    items.push(...pageItems);
    pageNumber += 1;
  }

  if (items.length !== expectedTotal) {
    throw new Error(
      `Official Assembly minutes catalog ${args.service.infId} was incomplete: expected ${expectedTotal}, received ${items.length}.`
    );
  }

  return {
    items,
    pagesVisited: pageNumber - 1,
    discoveredFromUrl
  };
}

function parseAssemblySessionNo(value: string | undefined): string | null {
  return value?.match(/제\s*(\d+)\s*회/)?.[1] ?? null;
}

export function buildAssemblyMinutesCatalogCandidate(args: {
  item: AssemblyMinutesCatalogItem;
  config: {
    assemblyNo: number;
    sourceId: string;
  };
  service: AssemblyMinutesCatalogService;
  discoveredFromUrl: string;
}): MirrorCandidate {
  const minutesId = readString(args.item.CONFER_NUM);
  const rawLink = readString(args.item.CONF_LINK_URL)?.replaceAll("&amp;", "&");
  const publishedDate = normalizeDocumentDate(
    readString(args.item.CONF_DATE) ?? ""
  );
  const assemblyNo = readString(args.item.DAE_NUM);
  const className = readString(args.item.CLASS_NAME);
  const classCode = readString(args.item.CLASS_CODE);
  const committeeName = readString(args.item.COMM_NAME);
  const sessionNo = parseAssemblySessionNo(readString(args.item.TITLE));
  if (
    !minutesId ||
    !rawLink ||
    !publishedDate ||
    assemblyNo !== String(args.config.assemblyNo) ||
    !classCode ||
    !/^[1-7]$/.test(classCode)
  ) {
    throw new Error(
      `Official Assembly minutes catalog ${args.service.infId} returned a row without a valid meeting id, link, date, or assembly number.`
    );
  }

  const linkedUrl = new URL(rawLink, officialAssemblyMinutesOrigin);
  if (
    linkedUrl.origin !== officialAssemblyMinutesOrigin ||
    linkedUrl.pathname !== "/assembly/viewer/minutes/xml.do" ||
    linkedUrl.searchParams.get("id") !== minutesId
  ) {
    throw new Error(
      `Official Assembly minutes catalog ${args.service.infId} returned a mismatched viewer link for ${minutesId}.`
    );
  }

  const expectedClassNames =
    args.service.kind === "plenary"
      ? new Set(["국회본회의"])
      : new Set(["상임위원회", "예산결산특별위원회", "특별위원회"]);
  if (!className || !expectedClassNames.has(className)) {
    throw new Error(
      `Official Assembly minutes catalog ${args.service.infId} returned unexpected class ${className ?? "(missing)"}.`
    );
  }
  if (args.service.kind === "committee" && !committeeName) {
    throw new Error(
      `Official Assembly minutes catalog ${args.service.infId} returned committee minutes without COMM_NAME.`
    );
  }

  const meetingName =
    args.service.kind === "plenary" ? "국회본회의" : committeeName!;
  const viewerUrl = `${officialAssemblyMinutesOrigin}/assembly/viewer/minutes/xml.do?id=${encodeURIComponent(minutesId)}&type=view`;
  return {
    documentId: `${args.config.sourceId}-minutes-${minutesId}`,
    title: [
      `제${args.config.assemblyNo}대`,
      sessionNo ? `제${sessionNo}회` : null,
      meetingName,
      "회의록"
    ]
      .filter((value): value is string => Boolean(value))
      .join(" "),
    sourceUrl: viewerUrl,
    downloadUrl: viewerUrl,
    publishedDate,
    discoveredFromUrl: args.discoveredFromUrl,
    sourceMetadata: {
      minutesId,
      assemblyNo,
      sessionNo,
      committeeName: args.service.kind === "committee" ? committeeName! : null,
      meetingSubtitle: readString(args.item.SUB_NAME) ?? null,
      catalogInfId: args.service.infId,
      className,
      classCode
    }
  };
}

function mergeAssemblyMinutesCatalogCandidate(
  candidatesById: Map<string, MirrorCandidate>,
  candidate: MirrorCandidate
): void {
  const documentId = candidate.documentId;
  if (!documentId) {
    throw new Error("Official Assembly minutes candidate has no document id.");
  }
  const existing = candidatesById.get(documentId);
  if (!existing) {
    candidatesById.set(documentId, candidate);
    return;
  }
  const existingCommittee = existing.sourceMetadata?.committeeName ?? null;
  const candidateCommittee = candidate.sourceMetadata?.committeeName ?? null;
  if (
    existing.sourceUrl !== candidate.sourceUrl ||
    existing.publishedDate !== candidate.publishedDate ||
    existingCommittee !== candidateCommittee ||
    existing.title !== candidate.title
  ) {
    throw new Error(
      `Official Assembly minutes catalog returned conflicting rows for ${documentId}.`
    );
  }
  if (
    !existing.sourceMetadata?.meetingSubtitle &&
    candidate.sourceMetadata?.meetingSubtitle
  ) {
    candidatesById.set(documentId, {
      ...existing,
      sourceMetadata: {
        ...existing.sourceMetadata,
        meetingSubtitle: candidate.sourceMetadata.meetingSubtitle
      }
    });
  }
}

async function collectAssemblyMinutesCatalogCandidates(
  api: APIRequestContext,
  config: MirrorConfig,
  existingState: DocumentMirrorState | null,
  cutoffDate: string
): Promise<CandidateCollectionResult> {
  if (config.includeAppendices) {
    throw new Error(
      "Official Assembly minutes catalogs do not include appendix files; set MIRROR_INCLUDE_APPENDICES=false."
    );
  }
  const windows = buildAssemblySearchWindows(
    cutoffDate,
    config,
    existingState,
    {
      backfillCursorDate: config.backfillCursorOverride,
      includeRecent: !config.skipRecent,
      maxBackfillWindows: config.backfillWindowsPerRun
    }
  );
  const ranges = mergeAssemblySearchWindows(windows);
  const candidatesById = new Map<string, MirrorCandidate>();
  let pagesVisited = 0;
  for (const window of ranges) {
    for (const service of assemblyMinutesCatalogServices) {
      const result = await fetchAssemblyMinutesCatalogWindow({
        api,
        config,
        service,
        window
      });
      pagesVisited += result.pagesVisited;
      for (const item of result.items) {
        mergeAssemblyMinutesCatalogCandidate(
          candidatesById,
          buildAssemblyMinutesCatalogCandidate({
            item,
            config,
            service,
            discoveredFromUrl: result.discoveredFromUrl
          })
        );
      }
    }
  }
  const candidates = [...candidatesById.values()];
  const sourceSnapshot = {
    count: candidates.length,
    sha256: sha256(
      JSON.stringify(
        candidates
          .map((candidate) => ({
            documentId: candidate.documentId,
            publishedDate: candidate.publishedDate,
            sourceUrl: candidate.sourceUrl,
            title: candidate.title
          }))
          .sort((left, right) =>
            (left.documentId ?? "").localeCompare(right.documentId ?? "")
          )
      )
    )
  };

  return {
    candidates,
    pagesVisited,
    discoveredCandidates: candidates.length,
    recentWindowStartDate: windows.find((window) => window.label === "recent")
      ?.startDate,
    recentWindowEndDate: windows
      .filter((window) => window.label === "recent")
      .at(-1)?.endDate,
    nextBackfillCursorDate: resolveNextBackfillCursorDate({
      cutoffDate,
      config,
      existingState,
      windows
    }),
    sourceSnapshotSha256: sourceSnapshot.sha256,
    sourceSnapshotCount: sourceSnapshot.count,
    sourceSnapshotUnchanged: false
  };
}

export function buildExistingAssemblyMinutesRetryCollection(args: {
  existingIndex: MirroredDocumentIndex;
  existingMetadataByDocumentId: Map<string, MirroredDocumentMetadata>;
  existingState: DocumentMirrorState | null;
  sourceId: string;
}): CandidateCollectionResult {
  if (args.existingIndex.sourceId !== args.sourceId) {
    throw new Error(
      `Existing document index source ${args.existingIndex.sourceId} does not match ${args.sourceId}.`
    );
  }
  if (args.existingState && args.existingState.sourceId !== args.sourceId) {
    throw new Error(
      `Existing mirror state source ${args.existingState.sourceId} does not match ${args.sourceId}.`
    );
  }
  for (const item of args.existingIndex.items) {
    if (!args.existingMetadataByDocumentId.has(item.documentId)) {
      throw new Error(
        `Indexed document metadata is missing for ${item.documentId}.`
      );
    }
  }

  const officialItems = args.existingIndex.items.filter((item) =>
    isOfficialAssemblyMinutesViewerUrl(item.sourceUrl)
  );
  if (officialItems.length === 0) {
    throw new Error(
      "Existing-only retry requires at least one indexed official Assembly minutes document."
    );
  }

  const candidates = officialItems.map((item) => {
    const metadata = args.existingMetadataByDocumentId.get(item.documentId);
    if (!metadata) {
      throw new Error(
        `Indexed official Assembly minutes metadata is missing for ${item.documentId}.`
      );
    }
    if (
      metadata.sourceId !== args.sourceId ||
      metadata.sourceUrl !== item.sourceUrl ||
      metadata.publishedDate !== item.publishedDate ||
      metadata.title !== item.title
    ) {
      throw new Error(
        `Indexed official Assembly minutes metadata conflicts with ${item.documentId}.`
      );
    }

    return {
      documentId: metadata.documentId,
      title: metadata.title,
      sourceUrl: metadata.sourceUrl,
      downloadUrl: metadata.downloadUrl,
      publishedDate: metadata.publishedDate,
      discoveredFromUrl: metadata.discoveredFromUrl,
      sourceMetadata: metadata.sourceMetadata
    };
  });

  return {
    candidates,
    pagesVisited: 0,
    discoveredCandidates: candidates.length,
    recentWindowStartDate: args.existingState?.recentWindowStartDate,
    recentWindowEndDate: args.existingState?.recentWindowEndDate,
    nextBackfillCursorDate: args.existingState?.nextBackfillCursorDate,
    sourceSnapshotSha256: args.existingState?.sourceSnapshotSha256,
    sourceSnapshotCount: args.existingState?.sourceSnapshotCount,
    sourceSnapshotUnchanged: false
  };
}

async function postAssemblyFileServiceSearch(
  api: APIRequestContext,
  config: MirrorConfig
): Promise<AssemblyFileServiceResponse> {
  if (!config.serviceInfId) {
    throw new Error(
      "MIRROR_SERVICE_INF_ID must be configured for assembly_file_service mode."
    );
  }

  const response = await api.post(
    new URL("/portal/data/file/searchFileData.do", config.startUrl).toString(),
    {
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        referer: config.startUrl
      },
      data: new URLSearchParams({
        infId: config.serviceInfId,
        infSeq: String(config.serviceInfSeq),
        page: "1",
        rows: "500"
      }).toString(),
      timeout: config.timeoutMs,
      failOnStatusCode: true
    }
  );

  return (await response.json()) as AssemblyFileServiceResponse;
}

async function collectAssemblyFileServiceCandidates(
  api: APIRequestContext,
  config: MirrorConfig,
  existingState: DocumentMirrorState | null,
  cutoffDate: string
): Promise<CandidateCollectionResult> {
  const windows = buildAssemblySearchWindows(
    cutoffDate,
    config,
    existingState,
    {
      includeAllBackfillWindows: true
    }
  );
  const response = await postAssemblyFileServiceSearch(api, config);
  const sourceSnapshot = buildAssemblyFileServiceSourceSnapshot(
    response.data ?? []
  );
  const hasBackfillWindow = windows.some(
    (window) => window.label === "backfill"
  );
  const candidates = (response.data ?? [])
    .map((item) => buildAssemblyFileServiceCandidate(item, config))
    .filter((candidate): candidate is MirrorCandidate => Boolean(candidate))
    .filter((candidate) =>
      windows.some((window) =>
        isDateWithinSearchWindow(candidate.publishedDate ?? "", window)
      )
    );
  const skipBySourceSnapshot = shouldSkipAssemblyFileServiceRefresh({
    existingState,
    hasBackfillWindow,
    sourceSnapshotCount: sourceSnapshot.count,
    sourceSnapshotSha256: sourceSnapshot.sha256
  });

  if (skipBySourceSnapshot) {
    return {
      candidates: [],
      pagesVisited: 1,
      discoveredCandidates: 0,
      recentWindowStartDate: windows.find((window) => window.label === "recent")
        ?.startDate,
      recentWindowEndDate: windows.find((window) => window.label === "recent")
        ?.endDate,
      nextBackfillCursorDate: resolveNextBackfillCursorDate({
        cutoffDate,
        config,
        existingState,
        windows
      }),
      sourceSnapshotSha256: sourceSnapshot.sha256,
      sourceSnapshotCount: sourceSnapshot.count,
      sourceSnapshotUnchanged: true
    };
  }

  return {
    candidates,
    pagesVisited: 1,
    discoveredCandidates: candidates.length,
    recentWindowStartDate: windows.find((window) => window.label === "recent")
      ?.startDate,
    recentWindowEndDate: windows.find((window) => window.label === "recent")
      ?.endDate,
    nextBackfillCursorDate: resolveNextBackfillCursorDate({
      cutoffDate,
      config,
      existingState,
      windows
    }),
    sourceSnapshotSha256: sourceSnapshot.sha256,
    sourceSnapshotCount: sourceSnapshot.count,
    sourceSnapshotUnchanged: false
  };
}

async function downloadDocument(
  api: APIRequestContext,
  sourceUrl: string,
  timeoutMs: number
): Promise<DownloadedDocument> {
  return retryFetch(
    async () => {
      const response = await api.get(sourceUrl, {
        failOnStatusCode: true,
        timeout: timeoutMs
      });
      const body = await response.body();
      return {
        body,
        responseUrl: response.url(),
        contentType:
          response.headers()["content-type"] ?? "application/octet-stream",
        contentDisposition: response.headers()["content-disposition"]
      };
    },
    {
      retries: 2,
      backoffMs: 500
    }
  );
}

function readExpectedMinutesId(args: {
  sourceUrl: string;
  sourceMetadata?: Record<string, string | number | null>;
}): string {
  const minutesId =
    readString(args.sourceMetadata?.minutesId) ??
    new URL(args.sourceUrl).searchParams.get("id");
  if (!minutesId) {
    throw new Error(
      `Official Assembly minutes artifact has no expected meeting id: ${args.sourceUrl}.`
    );
  }
  return minutesId;
}

function selectOfficialMinutesAttendanceFragment(html: string): string {
  const footerStart = html.lastIndexOf('<div class="minutes_footer"');
  if (footerStart >= 0) {
    return html.slice(footerStart);
  }

  const headerStart = html.indexOf('<div class="minutes_header"');
  if (headerStart < 0) {
    return html;
  }
  const bodyStart = html.indexOf('<div class="minutes_body"', headerStart);
  return bodyStart > headerStart
    ? html.slice(headerStart, bodyStart)
    : html.slice(headerStart);
}

function assertOfficialMinutesAttendanceIsComplete(html: string): void {
  const attendance = parseOfficialMinutesAttendanceHtml(
    selectOfficialMinutesAttendanceFragment(html)
  );
  if (attendance.presentNames.length === 0) {
    throw new Error(
      "Official Assembly minutes artifact contains no verified attendance list."
    );
  }
}

function requiresOfficialMinutesAttendanceVerification(args: {
  title?: string;
  sourceMetadata?: Record<string, string | number | null>;
}): boolean {
  if (!args.title) {
    return true;
  }
  return (
    isOfficialAttendanceRelevantMinutesTitle(
      args.title,
      readString(args.sourceMetadata?.meetingSubtitle)
    ) &&
    !args.title.includes("국회본회의 회의록") &&
    readString(args.sourceMetadata?.meetingSubtitle) !== "개회식"
  );
}

export function assertAssemblyMinutesViewerPayloadMatchesCandidate(args: {
  html: string;
  sourceUrl: string;
  responseUrl?: string;
  expectedMinutesId: string;
  expectedMeetingDate: string;
  requireAttendance?: boolean;
}): void {
  if (!isOfficialAssemblyMinutesViewerUrl(args.sourceUrl)) {
    throw new Error(
      `Official Assembly minutes viewer validation received an invalid source URL: ${args.sourceUrl}.`
    );
  }
  if (
    args.responseUrl &&
    (!isOfficialAssemblyMinutesViewerUrl(args.responseUrl) ||
      new URL(args.responseUrl).searchParams.get("id") !==
        args.expectedMinutesId)
  ) {
    throw new Error(
      `Official Assembly minutes viewer returned an unexpected response URL for ${args.expectedMinutesId}: ${args.responseUrl}.`
    );
  }

  const embeddedMinutesIds = [
    ...args.html.matchAll(
      /\b(?:const|let|var)\s+mnts_id\s*=\s*["']?(\d+)["']?/g
    )
  ].flatMap((match) => (match[1] ? [match[1]] : []));
  const uniqueMinutesIds = [...new Set(embeddedMinutesIds)];
  if (
    uniqueMinutesIds.length !== 1 ||
    uniqueMinutesIds[0] !== args.expectedMinutesId
  ) {
    throw new Error(
      `Official Assembly minutes viewer payload id mismatch: expected ${args.expectedMinutesId}, received ${uniqueMinutesIds.join(", ") || "(missing)"}.`
    );
  }

  const meetingDate = normalizeDocumentDate(
    args.html.match(
      /<span[^>]*class=["'][^"']*\bdate\b[^"']*["'][^>]*>([^<]*)<\/span>/i
    )?.[1] ?? ""
  );
  if (meetingDate !== args.expectedMeetingDate) {
    throw new Error(
      `Official Assembly minutes viewer payload date mismatch for ${args.expectedMinutesId}: expected ${args.expectedMeetingDate}, received ${meetingDate ?? "(missing)"}.`
    );
  }

  const isEmptyTemporaryMinutes =
    /<p[^>]*class=["'][^"']*\btmp\b[^"']*["'][^>]*>\s*\(임시회의록\)\s*<\/p>/i.test(
      args.html
    ) &&
    /<div[^>]*class=["'][^"']*\bminutes_body\b[^"']*["'][^>]*>\s*<\/div>/i.test(
      args.html
    ) &&
    !/◯출석\s*(?:의원|위원)\s*\(/.test(args.html);
  if ((args.requireAttendance ?? true) && !isEmptyTemporaryMinutes) {
    assertOfficialMinutesAttendanceIsComplete(args.html);
  }
}

export function assertAssemblyMinutesSearchFallbackPayloadMatchesCandidate(args: {
  html: string;
  expectedMinutesId: string;
  expectedMeetingDate: string;
  expectedClassCode?: string;
  requireAttendance?: boolean;
}): void {
  const sourceUrl = args.html.match(
    /<meta\s+name=["']official-search-source["']\s+content=["']([^"']+)["'][^>]*>/i
  )?.[1];
  let parsedSourceUrl: URL;
  try {
    parsedSourceUrl = new URL(sourceUrl ?? "");
  } catch {
    throw new Error(
      `Official Assembly minutes search fallback has no valid source URL for ${args.expectedMinutesId}.`
    );
  }
  if (
    parsedSourceUrl.origin !== officialAssemblyMinutesOrigin ||
    parsedSourceUrl.pathname !== "/assembly/mnts/search/search.do"
  ) {
    throw new Error(
      `Official Assembly minutes search fallback has an unexpected source URL for ${args.expectedMinutesId}: ${sourceUrl ?? "(missing)"}.`
    );
  }

  const embeddedRows = args.html.match(
    /<script[^>]*id=["']official-search-rows["'][^>]*>([\s\S]*?)<\/script>/i
  )?.[1];
  let rows: AssemblySearchItem[];
  try {
    const parsedRows = JSON.parse(embeddedRows ?? "") as unknown;
    if (!Array.isArray(parsedRows) || parsedRows.length === 0) {
      throw new Error("missing rows");
    }
    rows = parsedRows as AssemblySearchItem[];
  } catch {
    throw new Error(
      `Official Assembly minutes search fallback has no complete embedded rows for ${args.expectedMinutesId}.`
    );
  }

  for (const row of rows) {
    const minutesId = readString(row.MNTS_ID);
    const meetingDate = normalizeCompactAssemblyDate(
      readString(row.DATE) ?? readString(row.RDATE)
    );
    const classCode = readString(row.CLASS_CD);
    if (
      minutesId !== args.expectedMinutesId ||
      meetingDate !== args.expectedMeetingDate ||
      (args.expectedClassCode && classCode !== args.expectedClassCode)
    ) {
      throw new Error(
        `Official Assembly minutes search fallback embedded row mismatch for ${args.expectedMinutesId}.`
      );
    }
  }

  if (args.requireAttendance ?? true) {
    assertOfficialMinutesAttendanceIsComplete(args.html);
  }
}

function assertMirroredAssemblyMinutesArtifact(args: {
  body: Buffer;
  sourceUrl: string;
  responseUrl?: string;
  publishedDate: string;
  title?: string;
  sourceMetadata?: Record<string, string | number | null>;
}): void {
  const html = args.body.toString("utf8");
  const expectedMinutesId = readExpectedMinutesId(args);
  const retrievalMethod = readString(args.sourceMetadata?.retrievalMethod);
  const requireAttendance = requiresOfficialMinutesAttendanceVerification(args);
  if (retrievalMethod === "official_minutes_search_api_fallback") {
    assertAssemblyMinutesSearchFallbackPayloadMatchesCandidate({
      html,
      expectedMinutesId,
      expectedMeetingDate: args.publishedDate,
      expectedClassCode: readString(args.sourceMetadata?.classCode),
      requireAttendance
    });
    return;
  }

  assertAssemblyMinutesViewerPayloadMatchesCandidate({
    html,
    sourceUrl: args.sourceUrl,
    responseUrl: args.responseUrl,
    expectedMinutesId,
    expectedMeetingDate: args.publishedDate,
    requireAttendance
  });
}

async function downloadAssemblyMinutesSearchFallback(args: {
  api: APIRequestContext;
  candidate: MirrorCandidate;
  config: MirrorConfig;
}): Promise<DownloadedDocument> {
  const minutesId =
    readString(args.candidate.sourceMetadata?.minutesId) ??
    new URL(args.candidate.sourceUrl).searchParams.get("id");
  const expectedClassCode = readString(
    args.candidate.sourceMetadata?.classCode
  );
  const meetingDate = args.candidate.publishedDate;
  if (!minutesId || !meetingDate) {
    throw new Error(
      "Official Assembly minutes search fallback requires a meeting id and date."
    );
  }

  const searchUrl = `${officialAssemblyMinutesOrigin}/assembly/mnts/search/search.do`;
  await retryFetch(
    async () => {
      await args.api.get(searchUrl, {
        timeout: args.config.timeoutMs,
        failOnStatusCode: true
      });
    },
    {
      retries: 2,
      backoffMs: Math.max(500, args.config.pageDelayMs)
    }
  );
  const responsePayload = await retryFetch(
    async () => {
      const response = await args.api.post(searchUrl, {
        headers: {
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
          "x-requested-with": "XMLHttpRequest",
          referer: searchUrl
        },
        data: buildAssemblyMinutesSearchFallbackParams({
          meetingDate,
          classCode: expectedClassCode
        }).toString(),
        timeout: args.config.timeoutMs,
        failOnStatusCode: true
      });
      return (await response.json()) as AssemblySearchResponse;
    },
    {
      retries: 2,
      backoffMs: Math.max(500, args.config.pageDelayMs)
    }
  );
  const { classCode, rows } =
    selectCompleteAssemblyMinutesSearchFallbackMeeting({
      response: responsePayload,
      minutesId,
      meetingDate,
      expectedClassCode
    });
  const html = buildAssemblyMinutesSearchFallbackHtml({
    minutesId,
    meetingDate,
    meetingTitle: args.candidate.title,
    rows,
    sourceUrl: searchUrl,
    requireAttendance: requiresOfficialMinutesAttendanceVerification({
      title: args.candidate.title,
      sourceMetadata: args.candidate.sourceMetadata
    })
  });

  return {
    body: Buffer.from(html),
    responseUrl: searchUrl,
    contentType: "text/html; charset=utf-8",
    sourceMetadata: {
      retrievalMethod: "official_minutes_search_api_fallback",
      fallbackSourceUrl: searchUrl,
      classCode
    }
  };
}

async function mirrorCandidate(
  candidate: MirrorCandidate,
  config: MirrorConfig,
  api: APIRequestContext,
  existingMetadata: MirroredDocumentMetadata | undefined,
  retrievedAt: string
): Promise<MirrorOutcome> {
  const downloadTarget = candidate.downloadUrl ?? candidate.sourceUrl;
  let downloaded: DownloadedDocument;
  try {
    downloaded = await downloadDocument(api, downloadTarget, config.timeoutMs);
    if (
      config.mode === "assembly_minutes_catalog" &&
      isOfficialAssemblyMinutesViewerUrl(candidate.sourceUrl)
    ) {
      if (!candidate.publishedDate) {
        throw new Error(
          "Official Assembly minutes candidate has no published date."
        );
      }
      assertMirroredAssemblyMinutesArtifact({
        body: downloaded.body,
        sourceUrl: candidate.sourceUrl,
        responseUrl: downloaded.responseUrl,
        publishedDate: candidate.publishedDate,
        title: candidate.title,
        sourceMetadata: candidate.sourceMetadata
      });
    }
  } catch (downloadError) {
    if (
      config.mode !== "assembly_minutes_catalog" ||
      !isOfficialAssemblyMinutesViewerUrl(candidate.sourceUrl)
    ) {
      throw downloadError;
    }
    process.stderr.write(
      `Official minutes viewer failed for ${candidate.documentId ?? candidate.sourceUrl}; trying the official minutes search API.\n`
    );
    try {
      downloaded = await downloadAssemblyMinutesSearchFallback({
        api,
        candidate,
        config
      });
      if (!candidate.publishedDate) {
        throw new Error(
          "Official Assembly minutes fallback candidate has no published date."
        );
      }
      assertMirroredAssemblyMinutesArtifact({
        body: downloaded.body,
        sourceUrl: candidate.sourceUrl,
        publishedDate: candidate.publishedDate,
        title: candidate.title,
        sourceMetadata: {
          ...candidate.sourceMetadata,
          ...downloaded.sourceMetadata
        }
      });
    } catch (fallbackError) {
      const viewerMessage =
        downloadError instanceof Error
          ? downloadError.message
          : String(downloadError);
      const fallbackMessage =
        fallbackError instanceof Error
          ? fallbackError.message
          : String(fallbackError);
      throw new AggregateError(
        [downloadError, fallbackError],
        `Official Assembly minutes viewer and search fallback failed for ${candidate.documentId ?? candidate.sourceUrl}. Viewer: ${viewerMessage} Fallback: ${fallbackMessage}`
      );
    }
  }
  const fileExtension = detectFileExtension(
    downloaded.responseUrl,
    downloaded.contentType,
    downloaded.contentDisposition
  );
  const documentId =
    existingMetadata?.documentId ??
    candidate.documentId ??
    buildDocumentId(
      candidate.title,
      candidate.sourceUrl,
      candidate.publishedDate ?? dateInTimeZone(config.timeZone)
    );
  const paths = buildDocumentPaths({
    sourceId: config.sourceId,
    documentId,
    publishedDate: candidate.publishedDate ?? dateInTimeZone(config.timeZone),
    retrievedAt,
    fileExtension
  });
  const contentSha = sha256Buffer(downloaded.body);
  const existingRawMatches =
    existingMetadata &&
    (await mirroredDocumentMatchesMetadata(
      config.dataRepoDir,
      existingMetadata
    ));

  if (
    existingMetadata &&
    existingMetadata.currentContentSha256 === contentSha &&
    existingRawMatches
  ) {
    return {
      type: "unchanged",
      metadata: existingMetadata,
      downloaded
    };
  }

  const latestPath = join(config.dataRepoDir, paths.latestRelativePath);
  const versionPath = join(config.dataRepoDir, paths.versionRelativePath);
  const metadataPath = join(config.dataRepoDir, paths.metadataRelativePath);
  await mkdir(dirname(versionPath), { recursive: true });
  await writeFile(versionPath, downloaded.body);
  await writeFile(latestPath, downloaded.body);

  const existingVersions = existingMetadata?.versions ?? [];
  const newVersion = {
    retrievedAt,
    relativePath: paths.versionRelativePath,
    contentSha256: contentSha,
    bytes: downloaded.body.byteLength
  };
  const dedupedVersions = [...existingVersions, newVersion].filter(
    (version, index, versions) =>
      versions.findIndex(
        (candidateVersion) =>
          candidateVersion.contentSha256 === version.contentSha256
      ) === index
  );

  const mergedSourceMetadata =
    candidate.sourceMetadata || downloaded.sourceMetadata
      ? {
          ...candidate.sourceMetadata,
          ...downloaded.sourceMetadata
        }
      : undefined;
  const metadata: MirroredDocumentMetadata = {
    documentId,
    sourceId: config.sourceId,
    sourceUrl: candidate.sourceUrl,
    ...(candidate.downloadUrl ? { downloadUrl: candidate.downloadUrl } : {}),
    title: candidate.title,
    publishedDate: candidate.publishedDate ?? dateInTimeZone(config.timeZone),
    discoveredFromUrl: candidate.discoveredFromUrl,
    firstMirroredAt: existingMetadata?.firstMirroredAt ?? retrievedAt,
    lastMirroredAt: retrievedAt,
    latestRelativePath: paths.latestRelativePath,
    metadataRelativePath: paths.metadataRelativePath,
    currentContentSha256: contentSha,
    currentContentType: downloaded.contentType,
    currentBytes: downloaded.body.byteLength,
    ...(mergedSourceMetadata ? { sourceMetadata: mergedSourceMetadata } : {}),
    versions: dedupedVersions
  };

  await writeJsonFile(metadataPath, metadata);

  return {
    type: "downloaded",
    metadata,
    updated: Boolean(existingMetadata),
    downloaded
  };
}

async function mirrorAssemblyMinutesTranscript(args: {
  candidate: MirrorCandidate;
  config: MirrorConfig;
  metadata: MirroredDocumentMetadata;
  retrievedAt: string;
  downloaded: DownloadedDocument;
}): Promise<{
  metadata: MirroredDocumentMetadata;
  written: boolean;
}> {
  const downloaded = args.downloaded;
  if (!downloaded.contentType.toLowerCase().includes("html")) {
    throw new Error(
      `Expected Assembly minutes viewer HTML, received ${downloaded.contentType}.`
    );
  }

  const transcript = parseAssemblyMinutesViewerHtml({
    documentId: args.metadata.documentId,
    sourceUrl: args.candidate.sourceUrl,
    fallbackMeetingDate: args.metadata.publishedDate,
    fallbackTitle: args.metadata.title,
    html: downloaded.body.toString("utf8")
  });
  if (transcript.statements.length === 0) {
    throw new Error(
      `Assembly minutes viewer returned no member statements for ${args.metadata.documentId}.`
    );
  }

  const transcriptJson = JSON.stringify(transcript, null, 2);
  const transcriptContentSha256 = sha256(transcriptJson);
  if (
    args.metadata.transcriptContentSha256 === transcriptContentSha256 &&
    args.metadata.transcriptRelativePath &&
    args.metadata.transcriptParserVersion ===
      ASSEMBLY_MINUTES_TRANSCRIPT_PARSER_VERSION
  ) {
    return {
      metadata: args.metadata,
      written: false
    };
  }

  const documentDirectory = dirname(args.metadata.metadataRelativePath);
  const transcriptRelativePath = join(
    documentDirectory,
    "latest.transcript.json"
  );
  const transcriptVersionRelativePath = join(
    documentDirectory,
    "transcript-versions",
    `${args.retrievedAt.replace(/[:.]/g, "-")}.json`
  );
  await mkdir(
    dirname(join(args.config.dataRepoDir, transcriptVersionRelativePath)),
    {
      recursive: true
    }
  );
  await writeFile(
    join(args.config.dataRepoDir, transcriptRelativePath),
    transcriptJson
  );
  await writeFile(
    join(args.config.dataRepoDir, transcriptVersionRelativePath),
    transcriptJson
  );

  const transcriptVersions = [
    ...(args.metadata.transcriptVersions ?? []),
    {
      retrievedAt: args.retrievedAt,
      relativePath: transcriptVersionRelativePath,
      contentSha256: transcriptContentSha256,
      statementCount: transcript.statements.length
    }
  ].filter(
    (version, index, versions) =>
      versions.findIndex(
        (candidate) => candidate.contentSha256 === version.contentSha256
      ) === index
  );
  const metadata: MirroredDocumentMetadata = {
    ...args.metadata,
    lastMirroredAt: args.retrievedAt,
    transcriptRelativePath,
    transcriptContentSha256,
    transcriptStatementCount: transcript.statements.length,
    transcriptParserVersion: ASSEMBLY_MINUTES_TRANSCRIPT_PARSER_VERSION,
    transcriptVersions
  };
  await writeJsonFile(
    join(args.config.dataRepoDir, metadata.metadataRelativePath),
    metadata
  );

  return {
    metadata,
    written: true
  };
}

async function loadExistingMetadata(
  dataRepoDir: string,
  index: MirroredDocumentIndex
): Promise<MetadataLookups> {
  const byDocumentId = new Map<string, MirroredDocumentMetadata>();
  const bySourceUrl = new Map<string, MirroredDocumentMetadata>();
  const byDownloadUrl = new Map<string, MirroredDocumentMetadata>();

  for (const item of index.items) {
    const metadata = await readJsonFile<MirroredDocumentMetadata | null>(
      join(dataRepoDir, item.metadataRelativePath),
      null
    );
    if (metadata) {
      byDocumentId.set(metadata.documentId, metadata);
      bySourceUrl.set(metadata.sourceUrl, metadata);
      if (metadata.downloadUrl) {
        byDownloadUrl.set(metadata.downloadUrl, metadata);
      }
    }
  }

  return { byDocumentId, bySourceUrl, byDownloadUrl };
}

function buildTranscriptRefreshCandidates(
  metadataByDocumentId: Map<string, MirroredDocumentMetadata>
): MirrorCandidate[] {
  return [...metadataByDocumentId.values()]
    .filter(
      (metadata) =>
        isOfficialAssemblyMinutesViewerUrl(metadata.sourceUrl) &&
        metadata.transcriptParserVersion !==
          ASSEMBLY_MINUTES_TRANSCRIPT_PARSER_VERSION
    )
    .sort((left, right) =>
      right.publishedDate.localeCompare(left.publishedDate)
    )
    .map((metadata) => ({
      documentId: metadata.documentId,
      title: metadata.title,
      sourceUrl: metadata.sourceUrl,
      downloadUrl: metadata.downloadUrl,
      publishedDate: metadata.publishedDate,
      discoveredFromUrl: metadata.discoveredFromUrl,
      sourceMetadata: metadata.sourceMetadata
    }));
}

async function processWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length) },
    async () => {
      while (nextIndex < items.length) {
        const item = items[nextIndex];
        nextIndex += 1;
        if (item !== undefined) {
          await worker(item);
        }
      }
    }
  );
  await Promise.all(workers);
}

export function shouldReuseExistingBackfillDocument(args: {
  mode: MirrorMode;
  skipRecent: boolean;
  retryExistingOnly?: boolean;
  workItemKind: "discovered" | "transcript-refresh";
  hasExistingMetadata: boolean;
  hasFreshTranscript: boolean;
  rawMatchesMetadata: boolean;
}): boolean {
  return (
    args.mode === "assembly_minutes_catalog" &&
    (args.skipRecent || args.retryExistingOnly === true) &&
    args.workItemKind === "discovered" &&
    args.hasExistingMetadata &&
    args.hasFreshTranscript &&
    args.rawMatchesMetadata
  );
}

export async function auditExistingAssemblyMinutesRetry(args: {
  dataRepoDir: string;
  candidates: MirrorCandidate[];
  metadataByDocumentId: Map<string, MirroredDocumentMetadata>;
}): Promise<{ checked: number; invalid: number }> {
  let checked = 0;
  let invalid = 0;

  for (const candidate of args.candidates) {
    const documentId = candidate.documentId;
    const metadata = documentId
      ? args.metadataByDocumentId.get(documentId)
      : undefined;
    checked += 1;
    if (
      !metadata ||
      !(await mirroredDocumentMatchesMetadata(args.dataRepoDir, metadata))
    ) {
      invalid += 1;
    }
  }

  return { checked, invalid };
}

export function shouldBlockBackfillCursorOnDownloadFailure(args: {
  workItemKind: "discovered" | "transcript-refresh";
  rawMatchesMetadata: boolean;
}): boolean {
  return args.workItemKind === "discovered" && !args.rawMatchesMetadata;
}

export async function mirroredDocumentMatchesMetadata(
  dataRepoDir: string,
  metadata: Pick<
    MirroredDocumentMetadata,
    "latestRelativePath" | "currentBytes" | "currentContentSha256"
  > &
    Partial<
      Pick<
        MirroredDocumentMetadata,
        "sourceUrl" | "publishedDate" | "sourceMetadata" | "title"
      >
    >
): Promise<boolean> {
  try {
    const body = await readFile(join(dataRepoDir, metadata.latestRelativePath));
    if (
      body.byteLength !== metadata.currentBytes ||
      sha256Buffer(body) !== metadata.currentContentSha256
    ) {
      return false;
    }
    if (
      metadata.sourceUrl &&
      metadata.publishedDate &&
      isOfficialAssemblyMinutesViewerUrl(metadata.sourceUrl)
    ) {
      assertMirroredAssemblyMinutesArtifact({
        body,
        sourceUrl: metadata.sourceUrl,
        publishedDate: metadata.publishedDate,
        title: metadata.title,
        sourceMetadata: metadata.sourceMetadata
      });
    }
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const now = new Date();
  const cutoffDate = dateInTimeZone(config.timeZone, now);
  const retrievedAt = now.toISOString();
  const indexFile = join(config.dataRepoDir, config.indexPath);
  const stateFile = join(config.dataRepoDir, config.statePath);

  const existingIndex = await readJsonFile<MirroredDocumentIndex>(
    indexFile,
    mergeDocumentIndex(config.sourceId, [], retrievedAt)
  );
  const existingState = await readJsonFile<DocumentMirrorState | null>(
    stateFile,
    null
  );
  const existingMetadata = await loadExistingMetadata(
    config.dataRepoDir,
    existingIndex
  );
  const updatedMetadataByDocumentId = new Map(existingMetadata.byDocumentId);
  const updatedMetadataBySourceUrl = new Map(existingMetadata.bySourceUrl);
  const updatedMetadataByDownloadUrl = new Map(existingMetadata.byDownloadUrl);

  const needsBrowser =
    config.mode === "generic" || config.mode === "assembly_minutes_search";
  const chromiumExecutablePath =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
  const browser = needsBrowser
    ? await chromium.launch({
        headless: true,
        ...(chromiumExecutablePath
          ? { executablePath: chromiumExecutablePath }
          : {})
      })
    : null;
  const context = browser
    ? await browser.newContext({ userAgent: config.userAgent })
    : null;
  const page = context ? await context.newPage() : null;
  if (page) {
    const navigationAttempts = 3;
    for (let attempt = 1; attempt <= navigationAttempts; attempt += 1) {
      try {
        await page.goto(config.startUrl, {
          waitUntil: "commit",
          timeout: config.timeoutMs
        });
        if (config.readySelector) {
          await page
            .locator(config.readySelector)
            .first()
            .waitFor({ timeout: config.timeoutMs });
        }
        break;
      } catch (error) {
        if (attempt === navigationAttempts) {
          throw error;
        }
        process.stderr.write(
          `Start-page navigation attempt ${attempt} failed; retrying.\n`
        );
        await page.waitForTimeout(
          Math.min(config.pageDelayMs * attempt, 5_000)
        );
      }
    }
  }

  const api = await request.newContext({
    ...(context ? { storageState: await context.storageState() } : {}),
    userAgent: config.userAgent
  });

  const collectionResult = config.retryExistingOnly
    ? buildExistingAssemblyMinutesRetryCollection({
        existingIndex,
        existingMetadataByDocumentId: existingMetadata.byDocumentId,
        existingState,
        sourceId: config.sourceId
      })
    : config.mode === "assembly_minutes_search"
      ? await collectAssemblyCandidates(
          page!,
          api,
          config,
          existingState,
          cutoffDate
        )
      : config.mode === "assembly_minutes_catalog"
        ? await collectAssemblyMinutesCatalogCandidates(
            api,
            config,
            existingState,
            cutoffDate
          )
        : config.mode === "assembly_file_service"
          ? await collectAssemblyFileServiceCandidates(
              api,
              config,
              existingState,
              cutoffDate
            )
          : await collectGenericCandidates(page!, config);
  const transcriptRefreshCandidates =
    !config.retryExistingOnly &&
    (config.mode === "assembly_minutes_search" ||
      config.mode === "assembly_minutes_catalog")
      ? buildTranscriptRefreshCandidates(existingMetadata.byDocumentId)
      : [];
  const staleTranscriptDocumentIds = new Set(
    transcriptRefreshCandidates
      .map((candidate) => candidate.documentId)
      .filter((documentId): documentId is string => Boolean(documentId))
  );
  const workItems = [
    ...sortDatedItemsNewestFirst(collectionResult.candidates).map(
      (candidate) => ({
        kind: "discovered" as const,
        candidate
      })
    ),
    ...transcriptRefreshCandidates.map((candidate) => ({
      kind: "transcript-refresh" as const,
      candidate
    }))
  ];

  const seenCandidateKeys = new Set<string>();
  let downloadedCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  let skippedTodayOrFuture = 0;
  let skippedWithoutDate = 0;
  let downloadFailures = 0;
  let transcriptsWritten = 0;
  let transcriptFailures = 0;
  type PendingWorkItem = (typeof workItems)[number] & {
    blocksBackfillCursorOnDownloadFailure: boolean;
  };
  const pendingWorkItems: PendingWorkItem[] = [];
  for (const workItem of workItems) {
    const { candidate } = workItem;
    const seenKey = candidate.documentId ?? candidate.sourceUrl;
    if (seenCandidateKeys.has(seenKey)) {
      continue;
    }

    seenCandidateKeys.add(seenKey);

    if (!candidate.publishedDate) {
      skippedWithoutDate += 1;
      continue;
    }

    if (
      !config.retryExistingOnly &&
      !isPastDocumentDate(candidate.publishedDate, cutoffDate)
    ) {
      skippedTodayOrFuture += 1;
      continue;
    }

    const existingCandidateMetadata = selectExistingMirroredMetadata(
      {
        byDocumentId: updatedMetadataByDocumentId,
        bySourceUrl: updatedMetadataBySourceUrl,
        byDownloadUrl: updatedMetadataByDownloadUrl
      },
      candidate
    );
    const shouldCheckExistingRaw =
      config.mode === "assembly_minutes_catalog" &&
      workItem.kind === "discovered" &&
      Boolean(existingCandidateMetadata);
    const rawMatchesMetadata =
      shouldCheckExistingRaw && existingCandidateMetadata
        ? await mirroredDocumentMatchesMetadata(
            config.dataRepoDir,
            existingCandidateMetadata
          )
        : false;
    if (
      shouldReuseExistingBackfillDocument({
        mode: config.mode,
        skipRecent: config.skipRecent,
        retryExistingOnly: config.retryExistingOnly,
        workItemKind: workItem.kind,
        hasExistingMetadata: Boolean(existingCandidateMetadata),
        hasFreshTranscript:
          config.retryExistingOnly ||
          !isAssemblyMinutesViewerUrl(candidate.sourceUrl) ||
          existingCandidateMetadata?.transcriptParserVersion ===
            ASSEMBLY_MINUTES_TRANSCRIPT_PARSER_VERSION,
        rawMatchesMetadata
      })
    ) {
      unchangedCount += 1;
      continue;
    }

    pendingWorkItems.push({
      ...workItem,
      blocksBackfillCursorOnDownloadFailure:
        shouldBlockBackfillCursorOnDownloadFailure({
          workItemKind: workItem.kind,
          rawMatchesMetadata
        })
    });
  }

  const selectedWorkItems = pendingWorkItems.slice(0, config.maxDownloads);
  const reachedDownloadLimit = pendingWorkItems
    .slice(config.maxDownloads)
    .some((workItem) => workItem.blocksBackfillCursorOnDownloadFailure);
  await processWithConcurrency(
    selectedWorkItems,
    config.downloadConcurrency,
    async ({ candidate, blocksBackfillCursorOnDownloadFailure }) => {
      try {
        const existingCandidateMetadata = selectExistingMirroredMetadata(
          {
            byDocumentId: updatedMetadataByDocumentId,
            bySourceUrl: updatedMetadataBySourceUrl,
            byDownloadUrl: updatedMetadataByDownloadUrl
          },
          candidate
        );
        const outcome = await mirrorCandidate(
          candidate,
          config,
          api,
          existingCandidateMetadata,
          retrievedAt
        );
        let mirroredMetadata = outcome.metadata;

        if (
          (config.mode === "assembly_minutes_search" ||
            config.mode === "assembly_minutes_catalog") &&
          isAssemblyMinutesViewerUrl(candidate.sourceUrl)
        ) {
          try {
            const transcriptOutcome = await mirrorAssemblyMinutesTranscript({
              candidate,
              config,
              metadata: outcome.metadata,
              retrievedAt,
              downloaded: outcome.downloaded
            });
            mirroredMetadata = transcriptOutcome.metadata;
            if (transcriptOutcome.written) {
              transcriptsWritten += 1;
            }
          } catch (error) {
            transcriptFailures += 1;
            process.stderr.write(
              `Could not mirror transcript for ${outcome.metadata.documentId}: ${
                error instanceof Error ? error.message : String(error)
              }\n`
            );
          }
        }

        updatedMetadataByDocumentId.set(
          mirroredMetadata.documentId,
          mirroredMetadata
        );
        updatedMetadataBySourceUrl.set(
          mirroredMetadata.sourceUrl,
          mirroredMetadata
        );
        if (mirroredMetadata.downloadUrl) {
          updatedMetadataByDownloadUrl.set(
            mirroredMetadata.downloadUrl,
            mirroredMetadata
          );
        }

        if (outcome.type === "downloaded") {
          downloadedCount += 1;
          if (outcome.updated) {
            updatedCount += 1;
          }
        } else {
          unchangedCount += 1;
        }
      } catch (error) {
        if (blocksBackfillCursorOnDownloadFailure) {
          downloadFailures += 1;
        } else {
          transcriptFailures += 1;
        }
        process.stderr.write(
          `Could not mirror ${candidate.documentId ?? candidate.sourceUrl}: ${
            error instanceof Error ? error.message : String(error)
          }\n`
        );
      }
    }
  );

  await api.dispose();
  await context?.close();
  await browser?.close();

  const index = mergeDocumentIndex(
    config.sourceId,
    [...updatedMetadataByDocumentId.values()].map((metadata) =>
      toIndexItem(metadata)
    ),
    retrievedAt
  );
  const previousBackfillCursorDate = config.retryExistingOnly
    ? (existingState?.nextBackfillCursorDate ?? config.backfillStartDate)
    : (config.backfillCursorOverride ??
      existingState?.nextBackfillCursorDate ??
      config.backfillStartDate);
  const nextBackfillCursorDate = config.retryExistingOnly
    ? existingState?.nextBackfillCursorDate
    : resolvePublishedBackfillCursor({
        proposedCursor: collectionResult.nextBackfillCursorDate,
        fallbackCursor: previousBackfillCursorDate,
        skippedWithoutDate,
        downloadFailures,
        reachedDownloadLimit
      });
  const latestDiscoveredDocumentDate =
    collectionResult.candidates
      .map((candidate) => candidate.publishedDate)
      .filter((date): date is string => Boolean(date))
      .sort((left, right) => right.localeCompare(left))[0] ?? null;
  const staleTranscriptsRefreshed = [...staleTranscriptDocumentIds].filter(
    (documentId) =>
      updatedMetadataByDocumentId.get(documentId)?.transcriptParserVersion ===
      ASSEMBLY_MINUTES_TRANSCRIPT_PARSER_VERSION
  ).length;
  const recentWindowStartDate =
    collectionResult.recentWindowStartDate ??
    existingState?.recentWindowStartDate;
  const recentWindowEndDate =
    collectionResult.recentWindowEndDate ?? existingState?.recentWindowEndDate;
  const existingRetryAudit = config.retryExistingOnly
    ? await auditExistingAssemblyMinutesRetry({
        dataRepoDir: config.dataRepoDir,
        candidates: collectionResult.candidates,
        metadataByDocumentId: updatedMetadataByDocumentId
      })
    : null;
  const pendingExistingRetry = Boolean(
    existingRetryAudit &&
    (existingRetryAudit.invalid > 0 ||
      downloadFailures > 0 ||
      reachedDownloadLimit)
  );

  const state: DocumentMirrorState = {
    sourceId: config.sourceId,
    updatedAt: retrievedAt,
    cutoffDate,
    pagesVisited: collectionResult.pagesVisited,
    discoveredCandidates: collectionResult.discoveredCandidates,
    downloaded: downloadedCount,
    updated: updatedCount,
    unchanged: unchangedCount,
    skippedTodayOrFuture,
    skippedWithoutDate,
    downloadFailures,
    transcriptsWritten,
    transcriptFailures,
    lastStartUrl: config.startUrl,
    recentWindowStartDate,
    recentWindowEndDate,
    effectiveRecentDays: config.recentDays,
    nextBackfillCursorDate,
    pendingBackfill: hasPendingBackfill({
      nextBackfillCursorDate,
      recentWindowStartDate
    }),
    backfillAdvanced:
      !config.retryExistingOnly &&
      Boolean(
        nextBackfillCursorDate &&
        nextBackfillCursorDate > previousBackfillCursorDate
      ),
    latestDiscoveredDocumentDate,
    latestMirroredDocumentDate: index.items[0]?.publishedDate ?? null,
    staleTranscriptsQueued: staleTranscriptDocumentIds.size,
    staleTranscriptsRefreshed,
    sourceSnapshotSha256: collectionResult.sourceSnapshotSha256,
    sourceSnapshotCount: collectionResult.sourceSnapshotCount,
    skippedBySourceSnapshot: collectionResult.sourceSnapshotUnchanged ?? false,
    retryExistingOnly: config.retryExistingOnly,
    existingRetryCandidates: existingRetryAudit
      ? collectionResult.candidates.length
      : undefined,
    existingRetryChecked: existingRetryAudit?.checked,
    existingRetryInvalid: existingRetryAudit?.invalid,
    pendingExistingRetry: existingRetryAudit ? pendingExistingRetry : undefined
  };

  await writeJsonFile(indexFile, index);
  await writeJsonFile(stateFile, state);

  process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void main();
}
