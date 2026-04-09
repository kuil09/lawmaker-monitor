import type {
  AccountabilitySummaryExport,
  AccountabilityTrendsExport,
  ConstituencyBoundariesIndexExport,
  LatestVotesExport,
  MemberActivityCalendarExport,
  MemberActivityCalendarMemberDetailExport,
  MemberAssetsHistoryExport,
  MemberAssetsIndexExport,
  Manifest
} from "@lawmaker-monitor/schemas";
import {
  accountabilitySummaryExportSchema,
  accountabilityTrendsExportSchema,
  constituencyBoundariesIndexExportSchema,
  latestVotesExportSchema,
  memberAssetsHistoryExportSchema,
  memberAssetsIndexExportSchema,
  memberActivityCalendarExportSchema,
  memberActivityCalendarMemberDetailExportSchema,
  manifestSchema
} from "@lawmaker-monitor/schemas";

const dataRepoBaseUrl =
  import.meta.env.VITE_DATA_REPO_BASE_URL ?? "https://example.github.io/lawmaker-monitor-data";
const defaultConstituencyBoundariesIndexPath = "exports/constituency_boundaries/index.json";

function buildUrl(path: string): string {
  return new URL(path, `${dataRepoBaseUrl.replace(/\/$/, "")}/`).toString();
}

async function fetchJson<T>(url: string, parse: (value: unknown) => T): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`데이터 요청에 실패했습니다 (${response.status}).`);
  }

  return parse(await response.json());
}

async function fetchOptionalJson<T>(
  url: string,
  parse: (value: unknown) => T
): Promise<T | null> {
  const response = await fetch(url);
  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`데이터 요청에 실패했습니다 (${response.status}).`);
  }

  return parse(await response.json());
}

export function loadLatestVotes(): Promise<LatestVotesExport> {
  return fetchJson(buildUrl("exports/latest_votes.json"), (payload) =>
    latestVotesExportSchema.parse(payload)
  );
}

export function loadAccountabilitySummary(): Promise<AccountabilitySummaryExport | null> {
  return fetchOptionalJson(buildUrl("exports/accountability_summary.json"), (payload) =>
    accountabilitySummaryExportSchema.parse(payload)
  );
}

export function loadAccountabilityTrends(manifest?: Manifest | null): Promise<AccountabilityTrendsExport | null> {
  const trendsPath =
    manifest?.exports.accountabilityTrends?.path ?? "exports/accountability_trends.json";

  return fetchOptionalJson(buildUrl(trendsPath), (payload) =>
    accountabilityTrendsExportSchema.parse(payload)
  );
}

export function loadManifest(): Promise<Manifest | null> {
  return fetchOptionalJson(buildUrl("manifests/latest.json"), (payload) => manifestSchema.parse(payload));
}

export function loadMemberActivityCalendar(
  manifest?: Manifest | null
): Promise<MemberActivityCalendarExport | null> {
  const calendarPath =
    manifest?.exports.memberActivityCalendar?.path ?? "exports/member_activity_calendar.json";

  return fetchOptionalJson(buildUrl(calendarPath), (payload) =>
    memberActivityCalendarExportSchema.parse(payload)
  );
}

export function loadMemberActivityCalendarMemberDetail(
  path: string
): Promise<MemberActivityCalendarMemberDetailExport | null> {
  return fetchOptionalJson(buildUrl(path), (payload) =>
    memberActivityCalendarMemberDetailExportSchema.parse(payload)
  );
}

export function loadMemberAssetsIndex(
  manifest?: Manifest | null
): Promise<MemberAssetsIndexExport | null> {
  const indexPath =
    manifest?.exports.memberAssetsIndex?.path ?? "exports/member_assets_index.json";

  return fetchOptionalJson(buildUrl(indexPath), (payload) =>
    memberAssetsIndexExportSchema.parse(payload)
  );
}

export function loadMemberAssetsHistory(
  path: string
): Promise<MemberAssetsHistoryExport | null> {
  return fetchOptionalJson(buildUrl(path), (payload) =>
    memberAssetsHistoryExportSchema.parse(payload)
  );
}

export function loadConstituencyBoundariesIndex(
  manifest?: Manifest | null
): Promise<ConstituencyBoundariesIndexExport | null> {
  const indexPath = getConstituencyBoundariesIndexPath(manifest);

  return fetchOptionalJson(buildUrl(indexPath), (payload) =>
    constituencyBoundariesIndexExportSchema.parse(payload)
  );
}

export function loadConstituencyProvinceTopology<T>(path: string): Promise<T | null> {
  return fetchOptionalJson(buildUrl(path), (payload) => payload as T);
}

export function getDataRepoBaseUrl(): string {
  return dataRepoBaseUrl;
}

export function getConstituencyBoundariesIndexPath(manifest?: Manifest | null): string {
  return manifest?.exports.constituencyBoundariesIndex?.path ?? defaultConstituencyBoundariesIndexPath;
}
