import { getOfficialAssemblyEndpointPaths } from "./assembly-source-registry.js";
import { readString } from "./utils.js";

export type AssemblyEndpointConfig = {
  memberInfoPath: string;
  memberProfileAllPath: string;
  memberHistoryPath: string;
  committeeOverviewPath: string;
  committeeRosterPath: string;
  billVoteSummaryPath: string;
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

const DEFAULT_BASE_URL = "https://open.assembly.go.kr";
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
  }
): AssemblyRequest {
  return buildAssemblyRequest(config, config.endpoints.votesPath, {
    AGE: params.assemblyNo,
    BILL_ID: params.billId
  });
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
