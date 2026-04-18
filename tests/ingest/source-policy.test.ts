import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assemblySourceRegistry,
  assertRawSnapshotManifestSourcePolicy,
  getOfficialAssemblyEndpointPaths
} from "../../packages/ingest/src/assembly-source-registry.js";
import { resolveAssemblyApiConfig } from "../../packages/ingest/src/assembly-api.js";
import type { RawSnapshotManifest } from "../../packages/ingest/src/raw-snapshot.js";

const snapshotManifestPath = resolve(
  process.cwd(),
  "tests/fixtures/raw/fixture-snapshot-20260322-114500/snapshot-manifest.json"
);

function readFixtureManifest(): RawSnapshotManifest {
  return JSON.parse(
    readFileSync(snapshotManifestPath, "utf8")
  ) as RawSnapshotManifest;
}

describe("assembly source policy", () => {
  it("keeps every canonical endpoint tied to a concrete PDF page citation", () => {
    for (const endpoint of assemblySourceRegistry.canonicalEndpoints) {
      expect(endpoint.source).toBe("pdf");
      expect(endpoint.pdfPage).toBeGreaterThan(0);
      expect(endpoint.officialUrl).toContain(endpoint.serviceCode);
    }
  });

  it("keeps configured official endpoint defaults aligned with the registry", () => {
    const config = resolveAssemblyApiConfig();
    const expectedPaths = getOfficialAssemblyEndpointPaths();

    expect(config.endpoints.memberInfoPath).toBe(expectedPaths.memberInfo);
    expect(config.endpoints.memberProfileAllPath).toBe(
      expectedPaths.memberProfileAll
    );
    expect(config.endpoints.memberHistoryPath).toBe(
      expectedPaths.memberHistory
    );
    expect(config.endpoints.committeeOverviewPath).toBe(
      expectedPaths.committeeOverview
    );
    expect(config.endpoints.committeeRosterPath).toBe(
      expectedPaths.committeeRoster
    );
    expect(config.endpoints.billVoteSummaryPath).toBe(
      expectedPaths.billVoteSummary
    );
    expect(config.endpoints.votesPath).toBe(expectedPaths.votes);
    expect(config.endpoints.plenarySchedulePath).toBe(
      expectedPaths.plenarySchedule
    );
    expect(config.endpoints.plenaryLawBillsPath).toBe(
      expectedPaths.plenaryBillsLaw
    );
    expect(config.endpoints.plenaryBudgetBillsPath).toBe(
      expectedPaths.plenaryBillsBudget
    );
    expect(config.endpoints.plenarySettlementBillsPath).toBe(
      expectedPaths.plenaryBillsSettlement
    );
    expect(config.endpoints.plenaryOtherBillsPath).toBe(
      expectedPaths.plenaryBillsOther
    );
    expect(config.endpoints.plenaryMinutesPath).toBe(
      expectedPaths.plenaryMinutes
    );
    expect(config.endpoints.livePath).toBe(expectedPaths.liveWebcast);
  });

  it("accepts the official-only fixture snapshot", () => {
    const manifest = readFixtureManifest();

    expect(() => assertRawSnapshotManifestSourcePolicy(manifest)).not.toThrow();
  });

  it("rejects forbidden sheet endpoints", () => {
    const manifest = readFixtureManifest();
    const voteEntryIndex = manifest.entries.findIndex(
      (entry) => entry.kind === "vote_detail"
    );

    if (voteEntryIndex < 0) {
      throw new Error("Fixture manifest does not include a vote_detail entry.");
    }

    const mutated: RawSnapshotManifest = {
      ...manifest,
      entries: manifest.entries.map((entry, index) =>
        index === voteEntryIndex
          ? {
              ...entry,
              endpointCode: "searchSheetData.do",
              sourceUrl:
                "https://open.assembly.go.kr/portal/data/sheet/searchSheetData.do"
            }
          : entry
      )
    };

    expect(() => assertRawSnapshotManifestSourcePolicy(mutated)).toThrow(
      /forbidden runtime source/
    );
  });

  it("rejects non-official raw kinds outright", () => {
    const manifest = readFixtureManifest();
    const mutated: RawSnapshotManifest = {
      ...manifest,
      entries: [
        ...manifest.entries,
        {
          kind: "unknown_runtime_source" as never,
          endpointCode: "unsupported",
          relativePath: "official/unsupported/source.xml",
          sourceUrl: "https://example.invalid/unsupported/source.xml",
          requestParams: {
            q: "unsupported"
          },
          retrievedAt: manifest.retrievedAt,
          checksumSha256: "unsupported"
        }
      ]
    };

    expect(() => assertRawSnapshotManifestSourcePolicy(mutated)).toThrow(
      /Unexpected non-official snapshot kind/
    );
  });
});
