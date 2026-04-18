import { describe, expect, it } from "vitest";

import {
  buildAccountabilitySummaryExport,
  buildAccountabilityTrendsExport
} from "../../packages/ingest/src/exports.js";
import { createNormalizedBundle } from "../../packages/ingest/src/normalize.js";
import { buildMemberTenureIndex } from "../../packages/ingest/src/tenure.js";
import { validateNormalizedBundle } from "../../packages/ingest/src/validation.js";

import type {
  MemberRecord,
  RollCallRecord,
  VoteFactRecord
} from "@lawmaker-monitor/schemas";
import type { MemberTenureRecord } from "../../packages/ingest/src/tenure.js";

function createMember(
  memberId: string,
  name: string,
  party: string
): MemberRecord {
  return {
    memberId,
    name,
    party,
    district: null,
    committeeMemberships: [],
    photoUrl: null,
    officialProfileUrl: null,
    officialExternalUrl: null,
    isCurrentMember: true,
    proportionalFlag: false,
    assemblyNo: 22
  };
}

function createRollCall(
  rollCallId: string,
  voteDatetime: string
): RollCallRecord {
  return {
    rollCallId,
    assemblyNo: 22,
    meetingId: `meeting-${rollCallId}`,
    agendaId: `agenda-${rollCallId}`,
    billId: `bill-${rollCallId}`,
    billName: `Bill ${rollCallId}`,
    committeeName: "법제사법위원회",
    voteDatetime,
    voteVisibility: "recorded",
    sourceStatus: "confirmed",
    officialSourceUrl: `https://example.test/${rollCallId}`,
    summary: null,
    snapshotId: "snapshot-22",
    sourceHash: `hash-${rollCallId}`
  };
}

function createVoteFact(args: {
  rollCallId: string;
  memberId: string;
  voteCode: VoteFactRecord["voteCode"];
  party?: string | null;
}): VoteFactRecord {
  return {
    rollCallId: args.rollCallId,
    memberId: args.memberId,
    memberName: null,
    party: args.party ?? null,
    voteCode: args.voteCode,
    publishedAt: "2026-03-20T10:05:00+09:00",
    retrievedAt: "2026-03-20T10:10:00+09:00",
    sourceHash: `hash-${args.rollCallId}-${args.memberId}`
  };
}

function createBundle(args: {
  members: MemberRecord[];
  rollCalls: RollCallRecord[];
  voteFacts: VoteFactRecord[];
}) {
  return validateNormalizedBundle(
    createNormalizedBundle({
      members: args.members,
      rollCalls: args.rollCalls,
      voteFacts: args.voteFacts,
      meetings: [],
      sources: [],
      agendas: []
    })
  );
}

