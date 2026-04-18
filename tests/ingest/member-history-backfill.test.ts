import type { MemberRecord } from "@lawmaker-monitor/schemas";
import { describe, expect, it } from "vitest";

import {
  buildMemberHistorySupplementalRelativePath,
  buildMemberHistorySupplementalTargets,
  findMissingCurrentMemberTenures
} from "../../packages/ingest/src/member-history-backfill.js";
import { type MemberTenureRecord } from "../../packages/ingest/src/tenure.js";

function memberFixture(args: {
  memberId: string;
  name: string;
  assemblyNo?: number;
  isCurrentMember?: boolean;
}): MemberRecord {
  return {
    memberId: args.memberId,
    name: args.name,
    party: "테스트정당",
    district: "비례대표",
    committeeMemberships: [],
    photoUrl: null,
    officialProfileUrl: null,
    officialExternalUrl: null,
    isCurrentMember: args.isCurrentMember ?? true,
    proportionalFlag: false,
    assemblyNo: args.assemblyNo ?? 22
  };
}

function tenureFixture(args: {
  memberId: string;
  name: string;
  assemblyNo?: number;
  startDate: string;
  endDate?: string | null;
}): MemberTenureRecord {
  return {
    memberId: args.memberId,
    name: args.name,
    assemblyNo: args.assemblyNo ?? 22,
    startDate: args.startDate,
    endDate: args.endDate ?? null
  };
}

describe("member history backfill helpers", () => {
  it("finds only current members that are still missing tenure after bulk history parsing", () => {
    const members = [
      memberFixture({ memberId: "M001", name: "김아라" }),
      memberFixture({ memberId: "M002", name: "박민" }),
      memberFixture({ memberId: "M003", name: "이수", isCurrentMember: false })
    ];
    const tenures = [
      tenureFixture({
        memberId: "M001",
        name: "김아라",
        startDate: "2024-05-30"
      })
    ];

    expect(
      findMissingCurrentMemberTenures({
        members,
        tenures,
        assemblyNo: 22
      })
    ).toEqual([
      {
        memberId: "M002",
        memberName: "박민"
      }
    ]);
  });

  it("builds supplemental member-history targets only for missing current members", () => {
    const members = [
      memberFixture({ memberId: "QUR40502", name: "전진숙" }),
      memberFixture({ memberId: "TJW93720", name: "전용기" }),
      memberFixture({ memberId: "M4O5221T", name: "박민규" })
    ];
    const tenures = [
      tenureFixture({
        memberId: "TJW93720",
        name: "전용기",
        startDate: "2024-05-30"
      }),
      tenureFixture({
        memberId: "M4O5221T",
        name: "박민규",
        startDate: "2024-05-30"
      })
    ];

    expect(
      buildMemberHistorySupplementalTargets({
        members,
        tenures,
        assemblyNo: 22,
        assemblyLabel: "제22대 국회",
        unitCd: "100022"
      })
    ).toEqual([
      {
        memberId: "QUR40502",
        memberName: "전진숙",
        relativePath: "official/member_history/by-member/QUR40502.xml",
        metadata: {
          assemblyNo: "22",
          assemblyLabel: "제22대 국회",
          unitCd: "100022",
          memberId: "QUR40502",
          memberName: "전진숙",
          queryType: "monaCd"
        }
      }
    ]);
  });

  it("sanitizes the supplemental member-history file path", () => {
    expect(buildMemberHistorySupplementalRelativePath("ABC/123")).toBe(
      "official/member_history/by-member/ABC_123.xml"
    );
  });
});
