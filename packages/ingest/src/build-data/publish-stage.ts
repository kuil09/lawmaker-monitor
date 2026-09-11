import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { publishGeographyOutputs } from "./geography-stage.js";
import { writeNdjsonDataset } from "../dataset-writer.js";
import {
  assertPublishedJsonFileSize,
  ATTENDANCE_DATASET_SEED,
  attendanceDatasetRows,
  buildAccountabilitySummaryExport,
  buildAccountabilityTrendsExport,
  buildBillProposalActivityExport,
  buildLatestVotesExport,
  buildManifest,
  buildMemberActivityCalendarArtifacts,
  buildMemberActivityCalendarMemberDetailPath,
  MEMBER_ACTIVITY_MEMBER_DETAILS_DIR,
  serializePublishedJson,
  type NormalizedDatasetMetadata
} from "../exports.js";
import { collectMemberSponsorshipAccounts } from "../member-sponsorship-accounts.js";
import {
  DEFAULT_PROPERTY_DOCUMENT_INDEX_PATH,
  buildPropertyDisclosureArtifacts
} from "../property-disclosures.js";
import {
  validateAccountabilitySummaryExport,
  validateAccountabilityTrendsExport,
  validateBillProposalActivityExport,
  validateLatestVotesExport,
  validateManifest,
  validateMemberActivityCalendarExport,
  validateMemberActivityCalendarMemberDetailExport,
  validateMemberAssetsHistoryExport,
  validateMemberAssetsIndexExport,
  validateMemberSponsorshipAccountsExport
} from "../validation.js";

import type { BuildMemoryRecorder } from "../build-memory.js";
import type { DatasetMetadata } from "../dataset-writer.js";
import type { BuildDataRuntimeConfig } from "./input-stage.js";
import type { NormalizedBuildArtifacts } from "./normalize-stage.js";
import type {
  MemberSponsorshipAccountsExport,
  NormalizedBundle
} from "@lawmaker-monitor/schemas";

const POLITICAL_DONATION_CENTER_URL =
  "https://www.give.go.kr/portal/supporter/supporterSearch/list.do?menuNo=200025";

async function writeBundle(
  outputDir: string,
  bundle: NormalizedBundle,
  memory: BuildMemoryRecorder
): Promise<NormalizedDatasetMetadata> {
  const normalizedDir = join(outputDir, "normalized");
  await mkdir(join(outputDir, "exports"), { recursive: true });
  await mkdir(join(outputDir, "manifests"), { recursive: true });
  const write = async (name: string, rows: Iterable<unknown>, prefix = "") => {
    memory(`ndjson:${name}:start`);
    const metadata = await writeNdjsonDataset(
      join(normalizedDir, `${name}.ndjson`),
      rows,
      prefix
    );
    memory(`ndjson:${name}:end`, {
      rows: metadata.rowCount,
      bytes: metadata.byteSize
    });
    return metadata;
  };
  return {
    members: await write("members", bundle.members),
    rollCalls: await write("roll_calls", bundle.rollCalls),
    voteFacts: await write("vote_facts", bundle.voteFacts),
    attendanceFacts: await write(
      "attendance_facts",
      attendanceDatasetRows(bundle.attendanceFacts),
      JSON.stringify(ATTENDANCE_DATASET_SEED) +
        (bundle.attendanceFacts.length ? "\n" : "")
    ),
    meetings: await write("meetings", bundle.meetings),
    sources: await write("sources", bundle.sources)
  };
}

async function writeOptionalDataset<T extends Record<string, unknown>>(
  outputDir: string,
  name: string,
  items: T[],
  seedRow: T & { __seed: true },
  memory: BuildMemoryRecorder
): Promise<DatasetMetadata> {
  memory(`ndjson:${name}:start`, { rows: items.length });
  const metadata = await writeNdjsonDataset(
    join(outputDir, "normalized", `${name}.ndjson`),
    items,
    `${JSON.stringify(seedRow)}\n`
  );
  memory(`ndjson:${name}:end`, {
    rows: metadata.rowCount,
    bytes: metadata.byteSize
  });
  return metadata;
}

