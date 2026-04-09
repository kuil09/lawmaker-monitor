import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, request, type APIRequestContext, type Locator, type Page } from "playwright";

import type {
  DocumentMirrorState,
  MirroredDocumentIndex,
  MirroredDocumentMetadata,
  MirroredDocumentMetadataLookups
} from "../document-mirror.js";
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
import { readJsonFile, readString, sha256, sha256Buffer, writeJsonFile } from "../utils.js";

type MirrorMode = "generic" | "assembly_minutes_search" | "assembly_file_service";

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
  pageDelayMs: number;
  timeoutMs: number;
  timeZone: string;
  dataRepoDir: string;
  indexPath: string;
  statePath: string;
  userAgent: string;
  recentDays: number;
  backfillStartDate: string;
  backfillDays: number;
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
  | { type: "downloaded"; metadata: MirroredDocumentMetadata; updated: boolean }
  | { type: "unchanged"; metadata: MirroredDocumentMetadata };

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

type SearchWindow = {
  label: "recent" | "backfill";
  startDate: string;
  endDate: string;
};

type FormValueMap = Map<string, string[]>;

type AssemblySearchItem = Record<string, unknown>;

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

const assemblyMinuteRecordKeys = [
  "record1",
  "record2",
  "record3",
  "record4",
  "record5",
  "record6",
  "record7"
] as const;

