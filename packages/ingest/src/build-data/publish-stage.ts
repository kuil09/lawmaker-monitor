import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  buildConstituencyBoundaryRuntimeArtifacts,
  CONSTITUENCY_BOUNDARIES_INDEX_PATH
} from "../constituency-boundary-runtime.js";
import {
  assertPublishedJsonFileSize,
  buildAccountabilitySummaryExport,
  buildAccountabilityTrendsExport,
  buildBillProposalActivityExport,
  buildLatestVotesExport,
  buildManifest,
  buildMemberActivityCalendarArtifacts,
  buildMemberActivityCalendarMemberDetailPath,
  MEMBER_ACTIVITY_MEMBER_DETAILS_DIR,
  serializePublishedJson,
  toAttendanceFactsNdjson,
  toNdjson
} from "../exports.js";
import {
  buildHexmapStaticRuntimeArtifacts,
  HEXMAP_STATIC_INDEX_PATH
} from "../hexmap-static-runtime.js";
import { collectMemberSponsorshipAccounts } from "../member-sponsorship-accounts.js";
import {
  DEFAULT_PROPERTY_DOCUMENT_INDEX_PATH,
  buildPropertyDisclosureArtifacts
} from "../property-disclosures.js";
import {
  validateAccountabilitySummaryExport,
  validateAccountabilityTrendsExport,
  validateBillProposalActivityExport,
  validateConstituencyBoundariesIndexExport,
  validateHexmapStaticIndexExport,
  validateHexmapStaticProvinceArtifact,
  validateLatestVotesExport,
  validateManifest,
  validateMemberActivityCalendarExport,
  validateMemberActivityCalendarMemberDetailExport,
  validateMemberAssetsHistoryExport,
  validateMemberAssetsIndexExport,
  validateMemberSponsorshipAccountsExport
} from "../validation.js";

import type { BuildDataRawInputs } from "./input-stage.js";
import type { NormalizedBuildArtifacts } from "./normalize-stage.js";
import type {
  ConstituencyBoundaryExport,
  MemberSponsorshipAccountsExport,
  NormalizedBundle
} from "@lawmaker-monitor/schemas";

const POLITICAL_DONATION_CENTER_URL =
  "https://www.give.go.kr/portal/supporter/supporterSearch/list.do?menuNo=200025";

async function writeBundle(
  outputDir: string,
  bundle: NormalizedBundle
): Promise<void> {
  const normalizedDir = join(outputDir, "normalized");
  const exportsDir = join(outputDir, "exports");
  const manifestsDir = join(outputDir, "manifests");

  await mkdir(normalizedDir, { recursive: true });
  await mkdir(exportsDir, { recursive: true });
  await mkdir(manifestsDir, { recursive: true });

  await Promise.all([
    writeFile(join(normalizedDir, "members.ndjson"), toNdjson(bundle.members)),
    writeFile(
      join(normalizedDir, "roll_calls.ndjson"),
      toNdjson(bundle.rollCalls)
    ),
    writeFile(
      join(normalizedDir, "vote_facts.ndjson"),
      toNdjson(bundle.voteFacts)
    ),
    writeFile(
      join(normalizedDir, "attendance_facts.ndjson"),
      toAttendanceFactsNdjson(bundle.attendanceFacts)
    ),
    writeFile(
      join(normalizedDir, "meetings.ndjson"),
      toNdjson(bundle.meetings)
    ),
    writeFile(join(normalizedDir, "sources.ndjson"), toNdjson(bundle.sources))
  ]);
}

