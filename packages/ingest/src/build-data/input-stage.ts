import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertRawSnapshotManifestSourcePolicy } from "../assembly-source-registry.js";
import { resolveRawSnapshot } from "../raw-snapshot.js";
import { resolvePathFromRoot } from "../utils.js";

import type { RawSnapshotEntry } from "../raw-snapshot.js";

type ResolvedRawSnapshot = Awaited<ReturnType<typeof resolveRawSnapshot>>;

export type BuildDataRuntimeConfig = {
  env: NodeJS.ProcessEnv;
  repositoryRoot: string;
  constituencyBoundaryDir: string;
  rawRoot: string;
  dataRepoDir: string;
  outputDir: string;
  baseUrl: string;
};

export type BuildDataRawInputs = {
  env: NodeJS.ProcessEnv;
  repositoryRoot: string;
  constituencyBoundaryDir: string;
  dataRepoDir: string;
  outputDir: string;
  baseUrl: string;
  snapshotId: string;
  resolvedRaw: ResolvedRawSnapshot;
  scheduleEntry: RawSnapshotEntry;
  memberInfoEntries: RawSnapshotEntry[];
  memberProfileAllEntries: RawSnapshotEntry[];
  memberHistoryEntries: RawSnapshotEntry[];
  committeeOverviewEntries: RawSnapshotEntry[];
  committeeRosterEntries: RawSnapshotEntry[];
  committeeCareerEntries: RawSnapshotEntry[];
  plenaryAttendanceFileEntries: RawSnapshotEntry[];
  billVoteSummaryEntries: RawSnapshotEntry[];
  billProposalEntries: RawSnapshotEntry[];
  agendaEntries: RawSnapshotEntry[];
  voteEntries: RawSnapshotEntry[];
  voteMemberListEntries: RawSnapshotEntry[];
  liveEntry: RawSnapshotEntry | null;
  minutesEntry: RawSnapshotEntry | null;
  memberInfoXmls: string[];
  memberProfileAllXmls: string[];
  memberHistoryXmls: string[];
  committeeOverviewXmls: string[];
  committeeRosterXmls: string[];
  committeeCareerJsons: string[];
  plenaryAttendanceFileBuffers: Buffer[];
  billVoteSummaryXmls: string[];
  billProposalXmls: string[];
  scheduleXml: string;
  liveXml: string | null;
  minutesXml: string | null;
  agendaXmls: string[];
  voteXmls: string[];
  voteMemberListHtmls: string[];
};

function findEntry(
  entries: ResolvedRawSnapshot["manifest"]["entries"],
  kind: string
) {
  return entries.find((entry) => entry.kind === kind) ?? null;
}

function findEntries(
  entries: ResolvedRawSnapshot["manifest"]["entries"],
  kinds: string[]
) {
  return entries.filter((entry) => kinds.includes(entry.kind));
}

async function readEntryPayload(
  rawDir: string,
  relativePath: string
): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  return readFile(join(rawDir, relativePath), "utf8");
}

async function readEntryBuffer(
  rawDir: string,
  relativePath: string
): Promise<Buffer> {
  const { readFile } = await import("node:fs/promises");
  return readFile(join(rawDir, relativePath));
}

export function resolveBuildDataRuntimeConfig(args?: {
  env?: NodeJS.ProcessEnv;
  repositoryRoot?: string;
}): BuildDataRuntimeConfig {
  const env = args?.env ?? process.env;
  const repositoryRoot =
    args?.repositoryRoot ??
    resolve(fileURLToPath(new URL("../../../../", import.meta.url)));

  return {
    env,
    repositoryRoot,
    constituencyBoundaryDir: resolvePathFromRoot(
      repositoryRoot,
      env.CONSTITUENCY_BOUNDARIES_DIR ??
        join(repositoryRoot, "artifacts/constituency-boundaries/current")
    ),
    rawRoot: resolvePathFromRoot(
      repositoryRoot,
      env.RAW_DIR ?? join(repositoryRoot, "tests/fixtures")
    ),
    dataRepoDir: resolvePathFromRoot(
      repositoryRoot,
      env.DATA_REPO_DIR ?? join(repositoryRoot, "published-data")
    ),
    outputDir: resolvePathFromRoot(
      repositoryRoot,
      env.OUTPUT_DIR ?? join(repositoryRoot, "artifacts/build")
    ),
    baseUrl:
      env.DATA_REPO_BASE_URL ??
      "https://example.github.io/lawmaker-monitor-data/"
  };
}