async function loadPublishedSponsorshipAccounts(
  dataRepoDir: string
): Promise<MemberSponsorshipAccountsExport | null> {
  try {
    const payload = JSON.parse(
      await readFile(
        join(dataRepoDir, "exports", "member_sponsorship_accounts.json"),
        "utf8"
      )
    ) as MemberSponsorshipAccountsExport;
    return validateMemberSponsorshipAccountsExport(payload);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function isPoliticalDonationCenterUrl(value: string): boolean {
  try {
    return new URL(value).hostname === "www.give.go.kr";
  } catch {
    return false;
  }
}

export function toPublicSponsorshipRoutes(
  payload: MemberSponsorshipAccountsExport
): MemberSponsorshipAccountsExport {
  const recordsByMemberId = new Map<
    string,
    MemberSponsorshipAccountsExport["accounts"][number]
  >();

  for (const account of payload.accounts) {
    const donationUrl =
      account.donationUrl && isPoliticalDonationCenterUrl(account.donationUrl)
        ? account.donationUrl
        : undefined;
    const sourceUrl = isPoliticalDonationCenterUrl(account.sourceUrl)
      ? account.sourceUrl
      : (donationUrl ?? POLITICAL_DONATION_CENTER_URL);
    const publicRecord: MemberSponsorshipAccountsExport["accounts"][number] = {
      recordId: `sponsorship-${account.memberId}-official`,
      memberId: account.memberId,
      status: "unverified",
      sourceUrl,
      reviewedAt: payload.generatedAt,
      reason:
        "Only official sponsorship committee and donation links are published.",
      ...(donationUrl ? { donationUrl } : {})
    };
    const existing = recordsByMemberId.get(account.memberId);

    if (!existing?.donationUrl || publicRecord.donationUrl) {
      recordsByMemberId.set(account.memberId, publicRecord);
    }
  }

  return validateMemberSponsorshipAccountsExport({
    ...payload,
    accounts: [...recordsByMemberId.values()].sort((left, right) =>
      left.memberId.localeCompare(right.memberId)
    )
  });
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function resolveMemberSponsorshipAccounts(args: {
  runtimeConfig: BuildDataRuntimeConfig;
  normalized: NormalizedBuildArtifacts;
  accountabilitySummary: ReturnType<typeof buildAccountabilitySummaryExport>;
}): Promise<MemberSponsorshipAccountsExport | null> {
  const published = await loadPublishedSponsorshipAccounts(
    args.runtimeConfig.dataRepoDir
  );
  const existing = published ? toPublicSponsorshipRoutes(published) : null;
  if (args.runtimeConfig.env.COLLECT_SPONSORSHIP_ACCOUNTS !== "true") {
    return existing;
  }

  try {
    const result = await collectMemberSponsorshipAccounts({
      members: args.accountabilitySummary.items,
      assemblyNo: args.normalized.currentAssembly.assemblyNo,
      assemblyLabel: args.normalized.currentAssembly.label,
      snapshotId: args.normalized.snapshotId,
      timeoutMs: parsePositiveInteger(
        args.runtimeConfig.env.SPONSORSHIP_FETCH_TIMEOUT_MS,
        10_000
      ),
      concurrency: parsePositiveInteger(
        args.runtimeConfig.env.SPONSORSHIP_FETCH_CONCURRENCY,
        4
      )
    });

    console.info(
      `[sponsorship] matched ${result.stats.officialSupporters}/${result.stats.directoryMembers} official committees; published official links only.`
    );
    for (const warning of result.warnings.slice(0, 25)) {
      console.warn(`[sponsorship] ${warning}`);
    }
    if (result.warnings.length > 25) {
      console.warn(
        `[sponsorship] ${result.warnings.length - 25} additional source warnings were omitted.`
      );
    }

    return toPublicSponsorshipRoutes(result.exportData);
  } catch (error) {
    console.warn(
      `[sponsorship] collection failed; ${
        existing
          ? "preserving the last sanitized official-link export"
          : "no prior export is available"
      }: ${error instanceof Error ? error.message : String(error)}`
    );
    return existing;
  }
}

export async function publishBuildOutputs(args: {
  runtimeConfig: BuildDataRuntimeConfig;
  normalized: NormalizedBuildArtifacts;
  memory?: BuildMemoryRecorder;
}): Promise<void> {
  const memory = args.memory ?? (() => {});
  memory("write-bundle:start");
  const normalizedDatasets = await writeBundle(
    args.runtimeConfig.outputDir,
    args.normalized.bundle,
    memory
  );
  memory("write-bundle:end");

  memory("exports:start");
  const latestVotes = validateLatestVotesExport(
    buildLatestVotesExport(args.normalized.bundle, {
      tenureIndex: args.normalized.tenureIndex
    })
  );
  const accountabilitySummary = validateAccountabilitySummaryExport(
    buildAccountabilitySummaryExport(args.normalized.bundle, {
      tenureIndex: args.normalized.tenureIndex
    })
  );
  const accountabilityTrends = validateAccountabilityTrendsExport(
    buildAccountabilityTrendsExport(args.normalized.bundle, {
      tenureIndex: args.normalized.tenureIndex
    })
  );
  memory("sponsorship:start");
  const memberSponsorshipAccounts = await resolveMemberSponsorshipAccounts({
    runtimeConfig: args.runtimeConfig,
    normalized: args.normalized,
    accountabilitySummary
  });
  memory("sponsorship:end");
  const billProposalActivity = validateBillProposalActivityExport(
    buildBillProposalActivityExport({
      bundle: args.normalized.bundle,
      currentAssembly: args.normalized.currentAssembly,
      snapshotId: args.normalized.snapshotId,
      billProposals: args.normalized.billProposals,
      generatedAt: latestVotes.generatedAt
    })
  );
  memory("calendar:start");
  const {
    memberActivityCalendar: builtMemberActivityCalendar,
    memberDetails: builtMemberDetails
  } = buildMemberActivityCalendarArtifacts(args.normalized.bundle, {
    tenureIndex: args.normalized.tenureIndex
  });
  const memberActivityCalendar = validateMemberActivityCalendarExport(
    builtMemberActivityCalendar
  );
  const memberActivityCalendarMemberDetails = builtMemberDetails.map((detail) =>
    validateMemberActivityCalendarMemberDetailExport(detail)
  );

  memory("property:start");
  const propertyDisclosureArtifacts = await buildPropertyDisclosureArtifacts({
    memory,
    assemblyLabel: args.normalized.currentAssembly.label,
    assemblyNo: args.normalized.currentAssembly.assemblyNo,
    currentMembers: args.normalized.propertyMemberContext.currentMembers,
    dataRepoDir: args.runtimeConfig.dataRepoDir,
    generatedAt: latestVotes.generatedAt,
    indexPath:
      args.runtimeConfig.env.PROPERTY_DOCUMENT_INDEX_PATH ??
      DEFAULT_PROPERTY_DOCUMENT_INDEX_PATH,
    propertySourceId: args.runtimeConfig.env.PROPERTY_SOURCE_ID,
    snapshotId: args.normalized.snapshotId,
    tenureIndex: args.normalized.propertyMemberContext.tenureIndex
  });
  memory("property:end");
  const memberAssetsIndex = validateMemberAssetsIndexExport(
    propertyDisclosureArtifacts.memberAssetsIndex
  );
  const memberAssetsHistory =
    propertyDisclosureArtifacts.memberAssetsHistory.map((history) =>
      validateMemberAssetsHistoryExport(history)
    );
  memory("property-ndjson:start");
  const propertyDatasetFiles = {
    files: await writeOptionalDataset(
      args.runtimeConfig.outputDir,
      "asset_disclosures",
      propertyDisclosureArtifacts.files,
      {
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
      },
      memory
    ),
    records: await writeOptionalDataset(
      args.runtimeConfig.outputDir,
      "asset_disclosure_records",
      propertyDisclosureArtifacts.records,
      {
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
      },
      memory
    ),
    categories: await writeOptionalDataset(
      args.runtimeConfig.outputDir,
      "asset_disclosure_categories",
      propertyDisclosureArtifacts.categories,
      {
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
      },
      memory
    ),
    items: await writeOptionalDataset(
      args.runtimeConfig.outputDir,
      "asset_disclosure_items",
      propertyDisclosureArtifacts.items,
      {
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
      },
      memory
    )
  };

  const { constituencyBoundariesIndex, hexmapStaticIndex } =
    await publishGeographyOutputs({
      boundaryDir: args.runtimeConfig.constituencyBoundaryDir,
      outputDir: args.runtimeConfig.outputDir,
      generatedAt: latestVotes.generatedAt,
      snapshotId: args.normalized.snapshotId,
      memory
    });

  memory("manifest:start");
  const manifest = validateManifest(
    buildManifest({
      normalizedDatasets,
      bundle: args.normalized.bundle,
      dataRepoBaseUrl: args.runtimeConfig.baseUrl,
      currentAssembly: args.normalized.currentAssembly,
      latestVotes,
      accountabilitySummary,
      accountabilityTrends,
      billProposalActivity,
      memberActivityCalendar,
      memberAssetsIndex,
      ...(memberSponsorshipAccounts ? { memberSponsorshipAccounts } : {}),
      assetDisclosuresDataset: propertyDatasetFiles.files,
      assetDisclosureRecordsDataset: propertyDatasetFiles.records,
      assetDisclosureCategoriesDataset: propertyDatasetFiles.categories,
      assetDisclosureItemsDataset: propertyDatasetFiles.items,
      constituencyBoundariesIndex,
      hexmapStaticIndex
    })
  );

  memory("serialization:start");
  const latestVotesJson = serializePublishedJson(latestVotes);
  const accountabilitySummaryJson = serializePublishedJson(
    accountabilitySummary
  );
  const accountabilityTrendsJson = serializePublishedJson(accountabilityTrends);
  const billProposalActivityJson = serializePublishedJson(billProposalActivity);
  const memberActivityCalendarJson = serializePublishedJson(
    memberActivityCalendar
  );
  const memberAssetsIndexJson = serializePublishedJson(memberAssetsIndex);
  const memberSponsorshipAccountsJson = memberSponsorshipAccounts
    ? serializePublishedJson(memberSponsorshipAccounts)
    : null;
  const manifestJson = JSON.stringify(manifest, null, 2);
  assertPublishedJsonFileSize("exports/latest_votes.json", latestVotesJson);
  assertPublishedJsonFileSize(
    "exports/accountability_summary.json",
    accountabilitySummaryJson
  );
  assertPublishedJsonFileSize(
    "exports/accountability_trends.json",
    accountabilityTrendsJson
  );
  assertPublishedJsonFileSize(
    "exports/bill_proposal_activity.json",
    billProposalActivityJson
  );
  assertPublishedJsonFileSize(
    "exports/member_activity_calendar.json",
    memberActivityCalendarJson
  );
  assertPublishedJsonFileSize(
    "exports/member_assets_index.json",
    memberAssetsIndexJson
  );
  if (memberSponsorshipAccountsJson) {
    assertPublishedJsonFileSize(
      "exports/member_sponsorship_accounts.json",
      memberSponsorshipAccountsJson
    );
  }
  await mkdir(
    join(args.runtimeConfig.outputDir, MEMBER_ACTIVITY_MEMBER_DETAILS_DIR),
    {
      recursive: true
    }
  );
  await mkdir(
    join(args.runtimeConfig.outputDir, "exports", "member_assets_history"),
    {
      recursive: true
    }
  );
  memory("export-write:start");
  await Promise.all([
    writeFile(
      join(args.runtimeConfig.outputDir, "exports", "latest_votes.json"),
      latestVotesJson
    ),
    writeFile(
      join(
        args.runtimeConfig.outputDir,
        "exports",
        "accountability_summary.json"
      ),
      accountabilitySummaryJson
    ),
    writeFile(
      join(
        args.runtimeConfig.outputDir,
        "exports",
        "accountability_trends.json"
      ),
      accountabilityTrendsJson
    ),
    writeFile(
      join(
        args.runtimeConfig.outputDir,
        "exports",
        "bill_proposal_activity.json"
      ),
      billProposalActivityJson
    ),
    writeFile(
      join(
        args.runtimeConfig.outputDir,
        "exports",
        "member_activity_calendar.json"
      ),
      memberActivityCalendarJson
    ),
    writeFile(
      join(args.runtimeConfig.outputDir, "exports", "member_assets_index.json"),
      memberAssetsIndexJson
    ),
    ...(memberSponsorshipAccountsJson
      ? [
          writeFile(
            join(
              args.runtimeConfig.outputDir,
              "exports",
              "member_sponsorship_accounts.json"
            ),
            memberSponsorshipAccountsJson
          )
        ]
      : []),
    writeFile(
      join(args.runtimeConfig.outputDir, "manifests", "latest.json"),
      manifestJson
    )
  ]);
  for (const detail of memberActivityCalendarMemberDetails) {
    const path = buildMemberActivityCalendarMemberDetailPath(detail.memberId);
    const content = serializePublishedJson(detail);
    assertPublishedJsonFileSize(path, content);
    await writeFile(join(args.runtimeConfig.outputDir, path), content);
  }
  for (const history of memberAssetsHistory) {
    const path = `exports/member_assets_history/${history.memberId}.json`;
    const content = serializePublishedJson(history);
    assertPublishedJsonFileSize(path, content);
    await writeFile(join(args.runtimeConfig.outputDir, path), content);
  }
  memory("export-write:end");
}
