import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildHistoryEvents,
  classifyActivityTopic,
  extractCareerClaims,
  writeMemberAnalysisInputs
} from "../../packages/ingest/src/member-analysis.js";
import {
  loadBuildDataRawInputs,
  resolveBuildDataRuntimeConfig
} from "../../packages/ingest/src/build-data/input-stage.js";
import { buildNormalizedStage } from "../../packages/ingest/src/build-data/normalize-stage.js";
import {
  memberAnalysisIndexSchema,
  memberAnalysisDetailSchema
} from "../../packages/schemas/src/index.js";
import { parseOfficialVoteXml } from "../../packages/ingest/src/parsers.js";

describe("member history analysis", () => {
  it("distinguishes source party labels from current-roster fallbacks", async () => {
    const normalized = await buildNormalizedStage(
      await loadBuildDataRawInputs(
        resolveBuildDataRuntimeConfig({
          env: {
            RAW_DIR: "tests/fixtures",
            DATA_REPO_DIR: "tests/fixtures/property_mirror"
          }
        })
      )
    );
    const xml = await readFile(
      "tests/fixtures/raw/fixture-snapshot-20260322-114500/official/votes/PRC_A1B2C3D4E5F6.xml",
      "utf8"
    );
    const context = {
      sourceUrl: "https://example.test/vote",
      retrievedAt: "2026-03-22T00:00:00Z",
      snapshotId: "test"
    };
    const source = parseOfficialVoteXml(xml, context, {
      currentMembers: normalized.bundle.members
    });
    expect(
      source.voteFacts.find((row) => row.memberId === "M001")?.recordedParty
    ).toBe("Future Reform Party");
    const fallback = parseOfficialVoteXml(
      xml.replace(/<POLY_NM>.*?<\/POLY_NM>/g, ""),
      context,
      { currentMembers: normalized.bundle.members }
    );
    expect(
      fallback.voteFacts.find((row) => row.memberId === "M001")
    ).toMatchObject({
      party: normalized.bundle.members.find(
        (member) => member.memberId === "M001"
      )!.party,
      recordedParty: null
    });
  });

  it("imports the ingest CLI without starting a live collection", () => {
    const url = new URL(
      "../../packages/ingest/dist/scripts/ingest-live.js",
      import.meta.url
    );
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `globalThis.fetch=async()=>{throw new Error('Unexpected live fetch during module import');}; await import(${JSON.stringify(url.toString())});`
      ],
      { encoding: "utf8", timeout: 10000 }
    );
    expect(output).toBe("");
  });
  it("retains the original career claim and does not turn education or a substring into employment", () => {
    expect(
      extractCareerClaims(
        "서울대학교 의과대학 졸업\n의사소통 개선위원회 위원",
        "https://example.test/profile"
      )
    ).toEqual([]);
    expect(
      extractCareerClaims(
        "1998년 의과대학 졸업 전) 서울병원 의사",
        "https://example.test/profile"
      )[0]
    ).toMatchObject({ startDate: null, endDate: null, precision: "unknown" });
    expect(
      extractCareerClaims(
        "1998년 의과대학 졸업\n전) 서울병원 의사\n전) 국립대학교 교수",
        "https://example.test/profile"
      )
    ).toEqual([
      expect.objectContaining({
        category: "medicine",
        evidence: "전) 서울병원 의사",
        startDate: null,
        precision: "unknown"
      }),
      expect.objectContaining({
        category: "education",
        evidence: "전) 국립대학교 교수",
        startDate: null
      })
    ]);
    expect(classifyActivityTopic("국민건강보험법 일부개정법률안")).toBe(
      "보건·복지"
    );
    expect(classifyActivityTopic("검토의 건")).toBe("기타·미분류");
    expect(
      extractCareerClaims(
        "1998년 의과대학 졸업 2013.7~2014.7 워싱턴대학교 연구교수 2017 변호사",
        "https://example.test/profile"
      )
    ).toEqual([
      expect.objectContaining({
        category: "education",
        evidence: "2013.7~2014.7 워싱턴대학교 연구교수",
        startDate: "2013-07-01",
        endDate: "2014-07-31",
        precision: "month",
        dateBasis: "stated_period"
      }),
      expect.objectContaining({
        category: "law",
        startDate: "2017-01-01",
        endDate: "2017-12-31",
        precision: "year",
        dateBasis: "dated_mention"
      })
    ]);
    expect(
      extractCareerClaims(
        "2020.13~2021.2 변호사",
        "https://example.test/profile"
      )[0]
    ).toMatchObject({ startDate: null, endDate: null, precision: "unknown" });
  });

  it("links tenure by official identity and preserves observed affiliation dates", async () => {
    const normalized = await buildNormalizedStage(
      await loadBuildDataRawInputs(
        resolveBuildDataRuntimeConfig({
          env: {
            RAW_DIR: "tests/fixtures",
            DATA_REPO_DIR: "tests/fixtures/property_mirror"
          }
        })
      )
    );
    const member = normalized.bundle.members[0]!;
    const events = buildHistoryEvents({
      member,
      tenures: [
        {
          memberId: member.memberId,
          name: member.name,
          assemblyNo: 22,
          startDate: "2024-05-30",
          endDate: null
        },
        {
          memberId: "SAME_NAME_OTHER_PERSON",
          name: member.name,
          assemblyNo: 21,
          startDate: "2020-05-30",
          endDate: "2024-05-29"
        }
      ],
      committees: [],
      observedAt: "2026-10-23T00:00:00Z",
      sourceUrl: "https://example.test/history",
      observations: [
        {
          memberId: member.memberId,
          party: "새 정당",
          role: null,
          observedAt: "2026-10-23T00:00:00Z",
          lastSeenAt: "2026-10-23T00:00:00Z",
          sourceUrl: "https://example.test/profile"
        }
      ]
    });
    expect(events.filter((event) => event.kind === "tenure")).toHaveLength(1);
    expect(
      events.find((event) => event.kind === "party_observation")
    ).toMatchObject({ startDate: "2026-10-23", dateBasis: "observed" });
  });

  it.skipIf(!process.env.DUCKDB_BIN)(
    "runs DuckDB 2.0 SQL with historical parties, missing votes, consensus exclusion, tenure eligibility and empty statements",
    async () => {
      const binary = process.env.DUCKDB_BIN!;
      const root = await mkdtemp(join(tmpdir(), "member-analysis-"));
      try {
        const normalized = await buildNormalizedStage(
          await loadBuildDataRawInputs(
            resolveBuildDataRuntimeConfig({
              env: {
                RAW_DIR: "tests/fixtures",
                DATA_REPO_DIR: "tests/fixtures/property_mirror"
              }
            })
          )
        );
        const [a, b, c] = normalized.bundle.members;
        expect(a && b && c).toBeTruthy();
        a!.profile = {
          ...a!.profile,
          briefHistory: "2010~2012 전) 서울병원 의사",
          aideNames: [],
          chiefSecretaryNames: [],
          secretaryNames: []
        };
        a!.party = "현재 같은 정당";
        b!.party = "현재 같은 정당";
        const template = normalized.bundle.rollCalls[0]!;
        normalized.bundle.rollCalls = Array.from({ length: 10 }, (_, i) => ({
          ...template,
          rollCallId: `vote-${i}`,
          billName: "국민건강보험법",
          voteDatetime: `2026-03-${String(10 + i).padStart(2, "0")}T10:00:00+09:00`,
          voteVisibility: "recorded" as const
        }));
        normalized.bundle.voteFacts = normalized.bundle.rollCalls.flatMap(
          (call, i) => [
            ...(i === 7
              ? []
              : [
                  {
                    rollCallId: call.rollCallId,
                    memberId: a!.memberId,
                    party: "표결 당시 A당",
                    recordedParty: "API의 현재 정당 표기",
                    voteCode: "yes" as const,
                    publishedAt: call.voteDatetime,
                    retrievedAt: call.voteDatetime,
                    sourceHash: "a"
                  }
                ]),
            {
              rollCallId: call.rollCallId,
              memberId: b!.memberId,
              party: "표결 당시 B당",
              recordedParty: "표결 당시 B당",
              voteCode: "yes" as const,
              publishedAt: call.voteDatetime,
              retrievedAt: call.voteDatetime,
              sourceHash: "b"
            },
            {
              rollCallId: call.rollCallId,
              memberId: c!.memberId,
              party: "C당",
              recordedParty: "C당",
              voteCode: i === 6 ? ("yes" as const) : ("no" as const),
              publishedAt: call.voteDatetime,
              retrievedAt: call.voteDatetime,
              sourceHash: "c"
            }
          ]
        );
        normalized.tenureIndex.set(c!.memberId, [
          { startDate: "2026-03-12", endDate: null }
        ]);
        await mkdir(join(root, "manifests"), { recursive: true });
        const period = (
          memberId: string,
          party: string,
          startDate: string,
          endDate: string
        ) => ({
          memberId,
          assemblyNo: 22,
          party,
          startDate,
          endDate,
          sourceUrl: "https://example.test/dated-affiliation",
          sourceExcerpt: "Controlled dated affiliation evidence",
          reviewedAt: "2026-03-22T00:00:00Z"
        });
        await writeFile(
          join(root, "manifests/member_affiliation_periods.json"),
          JSON.stringify([
            period(a!.memberId, "표결 당시 A당", "2026-03-10", "2026-03-13"),
            period(a!.memberId, "표결 당시 새 A당", "2026-03-15", "2026-03-19"),
            period(b!.memberId, "표결 당시 B당", "2026-03-10", "2026-03-19"),
            period(c!.memberId, "C당", "2026-03-12", "2026-03-19")
          ])
        );
        await mkdir(join(root, "exports/member_analysis"), { recursive: true });
        await writeFile(
          join(root, "exports/member_analysis/observations.json"),
          JSON.stringify([
            {
              memberId: a!.memberId,
              party: "관찰된 이전 정당",
              role: null,
              observedAt: "2026-03-01T00:00:00Z",
              lastSeenAt: "2026-03-13T00:00:00Z",
              sourceUrl: "https://example.test/old-roster"
            },
            {
              memberId: a!.memberId,
              party: a!.party,
              role: a!.profile?.roleName ?? null,
              observedAt: "2026-03-15T00:00:00Z",
              lastSeenAt: "2026-03-15T00:00:00Z",
              sourceUrl: "https://example.test/new-roster"
            }
          ])
        );
        await writeMemberAnalysisInputs({
          outputDir: root,
          dataRepoDir: root,
          bundle: normalized.bundle,
          billProposals: normalized.billProposals,
          tenureIndex: normalized.tenureIndex,
          snapshotId: normalized.snapshotId,
          ...normalized.analysisHistory
        });
        await mkdir(join(root, "curated"));
        await mkdir(join(root, "normalized"));
        const datasets = {
          members: normalized.bundle.members,
          roll_calls: normalized.bundle.rollCalls,
          vote_facts: normalized.bundle.voteFacts,
          attendance_facts: [{ __seed: true, attendanceId: "seed" }],
          meetings: normalized.bundle.meetings,
          sources: normalized.bundle.sources,
          asset_disclosures: [
            {
              __seed: true,
              disclosureFileId: "seed",
              downloadUrl: "https://example.test/property.pdf",
              sourceUrl: "https://example.test/property"
            }
          ],
          asset_disclosure_records: [
            {
              __seed: true,
              memberId: null,
              disclosureFileId: "seed",
              reportedAt: "1970-01-01",
              currentAmount: 0,
              deltaAmount: 0,
              valueChangeAmount: 0,
              mappingStatus: "unmatched"
            }
          ],
          asset_disclosure_categories: [{ __seed: true, category: "seed" }],
          asset_disclosure_items: [{ __seed: true, item: "seed" }]
        };
        for (const [name, rows] of Object.entries(datasets))
          await writeFile(
            join(root, "normalized", `${name}.ndjson`),
            rows.map((row) => JSON.stringify(row)).join("\n")
          );
        execFileSync(
          binary,
          [
            "-no-agent",
            "-bail",
            ":memory:",
            "-c",
            `.read ${join(process.cwd(), "packages/ingest/sql/materialize_parquet.sql")}`
          ],
          { cwd: root }
        );
        const timestampRows = JSON.parse(
          execFileSync(
            binary,
            [
              "-no-agent",
              "-json",
              ":memory:",
              "-c",
              "SELECT retrievedAt,typeof(retrievedAt) AS type FROM read_parquet('curated/sources.parquet') LIMIT 1"
            ],
            { cwd: root, encoding: "utf8" }
          )
        );
        expect(timestampRows[0]).toEqual({
          retrievedAt: normalized.bundle.sources[0]!.retrievedAt,
          type: "VARCHAR"
        });
        execFileSync(
          process.execPath,
          ["scripts/build-member-analysis.mjs", root],
          { env: { ...process.env, DUCKDB_BIN: binary } }
        );
        const index = memberAnalysisIndexSchema.parse(
          JSON.parse(
            await readFile(
              join(root, "exports/member_analysis/index.json"),
              "utf8"
            )
          )
        );
        const detail = memberAnalysisDetailSchema.parse(
          JSON.parse(
            await readFile(
              join(root, `exports/member_analysis/${a!.memberId}.json`),
              "utf8"
            )
          )
        );
        const later = memberAnalysisDetailSchema.parse(
          JSON.parse(
            await readFile(
              join(root, `exports/member_analysis/${c!.memberId}.json`),
              "utf8"
            )
          )
        );
        expect(index.engineVersion).toMatch(/^v2\.0\./);
        expect(index.coverage.statements).toBe(0);
        expect(
          detail.events.find((event) => event.kind === "career")
        ).toMatchObject({
          dateBasis: "biography_period",
          startDate: "2010-01-01",
          endDate: "2012-12-31",
          dateLabel: "2010~2012 (약력·연 단위)"
        });
        expect(detail.metrics).toMatchObject({
          eligibleVotes: 10,
          participatedVotes: 9,
          unknownVotes: 1,
          participationRate: 9 / 10
        });
        expect(later.metrics.eligibleVotes).toBe(8);
        expect(
          detail.transitions.find(
            (row) => row.basis === "party_observation_bounds"
          )
        ).toMatchObject({
          beforeEndDate: "2026-03-13",
          afterStartDate: "2026-03-15",
          uncertainDays: 1
        });
        // Five contested shared votes: two early votes are consensus after tenure filtering,
        // and the unanimous seventh vote is excluded. Current party is deliberately identical.
        expect(
          detail.coalitions.find((row) => row.memberId === b!.memberId)
        ).toMatchObject({
          sharedVotes: 5,
          sameVotes: 5,
          crossPartyVotes: 5,
          agreementRate: 1
        });
        expect(detail.transitions[0]?.beforeObservedDays).toBe(0);
        expect(detail.transitions[0]?.afterObservedDays).toBe(0);
        const activityPath = join(root, "analysis-input/activities.ndjson");
        const activities = (await readFile(activityPath, "utf8"))
          .trim()
          .split("\n")
          .map((row) => JSON.parse(row));
        const samePartyVote = activities.find(
          (row) => row.memberId === b!.memberId && row.activityId === "vote-2"
        );
        samePartyVote.partyAtVote = "표결 당시 A당";
        await writeFile(
          activityPath,
          activities.map((row) => JSON.stringify(row)).join("\n")
        );
        execFileSync(
          process.execPath,
          ["scripts/build-member-analysis.mjs", root],
          { env: { ...process.env, DUCKDB_BIN: binary } }
        );
        const fewer = memberAnalysisDetailSchema.parse(
          JSON.parse(
            await readFile(
              join(root, `exports/member_analysis/${a!.memberId}.json`),
              "utf8"
            )
          )
        );
        expect(
          fewer.coalitions.find((row) => row.memberId === b!.memberId)
        ).toBeUndefined();
        // A populated API party label is insufficient evidence for historical affiliation.
        await writeFile(
          join(root, "manifests/member_affiliation_periods.json"),
          "[]"
        );
        await writeMemberAnalysisInputs({
          outputDir: root,
          dataRepoDir: root,
          bundle: normalized.bundle,
          billProposals: normalized.billProposals,
          tenureIndex: normalized.tenureIndex,
          snapshotId: normalized.snapshotId,
          ...normalized.analysisHistory
        });
        execFileSync(
          process.execPath,
          ["scripts/build-member-analysis.mjs", root],
          { env: { ...process.env, DUCKDB_BIN: binary } }
        );
        const unknown = memberAnalysisDetailSchema.parse(
          JSON.parse(
            await readFile(
              join(root, `exports/member_analysis/${a!.memberId}.json`),
              "utf8"
            )
          )
        );
        expect(
          unknown.coalitions.some((row) => row.basis === "verified_period")
        ).toBe(false);
        expect(
          unknown.coalitions.some((row) => row.basis === "current_roster")
        ).toBe(true);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  );
});