function toOptionalNdjson<T extends Record<string, unknown>>(
  items: T[],
  seedRow: T & { __seed: true }
): string {
  return `${JSON.stringify(seedRow)}\n${items.length > 0 ? toNdjson(items) : ""}`;
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
  runtimeConfig: BuildDataRawInputs;
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
  runtimeConfig: BuildDataRawInputs;
  normalized: NormalizedBuildArtifacts;
}): Promise<void> {
  await writeBundle(args.runtimeConfig.outputDir, args.normalized.bundle);

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
  const memberSponsorshipAccounts = await resolveMemberSponsorshipAccounts({
    runtimeConfig: args.runtimeConfig,
    normalized: args.normalized,
    accountabilitySummary
  });
  const billProposalActivity = validateBillProposalActivityExport(
    buildBillProposalActivityExport({
      bundle: args.normalized.bundle,
      currentAssembly: args.normalized.currentAssembly,
      snapshotId: args.normalized.snapshotId,
      billProposals: args.normalized.billProposals,
      generatedAt: latestVotes.generatedAt
    })
  );
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

  const propertyDisclosureArtifacts = await buildPropertyDisclosureArtifacts({
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
  const memberAssetsIndex = validateMemberAssetsIndexExport(
    propertyDisclosureArtifacts.memberAssetsIndex
  );
  const memberAssetsHistory =
    propertyDisclosureArtifacts.memberAssetsHistory.map((history) =>
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

  const constituencyBoundaryExport = JSON.parse(
    await readFile(
      join(
        args.runtimeConfig.constituencyBoundaryDir,
        "constituency_boundaries.geojson"
      ),
      "utf8"
    )
  ) as ConstituencyBoundaryExport;
  const constituencyBoundaryRuntimeArtifacts =
    buildConstituencyBoundaryRuntimeArtifacts({
      boundaryExport: constituencyBoundaryExport,
      generatedAt: latestVotes.generatedAt,
      snapshotId: args.normalized.snapshotId
    });
  const hexmapStaticRuntimeArtifacts = buildHexmapStaticRuntimeArtifacts({
    generatedAt: latestVotes.generatedAt,
    snapshotId: args.normalized.snapshotId,
    provinceShards: constituencyBoundaryRuntimeArtifacts.shards
  });
  const constituencyBoundariesIndex = validateConstituencyBoundariesIndexExport(
    constituencyBoundaryRuntimeArtifacts.index
  );
  const hexmapStaticIndex = validateHexmapStaticIndexExport(
    hexmapStaticRuntimeArtifacts.index
  );
  for (const provinceArtifact of hexmapStaticRuntimeArtifacts.provinces) {
    validateHexmapStaticProvinceArtifact(provinceArtifact.artifact);
  }

  const manifest = validateManifest(
    buildManifest({
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
      constituencyBoundariesIndex,
      hexmapStaticIndex
    })
  );

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
  const constituencyBoundariesIndexJson =
    constituencyBoundaryRuntimeArtifacts.indexJson;
  const hexmapStaticIndexJson = hexmapStaticRuntimeArtifacts.indexJson;
  const manifestJson = JSON.stringify(manifest, null, 2);
  const memberActivityCalendarDetailWrites =
    memberActivityCalendarMemberDetails.map((detail) => {
      const relativePath = buildMemberActivityCalendarMemberDetailPath(
        detail.memberId
      );
      const content = serializePublishedJson(detail);
      assertPublishedJsonFileSize(relativePath, content);
      return {
        path: join(args.runtimeConfig.outputDir, relativePath),
        content
      };
    });
  const memberAssetHistoryWrites = memberAssetsHistory.map((history) => {
    const relativePath = `exports/member_assets_history/${history.memberId}.json`;
    const content = serializePublishedJson(history);
    assertPublishedJsonFileSize(relativePath, content);
    return {
      path: join(args.runtimeConfig.outputDir, relativePath),
      content
    };
  });

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
  assertPublishedJsonFileSize(
    CONSTITUENCY_BOUNDARIES_INDEX_PATH,
    constituencyBoundariesIndexJson
  );
  assertPublishedJsonFileSize(HEXMAP_STATIC_INDEX_PATH, hexmapStaticIndexJson);
  for (const shard of constituencyBoundaryRuntimeArtifacts.shards) {
    assertPublishedJsonFileSize(shard.path, shard.content);
  }
  for (const provinceArtifact of hexmapStaticRuntimeArtifacts.provinces) {
    assertPublishedJsonFileSize(
      provinceArtifact.path,
      provinceArtifact.content
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
  await mkdir(
    join(
      args.runtimeConfig.outputDir,
      "exports",
      "constituency_boundaries",
      "provinces"
    ),
    {
      recursive: true
    }
  );
  await mkdir(
    join(args.runtimeConfig.outputDir, "exports", "hexmap_static", "provinces"),
    {
      recursive: true
    }
  );
  await mkdir(join(args.runtimeConfig.outputDir, "normalized"), {
    recursive: true
  });

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
      join(args.runtimeConfig.outputDir, CONSTITUENCY_BOUNDARIES_INDEX_PATH),
      constituencyBoundariesIndexJson
    ),
    writeFile(
      join(args.runtimeConfig.outputDir, HEXMAP_STATIC_INDEX_PATH),
      hexmapStaticIndexJson
    ),
    writeFile(
      join(args.runtimeConfig.outputDir, "manifests", "latest.json"),
      manifestJson
    ),
    writeFile(
      join(
        args.runtimeConfig.outputDir,
        "normalized",
        "asset_disclosures.ndjson"
      ),
      propertyDatasetFiles.files
    ),
    writeFile(
      join(
        args.runtimeConfig.outputDir,
        "normalized",
        "asset_disclosure_records.ndjson"
      ),
      propertyDatasetFiles.records
    ),
    writeFile(
      join(
        args.runtimeConfig.outputDir,
        "normalized",
        "asset_disclosure_categories.ndjson"
      ),
      propertyDatasetFiles.categories
    ),
    writeFile(
      join(
        args.runtimeConfig.outputDir,
        "normalized",
        "asset_disclosure_items.ndjson"
      ),
      propertyDatasetFiles.items
    ),
    ...constituencyBoundaryRuntimeArtifacts.shards.map((shard) =>
      writeFile(join(args.runtimeConfig.outputDir, shard.path), shard.content)
    ),
    ...hexmapStaticRuntimeArtifacts.provinces.map((provinceArtifact) =>
      writeFile(
        join(args.runtimeConfig.outputDir, provinceArtifact.path),
        provinceArtifact.content
      )
    ),
    ...memberActivityCalendarDetailWrites.map((item) =>
      writeFile(item.path, item.content)
    ),
    ...memberAssetHistoryWrites.map((item) =>
      writeFile(item.path, item.content)
    )
  ]);
}
