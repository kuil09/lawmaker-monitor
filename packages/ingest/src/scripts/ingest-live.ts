import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildAssemblyRequest,
  buildBillVoteSummaryRequest,
  buildMemberHistoryRequest,
  buildVoteDetailRequest,
  type AssemblyApiConfig,
  resolveAssemblyApiConfig
} from "../assembly-api.js";
import { assertRawSnapshotManifestSourcePolicy } from "../assembly-source-registry.js";
import {
  buildMemberHistorySupplementalTargets,
  findMissingCurrentMemberTenures
} from "../member-history-backfill.js";
import { enrichMembersWithMemberProfileAll } from "../member-profile-enrichment.js";
import {
  parseAgendaXml,
  parseMemberInfoXml,
  parseMemberProfileAllXml,
  parseVoteDetailEntryPayload,
  parseMemberHistoryXml,
  parseMeetingXml,
  type CurrentAssemblyContext
} from "../parsers.js";
import {
  type RawSnapshotEntry,
  type RawSnapshotEntryKind,
  writeSnapshotManifest,
  writeSnapshotPayload
} from "../raw-snapshot.js";
import {
  fetchTextWithTimeout,
  mapWithConcurrency,
  resolvePathFromRoot,
  retryFetch
} from "../utils.js";

type FetchTarget = {
  kind: RawSnapshotEntryKind;
  endpointCode: string;
  path: string;
  relativePath: string;
  params?: Record<string, string | number | undefined>;
  metadata?: Record<string, string>;
};

type VoteFetchTarget = {
  kind: RawSnapshotEntryKind;
  endpointCode: string;
  path: string;
  relativePath: string;
  billNo: string;
  billId: string;
  assemblyNo: string;
  metadata?: Record<string, string>;
};

type FetchPolicy = {
  timeoutMs: number;
  retries: number;
  backoffMs: number;
};

type TextRequest = {
  url: string;
  headers: HeadersInit;
  method?: string;
  body?: string;
};

const FETCH_RETRY_BACKOFF_MS = 750;
const MAX_MEMBER_HISTORY_PAGES = 500;
const MAX_GENERIC_PAGES = 500;

function endpointCodeFromPath(path: string): string {
  return basename(path);
}

