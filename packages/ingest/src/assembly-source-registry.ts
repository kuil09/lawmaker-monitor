import { readFileSync } from "node:fs";

import type { RawSnapshotEntry, RawSnapshotManifest } from "./raw-snapshot.js";

export type CanonicalAssemblyEndpointKey =
  | "memberInfo"
  | "memberHistory"
  | "memberCommitteeCareer"
  | "votes"
  | "memberStandingCommitteeActivity"
  | "committeeOverview"
  | "committeeRoster"
  | "billVoteSummary";

export type PendingAssemblyEndpointKey =
  | "memberProfileAll"
  | "plenarySchedule"
  | "plenaryBillsLaw"
  | "plenaryBillsBudget"
  | "plenaryBillsSettlement"
  | "plenaryBillsOther"
  | "plenaryMinutes"
  | "liveWebcast";

export type ConfiguredAssemblyEndpointKey =
  | CanonicalAssemblyEndpointKey
  | PendingAssemblyEndpointKey;

type RegistrySource = {
  organization: string;
  documentTitle: string;
  documentDate: string;
  canonicalStandard: string;
  notes: string[];
};

type ForbiddenRuntimeSource = {
  key: string;
  url: string;
  reason: string;
};

type RegistryPolicy = {
  goal: string;
  forbiddenRuntimeSources: ForbiddenRuntimeSource[];
};

type RegistryEndpointBase = {
  key: ConfiguredAssemblyEndpointKey;
  source: string;
  serviceCode: string;
  koreanName: string;
  officialUrl: string;
  role: string;
  required: boolean;
  runtimeStatus: string;
  notes: string[];
};

type CanonicalRegistryEndpoint = RegistryEndpointBase & {
  key: CanonicalAssemblyEndpointKey;
  pdfPage: number;
};

type PendingRegistryEndpoint = RegistryEndpointBase & {
  key: PendingAssemblyEndpointKey;
};

export type AssemblySourceRegistry = {
  source: RegistrySource;
  policy: RegistryPolicy;
  canonicalEndpoints: CanonicalRegistryEndpoint[];
  pendingOfficialVerification: PendingRegistryEndpoint[];
};

const registryPath = new URL(
  "../../../docs/references/assembly-openapi-endpoints.json",
  import.meta.url
);

export const assemblySourceRegistry = JSON.parse(
  readFileSync(registryPath, "utf8")
) as AssemblySourceRegistry;

export const configuredAssemblyEndpoints: RegistryEndpointBase[] = [
  ...assemblySourceRegistry.canonicalEndpoints,
  ...assemblySourceRegistry.pendingOfficialVerification
];

const endpointByKey = new Map(
  configuredAssemblyEndpoints.map(
    (endpoint) => [endpoint.key, endpoint] as const
  )
);
const forbiddenRuntimePaths =
  assemblySourceRegistry.policy.forbiddenRuntimeSources.map(
    (entry) => new URL(entry.url).pathname
  );

const RAW_KIND_TO_ENDPOINT_KEY: Partial<
  Record<RawSnapshotEntry["kind"], ConfiguredAssemblyEndpointKey>
> = {
  member_info: "memberInfo",
  member_profile_all: "memberProfileAll",
  member_history: "memberHistory",
  committee_overview: "committeeOverview",
  committee_roster: "committeeRoster",
  plenary_schedule: "plenarySchedule",
  plenary_bills_law: "plenaryBillsLaw",
  plenary_bills_budget: "plenaryBillsBudget",
  plenary_bills_settlement: "plenaryBillsSettlement",
  plenary_bills_other: "plenaryBillsOther",
  vote_detail: "votes",
  bill_vote_summary: "billVoteSummary",
  live: "liveWebcast",
  plenary_minutes: "plenaryMinutes"
};

function getUrlPath(value: string): string {
  return new URL(value).pathname.replace(/\/+$/, "");
}

function getUrlOrigin(value: string): string {
  return new URL(value).origin;
}

function assertOfficialEndpointEntry(
  entry: RawSnapshotEntry,
  endpointKey: ConfiguredAssemblyEndpointKey
): void {
  const expected = endpointByKey.get(endpointKey);
  if (!expected) {
    throw new Error(`Missing endpoint definition for ${endpointKey}.`);
  }

  const actualOrigin = getUrlOrigin(entry.sourceUrl);
  const expectedOrigin = getUrlOrigin(expected.officialUrl);
  const actualPath = getUrlPath(entry.sourceUrl);
  const expectedPath = getUrlPath(expected.officialUrl);

  if (actualOrigin !== expectedOrigin) {
    throw new Error(
      `Snapshot entry ${entry.kind} must use official origin ${expectedOrigin}, got ${actualOrigin}.`
    );
  }

  if (actualPath !== expectedPath) {
    throw new Error(
      `Snapshot entry ${entry.kind} must use ${expected.officialUrl}, got ${entry.sourceUrl}.`
    );
  }

  if (entry.endpointCode !== expected.serviceCode) {
    throw new Error(
      `Snapshot entry ${entry.kind} must use service code ${expected.serviceCode}, got ${entry.endpointCode}.`
    );
  }
}

export function getOfficialAssemblyEndpointPath(
  key: ConfiguredAssemblyEndpointKey
): string {
  const endpoint = endpointByKey.get(key);
  if (!endpoint) {
    throw new Error(`Unknown Assembly endpoint key: ${key}.`);
  }

  return getUrlPath(endpoint.officialUrl);
}

export function getOfficialAssemblyEndpointPaths(): Record<
  ConfiguredAssemblyEndpointKey,
  string
> {
  return Object.fromEntries(
    configuredAssemblyEndpoints.map((endpoint) => [
      endpoint.key,
      getUrlPath(endpoint.officialUrl)
    ])
  ) as Record<ConfiguredAssemblyEndpointKey, string>;
}

export function getForbiddenRuntimeSourceUrls(): string[] {
  return assemblySourceRegistry.policy.forbiddenRuntimeSources.map(
    (entry) => entry.url
  );
}

export function assertRawSnapshotManifestSourcePolicy(
  manifest: RawSnapshotManifest
): RawSnapshotManifest {
  for (const entry of manifest.entries) {
    const actualPath = getUrlPath(entry.sourceUrl);

    if (forbiddenRuntimePaths.includes(actualPath)) {
      const source = assemblySourceRegistry.policy.forbiddenRuntimeSources.find(
        (candidate) => getUrlPath(candidate.url) === actualPath
      );
      throw new Error(
        `Snapshot entry ${entry.kind} uses forbidden runtime source ${entry.sourceUrl}. ${source?.reason ?? ""}`.trim()
      );
    }

    const endpointKey = RAW_KIND_TO_ENDPOINT_KEY[entry.kind];
    if (endpointKey) {
      assertOfficialEndpointEntry(entry, endpointKey);
      continue;
    }

    throw new Error(`Unexpected non-official snapshot kind: ${entry.kind}.`);
  }

  return manifest;
}