describe("party-line accountability metrics", () => {
  it("counts party-line defections when a strict majority exists", () => {
    const bundle = createBundle({
      members: [
        createMember("M001", "김아라", "미래개혁당"),
        createMember("M002", "박민", "미래개혁당"),
        createMember("M003", "이수", "미래개혁당"),
        createMember("M004", "한결", "시민녹색당")
      ],
      rollCalls: [createRollCall("rc-1", "2026-03-20T10:00:00+09:00")],
      voteFacts: [
        createVoteFact({
          rollCallId: "rc-1",
          memberId: "M001",
          voteCode: "yes",
          party: "미래개혁당"
        }),
        createVoteFact({
          rollCallId: "rc-1",
          memberId: "M002",
          voteCode: "yes",
          party: "미래개혁당"
        }),
        createVoteFact({
          rollCallId: "rc-1",
          memberId: "M003",
          voteCode: "no",
          party: "미래개혁당"
        }),
        createVoteFact({
          rollCallId: "rc-1",
          memberId: "M004",
          voteCode: "no",
          party: "시민녹색당"
        })
      ]
    });

    const accountabilitySummary = buildAccountabilitySummaryExport(bundle);
    const accountabilityTrends = buildAccountabilityTrendsExport(bundle);
    const summaryByMemberId = new Map(
      accountabilitySummary.items.map((item) => [item.memberId, item] as const)
    );
    const activeWeek = accountabilityTrends.weeks.find(
      (week) => week.eligibleVoteCount > 0
    );
    const mover = accountabilityTrends.movers.find(
      (item) => item.memberId === "M003"
    );

    expect(summaryByMemberId.get("M003")).toMatchObject({
      partyLineOpportunityCount: 1,
      partyLineParticipationCount: 1,
      partyLineDefectionCount: 1,
      partyLineDefectionRate: 1
    });
    expect(summaryByMemberId.get("M001")).toMatchObject({
      partyLineOpportunityCount: 1,
      partyLineParticipationCount: 1,
      partyLineDefectionCount: 0,
      partyLineDefectionRate: 0
    });
    expect(summaryByMemberId.get("M004")).toMatchObject({
      partyLineOpportunityCount: 0,
      partyLineParticipationCount: 0,
      partyLineDefectionCount: 0,
      partyLineDefectionRate: 0
    });
    expect(activeWeek).toMatchObject({
      partyLineOpportunityCount: 3,
      partyLineParticipationCount: 3,
      partyLineDefectionCount: 1
    });
    expect(mover).toMatchObject({
      currentWindowPartyLineOpportunityCount: 1,
      currentWindowPartyLineParticipationCount: 1,
      currentWindowPartyLineDefectionCount: 1
    });
  });

  it("skips tie votes and single-participant party groups", () => {
    const bundle = createBundle({
      members: [
        createMember("M001", "김아라", "미래개혁당"),
        createMember("M002", "박민", "미래개혁당")
      ],
      rollCalls: [
        createRollCall("rc-tie", "2026-03-20T10:00:00+09:00"),
        createRollCall("rc-single", "2026-03-21T10:00:00+09:00")
      ],
      voteFacts: [
        createVoteFact({
          rollCallId: "rc-tie",
          memberId: "M001",
          voteCode: "yes",
          party: "미래개혁당"
        }),
        createVoteFact({
          rollCallId: "rc-tie",
          memberId: "M002",
          voteCode: "no",
          party: "미래개혁당"
        }),
        createVoteFact({
          rollCallId: "rc-single",
          memberId: "M001",
          voteCode: "yes",
          party: "미래개혁당"
        })
      ]
    });

    const accountabilitySummary = buildAccountabilitySummaryExport(bundle);

    expect(accountabilitySummary.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memberId: "M001",
          partyLineOpportunityCount: 0,
          partyLineParticipationCount: 0,
          partyLineDefectionCount: 0
        }),
        expect.objectContaining({
          memberId: "M002",
          partyLineOpportunityCount: 0,
          partyLineParticipationCount: 0,
          partyLineDefectionCount: 0
        })
      ])
    );
  });

  it("treats absences as missed opportunities instead of defections", () => {
    const bundle = createBundle({
      members: [
        createMember("M001", "김아라", "미래개혁당"),
        createMember("M002", "박민", "미래개혁당"),
        createMember("M003", "이수", "미래개혁당")
      ],
      rollCalls: [createRollCall("rc-absent", "2026-03-20T10:00:00+09:00")],
      voteFacts: [
        createVoteFact({
          rollCallId: "rc-absent",
          memberId: "M001",
          voteCode: "yes",
          party: "미래개혁당"
        }),
        createVoteFact({
          rollCallId: "rc-absent",
          memberId: "M002",
          voteCode: "yes",
          party: "미래개혁당"
        })
      ]
    });

    const accountabilitySummary = buildAccountabilitySummaryExport(bundle);
    const summaryByMemberId = new Map(
      accountabilitySummary.items.map((item) => [item.memberId, item] as const)
    );

    expect(summaryByMemberId.get("M003")).toMatchObject({
      partyLineOpportunityCount: 1,
      partyLineParticipationCount: 0,
      partyLineDefectionCount: 0,
      partyLineDefectionRate: 0
    });
  });

  it("prefers explicit vote-party labels and respects tenure-adjusted eligibility", () => {
    const members = [
      createMember("M001", "김아라", "새미래당"),
      createMember("M002", "박민", "원정당"),
      createMember("M003", "이수", "원정당"),
      createMember("M004", "한결", "원정당")
    ];
    const rollCalls = [
      createRollCall("rc-early", "2026-03-20T10:00:00+09:00"),
      createRollCall("rc-late", "2026-03-25T10:00:00+09:00")
    ];
    const voteFacts = [
      createVoteFact({
        rollCallId: "rc-early",
        memberId: "M003",
        voteCode: "yes",
        party: "원정당"
      }),
      createVoteFact({
        rollCallId: "rc-early",
        memberId: "M004",
        voteCode: "yes",
        party: "원정당"
      }),
      createVoteFact({
        rollCallId: "rc-late",
        memberId: "M001",
        voteCode: "no",
        party: "원정당"
      }),
      createVoteFact({
        rollCallId: "rc-late",
        memberId: "M002",
        voteCode: "yes",
        party: "원정당"
      }),
      createVoteFact({
        rollCallId: "rc-late",
        memberId: "M003",
        voteCode: "yes",
        party: "원정당"
      })
    ];
    const bundle = createBundle({
      members,
      rollCalls,
      voteFacts
    });
    const tenureRecords: MemberTenureRecord[] = [
      {
        memberId: "M001",
        name: "김아라",
        assemblyNo: 22,
        startDate: "2026-03-01",
        endDate: null
      },
      {
        memberId: "M002",
        name: "박민",
        assemblyNo: 22,
        startDate: "2026-03-24",
        endDate: null
      },
      {
        memberId: "M003",
        name: "이수",
        assemblyNo: 22,
        startDate: "2026-03-01",
        endDate: null
      },
      {
        memberId: "M004",
        name: "한결",
        assemblyNo: 22,
        startDate: "2026-03-01",
        endDate: null
      }
    ];
    const tenureIndex = buildMemberTenureIndex({
      members: bundle.members,
      tenures: tenureRecords,
      assemblyNo: 22
    });

    const accountabilitySummary = buildAccountabilitySummaryExport(bundle, {
      tenureIndex
    });
    const summaryByMemberId = new Map(
      accountabilitySummary.items.map((item) => [item.memberId, item] as const)
    );

    expect(summaryByMemberId.get("M001")).toMatchObject({
      partyLineOpportunityCount: 1,
      partyLineParticipationCount: 1,
      partyLineDefectionCount: 1,
      partyLineDefectionRate: 1
    });
    expect(summaryByMemberId.get("M002")).toMatchObject({
      partyLineOpportunityCount: 1,
      partyLineParticipationCount: 1,
      partyLineDefectionCount: 0
    });
  });
});
