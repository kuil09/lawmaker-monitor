import { enrichMembersWithMemberProfileAll } from "../member-profile-enrichment.js";
import { createNormalizedBundle } from "../normalize.js";
import {
  createSourceRecord,
  parseAgendaXml,
  parseBillVoteSummaryXml,
  parseCommitteeOverviewXml,
  parseCommitteeRosterXml,
  parseLiveSignalXml,
  parseMemberHistoryXml,
  parseMemberInfoXml,
  parseMemberProfileAllXml,
  parseMeetingXml,
  parseVoteDetailEntryPayload
} from "../parsers.js";
import {
  DEFAULT_PROPERTY_MEMBER_CONTEXT_MANIFEST_PATH,
  loadPropertyMemberContext
} from "../property-member-context.js";
import {
  assertCurrentMembersHaveTenure,
  buildMemberTenureIndex
} from "../tenure.js";
import {
  assertSinglePublicAssembly,
  validateNormalizedBundle
} from "../validation.js";

import type { BuildDataRawInputs } from "./input-stage.js";
import type {
  CurrentAssembly,
  NormalizedBundle
} from "@lawmaker-monitor/schemas";

export type NormalizedBuildArtifacts = {
  snapshotId: string;
  currentAssembly: CurrentAssembly;
  bundle: NormalizedBundle;
  tenureIndex: ReturnType<typeof buildMemberTenureIndex>;
  propertyMemberContext: Awaited<ReturnType<typeof loadPropertyMemberContext>>;
};

function resolveCurrentAssembly(args: {
  memberAssembly: ReturnType<typeof parseMemberInfoXml>["currentAssembly"];
  tenures: ReturnType<typeof parseMemberHistoryXml>;
}): CurrentAssembly {
  const memberAssembly = args.memberAssembly;
  if (!memberAssembly) {
    throw new Error("Raw snapshot is missing the current Assembly metadata.");
  }

  const unitCd = args.tenures.find(
    (record) =>
      record.assemblyNo === memberAssembly.assemblyNo &&
      typeof record.unitCd === "string"
  )?.unitCd;

  if (!unitCd) {
    throw new Error(
      `Raw snapshot is missing UNIT_CD for assembly ${memberAssembly.assemblyNo}.`
    );
  }

  return {
    assemblyNo: memberAssembly.assemblyNo,
    label: memberAssembly.label,
    unitCd
  };
}

function buildSourceRecords(args: {
  entries: BuildDataRawInputs["memberInfoEntries"];
  payloads: string[];
  snapshotId: string;
}) {
  return args.entries.flatMap((entry, index) =>
    args.payloads[index]
      ? [
          createSourceRecord(
            {
              sourceUrl: entry.sourceUrl,
              retrievedAt: entry.retrievedAt,
              snapshotId: args.snapshotId
            },
            args.payloads[index]
          )
        ]
      : []
  );
}

