import { describe, expect, it } from "vitest";

import {
  buildOfficialAttendanceFacts,
  mergeOfficialVoteFacts
} from "../../packages/ingest/src/official-facts.js";

import type { BillVoteSummaryRecord } from "../../packages/ingest/src/parsers.js";
import type { RawSnapshotEntry } from "../../packages/ingest/src/raw-snapshot.js";
import type { MemberTenureIndex } from "../../packages/ingest/src/tenure.js";
import type {
  CommitteeCareerRecord,
  OfficialMinutesAttendanceMeeting
} from "../../packages/ingest/src/official-attendance.js";
import type { MemberRecord } from "@lawmaker-monitor/schemas";

const lee: MemberRecord = {
  memberId: "MRS4949T",
  name: "이소희",
  party: "국민의힘",
  district: "세종특별자치시을",
  committeeMemberships: ["보건복지위원회"],
  officialProfileUrl: "https://www.assembly.go.kr/members/22nd/LEESOHEE",
  isCurrentMember: true,
  proportionalFlag: false,
  assemblyNo: 22
};

const kim: MemberRecord = {
  memberId: "M-KIM",
  name: "김공식",
  party: "공식당",
  district: "공식구",
  committeeMemberships: [],
  officialProfileUrl: "https://www.assembly.go.kr/members/22nd/KIMOFFICIAL",
  isCurrentMember: true,
  proportionalFlag: false,
  assemblyNo: 22
};

const tenureIndex: MemberTenureIndex = new Map([
  [
    lee.memberId,
    [
      {
        startDate: "2026-01-12",
        endDate: null
      }
    ]
  ],
  [
    kim.memberId,
    [
      {
        startDate: "2024-05-30",
        endDate: null
      }
    ]
  ]
]);

function buildLikmsHtml(args: {
  billId: string;
  billNo: string;
  date: string;
  voteCode: "yes" | "no" | "abstain";
  member: MemberRecord;
}): string {
  const counts = {
    yes: args.voteCode === "yes" ? 1 : 0,
    no: args.voteCode === "no" ? 1 : 0,
    abstain: args.voteCode === "abstain" ? 1 : 0
  };
  const sectionId = {
    yes: "voteAgreeList",
    no: "voteDisAgreeList",
    abstain: "voteAbsList"
  }[args.voteCode];

  return `
    <input name="billId" value="${args.billId}" />
    <input id="voteBillNo" value="${args.billNo}" />
    <input id="voteBillName" value="Official bill ${args.billNo}" />
    <p id="procDt">의결일 ${args.date}</p>
    <p id="memberTcnt">재적 300인 재석 1인</p>
    <p id="voteTcnt">찬성 ${counts.yes}인 반대 ${counts.no}인 기권 ${counts.abstain}인</p>
    <ul id="voteAgreeList"></ul>
    <ul id="voteDisAgreeList"></ul>
    <ul id="voteAbsList"></ul>
    <ul id="${sectionId}">
      <li><a href="${args.member.officialProfileUrl}"><p>${args.member.name}</p></a></li>
    </ul>
  `;
}

function buildVoteSource(args: {
  billId: string;
  billNo: string;
  date: string;
  voteCode: "yes" | "no" | "abstain";
  member: MemberRecord;
}): {
  summary: BillVoteSummaryRecord;
  entry: RawSnapshotEntry;
  html: string;
} {
  const counts = {
    yes: args.voteCode === "yes" ? 1 : 0,
    no: args.voteCode === "no" ? 1 : 0,
    abstain: args.voteCode === "abstain" ? 1 : 0
  };
  return {
    summary: {
      billId: args.billId,
      billNo: args.billNo,
      billName: `Official bill ${args.billNo}`,
      committeeName: "본회의",
      officialSourceUrl: `https://likms.assembly.go.kr/bill/billDetail.do?billId=${args.billId}`,
      officialTally: {
        registeredCount: 300,
        presentCount: 1,
        yesCount: counts.yes,
        noCount: counts.no,
        abstainCount: counts.abstain,
        invalidCount: 0
      },
      summary: null
    },
    entry: {
      kind: "vote_member_list",
      endpointCode: "voteInfo.do",
      relativePath: `official/vote_member_lists/${args.billId}.html`,
      sourceUrl: "https://likms.assembly.go.kr/bill/bi/bill/detail/voteInfo.do",
      requestParams: { billId: args.billId },
      retrievedAt: "2026-08-02T00:00:00.000Z",
      checksumSha256: `hash-${args.billId}`,
      metadata: {
        billId: args.billId,
        billNo: args.billNo
      }
    },
    html: buildLikmsHtml(args)
  };
}

