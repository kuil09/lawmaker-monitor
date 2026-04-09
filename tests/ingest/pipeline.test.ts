import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertPublishedJsonFileSize,
  buildAccountabilitySummaryExport,
  buildAccountabilityTrendsExport,
  buildLatestVotesExport,
  buildManifest,
  buildMemberActivityCalendarArtifacts,
  buildMemberActivityCalendarExport,
  buildMemberActivityCalendarMemberDetailExports,
  serializePublishedJson
} from "../../packages/ingest/src/exports.js";
import { createNormalizedBundle } from "../../packages/ingest/src/normalize.js";
import {
  createSourceRecord,
  parseAgendaXml,
  parseBillVoteSummaryXml,
  parseCommitteeOverviewXml,
  parseCommitteeRosterXml,
  parseLiveSignalXml,
  parseMemberInfoXml,
  parseMemberProfileAllXml,
  parseMemberHistoryXml,
  parseMeetingXml,
  parseVoteDetailPayload
} from "../../packages/ingest/src/parsers.js";
import { enrichMembersWithMemberProfileAll } from "../../packages/ingest/src/member-profile-enrichment.js";
import { resolveRawSnapshot } from "../../packages/ingest/src/raw-snapshot.js";
import { buildMemberTenureIndex } from "../../packages/ingest/src/tenure.js";
import {
  validateAccountabilitySummaryExport,
  validateAccountabilityTrendsExport,
  validateLatestVotesExport,
  validateManifest,
  validateMemberActivityCalendarExport,
  validateMemberActivityCalendarMemberDetailExport,
  validateNormalizedBundle
} from "../../packages/ingest/src/validation.js";
import { sha256 } from "../../packages/ingest/src/utils.js";
import {
  accountabilitySummaryExportSchema,
  accountabilityTrendsExportSchema,
  latestVotesExportSchema,
  manifestSchema,
  memberAssetsHistoryExportSchema,
  memberAssetsIndexExportSchema,
  memberActivityCalendarExportSchema,
  memberActivityCalendarMemberDetailExportSchema,
  memberActivityCalendarMemberSchema
} from "../../packages/schemas/src/index.js";

const fixturesDir = resolve(process.cwd(), "tests/fixtures");

