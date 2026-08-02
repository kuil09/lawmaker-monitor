import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildAssemblyRequest,
  buildBillVoteSummaryRequest,
  buildCommitteeCareerSheetRequest,
  buildLikmsVoteMemberListRequest,
  buildMemberHistoryRequest,
  buildPlenaryAttendanceFileListRequest,
  buildPlenaryAttendanceFileRequest,
  buildVoteDetailRequest,
  OFFICIAL_PLENARY_ATTENDANCE_INF_ID,
  type AssemblyApiConfig,
  resolveAssemblyApiConfig
} from "../assembly-api.js";
import { assertRawSnapshotManifestSourcePolicy } from "../assembly-source-registry.js";
import { parseLikmsVoteInfoHtml } from "../likms-votes.js";
import {
  buildMemberHistorySupplementalTargets,
  findMissingCurrentMemberTenures
} from "../member-history-backfill.js";
import { enrichMembersWithMemberProfileAll } from "../member-profile-enrichment.js";
import {
  parseAgendaXml,
  parseBillVoteSummaryXml,
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
  fetchBufferWithTimeout,
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

type OfficialPlenaryAttendanceFile = {
  infId: string;
  infSeq: number;
  fileSeq: number;
  viewFileNm: string;
  fileExt: string;
  ftCrDttm: string;
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

function toVoteMemberListRelativePath(billId: string): string {
  const normalized = billId.replace(/[^A-Za-z0-9._-]/g, "_");
  return `official/vote_member_lists/${normalized}.html`;
}

function toPlenaryAttendanceFileRelativePath(fileSeq: number): string {
  return `official/plenary_attendance/${fileSeq}.xlsx`;
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

export function selectRecordedVoteBillRefs(args: {
  summaries: Array<{ billNo: string; billId: string }>;
  agendas: Array<{ billNo: string; billId?: string }>;
}): Array<{ billNo: string; billId: string }> {
  const refsByBillNo = new Map<string, { billNo: string; billId: string }>();
  const billNoByBillId = new Map<string, string>();

  for (const summary of args.summaries) {
    if (!summary.billNo || !summary.billId) {
      throw new Error(
        "Official recorded-vote summary is missing BILL_NO or BILL_ID."
      );
    }
    const existing = refsByBillNo.get(summary.billNo);
    if (existing && existing.billId !== summary.billId) {
      throw new Error(
        `Official recorded-vote summaries conflict for bill ${summary.billNo}: ${existing.billId} and ${summary.billId}.`
      );
    }
    const existingBillNo = billNoByBillId.get(summary.billId);
    if (existingBillNo && existingBillNo !== summary.billNo) {
      throw new Error(
        `Official recorded-vote summaries conflict for id ${summary.billId}: bills ${existingBillNo} and ${summary.billNo}.`
      );
    }
    refsByBillNo.set(summary.billNo, {
      billNo: summary.billNo,
      billId: summary.billId
    });
    billNoByBillId.set(summary.billId, summary.billNo);
  }

  for (const agenda of args.agendas) {
    const recordedVote = refsByBillNo.get(agenda.billNo);
    if (!recordedVote || !agenda.billId) {
      continue;
    }
    if (recordedVote.billId !== agenda.billId) {
      throw new Error(
        `Official plenary agenda conflicts with recorded-vote summary for bill ${agenda.billNo}: ${agenda.billId} and ${recordedVote.billId}.`
      );
    }
  }

  return [...refsByBillNo.values()].sort((left, right) =>
    left.billNo.localeCompare(right.billNo)
  );
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

async function fetchBuffer(
  request: Pick<TextRequest, "url" | "headers">,
  fetchPolicy: FetchPolicy
): Promise<Buffer> {
  return retryFetch(
    () =>
      fetchBufferWithTimeout(
        request.url,
        {
          headers: request.headers
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
    billId: args.target.billId,
    page: 1,
    rows: 1000
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

async function fetchAndStoreCommitteeCareerSheet(args: {
  config: AssemblyApiConfig;
  outputDir: string;
  snapshotId: string;
  fetchPolicy: FetchPolicy;
  page: number;
  rows: number;
}): Promise<{ body: string; entry: RawSnapshotEntry }> {
  const request = buildCommitteeCareerSheetRequest({
    page: args.page,
    rows: args.rows
  });
  const retrievedAt = new Date().toISOString();
  const body = await fetchText(request, args.fetchPolicy);
  const entry = await writeSnapshotPayload({
    outputDir: args.outputDir,
    snapshotId: args.snapshotId,
    kind: "member_committee_career",
    endpointCode: "ORNDP7000993P115502",
    relativePath: `official/member_committee_career/page-${args.page}.json`,
    sourceUrl: request.url,
    requestParams: request.params,
    retrievedAt,
    body,
    metadata: {
      page: String(args.page)
    }
  });

  return { body, entry };
}

async function fetchAndStoreLikmsVoteMemberList(args: {
  outputDir: string;
  snapshotId: string;
  fetchPolicy: FetchPolicy;
  billId: string;
  billNo: string;
}): Promise<{ body: string; entry: RawSnapshotEntry }> {
  const request = buildLikmsVoteMemberListRequest(args.billId);
  const retrievedAt = new Date().toISOString();
  const body = await fetchText(request, args.fetchPolicy);
  const entry = await writeSnapshotPayload({
    outputDir: args.outputDir,
    snapshotId: args.snapshotId,
    kind: "vote_member_list",
    endpointCode: "voteInfo.do",
    relativePath: toVoteMemberListRelativePath(args.billId),
    sourceUrl: request.url,
    requestParams: request.params,
    retrievedAt,
    body,
    metadata: {
      billId: args.billId,
      billNo: args.billNo
    }
  });

  return { body, entry };
}

function parsePlenaryAttendanceFileList(
  payload: string
): OfficialPlenaryAttendanceFile[] {
  const parsed = JSON.parse(payload) as {
    data?: Array<Record<string, unknown>>;
  };
  if (!Array.isArray(parsed.data)) {
    throw new Error(
      "Official plenary attendance file service returned no data array."
    );
  }

  return parsed.data.flatMap((row) => {
    const infId = String(row.infId ?? "");
    const infSeq = Number(row.infSeq);
    const fileSeq = Number(row.fileSeq);
    const viewFileNm = String(row.viewFileNm ?? "").trim();
    const fileExt = String(row.fileExt ?? "")
      .trim()
      .toLowerCase();
    const ftCrDttm = String(row.ftCrDttm ?? "").trim();
    if (
      infId !== OFFICIAL_PLENARY_ATTENDANCE_INF_ID ||
      infSeq !== 1 ||
      !Number.isSafeInteger(fileSeq) ||
      fileSeq <= 0 ||
      !viewFileNm ||
      !/^\d{4}-\d{2}-\d{2}$/.test(ftCrDttm)
    ) {
      throw new Error(
        `Official plenary attendance file list contains an invalid row: ${JSON.stringify(row)}`
      );
    }

    return [
      {
        infId,
        infSeq,
        fileSeq,
        viewFileNm,
        fileExt,
        ftCrDttm
      }
    ];
  });
}

function selectCurrentAssemblyAttendanceFiles(args: {
  files: OfficialPlenaryAttendanceFile[];
  assemblyStartDate: string;
}): Array<OfficialPlenaryAttendanceFile & { sessionNo: number }> {
  const latestBySession = new Map<
    number,
    OfficialPlenaryAttendanceFile & { sessionNo: number }
  >();

  for (const file of args.files) {
    const sessionNo = Number.parseInt(
      file.viewFileNm.match(/제?(\d+)회/)?.[1] ?? "",
      10
    );
    if (
      file.fileExt !== "xlsx" ||
      !file.viewFileNm.includes("본회의 출결현황") ||
      file.ftCrDttm.localeCompare(args.assemblyStartDate) < 0 ||
      !Number.isSafeInteger(sessionNo) ||
      sessionNo <= 0
    ) {
      continue;
    }

    const existing = latestBySession.get(sessionNo);
    if (
      !existing ||
      file.ftCrDttm.localeCompare(existing.ftCrDttm) > 0 ||
      (file.ftCrDttm === existing.ftCrDttm && file.fileSeq > existing.fileSeq)
    ) {
      latestBySession.set(sessionNo, { ...file, sessionNo });
    }
  }

  return [...latestBySession.values()].sort(
    (left, right) => left.sessionNo - right.sessionNo
  );
}

async function fetchAndStorePlenaryAttendanceFile(args: {
  outputDir: string;
  snapshotId: string;
  fetchPolicy: FetchPolicy;
  file: OfficialPlenaryAttendanceFile & { sessionNo: number };
}): Promise<RawSnapshotEntry> {
  const request = buildPlenaryAttendanceFileRequest(args.file.fileSeq);
  const retrievedAt = new Date().toISOString();
  const body = await fetchBuffer(request, args.fetchPolicy);
  if (
    body.length < 4 ||
    body[0] !== 0x50 ||
    body[1] !== 0x4b ||
    ![0x03, 0x05, 0x07].includes(body[2] ?? -1)
  ) {
    throw new Error(
      `Official plenary attendance file ${args.file.fileSeq} is not an XLSX ZIP payload.`
    );
  }

  return writeSnapshotPayload({
    outputDir: args.outputDir,
    snapshotId: args.snapshotId,
    kind: "plenary_attendance_file",
    endpointCode: OFFICIAL_PLENARY_ATTENDANCE_INF_ID,
    relativePath: toPlenaryAttendanceFileRelativePath(args.file.fileSeq),
    sourceUrl: request.url,
    requestParams: request.params,
    retrievedAt,
    body,
    metadata: {
      fileSeq: String(args.file.fileSeq),
      fileName: args.file.viewFileNm,
      filePublishedAt: args.file.ftCrDttm,
      sessionNo: String(args.file.sessionNo)
    }
  });
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

  let expectedBillProposalRows: number | null = null;
  let fetchedBillProposalRows = 0;

  for (let page = 1; page <= MAX_GENERIC_PAGES; page += 1) {
    const result = await fetchAndStoreTarget({
      config,
      outputDir,
      snapshotId,
      fetchPolicy,
      target: {
        kind: "bill_proposals",
        endpointCode: endpointCodeFromPath(config.endpoints.billProposalsPath),
        path: config.endpoints.billProposalsPath,
        relativePath: `official/bill_proposals/page-${page}.xml`,
        params: {
          AGE: String(currentAssembly.assemblyNo),
          pIndex: page,
          pSize: config.pageSize
        },
        metadata: {
          assemblyNo: String(currentAssembly.assemblyNo),
          assemblyLabel: currentAssembly.label,
          page: String(page)
        }
      }
    });
    manifestEntries.push(result.entry);

    const rows = countXmlRows(result.body);
    fetchedBillProposalRows += rows;
    expectedBillProposalRows ??= parseListTotalCount(result.body);

    if (rows === 0) {
      break;
    }

    if (
      expectedBillProposalRows !== null &&
      fetchedBillProposalRows >= expectedBillProposalRows
    ) {
      break;
    }
  }

  let expectedCommitteeCareerRows: number | null = null;
  let fetchedCommitteeCareerRows = 0;
  for (let page = 1; page <= MAX_GENERIC_PAGES; page += 1) {
    const result = await fetchAndStoreCommitteeCareerSheet({
      config,
      outputDir,
      snapshotId,
      fetchPolicy,
      page,
      rows: config.pageSize
    });
    manifestEntries.push(result.entry);

    const parsed = JSON.parse(result.body) as {
      total?: number | string;
      data?: unknown[];
    };
    const rows = parsed.data?.length ?? 0;
    fetchedCommitteeCareerRows += rows;
    const publishedTotal = Number.parseInt(String(parsed.total ?? ""), 10);
    expectedCommitteeCareerRows ??= Number.isFinite(publishedTotal)
      ? publishedTotal
      : null;

    if (rows === 0) {
      break;
    }
    if (
      expectedCommitteeCareerRows !== null &&
      fetchedCommitteeCareerRows >= expectedCommitteeCareerRows
    ) {
      break;
    }
  }
  if (
    expectedCommitteeCareerRows === null ||
    fetchedCommitteeCareerRows < expectedCommitteeCareerRows
  ) {
    throw new Error(
      `Committee career paging incomplete. Expected ${expectedCommitteeCareerRows ?? "a published total"}, fetched ${fetchedCommitteeCareerRows}.`
    );
  }

  const assemblyStartDate = parsedMemberHistory
    .filter((record) => record.assemblyNo === currentAssembly.assemblyNo)
    .map((record) => record.startDate)
    .sort()[0];
  if (!assemblyStartDate) {
    throw new Error(
      `Failed to resolve the start date of assembly ${currentAssembly.assemblyNo}.`
    );
  }

  const attendanceFileListRequest = buildPlenaryAttendanceFileListRequest({
    rows: 500
  });
  const attendanceFileListPayload = await fetchText(
    attendanceFileListRequest,
    fetchPolicy
  );
  const publishedAttendanceFiles = parsePlenaryAttendanceFileList(
    attendanceFileListPayload
  );
  if (publishedAttendanceFiles.length >= 500) {
    throw new Error(
      "Official plenary attendance file list reached the requested row limit."
    );
  }
  const attendanceFiles = selectCurrentAssemblyAttendanceFiles({
    files: publishedAttendanceFiles,
    assemblyStartDate
  });
  if (attendanceFiles.length === 0) {
    throw new Error(
      `Official plenary attendance file service returned no XLSX files for assembly ${currentAssembly.assemblyNo}.`
    );
  }
  const attendanceFileEntries = await mapWithConcurrency(
    attendanceFiles,
    Math.min(2, config.billFeedConcurrency),
    (file) =>
      fetchAndStorePlenaryAttendanceFile({
        outputDir,
        snapshotId,
        fetchPolicy,
        file
      })
  );
  manifestEntries.push(...attendanceFileEntries);

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

  let expectedBillVoteSummaryRows: number | null = null;
  let fetchedBillVoteSummaryRows = 0;
  const billVoteSummaryRecords: ReturnType<typeof parseBillVoteSummaryXml> = [];

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
    billVoteSummaryRecords.push(...parseBillVoteSummaryXml(result.body));

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
  if (
    expectedBillVoteSummaryRows === null ||
    fetchedBillVoteSummaryRows < expectedBillVoteSummaryRows
  ) {
    throw new Error(
      `Bill vote summary paging incomplete. Expected ${expectedBillVoteSummaryRows ?? "a published total"}, fetched ${fetchedBillVoteSummaryRows}.`
    );
  }

  const billTargets: FetchTarget[] = [
    {
      kind: "plenary_bills_law",
      endpointCode: endpointCodeFromPath(config.endpoints.plenaryLawBillsPath),
      path: config.endpoints.plenaryLawBillsPath,
      relativePath: "official/plenary_bills_law",
      params: { AGE: String(currentAssembly.assemblyNo) }
    },
    {
      kind: "plenary_bills_budget",
      endpointCode: endpointCodeFromPath(
        config.endpoints.plenaryBudgetBillsPath
      ),
      path: config.endpoints.plenaryBudgetBillsPath,
      relativePath: "official/plenary_bills_budget",
      params: { AGE: String(currentAssembly.assemblyNo) }
    },
    {
      kind: "plenary_bills_settlement",
      endpointCode: endpointCodeFromPath(
        config.endpoints.plenarySettlementBillsPath
      ),
      path: config.endpoints.plenarySettlementBillsPath,
      relativePath: "official/plenary_bills_settlement",
      params: { AGE: String(currentAssembly.assemblyNo) }
    },
    {
      kind: "plenary_bills_other",
      endpointCode: endpointCodeFromPath(
        config.endpoints.plenaryOtherBillsPath
      ),
      path: config.endpoints.plenaryOtherBillsPath,
      relativePath: "official/plenary_bills_other",
      params: { AGE: String(currentAssembly.assemblyNo) }
    }
  ];

  const plenaryAgendaBillRefs: Array<{
    billNo: string;
    billId?: string;
  }> = [];
  const billResults = await mapWithConcurrency(
    billTargets,
    config.billFeedConcurrency,
    async (target) => {
      const results: Array<{
        body: string;
        entry: RawSnapshotEntry;
      }> = [];
      let expectedRows: number | null = null;
      let fetchedRows = 0;

      for (let page = 1; page <= MAX_GENERIC_PAGES; page += 1) {
        const result = await fetchAndStoreTarget({
          config,
          outputDir,
          snapshotId,
          fetchPolicy,
          target: {
            ...target,
            relativePath: `${target.relativePath}/page-${page}.xml`,
            params: {
              ...target.params,
              pIndex: page,
              pSize: config.pageSize
            },
            metadata: {
              ...target.metadata,
              page: String(page)
            }
          }
        });
        results.push(result);

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

      if (expectedRows === null || fetchedRows < expectedRows) {
        throw new Error(
          `${target.kind} paging incomplete. Expected ${expectedRows ?? "a published total"}, fetched ${fetchedRows}.`
        );
      }
      return results;
    }
  );

  for (const result of billResults.flat()) {
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

      plenaryAgendaBillRefs.push({
        billNo,
        ...(agenda.billId ? { billId: agenda.billId } : {})
      });
    }
  }

  const verifiedBillRefs = selectRecordedVoteBillRefs({
    summaries: billVoteSummaryRecords,
    agendas: plenaryAgendaBillRefs
  });
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

      const { body, entry } = await fetchAndStoreVoteTarget({
        config,
        outputDir,
        snapshotId,
        fetchPolicy,
        target
      });
      const expectedRows = parseListTotalCount(body);
      const fetchedRows = countXmlRows(body);
      if (expectedRows === null || fetchedRows < expectedRows) {
        throw new Error(
          `vote_detail ${billId} incomplete. Expected ${expectedRows ?? "a published total"}, fetched ${fetchedRows}.`
        );
      }
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
      const namedParticipantCount = parsedVote.voteFacts.filter((fact) =>
        ["yes", "no", "abstain", "invalid"].includes(fact.voteCode)
      ).length;

      return {
        billNo,
        billId,
        entry,
        namedParticipantCount
      };
    }
  );
  manifestEntries.push(...voteResults.map((result) => result.entry));

  const officialTallyByBillId = new Map(
    billVoteSummaryRecords.map((record) => [
      record.billId,
      record.officialTally
    ])
  );
  const supplementalVoteTargets = voteResults.filter((result) => {
    const tally = officialTallyByBillId.get(result.billId);
    return !tally || result.namedParticipantCount !== tally.presentCount;
  });
  const supplementalVoteResults = await mapWithConcurrency(
    supplementalVoteTargets,
    Math.min(2, config.voteDetailConcurrency),
    async ({ billId, billNo }) => {
      const result = await fetchAndStoreLikmsVoteMemberList({
        outputDir,
        snapshotId,
        fetchPolicy,
        billId,
        billNo
      });
      const info = parseLikmsVoteInfoHtml(result.body);
      if (info.billId !== billId) {
        throw new Error(
          `Official LIKMS member list returned ${info.billId} for requested bill ${billId}.`
        );
      }
      const tally = officialTallyByBillId.get(billId);
      if (
        tally &&
        (info.registeredCount !== tally.registeredCount ||
          info.yesCount !== tally.yesCount ||
          info.noCount !== tally.noCount ||
          info.abstainCount !== tally.abstainCount ||
          info.presentCount !== tally.presentCount)
      ) {
        throw new Error(
          `Official LIKMS member list ${billId} does not match the official tally.`
        );
      }
      if (!tally && info.presentCount === 0) {
        throw new Error(
          `Official LIKMS member list ${billId} returned no named votes.`
        );
      }

      return result;
    }
  );
  manifestEntries.push(
    ...supplementalVoteResults.map((result) => result.entry)
  );

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