function buildMeeting(args: {
  id: string;
  date: string;
  type: "plenary" | "committee";
  committeeName?: string;
  status: "present" | "absent" | "leave" | "trip";
}): OfficialMinutesAttendanceMeeting {
  return {
    documentId: args.id,
    meetingDate: args.date,
    meetingType: args.type,
    committeeName: args.committeeName ?? null,
    presentNames: args.status === "present" ? [lee.name] : [],
    leaveNames: args.status === "leave" ? [lee.name] : [],
    tripNames: args.status === "trip" ? [lee.name] : [],
    sourceUrl: `https://record.assembly.go.kr/assembly/viewer/minutes/xml.do?id=${args.id}&type=view`,
    retrievedAt: "2026-08-02T00:00:00.000Z",
    sourceHash: `hash-${args.id}`
  };
}

describe("official vote fact completion", () => {
  it("restores a newly seated member's explicit votes and marks only recorded-vote nonparticipation as absent", () => {
    const sources = [
      buildVoteSource({
        billId: "PRC_YES",
        billNo: "2218545",
        date: "2026-06-18",
        voteCode: "yes",
        member: lee
      }),
      buildVoteSource({
        billId: "PRC_NO",
        billNo: "2216843",
        date: "2026-02-28",
        voteCode: "no",
        member: lee
      }),
      buildVoteSource({
        billId: "PRC_ABSTAIN",
        billNo: "2218561",
        date: "2026-05-07",
        voteCode: "abstain",
        member: lee
      }),
      buildVoteSource({
        billId: "PRC_NOT_PARTICIPATING",
        billNo: "2216000",
        date: "2026-01-29",
        voteCode: "yes",
        member: kim
      })
    ];

    const merged = mergeOfficialVoteFacts({
      members: [lee, kim],
      rollCalls: [],
      voteFacts: [],
      summaries: sources.map((source) => source.summary),
      voteMemberListPayloads: sources.map(({ entry, html }) => ({
        entry,
        html
      })),
      assemblyNo: 22,
      snapshotId: "official-fixture",
      snapshotRetrievedAt: "2026-08-02T00:00:00.000Z",
      tenureIndex
    });
    const leeVotes = merged.voteFacts
      .filter((fact) => fact.memberId === lee.memberId)
      .map((fact) => fact.voteCode)
      .sort();

    expect(leeVotes).toEqual(["absent", "abstain", "no", "yes"]);
    expect(merged.rollCalls).toHaveLength(4);
    expect(
      merged.rollCalls.every(
        (rollCall) => rollCall.officialTally?.presentCount === 1
      )
    ).toBe(true);
  });
});