function toVoteRelativePath(billId: string): string {
  const normalized = billId.replace(/[^A-Za-z0-9._-]/g, "_");
  return `official/votes/${normalized}.xml`;
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseListTotalCount(xml: string): number | null {
  const raw = xml.match(/<list_total_count>(\d+)<\/list_total_count>/)?.[1];
  if (!raw) {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function countXmlRows(xml: string): number {
  return (xml.match(/<row>/g) ?? []).length;
}

function sanitizeAssemblyRequestParams(
  config: AssemblyApiConfig,
  params: Record<string, string>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params).filter(([key]) => key !== config.apiKeyParamName)
  );
}

function sanitizeAssemblyRequestUrl(
  config: AssemblyApiConfig,
  requestUrl: string
): string {
  const url = new URL(requestUrl);
  url.searchParams.delete(config.apiKeyParamName);
  return url.toString();
}

async function fetchText(
  request: TextRequest,
  fetchPolicy: FetchPolicy
): Promise<string> {
  return retryFetch(
    () =>
      fetchTextWithTimeout(
        request.url,
        {
          headers: request.headers,
          method: request.method,
          body: request.body
        },
        fetchPolicy.timeoutMs
      ),
    {
      retries: fetchPolicy.retries,
      backoffMs: fetchPolicy.backoffMs
    }
  );
}

async function fetchAndStoreTarget(args: {
  config: AssemblyApiConfig;
  outputDir: string;
  snapshotId: string;
  fetchPolicy: FetchPolicy;
  target: FetchTarget;
}): Promise<{ body: string; entry: RawSnapshotEntry }> {
  const request = buildAssemblyRequest(
    args.config,
    args.target.path,
    args.target.params
  );
  const retrievedAt = new Date().toISOString();
  const body = await fetchText(
    {
      url: request.url,
      headers: request.headers
    },
    args.fetchPolicy
  );

  const entry = await writeSnapshotPayload({
    outputDir: args.outputDir,
    snapshotId: args.snapshotId,
    kind: args.target.kind,
    endpointCode: args.target.endpointCode,
    relativePath: args.target.relativePath,
    sourceUrl: sanitizeAssemblyRequestUrl(args.config, request.url),
    requestParams: sanitizeAssemblyRequestParams(args.config, request.params),
    retrievedAt,
    body,
    metadata: args.target.metadata
  });

  return { body, entry };
}

async function fetchAndStoreBillVoteSummary(args: {
  config: AssemblyApiConfig;
  outputDir: string;
  snapshotId: string;
  fetchPolicy: FetchPolicy;
  relativePath: string;
  assemblyNo: string;
  page?: number;
  rows?: number;
  lawBillNoQuery?: string;
  metadata?: Record<string, string>;
}): Promise<{ body: string; entry: RawSnapshotEntry }> {
  const request = buildBillVoteSummaryRequest(args.config, {
    assemblyNo: args.assemblyNo,
    page: args.page,
    rows: args.rows,
    lawBillNoQuery: args.lawBillNoQuery
  });
  const retrievedAt = new Date().toISOString();
  const body = await fetchText(
    {
      url: request.url,
      headers: request.headers
    },
    args.fetchPolicy
  );

  const entry = await writeSnapshotPayload({
    outputDir: args.outputDir,
    snapshotId: args.snapshotId,
    kind: "bill_vote_summary",
    endpointCode: endpointCodeFromPath(
      args.config.endpoints.billVoteSummaryPath
    ),
    relativePath: args.relativePath,
    sourceUrl: sanitizeAssemblyRequestUrl(args.config, request.url),
    requestParams: sanitizeAssemblyRequestParams(args.config, request.params),
    retrievedAt,
    body,
    metadata: args.metadata
  });

  return { body, entry };
}

function resolveCurrentAssemblyContext(args: {
  memberAssembly: ReturnType<typeof parseMemberInfoXml>["currentAssembly"];
  tenures: ReturnType<typeof parseMemberHistoryXml>;
}): CurrentAssemblyContext {
  const memberAssembly = args.memberAssembly;
  if (!memberAssembly) {
    throw new Error(
      "Failed to detect the latest Assembly from the official member info feed."
    );
  }

  const matchingUnitCds = [
    ...new Set(
      args.tenures
        .filter((record) => record.assemblyNo === memberAssembly.assemblyNo)
        .map((record) => record.unitCd)
        .filter((value): value is string => Boolean(value))
    )
  ];

  if (matchingUnitCds.length === 0) {
    throw new Error(
      `Failed to resolve UNIT_CD for assembly ${memberAssembly.assemblyNo} from member history.`
    );
  }

  const unitCd = matchingUnitCds[0];
  if (!unitCd) {
    throw new Error(
      `Failed to resolve UNIT_CD for assembly ${memberAssembly.assemblyNo} from member history.`
    );
  }

  return {
    assemblyNo: memberAssembly.assemblyNo,
    label: memberAssembly.label,
    unitCd
  };
}

async function fetchAndStoreMemberHistory(args: {
  config: AssemblyApiConfig;
  outputDir: string;
  snapshotId: string;
  fetchPolicy: FetchPolicy;
  relativePath: string;
  page?: number;
  rows?: number;
  monaCd?: string;
  metadata?: Record<string, string>;
}): Promise<{ body: string; entry: RawSnapshotEntry }> {
  const request = buildMemberHistoryRequest(args.config, {
    page: args.page,
    rows: args.rows,
    monaCd: args.monaCd
  });
  const retrievedAt = new Date().toISOString();
  const body = await fetchText(
    {
      url: request.url,
      headers: request.headers
    },
    args.fetchPolicy
  );

  const entry = await writeSnapshotPayload({
    outputDir: args.outputDir,
    snapshotId: args.snapshotId,
    kind: "member_history",
    endpointCode: endpointCodeFromPath(args.config.endpoints.memberHistoryPath),
    relativePath: args.relativePath,
    sourceUrl: sanitizeAssemblyRequestUrl(args.config, request.url),
    requestParams: sanitizeAssemblyRequestParams(args.config, request.params),
    retrievedAt,
    body,
    metadata: args.metadata
  });

  return { body, entry };
}

async function fetchAndStoreVoteTarget(args: {
  config: AssemblyApiConfig;
  outputDir: string;
  snapshotId: string;
  fetchPolicy: FetchPolicy;
  target: VoteFetchTarget;
}): Promise<{ body: string; entry: RawSnapshotEntry }> {
  const request = buildVoteDetailRequest(args.config, {
    assemblyNo: args.target.assemblyNo,
    billId: args.target.billId
  });
  const retrievedAt = new Date().toISOString();
  const body = await fetchText(
    {
      url: request.url,
      headers: request.headers
    },
    args.fetchPolicy
  );

  const entry = await writeSnapshotPayload({
    outputDir: args.outputDir,
    snapshotId: args.snapshotId,
    kind: args.target.kind,
    endpointCode: args.target.endpointCode,
    relativePath: args.target.relativePath,
    sourceUrl: sanitizeAssemblyRequestUrl(args.config, request.url),
    requestParams: sanitizeAssemblyRequestParams(args.config, request.params),
    retrievedAt,
    body,
    metadata: args.target.metadata
  });

  return { body, entry };
}

async function main(): Promise<void> {
  const config = resolveAssemblyApiConfig();
  const fetchPolicy: FetchPolicy = {
    timeoutMs: config.fetchTimeoutMs,
    retries: config.fetchRetries,
    backoffMs: FETCH_RETRY_BACKOFF_MS
  };
  const repositoryRoot = resolve(
    fileURLToPath(new URL("../../../../", import.meta.url))
  );
  const outputDir = resolvePathFromRoot(
    repositoryRoot,
    process.env.OUTPUT_DIR ?? join(repositoryRoot, "artifacts/ingest")
  );
  const snapshotId =
    process.env.SNAPSHOT_ID ?? new Date().toISOString().replace(/[:.]/g, "-");
  const manifestEntries: RawSnapshotEntry[] = [];
  let expectedMemberInfoRows: number | null = null;
  let fetchedMemberInfoRows = 0;
  const parsedMemberInfoMembers: ReturnType<
    typeof parseMemberInfoXml
  >["members"] = [];
  let detectedMemberAssembly: ReturnType<
    typeof parseMemberInfoXml
  >["currentAssembly"] = null;

  for (let page = 1; page <= MAX_GENERIC_PAGES; page += 1) {
    const result = await fetchAndStoreTarget({
      config,
      outputDir,
      snapshotId,
      fetchPolicy,
      target: {
        kind: "member_info",
        endpointCode: endpointCodeFromPath(config.endpoints.memberInfoPath),
        path: config.endpoints.memberInfoPath,
        relativePath: `official/member_info/page-${page}.xml`,
        params: {
          pIndex: page,
          pSize: config.pageSize
        },
        metadata: {
          page: String(page)
        }
      }
    });

    manifestEntries.push(result.entry);

    const parsed = parseMemberInfoXml(result.body);
    parsedMemberInfoMembers.push(...parsed.members);
    if (
      parsed.currentAssembly &&
      (!detectedMemberAssembly ||
        parsed.currentAssembly.assemblyNo > detectedMemberAssembly.assemblyNo)
    ) {
      detectedMemberAssembly = parsed.currentAssembly;
    }

    const rows = countXmlRows(result.body);
    fetchedMemberInfoRows += rows;
    expectedMemberInfoRows ??= parseListTotalCount(result.body);

    if (rows === 0) {
      break;
    }

    if (
      expectedMemberInfoRows !== null &&
      fetchedMemberInfoRows >= expectedMemberInfoRows
    ) {
      break;
    }
  }

  if (
    expectedMemberInfoRows !== null &&
    fetchedMemberInfoRows < expectedMemberInfoRows
  ) {
    throw new Error(
      `Member info paging stopped early. Expected ${expectedMemberInfoRows} rows, fetched ${fetchedMemberInfoRows}.`
    );
  }

  let expectedMemberProfileAllRows: number | null = null;
  let fetchedMemberProfileAllRows = 0;
  const parsedMemberProfileAllProfiles: ReturnType<
    typeof parseMemberProfileAllXml
  >["profiles"] = [];

  for (let page = 1; page <= MAX_GENERIC_PAGES; page += 1) {
    const result = await fetchAndStoreTarget({
      config,
      outputDir,
      snapshotId,
      fetchPolicy,
      target: {
        kind: "member_profile_all",
        endpointCode: endpointCodeFromPath(
          config.endpoints.memberProfileAllPath
        ),
        path: config.endpoints.memberProfileAllPath,
        relativePath: `official/member_profile_all/page-${page}.xml`,
        params: {
          pIndex: page,
          pSize: config.pageSize
        },
        metadata: {
          page: String(page)
        }
      }
    });

    manifestEntries.push(result.entry);

    const parsed = parseMemberProfileAllXml(result.body);
    parsedMemberProfileAllProfiles.push(...parsed.profiles);

    const rows = countXmlRows(result.body);
    fetchedMemberProfileAllRows += rows;
    expectedMemberProfileAllRows ??= parseListTotalCount(result.body);

    if (rows === 0) {
      break;
    }

    if (
      expectedMemberProfileAllRows !== null &&
      fetchedMemberProfileAllRows >= expectedMemberProfileAllRows
    ) {
      break;
    }
  }

  if (
    expectedMemberProfileAllRows !== null &&
    fetchedMemberProfileAllRows < expectedMemberProfileAllRows
  ) {
    throw new Error(
      `Member profile enrichment paging stopped early. Expected ${expectedMemberProfileAllRows} rows, fetched ${fetchedMemberProfileAllRows}.`
    );
  }

  const memberHistoryResults: Array<{ body: string; entry: RawSnapshotEntry }> =
    [];
  let expectedMemberHistoryRows: number | null = null;
  let fetchedMemberHistoryRows = 0;

  for (let page = 1; page <= MAX_MEMBER_HISTORY_PAGES; page += 1) {
    const result = await fetchAndStoreMemberHistory({
      config,
      outputDir,
      snapshotId,
      fetchPolicy,
      page,
      rows: config.pageSize,
      relativePath: `official/member_history/page-${page}.xml`,
      metadata: {
        assemblyNo: String(detectedMemberAssembly?.assemblyNo ?? ""),
        assemblyLabel: detectedMemberAssembly?.label ?? "",
        page: String(page),
        queryType: "page"
      }
    });
    memberHistoryResults.push(result);
    manifestEntries.push(result.entry);

    const rows = parseMemberHistoryXml(result.body);
    fetchedMemberHistoryRows += rows.length;
    expectedMemberHistoryRows ??= parseListTotalCount(result.body);

    if (rows.length === 0) {
      break;
    }

    if (
      expectedMemberHistoryRows !== null &&
      fetchedMemberHistoryRows >= expectedMemberHistoryRows
    ) {
      break;
    }
  }

  if (
    expectedMemberHistoryRows !== null &&
    fetchedMemberHistoryRows < expectedMemberHistoryRows
  ) {
    throw new Error(
      `Member history paging stopped early. Expected ${expectedMemberHistoryRows} rows, fetched ${fetchedMemberHistoryRows}.`
    );
  }

  let parsedMemberHistory = memberHistoryResults.flatMap((result) =>
    parseMemberHistoryXml(result.body)
  );
  const currentAssembly = resolveCurrentAssemblyContext({
    memberAssembly: detectedMemberAssembly,
    tenures: parsedMemberHistory
  });
  const supplementalHistoryTargets = buildMemberHistorySupplementalTargets({
    members: parsedMemberInfoMembers,
    tenures: parsedMemberHistory,
    assemblyNo: currentAssembly.assemblyNo,
    assemblyLabel: currentAssembly.label,
    unitCd: currentAssembly.unitCd
  });

  if (supplementalHistoryTargets.length > 0) {
    console.warn(
      `missing current member tenure -> supplemental fetch ${supplementalHistoryTargets.length} members`
    );
  }

  const supplementalHistoryResults = await mapWithConcurrency(
    supplementalHistoryTargets,
    config.billFeedConcurrency,
    async (target) => {
      try {
        return await fetchAndStoreMemberHistory({
          config,
          outputDir,
          snapshotId,
          fetchPolicy,
          monaCd: target.memberId,
          rows: 20,
          relativePath: target.relativePath,
          metadata: target.metadata
        });
      } catch (error) {
        console.warn(
          `member_history supplemental ${target.memberId} failed after retries: ${formatErrorMessage(error)}`
        );
        return null;
      }
    }
  );
  const successfulSupplementalHistoryResults =
    supplementalHistoryResults.filter(
      (
        result
      ): result is {
        body: string;
        entry: RawSnapshotEntry;
      } => result !== null
    );

  manifestEntries.push(
    ...successfulSupplementalHistoryResults.map((result) => result.entry)
  );
  parsedMemberHistory = [
    ...parsedMemberHistory,
    ...successfulSupplementalHistoryResults.flatMap((result) =>
      parseMemberHistoryXml(result.body)
    )
  ];

  const remainingMissingTenures = findMissingCurrentMemberTenures({
    members: parsedMemberInfoMembers,
    tenures: parsedMemberHistory,
    assemblyNo: currentAssembly.assemblyNo
  });

  if (remainingMissingTenures.length > 0) {
    throw new Error(
      `Current members are missing tenure history after supplemental fetch: ${remainingMissingTenures
        .slice(0, 10)
        .map((member) => member.memberName)
        .join(", ")}${remainingMissingTenures.length > 10 ? "..." : ""}`
    );
  }
  const enrichment = enrichMembersWithMemberProfileAll({
    members: parsedMemberInfoMembers,
    profiles: parsedMemberProfileAllProfiles
  });
  const photoReadyMembers = enrichment.members.filter(
    (member) => member.photoUrl
  );

  if (enrichment.issues.length > 0) {
    const missingProfileMatches = enrichment.issues.filter(
      (issue) => issue.reason === "missing_profile_match"
    ).length;
    const duplicateMatches = enrichment.issues.filter(
      (issue) =>
        issue.reason === "duplicate_profile_match" ||
        issue.reason === "duplicate_member_match"
    ).length;
    const unmatchedProfiles = enrichment.issues.filter(
      (issue) => issue.reason === "unmatched_profile_record"
    ).length;
    console.warn(
      `member_profile_all enrichment coverage -> matched ${enrichment.matchedCount}/${parsedMemberInfoMembers.length}, photo enriched ${enrichment.photoEnrichedCount}, missing matches ${missingProfileMatches}, duplicate matches ${duplicateMatches}, unmatched profiles ${unmatchedProfiles}`
    );
  }

  if (photoReadyMembers.length === 0) {
    throw new Error(
      "member_profile_all did not enrich any current roster members with a non-null photoUrl."
    );
  }

  for (const target of [
    {
      kind: "committee_overview" as const,
      endpointCode: endpointCodeFromPath(
        config.endpoints.committeeOverviewPath
      ),
      path: config.endpoints.committeeOverviewPath,
      relativePathPrefix: "official/committee_overview"
    },
    {
      kind: "committee_roster" as const,
      endpointCode: endpointCodeFromPath(config.endpoints.committeeRosterPath),
      path: config.endpoints.committeeRosterPath,
      relativePathPrefix: "official/committee_roster"
    }
  ]) {
    let expectedRows: number | null = null;
    let fetchedRows = 0;

    for (let page = 1; page <= MAX_GENERIC_PAGES; page += 1) {
      const result = await fetchAndStoreTarget({
        config,
        outputDir,
        snapshotId,
        fetchPolicy,
        target: {
          kind: target.kind,
          endpointCode: target.endpointCode,
          path: target.path,
          relativePath: `${target.relativePathPrefix}/page-${page}.xml`,
          params: {
            pIndex: page,
            pSize: config.pageSize
          },
          metadata: {
            assemblyNo: String(currentAssembly.assemblyNo),
            assemblyLabel: currentAssembly.label,
            unitCd: currentAssembly.unitCd,
            page: String(page)
          }
        }
      });

      manifestEntries.push(result.entry);

      const rows = countXmlRows(result.body);
      fetchedRows += rows;
      expectedRows ??= parseListTotalCount(result.body);

      if (rows === 0) {
        break;
      }

      if (expectedRows !== null && fetchedRows >= expectedRows) {
        break;
      }
    }
  }

  const scheduleTarget: FetchTarget = {
    kind: "plenary_schedule",
    endpointCode: endpointCodeFromPath(config.endpoints.plenarySchedulePath),
    path: config.endpoints.plenarySchedulePath,
    relativePath: "official/plenary_schedule.xml",
    params: {
      UNIT_CD: currentAssembly.unitCd
    },
    metadata: {
      assemblyNo: String(currentAssembly.assemblyNo),
      assemblyLabel: currentAssembly.label,
      unitCd: currentAssembly.unitCd
    }
  };

  const { body: scheduleXml, entry: scheduleEntry } = await fetchAndStoreTarget(
    {
      config,
      outputDir,
      snapshotId,
      fetchPolicy,
      target: scheduleTarget
    }
  );
  manifestEntries.push(scheduleEntry);

  const billTargets: FetchTarget[] = [
    {
      kind: "plenary_bills_law",
      endpointCode: endpointCodeFromPath(config.endpoints.plenaryLawBillsPath),
      path: config.endpoints.plenaryLawBillsPath,
      relativePath: "official/plenary_bills_law.xml",
      params: { AGE: String(currentAssembly.assemblyNo) }
    },
    {
      kind: "plenary_bills_budget",
      endpointCode: endpointCodeFromPath(
        config.endpoints.plenaryBudgetBillsPath
      ),
      path: config.endpoints.plenaryBudgetBillsPath,
      relativePath: "official/plenary_bills_budget.xml",
      params: { AGE: String(currentAssembly.assemblyNo) }
    },
    {
      kind: "plenary_bills_settlement",
      endpointCode: endpointCodeFromPath(
        config.endpoints.plenarySettlementBillsPath
      ),
      path: config.endpoints.plenarySettlementBillsPath,
      relativePath: "official/plenary_bills_settlement.xml",
      params: { AGE: String(currentAssembly.assemblyNo) }
    },
    {
      kind: "plenary_bills_other",
      endpointCode: endpointCodeFromPath(
        config.endpoints.plenaryOtherBillsPath
      ),
      path: config.endpoints.plenaryOtherBillsPath,
      relativePath: "official/plenary_bills_other.xml",
      params: { AGE: String(currentAssembly.assemblyNo) }
    }
  ];

  const billRefs = new Map<string, { billNo: string; billId?: string }>();
  const billResults = await mapWithConcurrency(
    billTargets,
    config.billFeedConcurrency,
    async (target) => {
      try {
        return await fetchAndStoreTarget({
          config,
          outputDir,
          snapshotId,
          fetchPolicy,
          target
        });
      } catch (error) {
        console.warn(
          `plenary_bill_feed ${target.kind} failed after retries: ${formatErrorMessage(error)}`
        );
        return null;
      }
    }
  );

  for (const result of billResults) {
    if (!result) {
      continue;
    }

    manifestEntries.push(result.entry);

    const parsed = parseAgendaXml(result.body, {
      sourceUrl: result.entry.sourceUrl,
      retrievedAt: result.entry.retrievedAt,
      snapshotId
    });

    for (const agenda of parsed.agendas) {
      const billNo = agenda.agendaId;
      if (!billNo) {
        continue;
      }

      billRefs.set(billNo, {
        billNo,
        billId: agenda.billId
      });
    }
  }

  const sortedBillRefs = [...billRefs.values()].sort((left, right) =>
    left.billNo.localeCompare(right.billNo)
  );
  const missingBillIds = sortedBillRefs
    .filter((item) => !item.billId)
    .map((item) => item.billNo);

  if (missingBillIds.length > 0) {
    throw new Error(
      `Official vote detail requires BILL_ID for every agenda. Missing BILL_ID for: ${missingBillIds.slice(0, 10).join(", ")}${missingBillIds.length > 10 ? "..." : ""}`
    );
  }

  const verifiedBillRefs = sortedBillRefs as Array<{
    billNo: string;
    billId: string;
  }>;
  const voteResults = await mapWithConcurrency(
    verifiedBillRefs,
    config.voteDetailConcurrency,
    async ({ billNo, billId }) => {
      const voteKey = billId;
      const target: VoteFetchTarget = {
        kind: "vote_detail",
        endpointCode: endpointCodeFromPath(config.endpoints.votesPath),
        path: config.endpoints.votesPath,
        relativePath: toVoteRelativePath(voteKey),
        billNo,
        billId,
        assemblyNo: String(currentAssembly.assemblyNo),
        metadata: {
          billNo,
          billId
        }
      };

      try {
        const { body, entry } = await fetchAndStoreVoteTarget({
          config,
          outputDir,
          snapshotId,
          fetchPolicy,
          target
        });
        const parsedVote = parseVoteDetailEntryPayload(
          entry,
          body,
          {
            sourceUrl: entry.sourceUrl,
            retrievedAt: entry.retrievedAt,
            snapshotId
          },
          {
            currentMembers: parsedMemberInfoMembers
          }
        );
        const rollCalls = [
          ...new Map(
            parsedVote.rollCalls.map((rollCall) => [
              rollCall.rollCallId,
              rollCall
            ])
          ).values()
        ];

        return {
          billNo,
          billId,
          entry,
          rollCalls
        };
      } catch (error) {
        console.warn(
          `vote_detail ${billId} failed after retries: ${formatErrorMessage(error)}`
        );
        return null;
      }
    }
  );

  const successfulVoteResults = voteResults.filter(
    (result): result is NonNullable<(typeof voteResults)[number]> =>
      result !== null
  );
  manifestEntries.push(...successfulVoteResults.map((result) => result.entry));

  let expectedBillVoteSummaryRows: number | null = null;
  let fetchedBillVoteSummaryRows = 0;

  for (let page = 1; page <= MAX_GENERIC_PAGES; page += 1) {
    const result = await fetchAndStoreBillVoteSummary({
      config,
      outputDir,
      snapshotId,
      fetchPolicy,
      assemblyNo: String(currentAssembly.assemblyNo),
      page,
      rows: config.pageSize,
      relativePath: `official/bill_vote_summary/page-${page}.xml`,
      metadata: {
        assemblyNo: String(currentAssembly.assemblyNo),
        assemblyLabel: currentAssembly.label,
        page: String(page)
      }
    });
    manifestEntries.push(result.entry);

    const rows = countXmlRows(result.body);
    fetchedBillVoteSummaryRows += rows;
    expectedBillVoteSummaryRows ??= parseListTotalCount(result.body);

    if (rows === 0) {
      break;
    }

    if (
      expectedBillVoteSummaryRows !== null &&
      fetchedBillVoteSummaryRows >= expectedBillVoteSummaryRows
    ) {
      break;
    }
  }

  const liveTarget: FetchTarget = {
    kind: "live",
    endpointCode: endpointCodeFromPath(config.endpoints.livePath),
    path: config.endpoints.livePath,
    relativePath: "official/live.xml"
  };
  const { entry: liveEntry } = await fetchAndStoreTarget({
    config,
    outputDir,
    snapshotId,
    fetchPolicy,
    target: liveTarget
  });
  manifestEntries.push(liveEntry);

  const schedule = parseMeetingXml(scheduleXml, {
    sourceUrl: scheduleEntry.sourceUrl,
    retrievedAt: scheduleEntry.retrievedAt,
    snapshotId
  });
  const latestMeeting = [...schedule.meetings].sort((left, right) =>
    right.meetingDate.localeCompare(left.meetingDate)
  )[0];

  if (latestMeeting) {
    const minutesTarget: FetchTarget = {
      kind: "plenary_minutes",
      endpointCode: endpointCodeFromPath(config.endpoints.plenaryMinutesPath),
      path: config.endpoints.plenaryMinutesPath,
      relativePath: "official/plenary_minutes.xml",
      params: {
        DAE_NUM: String(currentAssembly.assemblyNo),
        CONF_DATE: latestMeeting.meetingDate
      },
      metadata: {
        meetingDate: latestMeeting.meetingDate,
        assemblyNo: String(currentAssembly.assemblyNo),
        assemblyLabel: currentAssembly.label,
        unitCd: currentAssembly.unitCd
      }
    };

    const { entry } = await fetchAndStoreTarget({
      config,
      outputDir,
      snapshotId,
      fetchPolicy,
      target: minutesTarget
    });
    manifestEntries.push(entry);
  }

  const manifest = assertRawSnapshotManifestSourcePolicy({
    snapshotId,
    retrievedAt: new Date().toISOString(),
    entries: manifestEntries
  });

  await writeSnapshotManifest({
    outputDir,
    manifest
  });
}

void main();
