import type {
  AccountabilitySummaryExport,
  AccountabilityTrendsExport,
  LatestVotesExport,
  MemberActivityCalendarExport,
  MemberActivityCalendarMemberDetailExport,
  Manifest
} from "@lawmaker-monitor/schemas";
import {
  accountabilitySummaryExportSchema,
  accountabilityTrendsExportSchema,
  latestVotesExportSchema,
  memberActivityCalendarExportSchema,
  memberActivityCalendarMemberDetailExportSchema,
  manifestSchema
} from "@lawmaker-monitor/schemas";

const dataRepoBaseUrl =
  import.meta.env.VITE_DATA_REPO_BASE_URL ?? "https://example.github.io/lawmaker-monitor-data";

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

export function getDataRepoBaseUrl(): string {
  return dataRepoBaseUrl;
}
