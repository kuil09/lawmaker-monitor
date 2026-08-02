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
    expect(config.endpoints.billProposalsPath).toBe(
      expectedPaths.billProposals
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

  it.each([
    [
      "People Power 21",
      "https://www.peoplepower21.org/openapi/nojepdqqaweusdfbi"
    ],
    [
      "private mirror",
      "https://private.example.test/portal/openapi/nojepdqqaweusdfbi"
    ]
  ])(
    "rejects %s instead of treating it as an official vote source",
    (_, sourceUrl) => {
      const manifest = readFixtureManifest();
      const mutated: RawSnapshotManifest = {
        ...manifest,
        entries: manifest.entries.map((entry) =>
          entry.kind === "vote_detail" ? { ...entry, sourceUrl } : entry
        )
      };

      expect(() => assertRawSnapshotManifestSourcePolicy(mutated)).toThrow(
        /official origin/
      );
    }
  );

  it("allows the registered National Assembly and LIKMS supplemental sources", () => {
    const manifest: RawSnapshotManifest = {
      snapshotId: "official-supplemental-fixture",
      retrievedAt: "2026-08-02T00:00:00.000Z",
      entries: [
        {
          kind: "member_committee_career",
          endpointCode: "ORNDP7000993P115502",
          relativePath: "official/member_committee_career/page-1.json",
          sourceUrl:
            "https://open.assembly.go.kr/portal/data/sheet/searchSheetData.do?page=1",
          requestParams: { page: "1", rows: "1000" },
          retrievedAt: "2026-08-02T00:00:00.000Z",
          checksumSha256: "committee-career"
        },
        {
          kind: "vote_member_list",
          endpointCode: "voteInfo.do",
          relativePath: "official/vote_member_lists/PRC_TEST.html",
          sourceUrl:
            "https://likms.assembly.go.kr/bill/bi/bill/detail/voteInfo.do",
          requestParams: { billId: "PRC_TEST" },
          retrievedAt: "2026-08-02T00:00:00.000Z",
          checksumSha256: "likms-vote-list"
        },
        {
          kind: "plenary_attendance_file",
          endpointCode: "O4Q5B50011905O18367",
          relativePath: "official/plenary_attendance/10001869.xlsx",
          sourceUrl:
            "https://open.assembly.go.kr/portal/data/file/downloadFileData.do?infId=O4Q5B50011905O18367&infSeq=1&fileSeq=10001869",
          requestParams: {
            infId: "O4Q5B50011905O18367",
            infSeq: "1",
            fileSeq: "10001869"
          },
          retrievedAt: "2026-08-02T00:00:00.000Z",
          checksumSha256: "plenary-attendance"
        }
      ]
    };

    expect(() => assertRawSnapshotManifestSourcePolicy(manifest)).not.toThrow();
  });
});
