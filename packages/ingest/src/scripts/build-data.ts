import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  ConstituencyBoundaryExport,
  CurrentAssembly,
  NormalizedBundle
} from "@lawmaker-monitor/schemas";

import {
  assertPublishedJsonFileSize,
  buildAccountabilitySummaryExport,
  buildAccountabilityTrendsExport,
  buildMemberActivityCalendarArtifacts,
  buildMemberActivityCalendarMemberDetailPath,
  buildLatestVotesExport,
  buildManifest,
  MEMBER_ACTIVITY_MEMBER_DETAILS_DIR,
  serializePublishedJson,
  toNdjson
} from "../exports.js";
import {
  buildConstituencyBoundaryRuntimeArtifacts,
  CONSTITUENCY_BOUNDARIES_INDEX_PATH
} from "../constituency-boundary-runtime.js";
import { createNormalizedBundle } from "../normalize.js";
import {
  createSourceRecord,
  parseAgendaXml,
  parseBillVoteSummaryXml,
  parseCommitteeOverviewXml,
  parseCommitteeRosterXml,
  parseLiveSignalXml,
  parseMemberInfoXml,
  parseMemberProfileAllXml,
  parseMemberHistoryXml,
  parseMeetingXml,
  parseVoteDetailEntryPayload
} from "../parsers.js";
import { enrichMembersWithMemberProfileAll } from "../member-profile-enrichment.js";
import {
  buildPropertyDisclosureArtifacts,
  DEFAULT_PROPERTY_DOCUMENT_INDEX_PATH
} from "../property-disclosures.js";
import {
  DEFAULT_PROPERTY_MEMBER_CONTEXT_MANIFEST_PATH,
  loadPropertyMemberContext
} from "../property-member-context.js";
import { resolveRawSnapshot } from "../raw-snapshot.js";
import { assertCurrentMembersHaveTenure, buildMemberTenureIndex } from "../tenure.js";
import { resolvePathFromRoot } from "../utils.js";
import {
  assertRawSnapshotManifestSourcePolicy,
} from "../assembly-source-registry.js";
import {
  validateAccountabilitySummaryExport,
  validateAccountabilityTrendsExport,
  assertSinglePublicAssembly,
  validateConstituencyBoundariesIndexExport,
  validateLatestVotesExport,
  validateManifest,
  validateMemberAssetsHistoryExport,
  validateMemberAssetsIndexExport,
  validateMemberActivityCalendarExport,
  validateMemberActivityCalendarMemberDetailExport,
  validateNormalizedBundle
} from "../validation.js";

function findEntry(
  entries: Awaited<ReturnType<typeof resolveRawSnapshot>>["manifest"]["entries"],
  kind: string
) {
  return entries.find((entry) => entry.kind === kind);
}

function findEntries(
  entries: Awaited<ReturnType<typeof resolveRawSnapshot>>["manifest"]["entries"],
  kinds: string[]
) {
  return entries.filter((entry) => kinds.includes(entry.kind));
}

async function readEntryPayload(rawDir: string, relativePath: string): Promise<string> {
  return readFile(join(rawDir, relativePath), "utf8");
}

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
      record.assemblyNo === memberAssembly.assemblyNo && typeof record.unitCd === "string"
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

async function writeBundle(outputDir: string, bundle: NormalizedBundle): Promise<void> {
  const normalizedDir = join(outputDir, "normalized");
  const exportsDir = join(outputDir, "exports");
  const manifestsDir = join(outputDir, "manifests");

  await mkdir(normalizedDir, { recursive: true });
  await mkdir(exportsDir, { recursive: true });
  await mkdir(manifestsDir, { recursive: true });

  await Promise.all([
    writeFile(join(normalizedDir, "members.ndjson"), toNdjson(bundle.members)),
    writeFile(join(normalizedDir, "roll_calls.ndjson"), toNdjson(bundle.rollCalls)),
    writeFile(join(normalizedDir, "vote_facts.ndjson"), toNdjson(bundle.voteFacts)),
    writeFile(join(normalizedDir, "meetings.ndjson"), toNdjson(bundle.meetings)),
    writeFile(join(normalizedDir, "sources.ndjson"), toNdjson(bundle.sources))
  ]);
}