describe("official minutes attendance fact completion", () => {
  it("requires a named XLSX status instead of treating a blank cell as absence", () => {
    const explicitMeeting = {
      ...buildMeeting({
        id: "plenary-file",
        date: "2026-04-17",
        type: "plenary",
        status: "absent"
      }),
      absentNames: [lee.name],
      requiresExplicitStatus: true
    };

    expect(
      buildOfficialAttendanceFacts({
        members: [lee],
        careers: [],
        meetings: [explicitMeeting],
        tenureIndex
      })[0]?.status
    ).toBe("absent");
    expect(() =>
      buildOfficialAttendanceFacts({
        members: [lee],
        careers: [],
        meetings: [
          {
            ...explicitMeeting,
            absentNames: []
          }
        ],
        tenureIndex
      })
    ).toThrow(/no explicit status/);
  });

  it("reproduces the current official Lee So-hee attendance snapshot", () => {
    const plenaryStatuses = new Map([
      ["2026-01-29", "leave"],
      ["2026-02-12", "absent"],
      ["2026-05-08", "absent"]
    ]);
    const plenaryDates = [
      "2026-01-15",
      "2026-01-29",
      "2026-02-02",
      "2026-02-03",
      "2026-02-04",
      "2026-02-09",
      "2026-02-10",
      "2026-02-11",
      "2026-02-12",
      "2026-02-24",
      "2026-03-12",
      "2026-03-19",
      "2026-03-31",
      "2026-04-02",
      "2026-04-03",
      "2026-04-06",
      "2026-04-10",
      "2026-04-13",
      "2026-04-17",
      "2026-04-18",
      "2026-04-23",
      "2026-04-28",
      "2026-05-07",
      "2026-05-08",
      "2026-06-05",
      "2026-06-11",
      "2026-06-18",
      "2026-06-30",
      "2026-07-20",
      "2026-07-23"
    ];
    const plenaryMeetings = plenaryDates.map((date, index) =>
      buildMeeting({
        id: `plenary-${index}`,
        date,
        type: "plenary",
        status:
          (plenaryStatuses.get(date) as
            | "present"
            | "absent"
            | "leave"
            | undefined) ?? "present"
      })
    );
    const cultureStatuses = [
      ["2026-02-23", "present"],
      ["2026-02-26", "absent"],
      ["2026-03-04", "absent"],
      ["2026-03-24", "present"],
      ["2026-03-27", "present"],
      ["2026-04-01", "present"],
      ["2026-04-06", "present"],
      ["2026-07-09", "absent"],
      ["2026-07-21", "absent"]
    ] as const;
    const cultureMeetings = cultureStatuses.map(([date, status], index) =>
      buildMeeting({
        id: `culture-${index}`,
        date,
        type: "committee",
        committeeName: "문화체육관광위원회",
        status
      })
    );
    const healthMeeting = buildMeeting({
      id: "health-1",
      date: "2026-07-29",
      type: "committee",
      committeeName: "보건복지위원회",
      status: "present"
    });
    const careers: Array<CommitteeCareerRecord & { memberId: string }> = [
      {
        assemblyNo: 22,
        memberId: lee.memberId,
        memberName: lee.name,
        committeeName: "문화체육관광위원회",
        startDate: "2026-01-19",
        endDate: "2026-05-29"
      },
      {
        assemblyNo: 22,
        memberId: lee.memberId,
        memberName: lee.name,
        committeeName: "문화체육관광위원회",
        startDate: "2026-06-30",
        endDate: "2026-07-23"
      },
      {
        assemblyNo: 22,
        memberId: lee.memberId,
        memberName: lee.name,
        committeeName: "보건복지위원회",
        startDate: "2026-07-23",
        endDate: null
      }
    ];

    const facts = buildOfficialAttendanceFacts({
      members: [lee],
      careers,
      meetings: [...plenaryMeetings, ...cultureMeetings, healthMeeting],
      tenureIndex
    });
    const plenary = facts.filter((fact) => fact.meetingType === "plenary");
    const culture = facts.filter(
      (fact) => fact.committeeName === "문화체육관광위원회"
    );
    const health = facts.filter(
      (fact) => fact.committeeName === "보건복지위원회"
    );

    expect(plenary).toHaveLength(30);
    expect(plenary.filter((fact) => fact.status === "present")).toHaveLength(
      27
    );
    expect(plenary.filter((fact) => fact.status === "absent")).toHaveLength(2);
    expect(plenary.filter((fact) => fact.status === "leave")).toHaveLength(1);
    expect(
      plenary
        .filter((fact) => fact.status !== "present")
        .map((fact) => [fact.meetingDate, fact.status])
    ).toEqual([
      ["2026-01-29", "leave"],
      ["2026-02-12", "absent"],
      ["2026-05-08", "absent"]
    ]);
    expect(
      plenary.find((fact) => fact.meetingDate === "2026-02-02")?.status
    ).toBe("present");
    expect(
      plenary.find((fact) => fact.meetingDate === "2026-04-23")?.status
    ).toBe("present");
    expect(culture).toHaveLength(9);
    expect(culture.filter((fact) => fact.status === "present")).toHaveLength(5);
    expect(health).toHaveLength(1);
    expect(health[0]?.status).toBe("present");
  });
});
