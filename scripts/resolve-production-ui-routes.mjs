import { resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_APP_BASE_URL = process.env.APP_BASE_URL ?? "https://kuil09.github.io/lawmaker-monitor/";
const DEFAULT_DATA_REPO_BASE_URL =
  process.env.DATA_REPO_BASE_URL ?? "https://kuil09.github.io/lawmaker-monitor-data/";

function normalizeBaseUrl(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url} (${response.status}).`);
  }

  return response.json();
}

async function urlExists(fetchImpl, url) {
  let response;

  try {
    response = await fetchImpl(url, { method: "HEAD" });
  } catch {
    response = null;
  }

  if (!response || response.status === 405 || response.status === 501) {
    response = await fetchImpl(url);
  }

  return response.ok;
}

export function compareVerificationMembers(left, right) {
  return left.name.localeCompare(right.name, "ko-KR") || left.memberId.localeCompare(right.memberId);
}

export async function pickVerificationMembers(
  members,
  {
    dataRepoBaseUrl,
    fetchImpl = globalThis.fetch
  } = {}
) {
  if (!dataRepoBaseUrl) {
    throw new Error("dataRepoBaseUrl is required.");
  }

  const candidates = members
    .filter(
      (member) =>
        typeof member?.memberId === "string" &&
        member.memberId.length > 0 &&
        typeof member?.name === "string" &&
        member.name.length > 0 &&
        typeof member?.voteRecordsPath === "string" &&
        member.voteRecordsPath.length > 0
    )
    .sort(compareVerificationMembers)
    .map((member) => ({
      memberId: member.memberId,
      name: member.name,
      party: member.party ?? member.partyName ?? null,
      voteRecordsPath: member.voteRecordsPath,
      detailUrl: new URL(member.voteRecordsPath, dataRepoBaseUrl).toString()
    }));

  const selectedMembers = [];

  for (const candidate of candidates) {
    if (!(await urlExists(fetchImpl, candidate.detailUrl))) {
      continue;
    }

    selectedMembers.push(candidate);

    if (selectedMembers.length === 2) {
      return selectedMembers;
    }
  }

  throw new Error(
    `Unable to find two published members with resolvable detail files. Checked ${candidates.length} candidates.`
  );
}

export function buildVerificationRoutes({
  appBaseUrl,
  dataRepoBaseUrl,
  manifestUrl,
  calendarUrl,
  snapshotId,
  updatedAt,
  selectedMembers
}) {
  const [primaryMember, secondaryMember] = selectedMembers;
  const singleHash = `#calendar?member=${encodeURIComponent(primaryMember.memberId)}`;
  const compareHash =
    `#calendar?member=${encodeURIComponent(primaryMember.memberId)}` +
    `&compare=${encodeURIComponent(secondaryMember.memberId)}&view=compare`;

  return {
    snapshotId,
    updatedAt,
    selectionRule:
      "Sort assembly members by name (ko-KR) then memberId, keep members with voteRecordsPath, probe published detail files, and use the first two results.",
    appBaseUrl,
    dataRepoBaseUrl,
    manifestUrl,
    calendarUrl,
    single: {
      ...primaryMember,
      hash: singleHash,
      url: new URL(singleHash, appBaseUrl).toString()
    },
    compare: {
      primaryMember,
      secondaryMember,
      hash: compareHash,
      url: new URL(compareHash, appBaseUrl).toString()
    }
  };
}

export async function resolveProductionUiRoutes({
  appBaseUrl = DEFAULT_APP_BASE_URL,
  dataRepoBaseUrl = DEFAULT_DATA_REPO_BASE_URL,
  fetchImpl = globalThis.fetch
} = {}) {
  const normalizedAppBaseUrl = normalizeBaseUrl(appBaseUrl);
  const normalizedDataRepoBaseUrl = normalizeBaseUrl(dataRepoBaseUrl);
  const manifestUrl = new URL("manifests/latest.json", normalizedDataRepoBaseUrl).toString();
  const manifest = await fetchJson(fetchImpl, manifestUrl);
  const calendarPath = manifest?.exports?.memberActivityCalendar?.path ?? "exports/member_activity_calendar.json";
  const calendarUrl = new URL(calendarPath, normalizedDataRepoBaseUrl).toString();
  const calendar = await fetchJson(fetchImpl, calendarUrl);
  const selectedMembers = await pickVerificationMembers(calendar?.assembly?.members ?? [], {
    dataRepoBaseUrl: normalizedDataRepoBaseUrl,
    fetchImpl
  });

  return buildVerificationRoutes({
    appBaseUrl: normalizedAppBaseUrl,
    dataRepoBaseUrl: normalizedDataRepoBaseUrl,
    manifestUrl,
    calendarUrl,
    snapshotId: manifest?.snapshotId ?? null,
    updatedAt: manifest?.updatedAt ?? null,
    selectedMembers
  });
}

const cliEntryUrl = process.argv[1] ? pathToFileURL(resolvePath(process.argv[1])).href : null;

if (cliEntryUrl && import.meta.url === cliEntryUrl) {
  const output = await resolveProductionUiRoutes();
  console.log(JSON.stringify(output, null, 2));
}