describe("data pipeline contracts", () => {
  it("discovers a raw snapshot manifest and builds normalized outputs from it", async () => {
    const snapshot = await resolveRawSnapshot(fixturesDir);
    const scheduleEntry = snapshot.manifest.entries.find((entry) => entry.kind === "plenary_schedule");
    const memberInfoEntries = snapshot.manifest.entries.filter(
      (entry) => entry.kind === "member_info"
    );
    const memberProfileAllEntries = snapshot.manifest.entries.filter(
      (entry) => entry.kind === "member_profile_all"
    );
    const memberHistoryEntries = snapshot.manifest.entries.filter(
      (entry) => entry.kind === "member_history"
    );
    const committeeOverviewEntries = snapshot.manifest.entries.filter(
      (entry) => entry.kind === "committee_overview"
    );
    const committeeRosterEntries = snapshot.manifest.entries.filter(
      (entry) => entry.kind === "committee_roster"
    );
    const billVoteSummaryEntries = snapshot.manifest.entries.filter(
      (entry) => entry.kind === "bill_vote_summary"
    );
    const liveEntry = snapshot.manifest.entries.find((entry) => entry.kind === "live");
    const agendaEntries = snapshot.manifest.entries.filter((entry) =>
      [
        "plenary_bills_law",
        "plenary_bills_budget",
        "plenary_bills_settlement",
        "plenary_bills_other"
      ].includes(entry.kind)
    );
    const voteEntries = snapshot.manifest.entries.filter((entry) => entry.kind === "vote_detail");
    const minutesEntry = snapshot.manifest.entries.find((entry) => entry.kind === "plenary_minutes");

    expect(snapshot.snapshotId).toBe("fixture-snapshot-20260322-114500");
    expect(memberInfoEntries.length).toBeGreaterThan(0);
    expect(memberProfileAllEntries.length).toBeGreaterThan(0);
    expect(memberHistoryEntries.length).toBeGreaterThan(0);
    expect(scheduleEntry).toBeDefined();
    expect(liveEntry).toBeDefined();
    expect(voteEntries).toHaveLength(2);

    const memberInfoXmls = memberInfoEntries.map((entry) =>
      readFileSync(join(snapshot.rawDir, entry.relativePath), "utf8")
    );
    const memberProfileAllXmls = memberProfileAllEntries.map((entry) =>
      readFileSync(join(snapshot.rawDir, entry.relativePath), "utf8")
    );
    const committeeOverviewXmls = committeeOverviewEntries.map((entry) =>
      readFileSync(join(snapshot.rawDir, entry.relativePath), "utf8")
    );
    const committeeRosterXmls = committeeRosterEntries.map((entry) =>
      readFileSync(join(snapshot.rawDir, entry.relativePath), "utf8")
    );
    const billVoteSummaryXmls = billVoteSummaryEntries.map((entry) =>
      readFileSync(join(snapshot.rawDir, entry.relativePath), "utf8")
    );
    const memberHistoryRows = memberHistoryEntries.flatMap((entry) =>
      parseMemberHistoryXml(readFileSync(join(snapshot.rawDir, entry.relativePath), "utf8"))
    );
    const scheduleXml = readFileSync(join(snapshot.rawDir, scheduleEntry!.relativePath), "utf8");
    const liveXml = readFileSync(join(snapshot.rawDir, liveEntry!.relativePath), "utf8");
    const minutesXml = minutesEntry
      ? readFileSync(join(snapshot.rawDir, minutesEntry.relativePath), "utf8")
      : null;

    const meetings = parseMeetingXml(scheduleXml, {
      sourceUrl: scheduleEntry!.sourceUrl,
      retrievedAt: scheduleEntry!.retrievedAt,
      snapshotId: snapshot.snapshotId
    });

    const agendas = agendaEntries.flatMap((entry) =>
      parseAgendaXml(readFileSync(join(snapshot.rawDir, entry.relativePath), "utf8"), {
        sourceUrl: entry.sourceUrl,
        retrievedAt: entry.retrievedAt,
        snapshotId: snapshot.snapshotId
      }).agendas
    );

    const memberInfoResults = memberInfoXmls.map((xml) => parseMemberInfoXml(xml));
    const memberProfileAllResults = memberProfileAllXmls.map((xml) =>
      parseMemberProfileAllXml(xml)
    );
    const memberInfoMembers = memberInfoResults.flatMap((result) => result.members);
    const memberProfileAllRecords = memberProfileAllResults.flatMap((result) => result.profiles);
    const committeeOverviewRows = committeeOverviewXmls.flatMap((xml) =>
      parseCommitteeOverviewXml(xml)
    );
    const committeeRosterRows = committeeRosterXmls.flatMap((xml) =>
      parseCommitteeRosterXml(xml)
    );
    const billVoteSummaryRows = billVoteSummaryXmls.flatMap((xml) =>
      parseBillVoteSummaryXml(xml)
    );
    const committeeMembershipsByMemberId = new Map<string, string[]>();
    for (const row of committeeRosterRows) {
      const memberships = committeeMembershipsByMemberId.get(row.memberId) ?? [];
      memberships.push(row.committeeName);
      committeeMembershipsByMemberId.set(row.memberId, [...new Set(memberships)]);
    }
    const officialMembers = enrichMembersWithMemberProfileAll({
      members: memberInfoMembers.map((member) => ({
        ...member,
        committeeMemberships:
          committeeMembershipsByMemberId.get(member.memberId) ?? member.committeeMemberships
      })),
      profiles: memberProfileAllRecords
    }).members;
    const officialTalliesByBillId = new Map(
      billVoteSummaryRows.map((row) => [row.billId, row.officialTally] as const)
    );
    const votes = voteEntries.map((entry) =>
      parseVoteDetailPayload(
        readFileSync(join(snapshot.rawDir, entry.relativePath), "utf8"),
        {
          sourceUrl: entry.sourceUrl,
          retrievedAt: entry.retrievedAt,
          snapshotId: snapshot.snapshotId
        },
        {
          currentMembers: officialMembers
        }
      )
    );
    const currentAssembly = memberInfoResults[0]?.currentAssembly;
    expect(currentAssembly).toMatchObject({
      assemblyNo: 22,
      label: "제22대 국회"
    });
    expect(committeeOverviewRows.length).toBeGreaterThan(0);
    expect(billVoteSummaryRows.length).toBeGreaterThan(0);

    const bundle = validateNormalizedBundle(
      createNormalizedBundle({
        members: [...votes.flatMap((result) => result.members), ...officialMembers],
        rollCalls: votes.flatMap((result) =>
          result.rollCalls.map((rollCall) => ({
            ...rollCall,
            officialTally: rollCall.billId
              ? officialTalliesByBillId.get(rollCall.billId) ?? rollCall.officialTally
              : rollCall.officialTally
          }))
        ),
        voteFacts: votes.flatMap((result) => result.voteFacts),
        meetings: meetings.meetings,
        sources: [
          ...votes.flatMap((result) => result.sources),
          ...memberInfoEntries.map((entry, index) =>
            createSourceRecord(
              {
                sourceUrl: entry.sourceUrl,
                retrievedAt: entry.retrievedAt,
                snapshotId: snapshot.snapshotId
              },
              memberInfoXmls[index] ?? ""
            )
          ),
          ...memberProfileAllEntries.map((entry, index) =>
            createSourceRecord(
              {
                sourceUrl: entry.sourceUrl,
                retrievedAt: entry.retrievedAt,
                snapshotId: snapshot.snapshotId
              },
              memberProfileAllXmls[index] ?? ""
            )
          ),
          ...agendaEntries.map((entry) =>
            createSourceRecord(
              {
                sourceUrl: entry.sourceUrl,
                retrievedAt: entry.retrievedAt,
                snapshotId: snapshot.snapshotId
              },
              readFileSync(join(snapshot.rawDir, entry.relativePath), "utf8")
            )
          ),
          ...committeeOverviewEntries.map((entry, index) =>
            createSourceRecord(
              {
                sourceUrl: entry.sourceUrl,
                retrievedAt: entry.retrievedAt,
                snapshotId: snapshot.snapshotId
              },
              committeeOverviewXmls[index] ?? ""
            )
          ),
          ...committeeRosterEntries.map((entry, index) =>
            createSourceRecord(
              {
                sourceUrl: entry.sourceUrl,
                retrievedAt: entry.retrievedAt,
                snapshotId: snapshot.snapshotId
              },
              committeeRosterXmls[index] ?? ""
            )
          ),
          ...billVoteSummaryEntries.map((entry, index) =>
            createSourceRecord(
              {
                sourceUrl: entry.sourceUrl,
                retrievedAt: entry.retrievedAt,
                snapshotId: snapshot.snapshotId
              },
              billVoteSummaryXmls[index] ?? ""
            )
          ),
          ...meetings.sources,
          ...(minutesEntry && minutesXml
            ? [
                createSourceRecord(
                  {
                    sourceUrl: minutesEntry.sourceUrl,
                    retrievedAt: minutesEntry.retrievedAt,
                    snapshotId: snapshot.snapshotId
                  },
                  minutesXml
                )
              ]
            : [])
        ],
        agendas,
        liveSignal: parseLiveSignalXml(liveXml)
      })
    );

    expect(bundle.meetings[0]?.isLive).toBe(true);
    expect(bundle.voteFacts).toHaveLength(6);
    expect(bundle.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memberId: "M001",
          committeeMemberships: ["과학기술정보방송통신위원회", "예산결산특별위원회"],
          photoUrl: "https://www.assembly.go.kr/static/portal/img/openassm/new/thumb/member-m001.jpg",
          profile: expect.objectContaining({
            nameEnglish: "KIM ARA",
            officePhone: "02-784-0001",
            aideNames: ["나보좌"]
          })
        })
      ])
    );
    expect(bundle.members.filter((member) => member.photoUrl)).toHaveLength(2);
    const tenureIndex = buildMemberTenureIndex({
      members: bundle.members,
      tenures: memberHistoryRows,
      assemblyNo: 22
    });

    const latestVotes = validateLatestVotesExport(buildLatestVotesExport(bundle, { tenureIndex }));
    const accountabilitySummary = validateAccountabilitySummaryExport(
      buildAccountabilitySummaryExport(bundle, { tenureIndex })
    );
    const accountabilityTrends = validateAccountabilityTrendsExport(
      buildAccountabilityTrendsExport(bundle, { tenureIndex })
    );
    const { memberActivityCalendar: builtMemberActivityCalendar, memberDetails } =
      buildMemberActivityCalendarArtifacts(bundle, { tenureIndex });
    const memberActivityCalendar = validateMemberActivityCalendarExport(
      builtMemberActivityCalendar
    );
    const validatedMemberDetails = memberDetails.map((detail) =>
      validateMemberActivityCalendarMemberDetailExport(detail)
    );
    const manifest = validateManifest(
      buildManifest({
        bundle,
        dataRepoBaseUrl: "https://data.example.test/lawmaker-monitor/",
        currentAssembly: {
          assemblyNo: 22,
          label: "제22대 국회",
          unitCd: "100022"
        },
        latestVotes,
        accountabilitySummary,
        accountabilityTrends,
        memberActivityCalendar
      })
    );

    expect(latestVotes.items[0]?.rollCallId).toBe("plenary-22-418-14-20260322:PRC_B2C3D4E5F6G7");
    expect(latestVotes.items[0]?.counts).toMatchObject({ yes: 1, no: 1, abstain: 0, absent: 1 });
    expect(latestVotes.items[0]?.absentListStatus).toBe("verified");
    expect(latestVotes.items[0]?.highlightedVotes[0]?.voteCode).toBe("no");
    expect(latestVotes.items[0]?.absentVotes[0]?.voteCode).toBe("absent");
    expect(accountabilitySummary.items[0]).toMatchObject({
      memberId: "M002",
      assemblyNo: 22,
      photoUrl: "https://www.assembly.go.kr/static/portal/img/openassm/new/thumb/member-m002.jpg",
      officialProfileUrl: "https://www.assembly.go.kr/members/22nd/PARKMIN",
      profile: {
        nameHanja: "朴敏",
        nameEnglish: "PARK MIN",
        officeRoom: "의원회관 202호"
      },
      noCount: 1,
      abstainCount: 0,
      absentCount: 1,
      totalRecordedVotes: 2
    });
    expect(accountabilitySummary.items[0]?.profile).not.toHaveProperty("officePhone");
    expect(accountabilitySummary.items[0]?.profile).not.toHaveProperty("email");
    expect(accountabilitySummary.items[0]?.profile).not.toHaveProperty("aideNames");
    expect(latestVotes.items[0]?.highlightedVotes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memberId: "M001",
          memberName: "김아라"
        })
      ])
    );
    expect(latestVotes.items[0]?.highlightedVotes[0]).not.toHaveProperty("officialProfileUrl");
    expect(latestVotes.items[0]?.highlightedVotes[0]).not.toHaveProperty("profile");
    expect(latestVotes).toMatchObject({
      assemblyNo: 22,
      assemblyLabel: "제22대 국회"
    });
    expect(accountabilitySummary).toMatchObject({
      assemblyNo: 22,
      assemblyLabel: "제22대 국회"
    });
    expect(accountabilityTrends).toMatchObject({
      assemblyNo: 22,
      assemblyLabel: "제22대 국회"
    });
    expect(accountabilityTrends.weeks).toHaveLength(12);
    expect(accountabilityTrends.weeks.at(-1)).toMatchObject({
      weekStart: "2026-03-16",
      weekEnd: "2026-03-22"
    });
    expect(
      accountabilityTrends.movers.find((member) => member.memberId === "M002")
    ).toMatchObject({
      memberId: "M002",
      profile: {
        nameEnglish: "PARK MIN"
      },
      currentWindowEligibleCount: 2
    });
    expect(memberActivityCalendar).toMatchObject({
      assemblyNo: 22
    });
    expect(memberActivityCalendar.assembly.label).toBe("제22대 국회");
    expect(
      memberActivityCalendar.assembly.members.find((member) => member.memberId === "M002")
    ).toMatchObject({
      memberId: "M002",
      profile: {
        nameEnglish: "PARK MIN",
        briefHistory: "법률안 심사 경험 다수"
      },
      committeeMemberships: ["법제사법위원회", "예산결산특별위원회"],
      currentNegativeStreak: 0,
      absentDays: 1,
      committeeSummaries: expect.arrayContaining([
        expect.objectContaining({
          committeeName: "법제사법위원회"
        })
      ]),
      voteRecords: [],
      voteRecordCount: 2,
      voteRecordsPath: "exports/member_activity_calendar_members/M002.json",
      dayStates: [
        expect.objectContaining({
          totalRollCalls: 2
        })
      ]
    });
    expect(validatedMemberDetails.find((detail) => detail.memberId === "M002")).toMatchObject({
      memberId: "M002",
      voteRecords: expect.arrayContaining([
        expect.objectContaining({
          voteCode: "no"
        }),
        expect.objectContaining({
          voteCode: "absent"
        })
      ])
    });
    expect(manifest.currentAssembly).toMatchObject({
      assemblyNo: 22,
      label: "제22대 국회",
      unitCd: "100022"
    });
    expect(manifest.datasets.voteFacts.url).toContain("curated/vote_facts.parquet");
    expect(manifest.exports.latestVotes.path).toBe("exports/latest_votes.json");
    expect(manifest.exports.latestVotes.checksumSha256).toBe(
      sha256(serializePublishedJson(latestVotes))
    );
    expect(manifest.exports.accountabilitySummary.path).toBe("exports/accountability_summary.json");
    expect(manifest.exports.accountabilitySummary.checksumSha256).toBe(
      sha256(serializePublishedJson(accountabilitySummary))
    );
    expect(manifest.exports.accountabilityTrends?.path).toBe("exports/accountability_trends.json");
    expect(manifest.exports.accountabilityTrends?.checksumSha256).toBe(
      sha256(serializePublishedJson(accountabilityTrends))
    );
    expect(manifest.exports.memberActivityCalendar?.path).toBe("exports/member_activity_calendar.json");
    expect(manifest.exports.memberActivityCalendar?.checksumSha256).toBe(
      sha256(serializePublishedJson(memberActivityCalendar))
    );
  });

  it("validates fixture contract files", () => {
    const latestVotesFixture = JSON.parse(
      readFileSync(resolve(fixturesDir, "contracts/latest_votes.json"), "utf8")
    );
    const accountabilitySummaryFixture = JSON.parse(
      readFileSync(resolve(fixturesDir, "contracts/accountability_summary.json"), "utf8")
    );
    const manifestFixture = JSON.parse(
      readFileSync(resolve(fixturesDir, "contracts/manifest.json"), "utf8")
    );
    const accountabilityTrendsFixture = JSON.parse(
      readFileSync(resolve(fixturesDir, "contracts/accountability_trends.json"), "utf8")
    );
    const memberActivityCalendarFixture = JSON.parse(
      readFileSync(resolve(fixturesDir, "contracts/member_activity_calendar.json"), "utf8")
    );
    const memberActivityCalendarMemberDetailFixture = JSON.parse(
      readFileSync(
        resolve(fixturesDir, "contracts/member_activity_calendar_members/M002.json"),
        "utf8"
      )
    );
    const memberAssetsIndexFixture = JSON.parse(
      readFileSync(resolve(fixturesDir, "contracts/member_assets_index.json"), "utf8")
    );
    const memberAssetsHistoryFixture = JSON.parse(
      readFileSync(resolve(fixturesDir, "contracts/member_assets_history/M001.json"), "utf8")
    );
    const summaryMemberWithoutEmbeddedRecords = {
      ...memberActivityCalendarFixture.assembly.members[0],
      voteRecords: undefined
    };

    expect(latestVotesExportSchema.parse(latestVotesFixture).assemblyNo).toBe(22);
    expect(latestVotesExportSchema.parse(latestVotesFixture).items).toHaveLength(2);
    expect(accountabilitySummaryExportSchema.parse(accountabilitySummaryFixture).assemblyNo).toBe(22);
    expect(accountabilitySummaryExportSchema.parse(accountabilitySummaryFixture).items).toHaveLength(3);
    expect(accountabilityTrendsExportSchema.parse(accountabilityTrendsFixture).weeks).toHaveLength(12);
    expect(accountabilityTrendsExportSchema.parse(accountabilityTrendsFixture).movers).toHaveLength(3);
    expect(manifestSchema.parse(manifestFixture).datasets.members.rowCount).toBe(3);
    expect(manifestSchema.parse(manifestFixture).currentAssembly.assemblyNo).toBe(22);
    expect(manifestSchema.parse(manifestFixture).exports.memberAssetsIndex?.rowCount).toBe(2);
    expect(memberAssetsIndexExportSchema.parse(memberAssetsIndexFixture).members).toHaveLength(2);
    expect(memberAssetsHistoryExportSchema.parse(memberAssetsHistoryFixture).series).toHaveLength(2);
    expect(memberActivityCalendarExportSchema.parse(memberActivityCalendarFixture).assembly.assemblyNo).toBe(22);
    expect(
      memberActivityCalendarMemberSchema.parse(summaryMemberWithoutEmbeddedRecords)
    ).toMatchObject({
      memberId: "M002",
      voteRecords: [],
      voteRecordCount: 6,
      voteRecordsPath: "exports/member_activity_calendar_members/M002.json"
    });
    expect(
      memberActivityCalendarMemberDetailExportSchema.parse(memberActivityCalendarMemberDetailFixture)
    ).toMatchObject({
      memberId: "M002",
      voteRecords: expect.arrayContaining([expect.objectContaining({ voteCode: "yes" })])
    });
  });

  it("builds member activity detail exports alongside the summary export", () => {
    const bundle = validateNormalizedBundle(
      createNormalizedBundle({
        members: [
          {
            memberId: "M001",
            name: "김아라",
            party: "미래개혁당",
            district: "서울 중구",
            photoUrl: null,
            officialProfileUrl: null,
            officialExternalUrl: null,
            isCurrentMember: true,
            proportionalFlag: false,
            assemblyNo: 22
          }
        ],
        rollCalls: [
          {
            rollCallId: "rc-22-1",
            assemblyNo: 22,
            meetingId: "meeting-22-1",
            agendaId: "agenda-22-1",
            billId: "bill-22-1",
            billName: "법안 1",
            committeeName: "법제사법위원회",
            voteDatetime: "2026-03-20T10:00:00+09:00",
            voteVisibility: "recorded",
            sourceStatus: "confirmed",
            officialSourceUrl: "https://example.test/22/1",
            summary: null,
            snapshotId: "snapshot-22",
            sourceHash: "hash-22-1"
          }
        ],
        voteFacts: [
          {
            rollCallId: "rc-22-1",
            memberId: "M001",
            voteCode: "no",
            publishedAt: "2026-03-20T10:05:00+09:00",
            retrievedAt: "2026-03-22T11:45:00+09:00",
            sourceHash: "hash-22-1"
          }
        ],
        meetings: [],
        sources: [],
        agendas: []
      })
    );

    const memberActivityCalendar = buildMemberActivityCalendarExport(bundle);
    const memberDetails = buildMemberActivityCalendarMemberDetailExports(bundle);

    expect(memberActivityCalendar.assembly.members[0]).toMatchObject({
      memberId: "M001",
      voteRecords: [],
      voteRecordCount: 1,
      voteRecordsPath: "exports/member_activity_calendar_members/M001.json"
    });
    expect(memberDetails).toHaveLength(1);
    expect(memberDetails[0]).toMatchObject({
      memberId: "M001",
      voteRecords: [expect.objectContaining({ voteCode: "no" })]
    });
  });

  it("fails early when a published JSON export exceeds the size guard", () => {
    expect(() => assertPublishedJsonFileSize("exports/member_activity_calendar.json", "12345", 4)).toThrow(
      /publish limit/
    );
    expect(() => assertPublishedJsonFileSize("exports/member_activity_calendar.json", "1234", 4)).not.toThrow();
  });

  it("serializes latest votes exports as minified published JSON", () => {
    const latestVotesFixtureRaw = readFileSync(
      resolve(fixturesDir, "contracts/latest_votes.json"),
      "utf8"
    );
    const latestVotesFixture = JSON.parse(latestVotesFixtureRaw);
    const serialized = serializePublishedJson(latestVotesFixture);

    expect(serialized).toBe(JSON.stringify(latestVotesFixture));
    expect(serialized).not.toContain("\n");
    expect(Buffer.byteLength(serialized)).toBeLessThan(Buffer.byteLength(latestVotesFixtureRaw));
    expect(() =>
      assertPublishedJsonFileSize(
        "exports/latest_votes.json",
        serialized,
        Buffer.byteLength(serialized) - 1
      )
    ).toThrow(/publish limit/);
    expect(() =>
      assertPublishedJsonFileSize(
        "exports/latest_votes.json",
        serialized,
        Buffer.byteLength(serialized)
      )
    ).not.toThrow();
  });

  it("omits repeated member profile metadata from latest votes payloads", () => {
    const bundle = validateNormalizedBundle(
      createNormalizedBundle({
        members: [
          {
            memberId: "M001",
            name: "김아라",
            party: "미래개혁당",
            district: "서울 중구",
            photoUrl: "https://example.test/photo.jpg",
            officialProfileUrl: "https://example.test/profile",
            officialExternalUrl: "https://example.test/external",
            isCurrentMember: true,
            proportionalFlag: false,
            assemblyNo: 22,
            profile: {
              nameHanja: "金아라",
              nameEnglish: "KIM ARA",
              birthType: null,
              birthDate: null,
              roleName: null,
              reelectionLabel: null,
              electedAssembliesLabel: null,
              gender: null,
              representativeCommitteeName: null,
              affiliatedCommitteeName: null,
              briefHistory: null,
              officeRoom: null,
              officePhone: null,
              email: null,
              aideNames: [],
              chiefSecretaryNames: [],
              secretaryNames: []
            }
          }
        ],
        rollCalls: [
          {
            rollCallId: "rc-22-lean",
            assemblyNo: 22,
            meetingId: "meeting-22-lean",
            agendaId: "agenda-22-lean",
            billId: "bill-22-lean",
            billName: "경량 피드 테스트안",
            committeeName: "법제사법위원회",
            voteDatetime: "2026-03-24T10:00:00+09:00",
            voteVisibility: "recorded",
            sourceStatus: "confirmed",
            officialSourceUrl: "https://example.test/22/lean",
            summary: null,
            snapshotId: "snapshot-22",
            sourceHash: "hash-22-lean"
          }
        ],
        voteFacts: [
          {
            rollCallId: "rc-22-lean",
            memberId: "M001",
            voteCode: "no",
            publishedAt: "2026-03-24T10:05:00+09:00",
            retrievedAt: "2026-03-24T10:06:00+09:00",
            sourceHash: "hash-22-lean"
          }
        ],
        meetings: [],
        sources: [],
        agendas: []
      })
    );

    const latestVotes = buildLatestVotesExport(bundle);

    expect(latestVotes.items[0]?.highlightedVotes[0]).toMatchObject({
      memberId: "M001",
      memberName: "김아라",
      party: "미래개혁당",
      voteCode: "no"
    });
    expect(latestVotes.items[0]?.highlightedVotes[0]).not.toHaveProperty("photoUrl");
    expect(latestVotes.items[0]?.highlightedVotes[0]).not.toHaveProperty("officialProfileUrl");
    expect(latestVotes.items[0]?.highlightedVotes[0]).not.toHaveProperty("officialExternalUrl");
    expect(latestVotes.items[0]?.highlightedVotes[0]).not.toHaveProperty("profile");
  });

  it("merges member directory metadata onto vote-derived members when ids differ", () => {
    const bundle = validateNormalizedBundle(
      createNormalizedBundle({
        members: [
          {
            memberId: "고동진",
            name: "고동진",
            party: "국민의힘",
            district: null,
            photoUrl: null,
            officialProfileUrl: null,
            officialExternalUrl: null,
            isCurrentMember: false,
            proportionalFlag: false,
            assemblyNo: 22
          },
          {
            memberId: "HS39431V",
            name: "고동진",
            party: "국민의힘",
            district: "서울 강남구병",
            photoUrl: "https://www.assembly.go.kr/static/portal/img/openassm/new/thumb/8e0621184727401ea5537cbeb1557776.jpg",
            officialProfileUrl: "https://www.assembly.go.kr/members/22nd/KOHDONGJIN",
            officialExternalUrl: null,
            isCurrentMember: true,
            proportionalFlag: false,
            assemblyNo: 22
          }
        ],
        rollCalls: [
          {
            rollCallId: "plenary-22-0-0-20260320:PRC_X",
            assemblyNo: 22,
            meetingId: "plenary-22-0-0-20260320",
            agendaId: "2217594",
            billId: "PRC_X",
            billName: "공소청법안(대안)",
            committeeName: "법제사법위원회",
            voteDatetime: "2026-03-20 15:51:26.0",
            voteVisibility: "recorded",
            sourceStatus: "confirmed",
            officialSourceUrl: "http://likms.assembly.go.kr/bill/billDetail.do?billId=PRC_X",
            summary: "원안가결 · 법률안 · 2026-03-20",
            snapshotId: "snapshot-test",
            sourceHash: "source-hash"
          }
        ],
        voteFacts: [
          {
            rollCallId: "plenary-22-0-0-20260320:PRC_X",
            memberId: "고동진",
            voteCode: "abstain",
            publishedAt: "2026-03-20 15:51:26.0",
            retrievedAt: "2026-03-22T21:58:41.000Z",
            sourceHash: "source-hash"
          }
        ],
        meetings: [],
        sources: [],
        agendas: []
      })
    );

    const accountabilitySummary = buildAccountabilitySummaryExport(bundle);
    const latestVotes = buildLatestVotesExport(bundle);

    expect(accountabilitySummary.items[0]).toMatchObject({
      memberId: "고동진",
      photoUrl: "https://www.assembly.go.kr/static/portal/img/openassm/new/thumb/8e0621184727401ea5537cbeb1557776.jpg",
      officialProfileUrl: "https://www.assembly.go.kr/members/22nd/KOHDONGJIN"
    });
    expect(latestVotes.items[0]?.highlightedVotes[0]).toMatchObject({
      memberId: "고동진"
    });
    expect(latestVotes.items[0]?.highlightedVotes[0]).not.toHaveProperty("officialProfileUrl");
  });

  it("keeps all flagged member names in latest votes without truncating after twelve", () => {
    const members = Array.from({ length: 13 }, (_, index) => ({
      memberId: `M${String(index + 1).padStart(3, "0")}`,
      name: `의원${index + 1}`,
      party: "테스트당",
      district: null,
      photoUrl: null,
      officialProfileUrl: null,
      officialExternalUrl: null,
      isCurrentMember: true,
      proportionalFlag: false,
      assemblyNo: 22
    }));

    const bundle = validateNormalizedBundle(
      createNormalizedBundle({
        members,
        rollCalls: [
          {
            rollCallId: "plenary-22-0-0-20260320:PRC_LONG",
            assemblyNo: 22,
            meetingId: "plenary-22-0-0-20260320",
            agendaId: "2217595",
            billId: "PRC_LONG",
            billName: "테스트 표결안",
            committeeName: "법제사법위원회",
            voteDatetime: "2026-03-20 15:51:26.0",
            voteVisibility: "recorded",
            sourceStatus: "confirmed",
            officialSourceUrl: "http://likms.assembly.go.kr/bill/billDetail.do?billId=PRC_LONG",
            summary: "원안가결 · 법률안 · 2026-03-20",
            snapshotId: "snapshot-test",
            sourceHash: "source-hash"
          }
        ],
        voteFacts: members.map((member) => ({
          rollCallId: "plenary-22-0-0-20260320:PRC_LONG",
          memberId: member.memberId,
          voteCode: "no" as const,
          publishedAt: "2026-03-20 15:51:26.0",
          retrievedAt: "2026-03-22T21:58:41.000Z",
          sourceHash: "source-hash"
        })),
        meetings: [],
        sources: [],
        agendas: []
      })
    );

    const latestVotes = buildLatestVotesExport(bundle);

    expect(latestVotes.items[0]?.counts.no).toBe(13);
    expect(latestVotes.items[0]?.highlightedVotes).toHaveLength(13);
    expect(latestVotes.items[0]?.highlightedVotes.at(-1)).toMatchObject({
      memberId: "M013",
      memberName: "의원13"
    });
  });

  it("keeps highlighted names visible without links when member identity is incomplete", () => {
    const bundle = validateNormalizedBundle(
      createNormalizedBundle({
        members: [],
        rollCalls: [
          {
            rollCallId: "plenary-22-0-0-20260320:PRC_PARTIAL",
            assemblyNo: 22,
            meetingId: "plenary-22-0-0-20260320",
            agendaId: "2217599",
            billId: "PRC_PARTIAL",
            billName: "부분 식별 테스트안",
            committeeName: "법제사법위원회",
            voteDatetime: "2026-03-20 15:51:26.0",
            voteVisibility: "secret",
            sourceStatus: "confirmed",
            officialSourceUrl: "http://likms.assembly.go.kr/bill/billDetail.do?billId=PRC_PARTIAL",
            summary: "원안가결 · 법률안 · 2026-03-20",
            snapshotId: "snapshot-test",
            sourceHash: "source-hash"
          }
        ],
        voteFacts: [
          {
            rollCallId: "plenary-22-0-0-20260320:PRC_PARTIAL",
            memberName: "홍길동",
            party: "무소속",
            voteCode: "no",
            publishedAt: "2026-03-20 15:51:26.0",
            retrievedAt: "2026-03-22T21:58:41.000Z",
            sourceHash: "source-hash"
          },
          {
            rollCallId: "plenary-22-0-0-20260320:PRC_PARTIAL",
            memberId: "M404",
            memberName: undefined,
            party: null,
            voteCode: "abstain",
            publishedAt: "2026-03-20 15:51:26.0",
            retrievedAt: "2026-03-22T21:58:41.000Z",
            sourceHash: "source-hash"
          }
        ],
        meetings: [],
        sources: [],
        agendas: []
      })
    );

    const latestVotes = buildLatestVotesExport(bundle);

    expect(latestVotes.items[0]?.highlightedVotes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memberId: null,
          memberName: "홍길동",
          party: "무소속",
          voteCode: "no"
        }),
        expect.objectContaining({
          memberId: "M404",
          memberName: "M404",
          party: "정당 미상",
          voteCode: "abstain"
        })
      ])
    );
  });

  it("does not count pre-join roll calls as absent for late-joining incumbents", () => {
    const bundle = validateNormalizedBundle(
      createNormalizedBundle({
        members: [
          {
            memberId: "M001",
            name: "김아라",
            party: "미래개혁당",
            district: "서울 중구",
            photoUrl: null,
            officialProfileUrl: null,
            officialExternalUrl: null,
            isCurrentMember: true,
            proportionalFlag: false,
            assemblyNo: 22
          },
          {
            memberId: "M002",
            name: "박민",
            party: "미래개혁당",
            district: "부산 남구",
            photoUrl: null,
            officialProfileUrl: null,
            officialExternalUrl: null,
            isCurrentMember: true,
            proportionalFlag: false,
            assemblyNo: 22
          }
        ],
        rollCalls: [
          {
            rollCallId: "rc-22-1",
            assemblyNo: 22,
            meetingId: "meeting-22-1",
            agendaId: "agenda-22-1",
            billId: "bill-22-1",
            billName: "법안 1",
            committeeName: "법제사법위원회",
            voteDatetime: "2026-03-20T10:00:00+09:00",
            voteVisibility: "recorded",
            sourceStatus: "confirmed",
            officialSourceUrl: "https://example.test/22/1",
            summary: null,
            snapshotId: "snapshot-22",
            sourceHash: "hash-22-1"
          },
          {
            rollCallId: "rc-22-2",
            assemblyNo: 22,
            meetingId: "meeting-22-2",
            agendaId: "agenda-22-2",
            billId: "bill-22-2",
            billName: "법안 2",
            committeeName: "법제사법위원회",
            voteDatetime: "2026-03-22T10:00:00+09:00",
            voteVisibility: "recorded",
            sourceStatus: "confirmed",
            officialSourceUrl: "https://example.test/22/2",
            summary: null,
            snapshotId: "snapshot-22",
            sourceHash: "hash-22-2",
            officialTally: {
              registeredCount: 1,
              presentCount: 0,
              yesCount: 0,
              noCount: 0,
              abstainCount: 0,
              invalidCount: 0
            }
          }
        ],
        voteFacts: [
          {
            rollCallId: "rc-22-1",
            memberId: "M001",
            voteCode: "yes",
            publishedAt: "2026-03-20T10:05:00+09:00",
            retrievedAt: "2026-03-22T11:45:00+09:00",
            sourceHash: "hash-22-1"
          },
          {
            rollCallId: "rc-22-2",
            memberId: "M001",
            voteCode: "no",
            publishedAt: "2026-03-22T10:05:00+09:00",
            retrievedAt: "2026-03-22T11:45:00+09:00",
            sourceHash: "hash-22-2"
          },
          {
            rollCallId: "rc-22-2",
            memberId: "M002",
            voteCode: "abstain",
            publishedAt: "2026-03-22T10:05:00+09:00",
            retrievedAt: "2026-03-22T11:45:00+09:00",
            sourceHash: "hash-22-2"
          }
        ],
        meetings: [],
        sources: [],
        agendas: []
      })
    );

    const tenureIndex = new Map([
      ["M001", [{ startDate: "2024-05-30", endDate: "2028-05-29" }]],
      ["M002", [{ startDate: "2026-03-21", endDate: "2028-05-29" }]]
    ]);
    const accountabilitySummary = buildAccountabilitySummaryExport(bundle, { tenureIndex });
    const memberActivityCalendar = buildMemberActivityCalendarExport(bundle, { tenureIndex });

    expect(accountabilitySummary.items.find((item) => item.memberId === "M002")).toMatchObject({
      totalRecordedVotes: 1,
      abstainCount: 1,
      absentCount: 0
    });
    expect(memberActivityCalendar.assembly.members.find((member) => member.memberId === "M002")).toMatchObject({
      absentDays: 0,
      negativeDays: 1
    });
  });

  it("keeps same-day roll calls separate in aggregates but summarizes them into one calendar cell", () => {
    const bundle = validateNormalizedBundle(
      createNormalizedBundle({
        members: [
          {
            memberId: "M001",
            name: "김아라",
            party: "미래개혁당",
            district: "서울 중구",
            photoUrl: null,
            officialProfileUrl: null,
            officialExternalUrl: null,
            isCurrentMember: true,
            proportionalFlag: false,
            assemblyNo: 22
          }
        ],
        rollCalls: [
          {
            rollCallId: "rc-22-1",
            assemblyNo: 22,
            meetingId: "meeting-22-1",
            agendaId: "agenda-22-1",
            billId: "bill-22-1",
            billName: "법안 1",
            committeeName: "법제사법위원회",
            voteDatetime: "2026-03-20T10:00:00+09:00",
            voteVisibility: "recorded",
            sourceStatus: "confirmed",
            officialSourceUrl: "https://example.test/22/1",
            summary: null,
            snapshotId: "snapshot-22",
            sourceHash: "hash-22-1"
          },
          {
            rollCallId: "rc-22-2",
            assemblyNo: 22,
            meetingId: "meeting-22-2",
            agendaId: "agenda-22-2",
            billId: "bill-22-2",
            billName: "법안 2",
            committeeName: "법제사법위원회",
            voteDatetime: "2026-03-20T14:00:00+09:00",
            voteVisibility: "recorded",
            sourceStatus: "confirmed",
            officialSourceUrl: "https://example.test/22/2",
            summary: null,
            snapshotId: "snapshot-22",
            sourceHash: "hash-22-2",
            officialTally: {
              registeredCount: 1,
              presentCount: 0,
              yesCount: 0,
              noCount: 0,
              abstainCount: 0,
              invalidCount: 0
            }
          }
        ],
        voteFacts: [
          {
            rollCallId: "rc-22-1",
            memberId: "M001",
            voteCode: "no",
            publishedAt: "2026-03-20T10:05:00+09:00",
            retrievedAt: "2026-03-22T11:45:00+09:00",
            sourceHash: "hash-22-1"
          }
        ],
        meetings: [],
        sources: [],
        agendas: []
      })
    );

    const tenureIndex = new Map([
      ["M001", [{ startDate: "2024-05-30", endDate: "2028-05-29" }]]
    ]);

    const accountabilitySummary = buildAccountabilitySummaryExport(bundle, { tenureIndex });
    const memberActivityCalendar = buildMemberActivityCalendarExport(bundle, { tenureIndex });

    expect(accountabilitySummary.items[0]).toMatchObject({
      totalRecordedVotes: 2,
      noCount: 1,
      absentCount: 1
    });
    expect(memberActivityCalendar.assembly.members[0]?.committeeSummaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          committeeName: "법제사법위원회",
          eligibleRollCallCount: 2,
          participatedRollCallCount: 1,
          absentRollCallCount: 1,
          participationRate: 0.5
        })
      ])
    );
    expect(memberActivityCalendar.assembly.members[0]?.dayStates).toEqual([
      expect.objectContaining({
        date: "2026-03-20",
        noCount: 1,
        absentCount: 1,
        totalRollCalls: 2,
        state: "absent"
      })
    ]);
  });

  it("uses official roll-call totals but avoids deriving absent names when row totals do not match", () => {
    const bundle = validateNormalizedBundle(
      createNormalizedBundle({
        members: [
          {
            memberId: "M001",
            name: "김아라",
            party: "미래개혁당",
            district: "서울 중구",
            photoUrl: null,
            officialProfileUrl: null,
            officialExternalUrl: null,
            isCurrentMember: true,
            proportionalFlag: false,
            assemblyNo: 22
          },
          {
            memberId: "M002",
            name: "박민",
            party: "미래개혁당",
            district: "부산 남구",
            photoUrl: null,
            officialProfileUrl: null,
            officialExternalUrl: null,
            isCurrentMember: true,
            proportionalFlag: false,
            assemblyNo: 22
          },
          {
            memberId: "M003",
            name: "이수",
            party: "시민녹색당",
            district: null,
            photoUrl: null,
            officialProfileUrl: null,
            officialExternalUrl: null,
            isCurrentMember: true,
            proportionalFlag: false,
            assemblyNo: 22
          },
          {
            memberId: "M004",
            name: "한창민",
            party: "사회민주당",
            district: null,
            photoUrl: null,
            officialProfileUrl: null,
            officialExternalUrl: null,
            isCurrentMember: true,
            proportionalFlag: false,
            assemblyNo: 22
          }
        ],
        rollCalls: [
          {
            rollCallId: "rc-22-mismatch",
            assemblyNo: 22,
            meetingId: "meeting-22-mismatch",
            agendaId: "agenda-22-mismatch",
            billId: "bill-22-mismatch",
            billName: "법안 3",
            committeeName: "법제사법위원회",
            voteDatetime: "2026-03-24T10:00:00+09:00",
            voteVisibility: "recorded",
            sourceStatus: "confirmed",
            officialSourceUrl: "https://example.test/22/mismatch",
            summary: null,
            snapshotId: "snapshot-22",
            sourceHash: "hash-22-mismatch",
            officialTally: {
              registeredCount: 4,
              presentCount: 3,
              yesCount: 1,
              noCount: 2,
              abstainCount: 0,
              invalidCount: 0
            }
          }
        ],
        voteFacts: [
          {
            rollCallId: "rc-22-mismatch",
            memberId: "M001",
            voteCode: "yes",
            publishedAt: "2026-03-24T10:05:00+09:00",
            retrievedAt: "2026-03-24T10:06:00+09:00",
            sourceHash: "hash-22-mismatch"
          },
          {
            rollCallId: "rc-22-mismatch",
            memberId: "M002",
            voteCode: "no",
            publishedAt: "2026-03-24T10:05:00+09:00",
            retrievedAt: "2026-03-24T10:06:00+09:00",
            sourceHash: "hash-22-mismatch"
          }
        ],
        meetings: [],
        sources: [],
        agendas: []
      })
    );

    const tenureIndex = new Map([
      ["M001", [{ startDate: "2024-05-30", endDate: "2028-05-29" }]],
      ["M002", [{ startDate: "2024-05-30", endDate: "2028-05-29" }]],
      ["M003", [{ startDate: "2024-05-30", endDate: "2028-05-29" }]],
      ["M004", [{ startDate: "2024-05-30", endDate: "2028-05-29" }]]
    ]);

    const latestVotes = buildLatestVotesExport(bundle, { tenureIndex });
    const accountabilitySummary = buildAccountabilitySummaryExport(bundle, { tenureIndex });
    const accountabilityTrends = buildAccountabilityTrendsExport(bundle, { tenureIndex });
    const memberActivityCalendar = buildMemberActivityCalendarExport(bundle, { tenureIndex });

    expect(latestVotes.items[0]).toMatchObject({
      absentListStatus: "unavailable",
      counts: {
        yes: 1,
        no: 2,
        abstain: 0,
        absent: 1
      },
      absentVotes: []
    });
    expect(accountabilitySummary.items.find((item) => item.memberId === "M003")).toMatchObject({
      totalRecordedVotes: 1,
      absentCount: 1
    });
    expect(accountabilitySummary.items.find((item) => item.memberId === "M004")).toMatchObject({
      totalRecordedVotes: 1,
      absentCount: 1
    });
    expect(accountabilityTrends.movers.find((member) => member.memberId === "M003")).toMatchObject({
      currentWindowEligibleCount: 1,
      currentWindowAbsentCount: 1
    });
    expect(accountabilityTrends.movers.find((member) => member.memberId === "M004")).toMatchObject({
      currentWindowEligibleCount: 1,
      currentWindowAbsentCount: 1
    });
    expect(memberActivityCalendar.assembly.members.find((member) => member.memberId === "M003")).toMatchObject({
      absentDays: 1,
      dayStates: [
        expect.objectContaining({
          date: "2026-03-24",
          absentCount: 1,
          unknownCount: 0,
          state: "absent"
        })
      ]
    });
    expect(memberActivityCalendar.assembly.members.find((member) => member.memberId === "M004")).toMatchObject({
      absentDays: 1
    });
  });

  it("fails public exports when multiple assemblies are mixed into one bundle", () => {
    const bundle = validateNormalizedBundle(
      createNormalizedBundle({
        members: [
          {
            memberId: "M022",
            name: "박민",
            party: "미래개혁당",
            district: null,
            photoUrl: null,
            officialProfileUrl: null,
            officialExternalUrl: null,
            proportionalFlag: false,
            assemblyNo: 22
          },
          {
            memberId: "M021",
            name: "정하늘",
            party: "시민녹색당",
            district: null,
            photoUrl: null,
            officialProfileUrl: null,
            officialExternalUrl: null,
            proportionalFlag: false,
            assemblyNo: 21
          }
        ],
        rollCalls: [
          {
            rollCallId: "rc-22-1",
            assemblyNo: 22,
            meetingId: "meeting-22-1",
            agendaId: "agenda-22-1",
            billId: "bill-22-1",
            billName: "법안 22",
            committeeName: "법제사법위원회",
            voteDatetime: "2026-03-20T10:00:00+09:00",
            voteVisibility: "recorded",
            sourceStatus: "confirmed",
            officialSourceUrl: "https://example.test/22/1",
            summary: null,
            snapshotId: "snapshot-22",
            sourceHash: "hash-22-1"
          },
          {
            rollCallId: "rc-21-1",
            assemblyNo: 21,
            meetingId: "meeting-21-1",
            agendaId: "agenda-21-1",
            billId: "bill-21-1",
            billName: "법안 21",
            committeeName: "행정안전위원회",
            voteDatetime: "2024-04-01T10:00:00+09:00",
            voteVisibility: "recorded",
            sourceStatus: "confirmed",
            officialSourceUrl: "https://example.test/21/1",
            summary: null,
            snapshotId: "snapshot-21",
            sourceHash: "hash-21-1"
          }
        ],
        voteFacts: [
          {
            rollCallId: "rc-22-1",
            memberId: "M022",
            voteCode: "no",
            publishedAt: "2026-03-20T10:05:00+09:00",
            retrievedAt: "2026-03-22T11:45:00+09:00",
            sourceHash: "hash-22-1"
          },
          {
            rollCallId: "rc-21-1",
            memberId: "M021",
            voteCode: "abstain",
            publishedAt: "2024-04-01T10:05:00+09:00",
            retrievedAt: "2026-03-22T11:45:00+09:00",
            sourceHash: "hash-21-1"
          }
        ],
        meetings: [],
        sources: [],
        agendas: []
      })
    );

    expect(() => buildLatestVotesExport(bundle)).toThrow("Public exports must contain exactly one Assembly.");
    expect(() => buildAccountabilitySummaryExport(bundle)).toThrow(
      "Public exports must contain exactly one Assembly."
    );
    expect(() => buildMemberActivityCalendarExport(bundle)).toThrow(
      "Public exports must contain exactly one Assembly."
    );
  });

  it("updates public export assembly labels when the latest Assembly changes", () => {
    const bundle = validateNormalizedBundle(
      createNormalizedBundle({
        members: [
          {
            memberId: "M023",
            name: "새의원",
            party: "새정당",
            district: null,
            photoUrl: null,
            officialProfileUrl: null,
            officialExternalUrl: null,
            isCurrentMember: true,
            proportionalFlag: false,
            assemblyNo: 23
          }
        ],
        rollCalls: [
          {
            rollCallId: "rc-23-1",
            assemblyNo: 23,
            meetingId: "meeting-23-1",
            agendaId: "agenda-23-1",
            billId: "bill-23-1",
            billName: "새 법안",
            committeeName: "법제사법위원회",
            voteDatetime: "2028-06-01T10:00:00+09:00",
            voteVisibility: "recorded",
            sourceStatus: "confirmed",
            officialSourceUrl: "https://example.test/23/1",
            summary: null,
            snapshotId: "snapshot-23",
            sourceHash: "hash-23-1"
          }
        ],
        voteFacts: [
          {
            rollCallId: "rc-23-1",
            memberId: "M023",
            voteCode: "no",
            publishedAt: "2028-06-01T10:05:00+09:00",
            retrievedAt: "2028-06-01T10:10:00+09:00",
            sourceHash: "hash-23-1"
          }
        ],
        meetings: [],
        sources: [],
        agendas: []
      })
    );

    expect(buildLatestVotesExport(bundle)).toMatchObject({
      assemblyNo: 23,
      assemblyLabel: "제23대 국회"
    });
    expect(buildAccountabilitySummaryExport(bundle)).toMatchObject({
      assemblyNo: 23,
      assemblyLabel: "제23대 국회"
    });
    expect(buildMemberActivityCalendarExport(bundle)).toMatchObject({
      assemblyNo: 23,
      assemblyLabel: "제23대 국회",
      assembly: {
        assemblyNo: 23,
        label: "제23대 국회"
      }
    });
  });

  it("excludes former members from general accountability aggregates", () => {
    const bundle = validateNormalizedBundle(
      createNormalizedBundle({
        members: [
          {
            memberId: "FORMER-1",
            name: "퇴직의원",
            party: "시민연합",
            district: null,
            photoUrl: null,
            officialProfileUrl: null,
            officialExternalUrl: null,
            isCurrentMember: false,
            proportionalFlag: false,
            assemblyNo: 22
          },
          {
            memberId: "CURRENT-1",
            name: "현직의원",
            party: "시민연합",
            district: null,
            photoUrl: null,
            officialProfileUrl: null,
            officialExternalUrl: null,
            isCurrentMember: true,
            proportionalFlag: false,
            assemblyNo: 22
          }
        ],
        rollCalls: [
          {
            rollCallId: "rc-22-1",
            assemblyNo: 22,
            meetingId: "meeting-22-1",
            agendaId: "agenda-22-1",
            billId: "bill-22-1",
            billName: "법안 22",
            committeeName: "법제사법위원회",
            voteDatetime: "2026-03-20T10:00:00+09:00",
            voteVisibility: "recorded",
            sourceStatus: "confirmed",
            officialSourceUrl: "https://example.test/22/1",
            summary: null,
            snapshotId: "snapshot-22",
            sourceHash: "hash-22-1"
          }
        ],
        voteFacts: [
          {
            rollCallId: "rc-22-1",
            memberId: "FORMER-1",
            voteCode: "no",
            publishedAt: "2026-03-20T10:05:00+09:00",
            retrievedAt: "2026-03-22T11:45:00+09:00",
            sourceHash: "hash-22-1"
          },
          {
            rollCallId: "rc-22-1",
            memberId: "CURRENT-1",
            voteCode: "yes",
            publishedAt: "2026-03-20T10:05:00+09:00",
            retrievedAt: "2026-03-22T11:45:00+09:00",
            sourceHash: "hash-22-1"
          }
        ],
        meetings: [],
        sources: [],
        agendas: []
      })
    );

    const accountabilitySummary = buildAccountabilitySummaryExport(bundle);
    const memberActivityCalendar = buildMemberActivityCalendarExport(bundle);

    expect(accountabilitySummary.items).toHaveLength(1);
    expect(accountabilitySummary.items[0]?.memberId).toBe("CURRENT-1");
    expect(memberActivityCalendar.assembly.members).toHaveLength(1);
    expect(memberActivityCalendar.assembly.members[0]?.memberId).toBe("CURRENT-1");
  });
});
