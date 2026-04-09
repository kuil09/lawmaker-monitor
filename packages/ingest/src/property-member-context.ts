import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basename, join, resolve } from "node:path";

import type { MemberRecord } from "@lawmaker-monitor/schemas";

import {
  buildAssemblyRequest,
  resolveAssemblyApiConfig,
  type AssemblyApiConfig
} from "./assembly-api.js";
import {
  findItems,
  normalizeAssemblyLabel
} from "./parsers/helpers.js";
import {
  parseMemberHistoryRows,
  parseMemberInfoRows
} from "./parsers/members.js";
import type { MemberTenureRecord } from "./parsers/types.js";
import {
  assertCurrentMembersHaveTenure,
  buildMemberTenureIndex,
  type MemberTenureIndex
} from "./tenure.js";
import {
  fetchTextWithTimeout,
  readString,
  resolvePathFromRoot,
  retryFetch,
  sha256,
  writeJsonFile
} from "./utils.js";

export type PropertyMemberContextManifestSource = {
  sourceUrl: string;
  requestParams: Record<string, string>;
  checksumSha256: string;
  retrievedAt: string;
};

export type PropertyMemberContextManifest = {
  retrievedAt: string;
  assemblyNo: number;
  assemblyLabel: string;
  memberInfoPath: string;
  memberHistoryPath: string;
  memberInfo: PropertyMemberContextManifestSource;
  memberHistory: PropertyMemberContextManifestSource;
};

export type PropertyMemberContext = {
  manifest: PropertyMemberContextManifest;
  currentMembers: MemberRecord[];
  tenures: MemberTenureRecord[];
  tenureIndex: MemberTenureIndex;
};

type SyncPropertyMemberContextOptions = {
  repositoryRoot?: string;
  env?: NodeJS.ProcessEnv;
};

type JsonFetchResult = {
  body: string;
  payload: unknown;
  requestUrl: string;
  requestParams: Record<string, string>;
  retrievedAt: string;
};

const DEFAULT_PROPERTY_MEMBER_INFO_PATH =
  "raw/official/property_member_context/member_info.json";
const DEFAULT_PROPERTY_MEMBER_HISTORY_PATH =
  "raw/official/property_member_context/member_history.json";
const DEFAULT_PROPERTY_MEMBER_CONTEXT_MANIFEST_PATH =
  "manifests/assembly_property_member_context.json";
const FETCH_RETRY_BACKOFF_MS = 750;
const MAX_PROPERTY_MEMBER_CONTEXT_PAGES = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parsePositiveInt(value: unknown): number | null {
  const text = readString(value);
  if (!text) {
    return null;
  }

  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function sanitizeAssemblyRequestParams(
  config: AssemblyApiConfig,
  params: Record<string, string>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params).filter(([key]) => key !== config.apiKeyParamName)
  );
}

function sanitizeAssemblyRequestUrl(config: AssemblyApiConfig, requestUrl: string): string {
  const url = new URL(requestUrl);
  url.searchParams.delete(config.apiKeyParamName);
  return url.toString();
}

function getEndpointCodeFromSourceUrl(value: string): string {
  try {
    return basename(new URL(value).pathname);
  } catch {
    return basename(value);
  }
}

function extractOfficialJsonEnvelope(payload: unknown, endpointCode: string): unknown {
  if (!isRecord(payload)) {
    throw new Error(`Property member context payload for ${endpointCode} must be a JSON object.`);
  }

  const envelope = payload[endpointCode];
  if (envelope === undefined) {
    throw new Error(
      `Property member context payload is missing the official ${endpointCode} envelope.`
    );
  }

  return envelope;
}

function findListTotalCount(value: unknown): number | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findListTotalCount(item);
      if (nested !== null) {
        return nested;
      }
    }

    return null;
  }

  if (!isRecord(value)) {
    return parsePositiveInt(value);
  }

  if ("list_total_count" in value) {
    const direct = parsePositiveInt(value.list_total_count);
    if (direct !== null) {
      return direct;
    }
  }

  for (const nested of Object.values(value)) {
    const found = findListTotalCount(nested);
    if (found !== null) {
      return found;
    }
  }

  return null;
}

function replaceRowCollection(
  container: unknown,
  rows: Record<string, unknown>[],
  allowAppend = false
): unknown {
  if (Array.isArray(container)) {
    let replaced = false;
    const next = container.map((item) => {
      if (isRecord(item) && "row" in item) {
        replaced = true;
        return {
          ...item,
          row: rows
        };
      }

      return replaceRowCollection(item, rows, false);
    });

    return replaced || !allowAppend ? next : [...next, { row: rows }];
  }

  if (!isRecord(container)) {
    return container;
  }

  if ("row" in container) {
    return {
      ...container,
      row: rows
    };
  }

  return Object.fromEntries(
    Object.entries(container).map(([key, value]) => [
      key,
      replaceRowCollection(value, rows, false)
    ])
  );
}

