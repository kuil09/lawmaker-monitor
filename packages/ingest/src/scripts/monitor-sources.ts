import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseMemberProfileAllXml,
  parseAgendaXml,
  parseBillVoteSummaryXml,
  parseCommitteeOverviewXml,
  parseCommitteeRosterXml,
  parseLiveSignalXml,
  parseMeetingXml,
  parseMemberInfoXml,
  parseMemberHistoryXml,
  parseVoteDetailEntryPayload
} from "../parsers.js";
import { enrichMembersWithMemberProfileAll } from "../member-profile-enrichment.js";
import { resolveRawSnapshot } from "../raw-snapshot.js";
import { assertRawSnapshotManifestSourcePolicy } from "../assembly-source-registry.js";
import { resolvePathFromRoot } from "../utils.js";

const REQUIRED_KINDS = [
  "member_info",
  "member_profile_all",
  "member_history",
  "committee_overview",
  "committee_roster",
  "bill_vote_summary",
  "plenary_schedule",
  "plenary_bills_law",
  "plenary_bills_budget",
  "plenary_bills_settlement",
  "plenary_bills_other",
  "live"
] as const;

async function readEntryPayload(rawDir: string, relativePath: string): Promise<string> {
  return readFile(join(rawDir, relativePath), "utf8");
}

