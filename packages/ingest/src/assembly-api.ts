import { getOfficialAssemblyEndpointPaths } from "./assembly-source-registry.js";
import { readString } from "./utils.js";

export type AssemblyEndpointConfig = {
  memberInfoPath: string;
  memberProfileAllPath: string;
  memberHistoryPath: string;
  committeeOverviewPath: string;
  committeeRosterPath: string;
  billVoteSummaryPath: string;
  billProposalsPath: string;
  votesPath: string;
  plenarySchedulePath: string;
  plenaryLawBillsPath: string;
  plenaryBudgetBillsPath: string;
  plenarySettlementBillsPath: string;
  plenaryOtherBillsPath: string;
  plenaryMinutesPath: string;
  livePath: string;
};

export type AssemblyApiConfig = {
  apiBaseUrl: string;
  apiKey?: string;
  apiKeyParamName: string;
  responseType: string;
  pageIndex: number;
  pageSize: number;
  billFeedConcurrency: number;
  voteDetailConcurrency: number;
  billVoteSummaryConcurrency: number;
  fetchTimeoutMs: number;
  fetchRetries: number;
  endpoints: AssemblyEndpointConfig;
};

export type AssemblyRequest = {
  url: string;
  headers: HeadersInit;
  params: Record<string, string>;
};

export type OfficialPostRequest = AssemblyRequest & {
  method: "POST";
  body: string;
};

const DEFAULT_BASE_URL = "https://open.assembly.go.kr";
export const OFFICIAL_COMMITTEE_CAREER_SHEET_URL =
  "https://open.assembly.go.kr/portal/data/sheet/searchSheetData.do";
export const OFFICIAL_COMMITTEE_CAREER_SERVICE_URL =
  "https://open.assembly.go.kr/portal/data/service/selectServicePage.do?infId=ORNDP7000993P115502";
export const OFFICIAL_COMMITTEE_CAREER_INF_ID = "ORNDP7000993P115502";
export const OFFICIAL_LIKMS_VOTE_INFO_URL =
  "https://likms.assembly.go.kr/bill/bi/bill/detail/voteInfo.do";
export const OFFICIAL_PLENARY_ATTENDANCE_INF_ID = "O4Q5B50011905O18367";
export const OFFICIAL_PLENARY_ATTENDANCE_FILE_LIST_URL =
  "https://open.assembly.go.kr/portal/data/file/searchFileData.do";
export const OFFICIAL_PLENARY_ATTENDANCE_FILE_DOWNLOAD_URL =
  "https://open.assembly.go.kr/portal/data/file/downloadFileData.do";
export const OFFICIAL_PLENARY_ATTENDANCE_SERVICE_URL =
  "https://open.assembly.go.kr/portal/data/service/selectServicePage.do/O4Q5B50011905O18367";
const DEFAULT_API_KEY_PARAM_NAME = "KEY";
const DEFAULT_RESPONSE_TYPE = "xml";
const DEFAULT_PAGE_INDEX = 1;
const DEFAULT_PAGE_SIZE = 1000;
const DEFAULT_BILL_FEED_CONCURRENCY = 4;
const DEFAULT_VOTE_DETAIL_CONCURRENCY = 6;
const DEFAULT_BILL_VOTE_SUMMARY_CONCURRENCY = 4;
const DEFAULT_FETCH_TIMEOUT_MS = 20_000;
const DEFAULT_FETCH_RETRIES = 2;
const DEFAULT_OFFICIAL_ENDPOINT_PATHS = getOfficialAssemblyEndpointPaths();

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toRecord(
  value: Record<string, string | number | undefined>
): Record<string, string> {
  const entries = Object.entries(value)
    .map(([key, item]) => [key, readString(item)] as const)
    .filter((entry): entry is [string, string] => entry[1] !== undefined);

  return Object.fromEntries(entries);
}