function replaceListTotalCount(container: unknown, totalCount: number): unknown {
  if (Array.isArray(container)) {
    return container.map((item) => replaceListTotalCount(item, totalCount));
  }

  if (!isRecord(container)) {
    return container;
  }

  const entries = Object.entries(container).map(([key, value]) => {
    if (key === "list_total_count") {
      return [key, String(totalCount)] as const;
    }

    return [key, replaceListTotalCount(value, totalCount)] as const;
  });

  return Object.fromEntries(entries);
}

function buildCombinedOfficialPayload(args: {
  endpointCode: string;
  firstPayload: unknown;
  rows: Record<string, unknown>[];
  totalCount: number;
}): unknown {
  if (!isRecord(args.firstPayload)) {
    throw new Error(`Property member context payload for ${args.endpointCode} must be a JSON object.`);
  }

  const cloned = JSON.parse(JSON.stringify(args.firstPayload)) as Record<string, unknown>;
  const envelope = cloned[args.endpointCode];
  if (envelope === undefined) {
    throw new Error(
      `Property member context payload is missing the official ${args.endpointCode} envelope.`
    );
  }

  cloned[args.endpointCode] = replaceListTotalCount(
    replaceRowCollection(envelope, args.rows, true),
    args.totalCount
  );
  return cloned;
}

export function extractOfficialOpenApiJsonRows(
  payload: unknown,
  endpointCode: string
): Record<string, unknown>[] {
  const rows = findItems(extractOfficialJsonEnvelope(payload, endpointCode));
  if (rows.length === 0) {
    throw new Error(`Property member context payload for ${endpointCode} has no row items.`);
  }

  return rows;
}

export function extractOfficialOpenApiJsonListTotalCount(
  payload: unknown,
  endpointCode: string
): number | null {
  return findListTotalCount(extractOfficialJsonEnvelope(payload, endpointCode));
}

function parsePropertyMemberContextManifest(payload: unknown): PropertyMemberContextManifest {
  if (!isRecord(payload)) {
    throw new Error("Property member context manifest must be a JSON object.");
  }

  const retrievedAt = readString(payload.retrievedAt);
  const assemblyNo = parsePositiveInt(payload.assemblyNo);
  const assemblyLabel = readString(payload.assemblyLabel);
  const memberInfoPath = readString(payload.memberInfoPath);
  const memberHistoryPath = readString(payload.memberHistoryPath);

  if (!retrievedAt || !assemblyNo || !assemblyLabel || !memberInfoPath || !memberHistoryPath) {
    throw new Error("Property member context manifest is missing required fields.");
  }

  const parseSource = (source: unknown, label: string): PropertyMemberContextManifestSource => {
    if (!isRecord(source)) {
      throw new Error(`Property member context manifest ${label} source must be an object.`);
    }

    const sourceUrl = readString(source.sourceUrl);
    const checksumSha256 = readString(source.checksumSha256);
    const sourceRetrievedAt = readString(source.retrievedAt);
    const requestParamsRaw = source.requestParams;

    if (!sourceUrl || !checksumSha256 || !sourceRetrievedAt || !isRecord(requestParamsRaw)) {
      throw new Error(`Property member context manifest ${label} source is missing required fields.`);
    }

    const requestParams = Object.fromEntries(
      Object.entries(requestParamsRaw)
        .map(([key, value]) => [key, readString(value)] as const)
        .filter((entry): entry is [string, string] => Boolean(entry[1]))
    );

    return {
      sourceUrl,
      checksumSha256,
      retrievedAt: sourceRetrievedAt,
      requestParams
    };
  };

  return {
    retrievedAt,
    assemblyNo,
    assemblyLabel,
    memberInfoPath,
    memberHistoryPath,
    memberInfo: parseSource(payload.memberInfo, "memberInfo"),
    memberHistory: parseSource(payload.memberHistory, "memberHistory")
  };
}