export async function loadBuildDataRawInputs(
  config: BuildDataRuntimeConfig
): Promise<BuildDataRawInputs> {
  const resolvedRaw = await resolveRawSnapshot(config.rawRoot);
  const snapshotId = config.env.SNAPSHOT_ID ?? resolvedRaw.snapshotId;

  assertRawSnapshotManifestSourcePolicy(resolvedRaw.manifest);

  const scheduleEntry = findEntry(
    resolvedRaw.manifest.entries,
    "plenary_schedule"
  );
  const memberInfoEntries = findEntries(resolvedRaw.manifest.entries, [
    "member_info"
  ]);
  const memberProfileAllEntries = findEntries(resolvedRaw.manifest.entries, [
    "member_profile_all"
  ]);
  const memberHistoryEntries = findEntries(resolvedRaw.manifest.entries, [
    "member_history"
  ]);
  const committeeOverviewEntries = findEntries(resolvedRaw.manifest.entries, [
    "committee_overview"
  ]);
  const committeeRosterEntries = findEntries(resolvedRaw.manifest.entries, [
    "committee_roster"
  ]);
  const committeeCareerEntries = findEntries(resolvedRaw.manifest.entries, [
    "member_committee_career"
  ]);
  const plenaryAttendanceFileEntries = findEntries(
    resolvedRaw.manifest.entries,
    ["plenary_attendance_file"]
  );
  const billVoteSummaryEntries = findEntries(resolvedRaw.manifest.entries, [
    "bill_vote_summary"
  ]);
  const billProposalEntries = findEntries(resolvedRaw.manifest.entries, [
    "bill_proposals"
  ]);

  if (
    !scheduleEntry ||
    memberInfoEntries.length === 0 ||
    memberProfileAllEntries.length === 0 ||
    memberHistoryEntries.length === 0 ||
    committeeOverviewEntries.length === 0 ||
    committeeRosterEntries.length === 0 ||
    billVoteSummaryEntries.length === 0 ||
    billProposalEntries.length === 0
  ) {
    throw new Error(
      "Raw snapshot is missing required assembly metadata payloads."
    );
  }

  const agendaEntries = findEntries(resolvedRaw.manifest.entries, [
    "plenary_bills_law",
    "plenary_bills_budget",
    "plenary_bills_settlement",
    "plenary_bills_other"
  ]);
  const voteEntries = findEntries(resolvedRaw.manifest.entries, [
    "vote_detail"
  ]);
  const voteMemberListEntries = findEntries(resolvedRaw.manifest.entries, [
    "vote_member_list"
  ]);
  const liveEntry = findEntry(resolvedRaw.manifest.entries, "live");
  const minutesEntry = findEntry(
    resolvedRaw.manifest.entries,
    "plenary_minutes"
  );

  const [
    memberInfoXmls,
    memberProfileAllXmls,
    memberHistoryXmls,
    committeeOverviewXmls,
    committeeRosterXmls,
    committeeCareerJsons,
    plenaryAttendanceFileBuffers,
    billVoteSummaryXmls,
    billProposalXmls,
    scheduleXml,
    liveXml,
    minutesXml,
    agendaXmls,
    voteXmls,
    voteMemberListHtmls
  ] = await Promise.all([
    Promise.all(
      memberInfoEntries.map((entry) =>
        readEntryPayload(resolvedRaw.rawDir, entry.relativePath)
      )
    ),
    Promise.all(
      memberProfileAllEntries.map((entry) =>
        readEntryPayload(resolvedRaw.rawDir, entry.relativePath)
      )
    ),
    Promise.all(
      memberHistoryEntries.map((entry) =>
        readEntryPayload(resolvedRaw.rawDir, entry.relativePath)
      )
    ),
    Promise.all(
      committeeOverviewEntries.map((entry) =>
        readEntryPayload(resolvedRaw.rawDir, entry.relativePath)
      )
    ),
    Promise.all(
      committeeRosterEntries.map((entry) =>
        readEntryPayload(resolvedRaw.rawDir, entry.relativePath)
      )
    ),
    Promise.all(
      committeeCareerEntries.map((entry) =>
        readEntryPayload(resolvedRaw.rawDir, entry.relativePath)
      )
    ),
    Promise.all(
      plenaryAttendanceFileEntries.map((entry) =>
        readEntryBuffer(resolvedRaw.rawDir, entry.relativePath)
      )
    ),
    Promise.all(
      billVoteSummaryEntries.map((entry) =>
        readEntryPayload(resolvedRaw.rawDir, entry.relativePath)
      )
    ),
    Promise.all(
      billProposalEntries.map((entry) =>
        readEntryPayload(resolvedRaw.rawDir, entry.relativePath)
      )
    ),
    readEntryPayload(resolvedRaw.rawDir, scheduleEntry.relativePath),
    liveEntry
      ? readEntryPayload(resolvedRaw.rawDir, liveEntry.relativePath)
      : Promise.resolve(null),
    minutesEntry
      ? readEntryPayload(resolvedRaw.rawDir, minutesEntry.relativePath)
      : Promise.resolve(null),
    Promise.all(
      agendaEntries.map((entry) =>
        readEntryPayload(resolvedRaw.rawDir, entry.relativePath)
      )
    ),
    Promise.all(
      voteEntries.map((entry) =>
        readEntryPayload(resolvedRaw.rawDir, entry.relativePath)
      )
    ),
    Promise.all(
      voteMemberListEntries.map((entry) =>
        readEntryPayload(resolvedRaw.rawDir, entry.relativePath)
      )
    )
  ]);

  return {
    env: config.env,
    repositoryRoot: config.repositoryRoot,
    constituencyBoundaryDir: config.constituencyBoundaryDir,
    dataRepoDir: config.dataRepoDir,
    outputDir: config.outputDir,
    baseUrl: config.baseUrl,
    snapshotId,
    resolvedRaw,
    scheduleEntry,
    memberInfoEntries,
    memberProfileAllEntries,
    memberHistoryEntries,
    committeeOverviewEntries,
    committeeRosterEntries,
    committeeCareerEntries,
    plenaryAttendanceFileEntries,
    billVoteSummaryEntries,
    billProposalEntries,
    agendaEntries,
    voteEntries,
    voteMemberListEntries,
    liveEntry,
    minutesEntry,
    memberInfoXmls,
    memberProfileAllXmls,
    memberHistoryXmls,
    committeeOverviewXmls,
    committeeRosterXmls,
    committeeCareerJsons,
    plenaryAttendanceFileBuffers,
    billVoteSummaryXmls,
    billProposalXmls,
    scheduleXml,
    liveXml,
    minutesXml,
    agendaXmls,
    voteXmls,
    voteMemberListHtmls
  };
}
