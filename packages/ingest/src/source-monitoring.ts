import {
  buildAssemblyRequest,
  resolveAssemblyApiConfig
} from "./assembly-api.js";
import { parseMemberInfoXml } from "./parsers.js";
import { officialRequestRetryOptions } from "./request-policy.js";
import { fetchTextWithTimeout, retryFetch } from "./utils.js";

export function assertFreshTimestamp(
  value: string,
  label: string,
  maxAgeHours: number,
  now = new Date()
): void {
  const age = now.getTime() - Date.parse(value);
  if (
    !Number.isFinite(age) ||
    age < -3_600_000 ||
    age > maxAgeHours * 3_600_000
  ) {
    throw new Error(
      `${label} is missing, invalid, or older than ${maxAgeHours} hours.`
    );
  }
}

export function assertMinutesSummaryProgress(
  state: {
    updatedAt: string;
    remainingDocuments?: number;
    lastProgressAt?: string | null;
  },
  now = new Date()
): void {
  if ((state.remainingDocuments ?? 0) > 0) {
    assertFreshTimestamp(
      state.lastProgressAt ?? state.updatedAt,
      "Pending minutes summary progress",
      48,
      now
    );
  }
}

export function assertMinutesAnalysisProgress(
  summaryGeneratedAt: string,
  analysisGeneratedAt: string,
  now = new Date()
): void {
  if (
    !Number.isFinite(Date.parse(summaryGeneratedAt)) ||
    !Number.isFinite(Date.parse(analysisGeneratedAt))
  )
    throw new Error("Invalid minutes publication timestamp.");
  if (Date.parse(summaryGeneratedAt) > Date.parse(analysisGeneratedAt))
    assertFreshTimestamp(
      analysisGeneratedAt,
      "Deferred minutes analysis refresh",
      24,
      now
    );
}

export async function probeLiveAssemblyMembers(
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  const config = resolveAssemblyApiConfig(env);
  if (!config.apiKey)
    throw new Error("Live source monitoring requires ASSEMBLY_API_KEY.");
  const request = buildAssemblyRequest(
    config,
    config.endpoints.memberInfoPath,
    { pSize: 1 }
  );
  const xml = await retryFetch(
    () =>
      fetchTextWithTimeout(
        request.url,
        { headers: request.headers },
        config.fetchTimeoutMs
      ),
    officialRequestRetryOptions(request.url, config.fetchRetries, 750)
  );
  const count = parseMemberInfoXml(xml).members.length;
  if (count === 0)
    throw new Error(
      "The live official member response contains no parseable members."
    );
  return count;
}
