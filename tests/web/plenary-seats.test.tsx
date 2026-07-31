import { describe, expect, it } from "vitest";

import {
  buildPlenarySeatAssignments,
  buildPlenarySeatPositions,
  countLinkedSeatOutcomes,
  matchesPlenarySeatFilters,
  PLENARY_ROW_COUNTS,
  PLENARY_SEAT_COUNT
} from "../../apps/web/src/lib/plenary-seats.js";

import type {
  AccountabilitySummaryExport,
  LatestVoteItem
} from "@lawmaker-monitor/schemas";

const members: AccountabilitySummaryExport["items"] = [
  {
    memberId: "member-yes",
    name: "가의원",
    party: "국민의힘",
    district: "서울 가구",
    assemblyNo: 22,
    totalRecordedVotes: 1,
    noCount: 0,
    abstainCount: 0,
    absentCount: 0,
    noRate: 0,
    abstainRate: 0,
    absentRate: 0,
    partyLineOpportunityCount: 0,
    partyLineParticipationCount: 0,
    partyLineDefectionCount: 0,
    partyLineDefectionRate: 0
  },
  {
    memberId: "member-no",
    name: "나의원",
    party: "더불어민주당",
    district: "부산 나구",
    assemblyNo: 22,
    totalRecordedVotes: 1,
    noCount: 1,
    abstainCount: 0,
    absentCount: 0,
    noRate: 1,
    abstainRate: 0,
    absentRate: 0,
    partyLineOpportunityCount: 0,
    partyLineParticipationCount: 0,
    partyLineDefectionCount: 0,
    partyLineDefectionRate: 0
  },
  {
    memberId: "member-abstain",
    name: "다의원",
    party: "진보당",
    district: "비례대표",
    assemblyNo: 22,
    totalRecordedVotes: 1,
    noCount: 0,
    abstainCount: 1,
    absentCount: 0,
    noRate: 0,
    abstainRate: 1,
    absentRate: 0,
    partyLineOpportunityCount: 0,
    partyLineParticipationCount: 0,
    partyLineDefectionCount: 0,
    partyLineDefectionRate: 0
  }
];

const vote: LatestVoteItem = {
  rollCallId: "roll-call-test",
  meetingId: "meeting-test",
  agendaId: "agenda-test",
  billName: "테스트 법률안",
  committeeName: "테스트위원회",
  voteDatetime: "2026-07-31T10:00:00+09:00",
  voteVisibility: "recorded",
  sourceStatus: "confirmed",
  counts: {
    yes: 1,
    no: 1,
    abstain: 1,
    absent: 0,
    invalid: 0,
    unknown: 0
  },
  highlightedVotes: [
    {
      memberId: "member-no",
      memberName: "나의원",
      party: "더불어민주당",
      voteCode: "no"
    },
    {
      memberId: "member-abstain",
      memberName: "다의원",
      party: "진보당",
      voteCode: "abstain"
    }
  ],
  absentVotes: [],
  memberVotes: [
    {
      memberId: "member-yes",
      memberName: "가의원",
      party: "국민의힘",
      voteCode: "yes"
    },
    {
      memberId: "member-no",
      memberName: "나의원",
      party: "더불어민주당",
      voteCode: "no"
    },
    {
      memberId: "member-abstain",
      memberName: "다의원",
      party: "진보당",
      voteCode: "abstain"
    }
  ],
  memberVoteListStatus: "verified",
  officialSourceUrl: "https://example.com/votes/roll-call-test",
  updatedAt: "2026-07-31T10:05:00+09:00",
  snapshotId: "snapshot-test",
  sourceHash: "source-hash-test"
};

describe("plenary seat layout", () => {
  it("builds a complete 300-seat fan within the visualization bounds", () => {
    const positions = buildPlenarySeatPositions();

    expect(positions).toHaveLength(PLENARY_SEAT_COUNT);
    expect(new Set(positions.map((position) => position.seatNumber)).size).toBe(
      PLENARY_SEAT_COUNT
    );
    expect(
      positions.every(
        (position) =>
          position.xPercent >= 0 &&
          position.xPercent <= 100 &&
          position.yPercent >= 0 &&
          position.yPercent <= 100
      )
    ).toBe(true);
    expect(PLENARY_ROW_COUNTS.at(-1)).toBeLessThan(40);
    expect(Math.max(...PLENARY_ROW_COUNTS)).toBe(PLENARY_ROW_COUNTS.at(-1));
  });

  it("links every explicitly published member outcome including yes", () => {
    const assignments = buildPlenarySeatAssignments({ members, vote });
    const counts = countLinkedSeatOutcomes(assignments);

    expect(
      assignments.find(
        (assignment) => assignment.member?.memberId === "member-no"
      )?.outcome
    ).toBe("no");
    expect(
      assignments.find(
        (assignment) => assignment.member?.memberId === "member-abstain"
      )?.outcome
    ).toBe("abstain");
    expect(
      assignments.find(
        (assignment) => assignment.member?.memberId === "member-yes"
      )?.outcome
    ).toBe("yes");
    expect(counts).toMatchObject({
      yes: 1,
      no: 1,
      abstain: 1,
      absent: 0,
      unlinked: 0
    });
  });

  it("falls back to the normalized member name when source identifiers differ", () => {
    const mismatchedVote: LatestVoteItem = {
      ...vote,
      memberVotes: vote.memberVotes.map((memberVote) =>
        memberVote.memberName === "가의원"
          ? { ...memberVote, memberId: "legacy-member-yes" }
          : memberVote
      )
    };

    const assignments = buildPlenarySeatAssignments({
      members,
      vote: mismatchedVote
    });

    expect(
      assignments.find(
        (assignment) => assignment.member?.memberId === "member-yes"
      )?.outcome
    ).toBe("yes");
  });

  it("matches seats by party, member name, and district", () => {
    const assignments = buildPlenarySeatAssignments({ members, vote });
    const yesAssignment = assignments.find(
      (assignment) => assignment.member?.memberId === "member-yes"
    );

    expect(yesAssignment).toBeDefined();
    expect(
      matchesPlenarySeatFilters(yesAssignment!, {
        party: "국민의힘",
        query: "서울가구"
      })
    ).toBe(true);
    expect(
      matchesPlenarySeatFilters(yesAssignment!, {
        party: "더불어민주당",
        query: ""
      })
    ).toBe(false);
  });
});