async function readJsonFileStrict(path: string): Promise<unknown> {
  const content = await readFile(path, "utf8");

  try {
    return JSON.parse(content) as unknown;
  } catch (error) {
    throw new Error(
      `Failed to parse JSON from ${path}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function fetchOfficialJsonPage(args: {
  config: AssemblyApiConfig;
  path: string;
  params?: Record<string, string | number | undefined>;
}): Promise<JsonFetchResult> {
  const request = buildAssemblyRequest(args.config, args.path, args.params);
  const retrievedAt = new Date().toISOString();
  const body = await retryFetch(
    async () =>
      fetchTextWithTimeout(
        request.url,
        {
          headers: request.headers
        },
        args.config.fetchTimeoutMs
      ),
    {
      retries: args.config.fetchRetries,
      backoffMs: FETCH_RETRY_BACKOFF_MS
    }
  );

  try {
    return {
      body,
      payload: JSON.parse(body) as unknown,
      requestUrl: sanitizeAssemblyRequestUrl(args.config, request.url),
      requestParams: sanitizeAssemblyRequestParams(args.config, request.params),
      retrievedAt
    };
  } catch (error) {
    throw new Error(
      `Failed to parse official JSON response from ${request.url}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function fetchOfficialJsonCacheFile(args: {
  config: AssemblyApiConfig;
  path: string;
  endpointCode: string;
  relativePath: string;
  dataRepoDir: string;
}): Promise<{
  relativePath: string;
  payload: unknown;
  sourceUrl: string;
  requestParams: Record<string, string>;
  retrievedAt: string;
  checksumSha256: string;
}> {
  const rows: Record<string, unknown>[] = [];
  let firstPayload: unknown | null = null;
  let sourceUrl = "";
  let requestParams: Record<string, string> = {};
  let retrievedAt = "";
  let expectedTotalCount: number | null = null;

  for (let page = 1; page <= MAX_PROPERTY_MEMBER_CONTEXT_PAGES; page += 1) {
    const result = await fetchOfficialJsonPage({
      config: args.config,
      path: args.path,
      params: {
        pIndex: page,
        pSize: args.config.pageSize
      }
    });
    const pageRows = extractOfficialOpenApiJsonRows(result.payload, args.endpointCode);

    if (!firstPayload) {
      firstPayload = result.payload;
      sourceUrl = result.requestUrl;
      requestParams = result.requestParams;
      retrievedAt = result.retrievedAt;
      expectedTotalCount =
        extractOfficialOpenApiJsonListTotalCount(result.payload, args.endpointCode) ??
        pageRows.length;
    }

    rows.push(...pageRows);

    if (expectedTotalCount !== null && rows.length >= expectedTotalCount) {
      break;
    }

    if (pageRows.length < args.config.pageSize) {
      break;
    }
  }

  if (!firstPayload) {
    throw new Error(`Failed to fetch any JSON payloads for ${args.endpointCode}.`);
  }

  const totalCount = expectedTotalCount ?? rows.length;
  const payload = buildCombinedOfficialPayload({
    endpointCode: args.endpointCode,
    firstPayload,
    rows,
    totalCount
  });
  const serialized = JSON.stringify(payload, null, 2);
  const absolutePath = resolve(args.dataRepoDir, args.relativePath);

  await writeJsonFile(absolutePath, payload);

  return {
    relativePath: args.relativePath,
    payload,
    sourceUrl,
    requestParams,
    retrievedAt,
    checksumSha256: sha256(serialized)
  };
}

export async function loadPropertyMemberContext(args: {
  dataRepoDir: string;
  assemblyNo: number;
  manifestPath?: string;
}): Promise<PropertyMemberContext> {
  const manifestPath =
    args.manifestPath ?? DEFAULT_PROPERTY_MEMBER_CONTEXT_MANIFEST_PATH;
  const manifestAbsolutePath = resolve(args.dataRepoDir, manifestPath);
  let manifestPayload: unknown;

  try {
    manifestPayload = await readJsonFileStrict(manifestAbsolutePath);
  } catch (error) {
    throw new Error(
      `Property member context manifest could not be read from ${manifestAbsolutePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const manifest = parsePropertyMemberContextManifest(manifestPayload);

  if (manifest.assemblyNo !== args.assemblyNo) {
    throw new Error(
      `Property member context assembly mismatch: expected ${args.assemblyNo}, got ${manifest.assemblyNo}.`
    );
  }

  const memberInfoAbsolutePath = resolve(args.dataRepoDir, manifest.memberInfoPath);
  const memberHistoryAbsolutePath = resolve(args.dataRepoDir, manifest.memberHistoryPath);
  const [memberInfoPayload, memberHistoryPayload] = await Promise.all([
    readJsonFileStrict(memberInfoAbsolutePath).catch((error) => {
      throw new Error(
        `Property member context member_info payload could not be read from ${memberInfoAbsolutePath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }),
    readJsonFileStrict(memberHistoryAbsolutePath).catch((error) => {
      throw new Error(
        `Property member context member_history payload could not be read from ${memberHistoryAbsolutePath}: ${error instanceof Error ? error.message : String(error)}`
      );
    })
  ]);

  const memberInfoEndpointCode = getEndpointCodeFromSourceUrl(manifest.memberInfo.sourceUrl);
  const memberHistoryEndpointCode = getEndpointCodeFromSourceUrl(manifest.memberHistory.sourceUrl);
  const memberInfoRows = extractOfficialOpenApiJsonRows(memberInfoPayload, memberInfoEndpointCode);
  const memberHistoryRows = extractOfficialOpenApiJsonRows(
    memberHistoryPayload,
    memberHistoryEndpointCode
  );

  const parsedMemberInfo = parseMemberInfoRows(memberInfoRows);
  const payloadAssemblyNo = parsedMemberInfo.currentAssembly?.assemblyNo ?? null;
  if (payloadAssemblyNo !== null && payloadAssemblyNo !== manifest.assemblyNo) {
    throw new Error(
      `Property member context roster assembly mismatch: expected ${manifest.assemblyNo}, got ${payloadAssemblyNo}.`
    );
  }

  const currentMembers = parsedMemberInfo.members.filter(
    (member) => member.assemblyNo === args.assemblyNo && member.isCurrentMember
  );
  if (currentMembers.length === 0) {
    throw new Error("Property member context did not produce any current members.");
  }

  const tenures = parseMemberHistoryRows(memberHistoryRows).filter(
    (record) => record.assemblyNo === args.assemblyNo
  );
  const tenureIndex = buildMemberTenureIndex({
    members: currentMembers,
    tenures,
    assemblyNo: args.assemblyNo
  });

  assertCurrentMembersHaveTenure({
    members: currentMembers,
    assemblyNo: args.assemblyNo,
    tenureIndex
  });

  return {
    manifest,
    currentMembers,
    tenures,
    tenureIndex
  };
}

export async function syncPropertyMemberContextCache(
  options: SyncPropertyMemberContextOptions = {}
): Promise<PropertyMemberContextManifest> {
  const repositoryRoot =
    options.repositoryRoot ??
    resolve(fileURLToPath(new URL("../../../", import.meta.url)));
  const env = options.env ?? process.env;
  const dataRepoDir = resolvePathFromRoot(
    repositoryRoot,
    env.DATA_REPO_DIR ?? join(repositoryRoot, "published-data")
  );
  const manifestPath =
    env.PROPERTY_MEMBER_CONTEXT_MANIFEST_PATH ??
    DEFAULT_PROPERTY_MEMBER_CONTEXT_MANIFEST_PATH;
  const memberInfoPath =
    env.PROPERTY_MEMBER_INFO_PATH ?? DEFAULT_PROPERTY_MEMBER_INFO_PATH;
  const memberHistoryPath =
    env.PROPERTY_MEMBER_HISTORY_PATH ?? DEFAULT_PROPERTY_MEMBER_HISTORY_PATH;
  const config: AssemblyApiConfig = {
    ...resolveAssemblyApiConfig(env),
    responseType: "json"
  };

  const memberInfoFile = await fetchOfficialJsonCacheFile({
    config,
    path: config.endpoints.memberInfoPath,
    endpointCode: getEndpointCodeFromSourceUrl(config.endpoints.memberInfoPath),
    relativePath: memberInfoPath,
    dataRepoDir
  });
  const memberHistoryFile = await fetchOfficialJsonCacheFile({
    config,
    path: config.endpoints.memberHistoryPath,
    endpointCode: getEndpointCodeFromSourceUrl(config.endpoints.memberHistoryPath),
    relativePath: memberHistoryPath,
    dataRepoDir
  });

  const assemblyNo =
    parseMemberInfoRows(
      extractOfficialOpenApiJsonRows(
        memberInfoFile.payload,
        getEndpointCodeFromSourceUrl(memberInfoFile.sourceUrl)
      )
    ).currentAssembly?.assemblyNo ?? 0;
  if (assemblyNo <= 0) {
    throw new Error("Property member context sync could not resolve the current assembly.");
  }

  const manifest: PropertyMemberContextManifest = {
    retrievedAt: new Date().toISOString(),
    assemblyNo,
    assemblyLabel: normalizeAssemblyLabel(`제${assemblyNo}대`),
    memberInfoPath: memberInfoFile.relativePath,
    memberHistoryPath: memberHistoryFile.relativePath,
    memberInfo: {
      sourceUrl: memberInfoFile.sourceUrl,
      requestParams: memberInfoFile.requestParams,
      checksumSha256: memberInfoFile.checksumSha256,
      retrievedAt: memberInfoFile.retrievedAt
    },
    memberHistory: {
      sourceUrl: memberHistoryFile.sourceUrl,
      requestParams: memberHistoryFile.requestParams,
      checksumSha256: memberHistoryFile.checksumSha256,
      retrievedAt: memberHistoryFile.retrievedAt
    }
  };

  await writeJsonFile(resolve(dataRepoDir, manifestPath), manifest);

  return manifest;
}

export {
  DEFAULT_PROPERTY_MEMBER_CONTEXT_MANIFEST_PATH,
  DEFAULT_PROPERTY_MEMBER_HISTORY_PATH,
  DEFAULT_PROPERTY_MEMBER_INFO_PATH
};