export function resolveAssemblyApiConfig(
  env: NodeJS.ProcessEnv = process.env
): AssemblyApiConfig {
  return {
    apiBaseUrl: DEFAULT_BASE_URL,
    apiKey: readString(env.ASSEMBLY_API_KEY),
    apiKeyParamName: DEFAULT_API_KEY_PARAM_NAME,
    responseType: DEFAULT_RESPONSE_TYPE,
    pageIndex: DEFAULT_PAGE_INDEX,
    pageSize: readPositiveInt(env.ASSEMBLY_PAGE_SIZE, DEFAULT_PAGE_SIZE),
    billFeedConcurrency: readPositiveInt(
      env.ASSEMBLY_BILL_FEED_CONCURRENCY,
      DEFAULT_BILL_FEED_CONCURRENCY
    ),
    voteDetailConcurrency: readPositiveInt(
      env.ASSEMBLY_VOTE_DETAIL_CONCURRENCY,
      DEFAULT_VOTE_DETAIL_CONCURRENCY
    ),
    billVoteSummaryConcurrency: readPositiveInt(
      env.ASSEMBLY_BILL_VOTE_SUMMARY_CONCURRENCY,
      DEFAULT_BILL_VOTE_SUMMARY_CONCURRENCY
    ),
    fetchTimeoutMs: readPositiveInt(
      env.ASSEMBLY_FETCH_TIMEOUT_MS,
      DEFAULT_FETCH_TIMEOUT_MS
    ),
    fetchRetries: readPositiveInt(
      env.ASSEMBLY_FETCH_RETRIES,
      DEFAULT_FETCH_RETRIES
    ),
    endpoints: {
      memberInfoPath: DEFAULT_OFFICIAL_ENDPOINT_PATHS.memberInfo,
      memberProfileAllPath: DEFAULT_OFFICIAL_ENDPOINT_PATHS.memberProfileAll,
      memberHistoryPath: DEFAULT_OFFICIAL_ENDPOINT_PATHS.memberHistory,
      committeeOverviewPath: DEFAULT_OFFICIAL_ENDPOINT_PATHS.committeeOverview,
      committeeRosterPath: DEFAULT_OFFICIAL_ENDPOINT_PATHS.committeeRoster,
      billVoteSummaryPath: DEFAULT_OFFICIAL_ENDPOINT_PATHS.billVoteSummary,
      billProposalsPath: DEFAULT_OFFICIAL_ENDPOINT_PATHS.billProposals,
      votesPath: DEFAULT_OFFICIAL_ENDPOINT_PATHS.votes,
      plenarySchedulePath: DEFAULT_OFFICIAL_ENDPOINT_PATHS.plenarySchedule,
      plenaryLawBillsPath: DEFAULT_OFFICIAL_ENDPOINT_PATHS.plenaryBillsLaw,
      plenaryBudgetBillsPath:
        DEFAULT_OFFICIAL_ENDPOINT_PATHS.plenaryBillsBudget,
      plenarySettlementBillsPath:
        DEFAULT_OFFICIAL_ENDPOINT_PATHS.plenaryBillsSettlement,
      plenaryOtherBillsPath: DEFAULT_OFFICIAL_ENDPOINT_PATHS.plenaryBillsOther,
      plenaryMinutesPath: DEFAULT_OFFICIAL_ENDPOINT_PATHS.plenaryMinutes,
      livePath: DEFAULT_OFFICIAL_ENDPOINT_PATHS.liveWebcast
    }
  };
}

export function buildAssemblyRequest(
  config: AssemblyApiConfig,
  path: string,
  params: Record<string, string | number | undefined> = {}
): AssemblyRequest {
  const url = new URL(path, `${config.apiBaseUrl}/`);
  const headers: HeadersInit = {};
  const query = toRecord({
    [config.apiKeyParamName]: config.apiKey,
    Type: config.responseType,
    pIndex: config.pageIndex,
    pSize: config.pageSize,
    ...params
  });

  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }

  return {
    url: url.toString(),
    headers,
    params: query
  };
}

export function buildVoteDetailRequest(
  config: AssemblyApiConfig,
  params: {
    assemblyNo: string;
    billId: string;
    page?: number;
    rows?: number;
  }
): AssemblyRequest {
  return buildAssemblyRequest(config, config.endpoints.votesPath, {
    AGE: params.assemblyNo,
    BILL_ID: params.billId,
    pIndex: params.page ?? config.pageIndex,
    pSize: params.rows ?? config.pageSize
  });
}

