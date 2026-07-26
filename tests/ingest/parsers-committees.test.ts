import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  parseBillProposalXml,
  parseBillVoteSummaryXml,
  parseCommitteeOverviewXml,
  parseCommitteeRosterXml
} from "../../packages/ingest/src/parsers.js";

const snapshotDir = resolve(
  process.cwd(),
  "tests/fixtures/raw/fixture-snapshot-20260322-114500"
);
const officialDir = resolve(snapshotDir, "official");

describe("committee and bill-summary parsers", () => {
  it("parses representative and co-sponsor identifiers without double counting", () => {
    const xml = readFileSync(
      resolve(officialDir, "bill_proposals/page-1.xml"),
      "utf8"
    );
    const parsed = parseBillProposalXml(xml);

    expect(parsed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          billId: "PRC_L3",
          assemblyNo: 22,
          proposedAt: "2026-03-08",
          processResult: null,
          leadMemberIds: ["M003"],
          coSponsorMemberIds: ["M001", "X999"]
        }),
        expect.objectContaining({
          billId: "PRC_L1",
          processResult: "원안가결"
        }),
        expect.objectContaining({
          billId: "PRC_L2",
          processResult: "대안반영폐기"
        })
      ])
    );
  });

  it("parses committee roster rows into member-to-committee links", () => {
    const xml = readFileSync(
      resolve(officialDir, "committee_roster/page-1.xml"),
      "utf8"
    );
    const parsed = parseCommitteeRosterXml(xml);

    expect(parsed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memberId: "M001",
          memberName: "김아라",
          committeeName: "과학기술정보방송통신위원회"
        }),
        expect.objectContaining({
          memberId: "M002",
          committeeName: "예산결산특별위원회"
        })
      ])
    );
  });

  it("parses committee overview rows", () => {
    const xml = readFileSync(
      resolve(officialDir, "committee_overview/page-1.xml"),
      "utf8"
    );
    const parsed = parseCommitteeOverviewXml(xml);

    expect(parsed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          committeeName: "법제사법위원회",
          committeeType: "상임위원회",
          memberLimit: 18,
          currentMemberCount: 18
        })
      ])
    );
  });

  it("parses official bill vote summary rows into tally counts", () => {
    const xml = readFileSync(
      resolve(officialDir, "bill_vote_summary/page-1.xml"),
      "utf8"
    );
    const parsed = parseBillVoteSummaryXml(xml);

    expect(parsed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          billId: "PRC_A1B2C3D4E5F6",
          officialSourceUrl:
            "http://likms.assembly.go.kr/bill/billDetail.do?billId=PRC_A1B2C3D4E5F6",
          officialTally: {
            registeredCount: 4,
            presentCount: 3,
            yesCount: 1,
            noCount: 1,
            abstainCount: 1,
            invalidCount: 0
          }
        })
      ])
    );
  });
});