function toOptionalNdjson<T extends Record<string, unknown>>(
  items: T[],
  seedRow: T & { __seed: true }
): string {
  if (items.length > 0) {
    return toNdjson(items);
  }

  return `${JSON.stringify(seedRow)}\n`;
}

export async function buildData(args?: {
  env?: NodeJS.ProcessEnv;
  repositoryRoot?: string;
}): Promise<void> {
  const env = args?.env ?? process.env;
  const repositoryRoot =
    args?.repositoryRoot ?? resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
  const constituencyBoundaryDir = resolvePathFromRoot(
    repositoryRoot,
    env.CONSTITUENCY_BOUNDARIES_DIR ??
      join(repositoryRoot, "artifacts/constituency-boundaries/current")
  );
  const rawRoot = resolvePathFromRoot(
    repositoryRoot,
    env.RAW_DIR ?? join(repositoryRoot, "tests/fixtures")
  );
  const dataRepoDir = resolvePathFromRoot(
    repositoryRoot,
    env.DATA_REPO_DIR ?? join(repositoryRoot, "published-data")
  );
  const outputDir = resolvePathFromRoot(
    repositoryRoot,
    env.OUTPUT_DIR ?? join(repositoryRoot, "artifacts/build")
  );
  const baseUrl =
    env.DATA_REPO_BASE_URL ?? "https://example.github.io/lawmaker-monitor-data/";

  const resolvedRaw = await resolveRawSnapshot(rawRoot);
  const snapshotId = env.SNAPSHOT_ID ?? resolvedRaw.snapshotId;
  assertRawSnapshotManifestSourcePolicy(resolvedRaw.manifest);

  const scheduleEntry = findEntry(resolvedRaw.manifest.entries, "plenary_schedule");
  const memberInfoEntries = findEntries(resolvedRaw.manifest.entries, ["member_info"]);
  const memberProfileAllEntries = findEntries(resolvedRaw.manifest.entries, [
    "member_profile_all"
  ]);
  const memberHistoryEntries = findEntries(resolvedRaw.manifest.entries, ["member_history"]);
  const committeeOverviewEntries = findEntries(resolvedRaw.manifest.entries, [
    "committee_overview"
  ]);
  const committeeRosterEntries = findEntries(resolvedRaw.manifest.entries, [
    "committee_roster"
  ]);
  const billVoteSummaryEntries = findEntries(resolvedRaw.manifest.entries, [
    "bill_vote_summary"
  ]);
  if (
    !scheduleEntry ||
    memberInfoEntries.length === 0 ||
    memberProfileAllEntries.length === 0 ||
    memberHistoryEntries.length === 0 ||
    committeeOverviewEntries.length === 0 ||
    committeeRosterEntries.length === 0 ||
    billVoteSummaryEntries.length === 0
  ) {
    throw new Error("Raw snapshot is missing required assembly metadata payloads.");
  }

  const agendaEntries = findEntries(resolvedRaw.manifest.entries, [
    "plenary_bills_law",
    "plenary_bills_budget",
    "plenary_bills_settlement",
    "plenary_bills_other"
  ]);
  const voteEntries = findEntries(resolvedRaw.manifest.entries, ["vote_detail"]);
  const liveEntry = findEntry(resolvedRaw.manifest.entries, "live");
  const minutesEntry = findEntry(resolvedRaw.manifest.entries, "plenary_minutes");

  const [
    memberInfoXmls,
    memberProfileAllXmls,
    memberHistoryXmls,
    committeeOverviewXmls,
    committeeRosterXmls,
    billVoteSummaryXmls,
    scheduleXml,
    liveXml,
    minutesXml,
    agendaXmls,
    voteXmls
  ] = await Promise.all([
    Promise.all(
      memberInfoEntries.map((entry) => readEntryPayload(resolvedRaw.rawDir, entry.relativePath))
    ),
    Promise.all(
      memberProfileAllEntries.map((entry) =>
        readEntryPayload(resolvedRaw.rawDir, entry.relativePath)
      )
    ),
    Promise.all(
      memberHistoryEntries.map((entry) => readEntryPayload(resolvedRaw.rawDir, entry.relativePath))
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
      billVoteSummaryEntries.map((entry) =>
        readEntryPayload(resolvedRaw.rawDir, entry.relativePath)
      )
    ),
    readEntryPayload(resolvedRaw.rawDir, scheduleEntry.relativePath),
    liveEntry ? readEntryPayload(resolvedRaw.rawDir, liveEntry.relativePath) : Promise.resolve(null),
    minutesEntry ? readEntryPayload(resolvedRaw.rawDir, minutesEntry.relativePath) : Promise.resolve(null),
    Promise.all(agendaEntries.map((entry) => readEntryPayload(resolvedRaw.rawDir, entry.relativePath))),
    Promise.all(voteEntries.map((entry) => readEntryPayload(resolvedRaw.rawDir, entry.relativePath)))
  ]);

  const meetings = parseMeetingXml(scheduleXml, {
    sourceUrl: scheduleEntry.sourceUrl,
    retrievedAt: scheduleEntry.retrievedAt,
    snapshotId
  });

  const parsedAgendas = agendaEntries.flatMap((entry, index) => {
    const xml = agendaXmls[index];
    if (!xml) {
      return [];
    }

    return parseAgendaXml(xml, {
      sourceUrl: entry.sourceUrl,
      retrievedAt: entry.retrievedAt,
      snapshotId
    }).agendas;
  });
  const agendaSources = agendaEntries.flatMap((entry, index) => {
    const xml = agendaXmls[index];
    if (!xml) {
      return [];
    }

    return [
      createSourceRecord(
        {
          sourceUrl: entry.sourceUrl,
          retrievedAt: entry.retrievedAt,
          snapshotId
        },
        xml
      )
    ];
  });

  const parsedMemberInfoResults = memberInfoXmls.map((xml) => parseMemberInfoXml(xml));
  const parsedMemberProfileAllResults = memberProfileAllXmls.map((xml) =>
    parseMemberProfileAllXml(xml)
  );
  const parsedMemberHistory = memberHistoryXmls.flatMap((xml) => parseMemberHistoryXml(xml));
  const currentAssembly = resolveCurrentAssembly({
    memberAssembly:
      parsedMemberInfoResults
        .map((result) => result.currentAssembly)
        .filter((result): result is NonNullable<typeof result> => Boolean(result))
        .sort((left, right) => right.assemblyNo - left.assemblyNo)[0] ?? null,
    tenures: parsedMemberHistory
  });
  const rosterMembershipsByMemberId = new Map<string, string[]>();
  for (const xml of committeeRosterXmls) {
    for (const row of parseCommitteeRosterXml(xml)) {
      const existing = rosterMembershipsByMemberId.get(row.memberId) ?? [];
      existing.push(row.committeeName);
      rosterMembershipsByMemberId.set(row.memberId, [...new Set(existing)]);
    }
  }
  const committeeOverviewRows = committeeOverviewXmls.flatMap((xml) =>
    parseCommitteeOverviewXml(xml)
  );
  if (committeeOverviewRows.length === 0) {
    throw new Error("Raw snapshot is missing parsable committee overview rows.");
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
  for (const row of billVoteSummaryXmls.flatMap((xml) => parseBillVoteSummaryXml(xml))) {
    officialTalliesByBillId.set(row.billId, row.officialTally);
  }
  const parsedVotes = voteEntries.flatMap((entry, index) => {
    const payload = voteXmls[index];
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
          snapshotId
        },
        {
          currentMembers: memberInfoMembers
        }
      )
    ];
  });

  const minutesSources =
    minutesEntry && minutesXml
      ? [
          createSourceRecord(
            {
              sourceUrl: minutesEntry.sourceUrl,
              retrievedAt: minutesEntry.retrievedAt,
              snapshotId
            },
            minutesXml
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
        ...memberInfoEntries.flatMap((entry, index) =>
          memberInfoXmls[index]
            ? [
                createSourceRecord(
                  {
                    sourceUrl: entry.sourceUrl,
                    retrievedAt: entry.retrievedAt,
                    snapshotId
                  },
                  memberInfoXmls[index]
                )
              ]
            : []
        ),
        ...memberProfileAllEntries.flatMap((entry, index) =>
          memberProfileAllXmls[index]
            ? [
                createSourceRecord(
                  {
                    sourceUrl: entry.sourceUrl,
                    retrievedAt: entry.retrievedAt,
                    snapshotId
                  },
                  memberProfileAllXmls[index]
                )
              ]
            : []
        ),
        ...memberHistoryEntries.flatMap((entry, index) =>
          memberHistoryXmls[index]
            ? [
                createSourceRecord(
                  {
                    sourceUrl: entry.sourceUrl,
                    retrievedAt: entry.retrievedAt,
                    snapshotId
                  },
                  memberHistoryXmls[index]
                )
              ]
            : []
        ),
        ...committeeOverviewEntries.flatMap((entry, index) =>
          committeeOverviewXmls[index]
            ? [
                createSourceRecord(
                  {
                    sourceUrl: entry.sourceUrl,
                    retrievedAt: entry.retrievedAt,
                    snapshotId
                  },
                  committeeOverviewXmls[index]
                )
              ]
            : []
        ),
        ...committeeRosterEntries.flatMap((entry, index) =>
          committeeRosterXmls[index]
            ? [
                createSourceRecord(
                  {
                    sourceUrl: entry.sourceUrl,
                    retrievedAt: entry.retrievedAt,
                    snapshotId
                  },
                  committeeRosterXmls[index]
                )
              ]
            : []
        ),
        ...billVoteSummaryEntries.flatMap((entry, index) =>
          billVoteSummaryXmls[index]
            ? [
                createSourceRecord(
                  {
                    sourceUrl: entry.sourceUrl,
                    retrievedAt: entry.retrievedAt,
                    snapshotId
                  },
                  billVoteSummaryXmls[index]
                )
              ]
            : []
        ),
        ...minutesSources
      ],
      agendas: parsedAgendas,
      liveSignal: liveXml ? parseLiveSignalXml(liveXml) : null
    });
  const bundle = validateNormalizedBundle({
    ...baseBundle,
    rollCalls: baseBundle.rollCalls.map((rollCall) => ({
      ...rollCall,
      officialTally: rollCall.billId
        ? officialTalliesByBillId.get(rollCall.billId) ?? rollCall.officialTally
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
    dataRepoDir,
    manifestPath:
      env.PROPERTY_MEMBER_CONTEXT_MANIFEST_PATH ??
      DEFAULT_PROPERTY_MEMBER_CONTEXT_MANIFEST_PATH
  });

  await writeBundle(outputDir, bundle);

  const latestVotes = validateLatestVotesExport(buildLatestVotesExport(bundle, { tenureIndex }));
  const accountabilitySummary = validateAccountabilitySummaryExport(
    buildAccountabilitySummaryExport(bundle, { tenureIndex })
  );
  const accountabilityTrends = validateAccountabilityTrendsExport(
    buildAccountabilityTrendsExport(bundle, { tenureIndex })
  );
  const { memberActivityCalendar: builtMemberActivityCalendar, memberDetails: builtMemberDetails } =
    buildMemberActivityCalendarArtifacts(bundle, { tenureIndex });
  const memberActivityCalendar = validateMemberActivityCalendarExport(
    builtMemberActivityCalendar
  );
  const memberActivityCalendarMemberDetails = builtMemberDetails.map((detail) =>
    validateMemberActivityCalendarMemberDetailExport(detail)
  );
  const propertyDisclosureArtifacts = await buildPropertyDisclosureArtifacts({
    assemblyLabel: currentAssembly.label,
    assemblyNo: currentAssembly.assemblyNo,
    currentMembers: propertyMemberContext.currentMembers,
    dataRepoDir,
    generatedAt: latestVotes.generatedAt,
    indexPath:
      env.PROPERTY_DOCUMENT_INDEX_PATH ?? DEFAULT_PROPERTY_DOCUMENT_INDEX_PATH,
    propertySourceId: env.PROPERTY_SOURCE_ID,
    snapshotId,
    tenureIndex: propertyMemberContext.tenureIndex
  });
  const memberAssetsIndex = validateMemberAssetsIndexExport(
    propertyDisclosureArtifacts.memberAssetsIndex
  );
  const memberAssetsHistory = propertyDisclosureArtifacts.memberAssetsHistory.map((history) =>
    validateMemberAssetsHistoryExport(history)
  );
  const propertyDatasetFiles = {
    files: toOptionalNdjson(propertyDisclosureArtifacts.files, {
      __seed: true,
      disclosureFileId: "__seed__",
      sourceDocumentId: "__seed__",
      sourceId: "__seed__",
      fileSeq: 0,
      infId: "__seed__",
      infSeq: 0,
      issueNo: null,
      viewFileNm: "__seed__",
      reportedAt: "1970-01-01",
      fileExt: "pdf",
      cvtFileSize: null,
      sourceUrl: "https://example.test/property",
      downloadUrl: "https://example.test/property",
      metadataRelativePath: "__seed__",
      latestRelativePath: "__seed__",
      contentSha256: "__seed__",
      currentBytes: 0
    }),
    records: toOptionalNdjson(propertyDisclosureArtifacts.records, {
      __seed: true,
      disclosureRecordId: "__seed__",
      disclosureFileId: "__seed__",
      sourceDocumentId: "__seed__",
      fileSeq: 0,
      issueNo: null,
      disclosureName: "__seed__",
      normalizedName: "__seed__",
      officeTitle: null,
      sectionLabel: "국회의원",
      reportedAt: "1970-01-01",
      pageStart: 0,
      pageEnd: 0,
      memberId: null,
      mappingStatus: "unmatched",
      previousAmount: 0,
      increaseAmount: 0,
      decreaseAmount: 0,
      currentAmount: 0,
      deltaAmount: 0,
      valueChangeAmount: 0,
      rawSummaryText: "__seed__"
    }),
    categories: toOptionalNdjson(propertyDisclosureArtifacts.categories, {
      __seed: true,
      disclosureCategoryId: "__seed__",
      disclosureRecordId: "__seed__",
      categoryOrder: 0,
      categoryKey: "__seed__",
      categoryLabel: "__seed__",
      previousAmount: 0,
      increaseAmount: 0,
      decreaseAmount: 0,
      currentAmount: 0
    }),
    items: toOptionalNdjson(propertyDisclosureArtifacts.items, {
      __seed: true,
      disclosureItemId: "__seed__",
      disclosureCategoryId: "__seed__",
      disclosureRecordId: "__seed__",
      categoryOrder: 0,
      itemOrder: 0,
      relation: null,
      assetTypeLabel: null,
      locationText: null,
      measureText: null,
      reasonText: null,
      rawDetailText: "__seed__",
      previousAmount: 0,
      increaseAmount: 0,
      decreaseAmount: 0,
      currentAmount: 0
    })
  };
  // The boundary artifact is validated when it is built; build-data consumes and republishes it.
  const constituencyBoundaryExport = JSON.parse(
    await readFile(
      join(constituencyBoundaryDir, "constituency_boundaries.geojson"),
      "utf8"
    )
  ) as ConstituencyBoundaryExport;
  const constituencyBoundaryRuntimeArtifacts = buildConstituencyBoundaryRuntimeArtifacts({
    boundaryExport: constituencyBoundaryExport,
    generatedAt: latestVotes.generatedAt,
    snapshotId
  });
  const constituencyBoundariesIndex = validateConstituencyBoundariesIndexExport(
    constituencyBoundaryRuntimeArtifacts.index
  );
  const manifest = validateManifest(
    buildManifest({
      bundle,
      dataRepoBaseUrl: baseUrl,
      currentAssembly,
      latestVotes,
      accountabilitySummary,
      accountabilityTrends,
      memberActivityCalendar,
      memberAssetsIndex,
      assetDisclosuresDataset: {
        content: propertyDatasetFiles.files,
        rowCount: propertyDisclosureArtifacts.files.length
      },
      assetDisclosureRecordsDataset: {
        content: propertyDatasetFiles.records,
        rowCount: propertyDisclosureArtifacts.records.length
      },
      assetDisclosureCategoriesDataset: {
        content: propertyDatasetFiles.categories,
        rowCount: propertyDisclosureArtifacts.categories.length
      },
      assetDisclosureItemsDataset: {
        content: propertyDatasetFiles.items,
        rowCount: propertyDisclosureArtifacts.items.length
      },
      constituencyBoundariesIndex
    })
  );

  const latestVotesJson = serializePublishedJson(latestVotes);
  const accountabilitySummaryJson = serializePublishedJson(accountabilitySummary);
  const accountabilityTrendsJson = serializePublishedJson(accountabilityTrends);
  const memberActivityCalendarJson = serializePublishedJson(memberActivityCalendar);
  const memberAssetsIndexJson = serializePublishedJson(memberAssetsIndex);
  const constituencyBoundariesIndexJson = constituencyBoundaryRuntimeArtifacts.indexJson;
  const manifestJson = JSON.stringify(manifest, null, 2);
  const memberActivityCalendarDetailWrites = memberActivityCalendarMemberDetails.map((detail) => {
    const relativePath = buildMemberActivityCalendarMemberDetailPath(detail.memberId);
    const content = serializePublishedJson(detail);
    assertPublishedJsonFileSize(relativePath, content);
    return {
      path: join(outputDir, relativePath),
      content
    };
  });
  const memberAssetHistoryWrites = memberAssetsHistory.map((history) => {
    const relativePath = `exports/member_assets_history/${history.memberId}.json`;
    const content = serializePublishedJson(history);
    assertPublishedJsonFileSize(relativePath, content);
    return {
      path: join(outputDir, relativePath),
      content
    };
  });
  assertPublishedJsonFileSize("exports/latest_votes.json", latestVotesJson);
  assertPublishedJsonFileSize("exports/accountability_summary.json", accountabilitySummaryJson);
  assertPublishedJsonFileSize("exports/accountability_trends.json", accountabilityTrendsJson);
  assertPublishedJsonFileSize("exports/member_activity_calendar.json", memberActivityCalendarJson);
  assertPublishedJsonFileSize("exports/member_assets_index.json", memberAssetsIndexJson);
  assertPublishedJsonFileSize(
    CONSTITUENCY_BOUNDARIES_INDEX_PATH,
    constituencyBoundariesIndexJson
  );
  for (const shard of constituencyBoundaryRuntimeArtifacts.shards) {
    assertPublishedJsonFileSize(shard.path, shard.content);
  }

  await mkdir(join(outputDir, MEMBER_ACTIVITY_MEMBER_DETAILS_DIR), { recursive: true });
  await mkdir(join(outputDir, "exports", "member_assets_history"), { recursive: true });
  await mkdir(join(outputDir, "exports", "constituency_boundaries", "provinces"), {
    recursive: true
  });
  await mkdir(join(outputDir, "normalized"), { recursive: true });

  await Promise.all([
    writeFile(join(outputDir, "exports", "latest_votes.json"), latestVotesJson),
    writeFile(
      join(outputDir, "exports", "accountability_summary.json"),
      accountabilitySummaryJson
    ),
    writeFile(
      join(outputDir, "exports", "accountability_trends.json"),
      accountabilityTrendsJson
    ),
    writeFile(
      join(outputDir, "exports", "member_activity_calendar.json"),
      memberActivityCalendarJson
    ),
    writeFile(join(outputDir, "exports", "member_assets_index.json"), memberAssetsIndexJson),
    writeFile(
      join(outputDir, CONSTITUENCY_BOUNDARIES_INDEX_PATH),
      constituencyBoundariesIndexJson
    ),
    writeFile(join(outputDir, "manifests", "latest.json"), manifestJson),
    writeFile(
      join(outputDir, "normalized", "asset_disclosures.ndjson"),
      propertyDatasetFiles.files
    ),
    writeFile(
      join(outputDir, "normalized", "asset_disclosure_records.ndjson"),
      propertyDatasetFiles.records
    ),
    writeFile(
      join(outputDir, "normalized", "asset_disclosure_categories.ndjson"),
      propertyDatasetFiles.categories
    ),
    writeFile(
      join(outputDir, "normalized", "asset_disclosure_items.ndjson"),
      propertyDatasetFiles.items
    ),
    ...constituencyBoundaryRuntimeArtifacts.shards.map((shard) =>
      writeFile(join(outputDir, shard.path), shard.content)
    ),
    ...memberActivityCalendarDetailWrites.map((item) => writeFile(item.path, item.content)),
    ...memberAssetHistoryWrites.map((item) => writeFile(item.path, item.content))
  ]);
}

async function main(): Promise<void> {
  await buildData();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