export function buildCommitteeCareerSheetRequest(
  params: {
    page?: number;
    rows?: number;
  } = {}
): OfficialPostRequest {
  const page = params.page ?? 1;
  const rows = params.rows ?? 1000;
  const requestParams = {
    page: String(page),
    rows: String(rows),
    infId: OFFICIAL_COMMITTEE_CAREER_INF_ID,
    infSeq: "1",
    HG_NM: "",
    PROFILE_SJ: ""
  };
  const url = new URL(OFFICIAL_COMMITTEE_CAREER_SHEET_URL);
  url.searchParams.set("page", String(page));

  return {
    url: url.toString(),
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest",
      referer: OFFICIAL_COMMITTEE_CAREER_SERVICE_URL
    },
    method: "POST",
    body: new URLSearchParams(
      Object.fromEntries(
        Object.entries(requestParams).filter(([key]) => key !== "page")
      )
    ).toString(),
    params: requestParams
  };
}

export function buildLikmsVoteMemberListRequest(
  billId: string
): OfficialPostRequest {
  const billPageUrl = new URL(
    "/bill/bi/billDetailPage.do",
    OFFICIAL_LIKMS_VOTE_INFO_URL
  );
  billPageUrl.searchParams.set("billId", billId);
  billPageUrl.searchParams.set("currMenuNo", "2600044");

  return {
    url: OFFICIAL_LIKMS_VOTE_INFO_URL,
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest",
      referer: billPageUrl.toString(),
      "user-agent":
        "Mozilla/5.0 (compatible; LawmakerMonitor/1.0; +https://github.com/kuil09/lawmaker-monitor)"
    },
    method: "POST",
    body: new URLSearchParams({ billId }).toString(),
    params: { billId }
  };
}

export function buildPlenaryAttendanceFileListRequest(
  params: {
    page?: number;
    rows?: number;
  } = {}
): OfficialPostRequest {
  const requestParams = {
    infId: OFFICIAL_PLENARY_ATTENDANCE_INF_ID,
    infSeq: "1",
    page: String(params.page ?? 1),
    rows: String(params.rows ?? 500)
  };

  return {
    url: OFFICIAL_PLENARY_ATTENDANCE_FILE_LIST_URL,
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest",
      referer: OFFICIAL_PLENARY_ATTENDANCE_SERVICE_URL,
      "user-agent":
        "Mozilla/5.0 (compatible; LawmakerMonitor/1.0; +https://github.com/kuil09/lawmaker-monitor)"
    },
    method: "POST",
    body: new URLSearchParams(requestParams).toString(),
    params: requestParams
  };
}

export function buildPlenaryAttendanceFileRequest(
  fileSeq: number
): AssemblyRequest {
  if (!Number.isSafeInteger(fileSeq) || fileSeq <= 0) {
    throw new Error(`Invalid official plenary attendance fileSeq: ${fileSeq}.`);
  }

  const requestParams = {
    infId: OFFICIAL_PLENARY_ATTENDANCE_INF_ID,
    infSeq: "1",
    fileSeq: String(fileSeq)
  };
  const url = new URL(OFFICIAL_PLENARY_ATTENDANCE_FILE_DOWNLOAD_URL);
  for (const [key, value] of Object.entries(requestParams)) {
    url.searchParams.set(key, value);
  }

  return {
    url: url.toString(),
    headers: {
      referer: OFFICIAL_PLENARY_ATTENDANCE_SERVICE_URL,
      "user-agent":
        "Mozilla/5.0 (compatible; LawmakerMonitor/1.0; +https://github.com/kuil09/lawmaker-monitor)"
    },
    params: requestParams
  };
}

export function buildMemberHistoryRequest(
  config: AssemblyApiConfig,
  params: {
    page?: number;
    rows?: number;
    monaCd?: string;
  } = {}
): AssemblyRequest {
  return buildAssemblyRequest(config, config.endpoints.memberHistoryPath, {
    pIndex: params.page ?? config.pageIndex,
    pSize: params.rows ?? config.pageSize,
    MONA_CD: params.monaCd
  });
}

export function buildBillVoteSummaryRequest(
  config: AssemblyApiConfig,
  params: {
    assemblyNo: string;
    page?: number;
    rows?: number;
    lawBillNoQuery?: string;
  }
): AssemblyRequest {
  return buildAssemblyRequest(config, config.endpoints.billVoteSummaryPath, {
    AGE: params.assemblyNo,
    pIndex: params.page ?? config.pageIndex,
    pSize: params.rows ?? config.pageSize,
    // The OpenAPI requires LAW_BILL_NO to be present. In practice, using the
    // current assembly prefix returns the assembly-wide tally feed.
    LAW_BILL_NO: params.lawBillNoQuery ?? params.assemblyNo
  });
}