export async function buildNormalizedStage(
  rawInputs: BuildDataRawInputs
): Promise<NormalizedBuildArtifacts> {
  const meetings = parseMeetingXml(rawInputs.scheduleXml, {
    sourceUrl: rawInputs.scheduleEntry.sourceUrl,
    retrievedAt: rawInputs.scheduleEntry.retrievedAt,
    snapshotId: rawInputs.snapshotId
  });

  const parsedAgendas = rawInputs.agendaEntries.flatMap((entry, index) => {
    const xml = rawInputs.agendaXmls[index];
    if (!xml) {
      return [];
    }

    return parseAgendaXml(xml, {
      sourceUrl: entry.sourceUrl,
      retrievedAt: entry.retrievedAt,
      snapshotId: rawInputs.snapshotId
    }).agendas;
  });
  const agendaSources = rawInputs.agendaEntries.flatMap((entry, index) => {
    const xml = rawInputs.agendaXmls[index];
    if (!xml) {
      return [];
    }

    return [
      createSourceRecord(
        {
          sourceUrl: entry.sourceUrl,
          retrievedAt: entry.retrievedAt,
          snapshotId: rawInputs.snapshotId
        },
        xml
      )
    ];
  });

  const parsedMemberInfoResults = rawInputs.memberInfoXmls.map((xml) =>
    parseMemberInfoXml(xml)
  );
  const parsedMemberProfileAllResults = rawInputs.memberProfileAllXmls.map(
    (xml) => parseMemberProfileAllXml(xml)
  );
  const parsedMemberHistory = rawInputs.memberHistoryXmls.flatMap((xml) =>
    parseMemberHistoryXml(xml)
  );
  const currentAssembly = resolveCurrentAssembly({
    memberAssembly:
      parsedMemberInfoResults
        .map((result) => result.currentAssembly)
        .filter((result): result is NonNullable<typeof result> =>
          Boolean(result)
        )
        .sort((left, right) => right.assemblyNo - left.assemblyNo)[0] ?? null,
    tenures: parsedMemberHistory
  });

  const rosterMembershipsByMemberId = new Map<string, string[]>();
  for (const xml of rawInputs.committeeRosterXmls) {
    for (const row of parseCommitteeRosterXml(xml)) {
      const existing = rosterMembershipsByMemberId.get(row.memberId) ?? [];
      existing.push(row.committeeName);
      rosterMembershipsByMemberId.set(row.memberId, [...new Set(existing)]);
    }
  }

  const committeeOverviewRows = rawInputs.committeeOverviewXmls.flatMap((xml) =>
    parseCommitteeOverviewXml(xml)
  );
  if (committeeOverviewRows.length === 0) {
    throw new Error(
      "Raw snapshot is missing parsable committee overview rows."
    );
  }

  const currentRosterMembers = parsedMemberInfoResults
    .flatMap((result) => result.members)
    .map((member) => ({
      ...member,
      committeeMemberships: [
        ...new Set([
          ...(member.committeeMemberships ?? []),
          ...(rosterMembershipsByMemberId.get(member.memberId) ?? [])
        ])
      ]
    }));
  const memberProfileAllRecords = parsedMemberProfileAllResults.flatMap(
    (result) => result.profiles
  );
  const memberInfoMembers = enrichMembersWithMemberProfileAll({
    members: currentRosterMembers,
    profiles: memberProfileAllRecords
  }).members;

  const officialTalliesByBillId = new Map<
    string,
    NonNullable<NormalizedBundle["rollCalls"][number]["officialTally"]>
  >();
  for (const row of rawInputs.billVoteSummaryXmls.flatMap((xml) =>
    parseBillVoteSummaryXml(xml)
  )) {
    officialTalliesByBillId.set(row.billId, row.officialTally);
  }

  const parsedVotes = rawInputs.voteEntries.flatMap((entry, index) => {
    const payload = rawInputs.voteXmls[index];
    if (!payload) {
      return [];
    }

    return [
      parseVoteDetailEntryPayload(
        entry,
        payload,
        {
          sourceUrl: entry.sourceUrl,
          retrievedAt: entry.retrievedAt,
          snapshotId: rawInputs.snapshotId
        },
        {
          currentMembers: memberInfoMembers
        }
      )
    ];
  });

  const minutesSources =
    rawInputs.minutesEntry && rawInputs.minutesXml
      ? [
          createSourceRecord(
            {
              sourceUrl: rawInputs.minutesEntry.sourceUrl,
              retrievedAt: rawInputs.minutesEntry.retrievedAt,
              snapshotId: rawInputs.snapshotId
            },
            rawInputs.minutesXml
          )
        ]
      : [];

  const baseBundle = createNormalizedBundle({
    members: [
      ...parsedVotes.flatMap((result) => result.members),
      ...memberInfoMembers
    ],
    rollCalls: parsedVotes.flatMap((result) => result.rollCalls),
    voteFacts: parsedVotes.flatMap((result) => result.voteFacts),
    meetings: meetings.meetings,
    sources: [
      ...parsedVotes.flatMap((result) => result.sources),
      ...agendaSources,
      ...meetings.sources,
      ...buildSourceRecords({
        entries: rawInputs.memberInfoEntries,
        payloads: rawInputs.memberInfoXmls,
        snapshotId: rawInputs.snapshotId
      }),
      ...buildSourceRecords({
        entries: rawInputs.memberProfileAllEntries,
        payloads: rawInputs.memberProfileAllXmls,
        snapshotId: rawInputs.snapshotId
      }),
      ...buildSourceRecords({
        entries: rawInputs.memberHistoryEntries,
        payloads: rawInputs.memberHistoryXmls,
        snapshotId: rawInputs.snapshotId
      }),
      ...buildSourceRecords({
        entries: rawInputs.committeeOverviewEntries,
        payloads: rawInputs.committeeOverviewXmls,
        snapshotId: rawInputs.snapshotId
      }),
      ...buildSourceRecords({
        entries: rawInputs.committeeRosterEntries,
        payloads: rawInputs.committeeRosterXmls,
        snapshotId: rawInputs.snapshotId
      }),
      ...buildSourceRecords({
        entries: rawInputs.billVoteSummaryEntries,
        payloads: rawInputs.billVoteSummaryXmls,
        snapshotId: rawInputs.snapshotId
      }),
      ...minutesSources
    ],
    agendas: parsedAgendas,
    liveSignal: rawInputs.liveXml ? parseLiveSignalXml(rawInputs.liveXml) : null
  });

  const bundle = validateNormalizedBundle({
    ...baseBundle,
    rollCalls: baseBundle.rollCalls.map((rollCall) => ({
      ...rollCall,
      officialTally: rollCall.billId
        ? (officialTalliesByBillId.get(rollCall.billId) ??
          rollCall.officialTally)
        : rollCall.officialTally
    }))
  });
  assertSinglePublicAssembly(bundle);

  const tenureIndex = buildMemberTenureIndex({
    members: bundle.members,
    tenures: parsedMemberHistory,
    assemblyNo: currentAssembly.assemblyNo
  });
  assertCurrentMembersHaveTenure({
    members: bundle.members,
    assemblyNo: currentAssembly.assemblyNo,
    tenureIndex
  });

  const propertyMemberContext = await loadPropertyMemberContext({
    assemblyNo: currentAssembly.assemblyNo,
    dataRepoDir: rawInputs.dataRepoDir,
    manifestPath:
      rawInputs.env.PROPERTY_MEMBER_CONTEXT_MANIFEST_PATH ??
      DEFAULT_PROPERTY_MEMBER_CONTEXT_MANIFEST_PATH
  });

  return {
    snapshotId: rawInputs.snapshotId,
    currentAssembly,
    bundle,
    tenureIndex,
    propertyMemberContext
  };
}