async function main(): Promise<void> {
  const repositoryRoot = resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
  const fixturesDir = resolvePathFromRoot(
    repositoryRoot,
    process.env.FIXTURES_DIR ?? join(repositoryRoot, "tests/fixtures")
  );
  const snapshot = await resolveRawSnapshot(fixturesDir);
  assertRawSnapshotManifestSourcePolicy(snapshot.manifest);

  const missingKinds = REQUIRED_KINDS.filter(
    (kind) => !snapshot.manifest.entries.some((entry) => entry.kind === kind)
  );

  if (missingKinds.length > 0) {
    throw new Error(`Fixture snapshot is missing required payloads: ${missingKinds.join(", ")}`);
  }

  const memberInfoEntries = snapshot.manifest.entries.filter((entry) => entry.kind === "member_info");
  const memberProfileAllEntries = snapshot.manifest.entries.filter(
    (entry) => entry.kind === "member_profile_all"
  );
  const committeeOverviewEntries = snapshot.manifest.entries.filter(
    (entry) => entry.kind === "committee_overview"
  );
  const committeeRosterEntries = snapshot.manifest.entries.filter(
    (entry) => entry.kind === "committee_roster"
  );
  const billVoteSummaryEntries = snapshot.manifest.entries.filter(
    (entry) => entry.kind === "bill_vote_summary"
  );
  const scheduleEntry = snapshot.manifest.entries.find((entry) => entry.kind === "plenary_schedule");
  const memberHistoryEntries = snapshot.manifest.entries.filter((entry) => entry.kind === "member_history");
  const liveEntry = snapshot.manifest.entries.find((entry) => entry.kind === "live");
  const agendaEntries = snapshot.manifest.entries.filter((entry) =>
    [
      "plenary_bills_law",
      "plenary_bills_budget",
      "plenary_bills_settlement",
      "plenary_bills_other"
    ].includes(entry.kind)
  );
  const voteEntries = snapshot.manifest.entries.filter((entry) => entry.kind === "vote_detail");

  if (
    !scheduleEntry ||
    !liveEntry ||
    memberInfoEntries.length === 0 ||
    memberProfileAllEntries.length === 0 ||
    memberHistoryEntries.length === 0 ||
    committeeOverviewEntries.length === 0 ||
    committeeRosterEntries.length === 0 ||
    billVoteSummaryEntries.length === 0
  ) {
    throw new Error("Fixture snapshot does not include the required official assembly payloads.");
  }

  const [memberInfoXmls, memberProfileAllXmls, memberHistoryXmls, committeeOverviewXmls, committeeRosterXmls, billVoteSummaryXmls, scheduleXml, liveXml, agendaXmls, voteXmls] = await Promise.all([
    Promise.all(memberInfoEntries.map((entry) => readEntryPayload(snapshot.rawDir, entry.relativePath))),
    Promise.all(
      memberProfileAllEntries.map((entry) => readEntryPayload(snapshot.rawDir, entry.relativePath))
    ),
    Promise.all(memberHistoryEntries.map((entry) => readEntryPayload(snapshot.rawDir, entry.relativePath))),
    Promise.all(committeeOverviewEntries.map((entry) => readEntryPayload(snapshot.rawDir, entry.relativePath))),
    Promise.all(committeeRosterEntries.map((entry) => readEntryPayload(snapshot.rawDir, entry.relativePath))),
    Promise.all(billVoteSummaryEntries.map((entry) => readEntryPayload(snapshot.rawDir, entry.relativePath))),
    readEntryPayload(snapshot.rawDir, scheduleEntry.relativePath),
    readEntryPayload(snapshot.rawDir, liveEntry.relativePath),
    Promise.all(agendaEntries.map((entry) => readEntryPayload(snapshot.rawDir, entry.relativePath))),
    Promise.all(voteEntries.map((entry) => readEntryPayload(snapshot.rawDir, entry.relativePath)))
  ]);
  const tenureRows = memberHistoryXmls.flatMap((xml) => parseMemberHistoryXml(xml));

  const meetings = parseMeetingXml(scheduleXml, {
    sourceUrl: scheduleEntry.sourceUrl,
    retrievedAt: scheduleEntry.retrievedAt,
    snapshotId: snapshot.snapshotId
  });
  const agendas = agendaXmls.flatMap((xml, index) =>
    agendaEntries[index]
      ? parseAgendaXml(xml, {
          sourceUrl: agendaEntries[index].sourceUrl,
          retrievedAt: agendaEntries[index].retrievedAt,
          snapshotId: snapshot.snapshotId
        }).agendas
      : []
  );
  const votes = voteXmls.flatMap((xml, index) =>
    voteEntries[index]
      ? parseVoteDetailEntryPayload(
          voteEntries[index],
          xml,
          {
            sourceUrl: voteEntries[index].sourceUrl,
            retrievedAt: voteEntries[index].retrievedAt,
            snapshotId: snapshot.snapshotId
          }
        ).rollCalls
      : []
  );
  const liveSignal = parseLiveSignalXml(liveXml);
  const memberInfoRows = memberInfoXmls.flatMap((xml) => parseMemberInfoXml(xml).members);
  const memberProfileAllRows = memberProfileAllXmls.flatMap(
    (xml) => parseMemberProfileAllXml(xml).profiles
  );
  const enrichedMembers = enrichMembersWithMemberProfileAll({
    members: memberInfoRows,
    profiles: memberProfileAllRows
  }).members;
  const committeeOverviewRows = committeeOverviewXmls.flatMap((xml) =>
    parseCommitteeOverviewXml(xml)
  );
  const committeeRosterRows = committeeRosterXmls.flatMap((xml) => parseCommitteeRosterXml(xml));
  const billVoteSummaryRows = billVoteSummaryXmls.flatMap((xml) =>
    parseBillVoteSummaryXml(xml)
  );

  if (
    meetings.meetings.length === 0 ||
    agendas.length === 0 ||
    votes.length === 0 ||
    tenureRows.length === 0 ||
    enrichedMembers.length === 0 ||
    committeeOverviewRows.length === 0 ||
    committeeRosterRows.length === 0 ||
    billVoteSummaryRows.length === 0
  ) {
    throw new Error("Fixture parsing failed. Source assumptions may have drifted.");
  }

  if (!liveSignal) {
    throw new Error("Live signal fixture did not parse.");
  }

  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        members: enrichedMembers.length,
        memberProfileAll: memberProfileAllRows.length,
        committeeOverview: committeeOverviewRows.length,
        committeeRoster: committeeRosterRows.length,
        voteSummaries: billVoteSummaryRows.length,
        meetings: meetings.meetings.length,
        tenures: tenureRows.length,
        agendas: agendas.length,
        votes: votes.length,
        liveTitle: liveSignal.title ?? null
      },
      null,
      2
    )
  );
}

void main();