const assemblyAppendixRecordKeys = ["record_app", "record_app_bo"] as const;

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be configured.`);
  }

  return value;
}

function readPositiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
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

function shiftIsoDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map((part) => Number.parseInt(part, 10));
  if (!year || !month || !day) {
    throw new Error(`Invalid ISO date: ${date}`);
  }

  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function minIsoDate(left: string, right: string): string {
  return left <= right ? left : right;
}

function parseServiceInfId(startUrl: string): string | undefined {
  const matched = startUrl.match(/\/selectServicePage\.do\/([^/?#]+)/);
  return matched?.[1];
}

function loadConfig(): MirrorConfig {
  const startUrl = readRequiredEnv("MIRROR_START_URL");
  const configuredMode = process.env.MIRROR_MODE?.trim() as MirrorMode | undefined;
  const serviceInfId = process.env.MIRROR_SERVICE_INF_ID?.trim() || parseServiceInfId(startUrl);

  return {
    mode:
      configuredMode ??
      (startUrl.includes("/mnts/minutes/search.do") ? "assembly_minutes_search" : "generic"),
    sourceId: process.env.MIRROR_SOURCE_ID?.trim() || "assembly-public-documents",
    startUrl,
    readySelector: process.env.MIRROR_READY_SELECTOR?.trim(),
    rowSelector: process.env.MIRROR_ROW_SELECTOR?.trim() || ".sch_rslt .rslt_list > li.list",
    titleSelector: process.env.MIRROR_TITLE_SELECTOR?.trim() || ".con .ellipsis a",
    linkSelector:
      process.env.MIRROR_LINK_SELECTOR?.trim() ||
      ".btn_list a[href*='/viewer/minutes/download/pdf.do'], .btn_list a[href*='/viewer/minutes/download/hwp.do'], .btn_list a[href*='/viewer/minutes/download/img.do'], .con .ellipsis a",
    linkAttribute: process.env.MIRROR_LINK_ATTRIBUTE?.trim() || "href",
    dateSelector: process.env.MIRROR_DATE_SELECTOR?.trim() || ".std .date",
    nextSelector: process.env.MIRROR_NEXT_SELECTOR?.trim() || ".page_nav a.next:not([disabled])",
    maxPages: readPositiveInteger("MIRROR_MAX_PAGES", 25),
    maxDownloads: readPositiveInteger("MIRROR_MAX_DOWNLOADS", 80),
    pageDelayMs: readPositiveInteger("MIRROR_PAGE_DELAY_MS", 1000),
    timeoutMs: readPositiveInteger("MIRROR_TIMEOUT_MS", 20_000),
    timeZone: process.env.MIRROR_TIME_ZONE?.trim() || "Asia/Seoul",
    dataRepoDir: resolve(process.env.DATA_REPO_DIR?.trim() || "published-data"),
    indexPath: process.env.MIRROR_INDEX_PATH?.trim() || "raw/index/document_index.json",
    statePath:
      process.env.MIRROR_STATE_PATH?.trim() || "manifests/document_mirror_state.json",
    userAgent:
      process.env.MIRROR_USER_AGENT?.trim() ||
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    recentDays: readPositiveInteger("MIRROR_RECENT_DAYS", 3),
    backfillStartDate:
      process.env.MIRROR_BACKFILL_START_DATE?.trim() || "2024-05-30",
    backfillDays: readPositiveInteger("MIRROR_BACKFILL_DAYS", 7),
    includeAppendices: readBooleanEnv("MIRROR_INCLUDE_APPENDICES", true),
    serviceInfId,
    serviceInfSeq: readPositiveInteger("MIRROR_SERVICE_INF_SEQ", 1)
  };
}

async function locatorText(locator: Locator): Promise<string | undefined> {
  try {
    return readString(await locator.textContent());
  } catch {
    return undefined;
  }
}

async function locatorAttribute(locator: Locator, attribute: string): Promise<string | undefined> {
  try {
    return readString(await locator.getAttribute(attribute));
  } catch {
    return undefined;
  }
}

async function collectCandidates(page: Page, config: MirrorConfig): Promise<MirrorCandidate[]> {
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

async function hashVisibleRows(page: Page, rowSelector: string): Promise<string> {
  const rows = page.locator(rowSelector);
  const texts = await rows.allInnerTexts();
  return sha256(texts.join("\n"));
}

async function goToNextPage(page: Page, config: MirrorConfig): Promise<boolean> {
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
  return new Map([...source.entries()].map(([key, values]) => [key, [...values]]));
}

function setFormValues(map: FormValueMap, key: string, values: string[]): void {
  const normalizedValues = values.map((value) => value.trim());
  if (normalizedValues.length === 0) {
    map.delete(key);
    return;
  }

  map.set(key, normalizedValues);
}

function setSingleFormValue(map: FormValueMap, key: string, value: string | undefined): void {
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

export function buildAssemblySearchWindows(
  cutoffDate: string,
  config: MirrorConfig,
  existingState: DocumentMirrorState | null,
  options?: {
    includeAllBackfillWindows?: boolean;
  }
): SearchWindow[] {
  const yesterday = shiftIsoDate(cutoffDate, -1);
  const windows: SearchWindow[] = [];

  if (config.recentDays > 0) {
    windows.push({
      label: "recent",
      startDate: shiftIsoDate(yesterday, -(config.recentDays - 1)),
      endDate: yesterday
    });
  }

  const backfillCursor =
    existingState?.nextBackfillCursorDate?.trim() || config.backfillStartDate;
  if (backfillCursor <= yesterday && config.backfillDays > 0) {
    let cursor = backfillCursor;

    while (cursor <= yesterday) {
      const backfillEndDate = minIsoDate(
        shiftIsoDate(cursor, config.backfillDays - 1),
        yesterday
      );
      const overlapsRecent = windows.some(
        (window) =>
          cursor >= window.startDate &&
          backfillEndDate <= window.endDate
      );

      if (!overlapsRecent) {
        windows.push({
          label: "backfill",
          startDate: cursor,
          endDate: backfillEndDate
        });
      }

      if (!options?.includeAllBackfillWindows) {
        break;
      }

      cursor = shiftIsoDate(backfillEndDate, 1);
    }
  }

  const uniqueWindows = new Map<string, SearchWindow>();
  for (const window of windows) {
    uniqueWindows.set(`${window.label}:${window.startDate}:${window.endDate}`, window);
  }

  return [...uniqueWindows.values()];
}

export function resolveNextBackfillCursorDate(args: {
  cutoffDate: string;
  config: Pick<MirrorConfig, "backfillStartDate">;
  existingState: Pick<DocumentMirrorState, "nextBackfillCursorDate"> | null;
  windows: SearchWindow[];
}): string | null {
  const yesterday = shiftIsoDate(args.cutoffDate, -1);
  const latestBackfillWindow = args.windows.filter((window) => window.label === "backfill").at(-1);

  if (latestBackfillWindow) {
    return shiftIsoDate(latestBackfillWindow.endDate, 1);
  }

  return args.existingState?.nextBackfillCursorDate ??
    (args.config.backfillStartDate <= yesterday ? args.config.backfillStartDate : null);
}

function toNumber(value: unknown): number {
  const parsed = Number.parseInt(readString(value) ?? "", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeCompactAssemblyDate(value: unknown): string | null {
  const text = readString(value);
  if (!text) {
    return null;
  }

  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  }

  return normalizeDocumentDate(text);
}

export function buildAssemblyFileServiceSourceSnapshot(items: AssemblyFileServiceItem[]): {
  count: number;
  sha256: string;
} {
  const normalized = [...items]
    .map((item) => ({
      cvtFileSize: readString(item.cvtFileSize) ?? "",
      fileExt: readString(item.fileExt) ?? "",
      fileSeq: toNumber(item.fileSeq),
      ftCrDttm: normalizeCompactAssemblyDate(item.ftCrDttm) ?? readString(item.ftCrDttm) ?? "",
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
  const title =
    readString(item.ITEM_NM) ??
    readString(item.CMIT_NM) ??
    `Minutes ${minutesId}`;

  const viewerUrl = new URL(
    `/assembly/viewer/minutes/xml.do?id=${minutesId}&type=view`,
    config.startUrl
  ).toString();
  const assetUrls: string[] = [];

  if (toNumber(item.PDF_CNT) > 0) {
    assetUrls.push(
      new URL(
        `/assembly/viewer/minutes/download/pdf.do?id=${minutesId}`,
        config.startUrl
      ).toString()
    );
  }

  if (toNumber(item.HWP_CNT) > 0) {
    assetUrls.push(
      new URL(
        `/assembly/viewer/minutes/download/hwp.do?id=${minutesId}`,
        config.startUrl
      ).toString()
    );
  }

  if (toNumber(item.IMG_CNT) > 0) {
    assetUrls.push(
      new URL(
        `/assembly/viewer/minutes/download/img.do?id=${minutesId}`,
        config.startUrl
      ).toString()
    );
  }

  if (assetUrls.length === 0) {
    assetUrls.push(viewerUrl);
  }

  return {
    documentId: `${config.sourceId}-minutes-${minutesId}`,
    title,
    sourceUrl: viewerUrl,
    downloadUrl: assetUrls[0],
    publishedDate,
    discoveredFromUrl
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
      const candidate = buildAssemblyMinutesCandidate(item, config, discoveredFromUrl);
      if (candidate) {
        candidates.push(candidate);
      }
    }
  }

  if (!includeAppendices) {
    return candidates;
  }

  for (const key of assemblyAppendixRecordKeys) {
    const record = response[key];
    for (const item of record?.resultList ?? []) {
      const candidate = buildAssemblyAppendixCandidate(item, config, discoveredFromUrl);
      if (candidate) {
        candidates.push(candidate);
      }
    }
  }

  return candidates;
}

function responsePageCount(
  response: AssemblySearchResponse,
  includeAppendices: boolean
): number {
  const keys = includeAppendices
    ? [...assemblyMinuteRecordKeys, ...assemblyAppendixRecordKeys]
    : [...assemblyMinuteRecordKeys];

  let totalPages = 1;
  for (const key of keys) {
    const count = response[key]?.totalCount ?? 0;
    totalPages = Math.max(totalPages, Math.ceil(count / 10));
  }

  return totalPages;
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

function buildAssemblyMinutesParams(
  baseValues: FormValueMap,
  window: SearchWindow,
  pageNumber: number
): URLSearchParams {
  const formValues = cloneFormValues(baseValues);

  setSingleFormValue(formValues, "startDate", compactDate(window.startDate));
  setSingleFormValue(formValues, "endDate", compactDate(window.endDate));
  setSingleFormValue(formValues, "collection", "record1,record2,record3,record4,record5,record6,record7");
  setSingleFormValue(formValues, "CLASS_CD", "1,2,3,4,5,6,7");
  setSingleFormValue(formValues, "query", "");
  setSingleFormValue(formValues, "SPK_NM", "");
  setSingleFormValue(formValues, "SPKSAME", "N");
  setSingleFormValue(formValues, "sort", "RDATE");
  setSingleFormValue(formValues, "searchField", "SPK_CNTS,ITEM_NM,ETC_CNTS");
  setSingleFormValue(formValues, "startCount", String(pageNumber));
  setSingleFormValue(formValues, "listCount", "10");

  return formValuesToSearchParams(formValues);
}

function buildAssemblyAppendixParams(
  baseValues: FormValueMap,
  window: SearchWindow,
  pageNumber: number
): URLSearchParams {
  const formValues = cloneFormValues(baseValues);

  setSingleFormValue(formValues, "startDate", compactDate(window.startDate));
  setSingleFormValue(formValues, "endDate", compactDate(window.endDate));
  setSingleFormValue(formValues, "collection", "record_app,record_app_bo");
  setSingleFormValue(formValues, "query", "");
  setSingleFormValue(formValues, "SPK_NM", "");
  setSingleFormValue(formValues, "SPKSAME", "N");
  setSingleFormValue(formValues, "sort", "RDATE");
  setSingleFormValue(formValues, "searchField", "");
  setSingleFormValue(formValues, "startCount", String(pageNumber));
  setSingleFormValue(formValues, "listCount", "10");
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
  const windows = buildAssemblySearchWindows(cutoffDate, config, existingState);
  const candidates: MirrorCandidate[] = [];
  let pagesVisited = 0;
  let discoveredCandidates = 0;

  for (const window of windows) {
    const minutesFirst = await postAssemblySearch(
      api,
      config,
      buildAssemblyMinutesParams(baseValues, window, 1)
    );
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

    const minutePages = Math.min(responsePageCount(minutesFirst, false), config.maxPages);
    for (let pageNumber = 2; pageNumber <= minutePages; pageNumber += 1) {
      const response = await postAssemblySearch(
        api,
        config,
        buildAssemblyMinutesParams(baseValues, window, pageNumber)
      );
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

    if (config.includeAppendices) {
      const appendixFirst = await postAssemblySearch(
        api,
        config,
        buildAssemblyAppendixParams(baseValues, window, 1)
      );
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

      const appendixPages = Math.min(responsePageCount(appendixFirst, true), config.maxPages);
      for (let pageNumber = 2; pageNumber <= appendixPages; pageNumber += 1) {
        const response = await postAssemblySearch(
          api,
          config,
          buildAssemblyAppendixParams(baseValues, window, pageNumber)
        );
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
    }
  }

  return {
    candidates,
    pagesVisited,
    discoveredCandidates,
    recentWindowStartDate: windows.find((window) => window.label === "recent")?.startDate,
    recentWindowEndDate: windows.find((window) => window.label === "recent")?.endDate,
    nextBackfillCursorDate: resolveNextBackfillCursorDate({
      cutoffDate,
      config,
      existingState,
      windows
    })
  };
}

function isDateWithinSearchWindow(date: string, window: SearchWindow): boolean {
  return date >= window.startDate && date <= window.endDate;
}

async function postAssemblyFileServiceSearch(
  api: APIRequestContext,
  config: MirrorConfig
): Promise<AssemblyFileServiceResponse> {
  if (!config.serviceInfId) {
    throw new Error("MIRROR_SERVICE_INF_ID must be configured for assembly_file_service mode.");
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
  const windows = buildAssemblySearchWindows(cutoffDate, config, existingState, {
    includeAllBackfillWindows: true
  });
  const response = await postAssemblyFileServiceSearch(api, config);
  const sourceSnapshot = buildAssemblyFileServiceSourceSnapshot(response.data ?? []);
  const hasBackfillWindow = windows.some((window) => window.label === "backfill");
  const candidates = (response.data ?? [])
    .map((item) => buildAssemblyFileServiceCandidate(item, config))
    .filter((candidate): candidate is MirrorCandidate => Boolean(candidate))
    .filter((candidate) =>
      windows.some((window) => isDateWithinSearchWindow(candidate.publishedDate ?? "", window))
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
      recentWindowStartDate: windows.find((window) => window.label === "recent")?.startDate,
      recentWindowEndDate: windows.find((window) => window.label === "recent")?.endDate,
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
    recentWindowStartDate: windows.find((window) => window.label === "recent")?.startDate,
    recentWindowEndDate: windows.find((window) => window.label === "recent")?.endDate,
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
): Promise<{
  body: Buffer;
  responseUrl: string;
  contentType: string;
  contentDisposition?: string;
}> {
  const response = await api.get(sourceUrl, {
    failOnStatusCode: true,
    timeout: timeoutMs
  });

  const body = await response.body();
  return {
    body,
    responseUrl: response.url(),
    contentType: response.headers()["content-type"] ?? "application/octet-stream",
    contentDisposition: response.headers()["content-disposition"]
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
  const downloaded = await downloadDocument(api, downloadTarget, config.timeoutMs);
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

  if (existingMetadata && existingMetadata.currentContentSha256 === contentSha) {
    return { type: "unchanged", metadata: existingMetadata };
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
        (candidateVersion) => candidateVersion.contentSha256 === version.contentSha256
      ) === index
  );

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
    ...(candidate.sourceMetadata ? { sourceMetadata: candidate.sourceMetadata } : {}),
    versions: dedupedVersions
  };

  await writeJsonFile(metadataPath, metadata);

  return {
    type: "downloaded",
    metadata,
    updated: Boolean(existingMetadata)
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
  const existingState = await readJsonFile<DocumentMirrorState | null>(stateFile, null);
  const existingMetadata = await loadExistingMetadata(config.dataRepoDir, existingIndex);
  const updatedMetadataByDocumentId = new Map(existingMetadata.byDocumentId);
  const updatedMetadataBySourceUrl = new Map(existingMetadata.bySourceUrl);
  const updatedMetadataByDownloadUrl = new Map(existingMetadata.byDownloadUrl);

  const needsBrowser = config.mode === "generic" || config.mode === "assembly_minutes_search";
  const browser = needsBrowser ? await chromium.launch({ headless: true }) : null;
  const context = browser ? await browser.newContext({ userAgent: config.userAgent }) : null;
  const page = context ? await context.newPage() : null;
  if (page) {
    await page.goto(config.startUrl, {
      waitUntil: "domcontentloaded",
      timeout: config.timeoutMs
    });
    if (config.readySelector) {
      await page.locator(config.readySelector).first().waitFor({ timeout: config.timeoutMs });
    }
  }

  const api = await request.newContext({
    ...(context ? { storageState: await context.storageState() } : {}),
    userAgent: config.userAgent
  });

  const collectionResult =
    config.mode === "assembly_minutes_search"
      ? await collectAssemblyCandidates(page!, api, config, existingState, cutoffDate)
      : config.mode === "assembly_file_service"
        ? await collectAssemblyFileServiceCandidates(api, config, existingState, cutoffDate)
        : await collectGenericCandidates(page!, config);

  const seenCandidateKeys = new Set<string>();
  let downloadedCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  let skippedTodayOrFuture = 0;
  let skippedWithoutDate = 0;
  let remainingDownloads = config.maxDownloads;

  for (const candidate of collectionResult.candidates) {
    const seenKey = candidate.documentId ?? candidate.sourceUrl;
    if (seenCandidateKeys.has(seenKey)) {
      continue;
    }

    seenCandidateKeys.add(seenKey);

    if (!candidate.publishedDate) {
      skippedWithoutDate += 1;
      continue;
    }

    if (!isPastDocumentDate(candidate.publishedDate, cutoffDate)) {
      skippedTodayOrFuture += 1;
      continue;
    }

    if (remainingDownloads <= 0) {
      break;
    }

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

    updatedMetadataByDocumentId.set(outcome.metadata.documentId, outcome.metadata);
    updatedMetadataBySourceUrl.set(outcome.metadata.sourceUrl, outcome.metadata);
    if (outcome.metadata.downloadUrl) {
      updatedMetadataByDownloadUrl.set(outcome.metadata.downloadUrl, outcome.metadata);
    }

    if (outcome.type === "downloaded") {
      downloadedCount += 1;
      if (outcome.updated) {
        updatedCount += 1;
      }
    } else {
      unchangedCount += 1;
    }

    remainingDownloads -= 1;
  }

  await api.dispose();
  await context?.close();
  await browser?.close();

  const index = mergeDocumentIndex(
    config.sourceId,
    [...updatedMetadataByDocumentId.values()].map((metadata) => toIndexItem(metadata)),
    retrievedAt
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
    lastStartUrl: config.startUrl,
    recentWindowStartDate: collectionResult.recentWindowStartDate,
    recentWindowEndDate: collectionResult.recentWindowEndDate,
    nextBackfillCursorDate: collectionResult.nextBackfillCursorDate,
    sourceSnapshotSha256: collectionResult.sourceSnapshotSha256,
    sourceSnapshotCount: collectionResult.sourceSnapshotCount,
    skippedBySourceSnapshot: collectionResult.sourceSnapshotUnchanged ?? false
  };

  await writeJsonFile(indexFile, index);
  await writeJsonFile(stateFile, state);

  process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
