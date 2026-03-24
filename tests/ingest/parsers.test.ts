import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  parseAgendaXml,
  parseBillVoteSummaryXml,
  parseCommitteeOverviewXml,
  parseCommitteeRosterXml,
  parseLiveSignalXml,
  parseMemberInfoXml,
  parseMemberProfileAllXml,
  parseMemberHistoryXml,
  parseMeetingXml,
  parseOfficialVoteXml,
  parseVoteDetailPayload
} from "../../packages/ingest/src/parsers.js";

const snapshotDir = resolve(process.cwd(), "tests/fixtures/raw/fixture-snapshot-20260322-114500");
const officialDir = resolve(snapshotDir, "official");

describe("official parsers", () => {
  it("parses vote rows into roll calls, members, and vote facts", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<국회의원본회의표결정보>
  <row>
    <AGE>대</AGE>
    <BILL_NO>의안번호</BILL_NO>
    <BILL_NAME>의안명</BILL_NAME>
    <VOTE_DATE>의결일자</VOTE_DATE>
    <HG_NM>의원</HG_NM>
    <HJ_NM>한자명</HJ_NM>
    <POLY_NM>정당</POLY_NM>
    <RESULT_VOTE_MOD>표결결과</RESULT_VOTE_MOD>
    <BILL_URL>의안URL</BILL_URL>
  </row>
  <row>
    <AGE>22</AGE>
    <BILL_NO>2217594</BILL_NO>
    <BILL_NAME>공소청법안(대안)</BILL_NAME>
    <VOTE_DATE>2026-03-20 15:51:26.0</VOTE_DATE>
    <HG_NM>강경숙</HG_NM>
    <HJ_NM>姜景淑</HJ_NM>
    <POLY_NM>조국혁신당</POLY_NM>
    <RESULT_VOTE_MOD>찬성</RESULT_VOTE_MOD>
    <BILL_URL>http://likms.assembly.go.kr/bill/billDetail.do?billId=PRC_V2X6E0Z3G1E7L2P0N0A0B4W9O2W3V3</BILL_URL>
  </row>
  <row>
    <AGE>22</AGE>
    <BILL_NO>2217594</BILL_NO>
    <BILL_NAME>공소청법안(대안)</BILL_NAME>
    <VOTE_DATE>2026-03-20 15:51:26.0</VOTE_DATE>
    <HG_NM>천하람</HG_NM>
    <HJ_NM>千하람</HJ_NM>
    <POLY_NM>개혁신당</POLY_NM>
    <RESULT_VOTE_MOD>반대</RESULT_VOTE_MOD>
    <BILL_URL>http://likms.assembly.go.kr/bill/billDetail.do?billId=PRC_V2X6E0Z3G1E7L2P0N0A0B4W9O2W3V3</BILL_URL>
  </row>
  <row>
    <AGE>22</AGE>
    <BILL_NO>2217594</BILL_NO>
    <BILL_NAME>공소청법안(대안)</BILL_NAME>
    <VOTE_DATE>2026-03-20 15:51:26.0</VOTE_DATE>
    <HG_NM>김재원</HG_NM>
    <HJ_NM>金載原</HJ_NM>
    <POLY_NM>조국혁신당</POLY_NM>
    <RESULT_VOTE_MOD>기권</RESULT_VOTE_MOD>
    <BILL_URL>http://likms.assembly.go.kr/bill/billDetail.do?billId=PRC_V2X6E0Z3G1E7L2P0N0A0B4W9O2W3V3</BILL_URL>
  </row>
</국회의원본회의표결정보>`;
    const parsed = parseOfficialVoteXml(xml, {
      sourceUrl: "https://example.test/portal/openapi/nojepdqqaweusdfbi",
      retrievedAt: "2026-03-22T11:45:00+09:00",
      snapshotId: "snapshot-20260322-114500"
    });

    expect(parsed.rollCalls).toHaveLength(1);
    expect(parsed.members).toHaveLength(0);
    expect(parsed.voteFacts).toHaveLength(3);
    expect(parsed.rollCalls[0]?.officialSourceUrl).toBe(
      "http://likms.assembly.go.kr/bill/billDetail.do?billId=PRC_V2X6E0Z3G1E7L2P0N0A0B4W9O2W3V3"
    );
    expect(parsed.rollCalls[0]?.voteVisibility).toBe("recorded");
    expect(parsed.rollCalls[0]?.billId).toBe("PRC_V2X6E0Z3G1E7L2P0N0A0B4W9O2W3V3");
  });

  it("parses official vote xml rows and matches current member ids", () => {
    const payload = `<?xml version="1.0" encoding="UTF-8"?>
<nojepdqqaweusdfbi>
  <row>
    <AGE>22</AGE>
    <BILL_NO>2217594</BILL_NO>
    <BILL_NAME>공소청법안(대안)</BILL_NAME>
    <VOTE_DATE>20260320 155126</VOTE_DATE>
    <HG_NM>강경숙</HG_NM>
    <POLY_NM>조국혁신당</POLY_NM>
    <RESULT_VOTE_MOD>찬성</RESULT_VOTE_MOD>
    <BILL_URL>https://likms.assembly.go.kr/bill/bi/billDetailPage.do?billId=PRC_V2X6E0Z3G1E7L2P0N0A0B4W9O2W3V3</BILL_URL>
  </row>
  <row>
    <AGE>22</AGE>
    <BILL_NO>2217594</BILL_NO>
    <BILL_NAME>공소청법안(대안)</BILL_NAME>
    <VOTE_DATE>20260320 155126</VOTE_DATE>
    <HG_NM>천하람</HG_NM>
    <POLY_NM>개혁신당</POLY_NM>
    <RESULT_VOTE_MOD>반대</RESULT_VOTE_MOD>
    <BILL_URL>https://likms.assembly.go.kr/bill/bi/billDetailPage.do?billId=PRC_V2X6E0Z3G1E7L2P0N0A0B4W9O2W3V3</BILL_URL>
  </row>
</nojepdqqaweusdfbi>`;
    const parsed = parseVoteDetailPayload(
      payload,
      {
        sourceUrl: "https://open.assembly.go.kr/portal/openapi/nojepdqqaweusdfbi",
        retrievedAt: "2026-03-22T11:45:00+09:00",
        snapshotId: "snapshot-20260322-114500"
      },
      {
        currentMembers: [
          {
            memberId: "M001",
            name: "강경숙",
            party: "조국혁신당",
            district: null,
            committeeMemberships: [],
            photoUrl: null,
            officialProfileUrl: null,
            officialExternalUrl: null,
            isCurrentMember: true,
            proportionalFlag: false,
            assemblyNo: 22
          },
          {
            memberId: "M002",
            name: "천하람",
            party: "개혁신당",
            district: null,
            committeeMemberships: [],
            photoUrl: null,
            officialProfileUrl: null,
            officialExternalUrl: null,
            isCurrentMember: true,
            proportionalFlag: false,
            assemblyNo: 22
          }
        ]
      }
    );

    expect(parsed.rollCalls).toHaveLength(1);
    expect(parsed.voteFacts).toHaveLength(2);
    expect(parsed.voteFacts[0]).toMatchObject({
      memberId: "M001",
      memberName: "강경숙",
      voteCode: "yes"
    });
    expect(parsed.voteFacts[1]).toMatchObject({
      memberId: "M002",
      memberName: "천하람",
      voteCode: "no"
    });
    expect(parsed.rollCalls[0]?.officialSourceUrl).toBe(
      "https://likms.assembly.go.kr/bill/bi/billDetailPage.do?billId=PRC_V2X6E0Z3G1E7L2P0N0A0B4W9O2W3V3"
    );
  });

  it("parses agenda rows", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<nwbpacrgavhjryiph>
  <head>
    <list_total_count>1</list_total_count>
  </head>
  <row>
    <AGE>22</AGE>
    <BILL_NO>2217594</BILL_NO>
    <BILL_ID>PRC_V2X6E0Z3G1E7L2P0N0A0B4W9O2W3V3</BILL_ID>
    <BILL_NM>공소청법안(대안)(법제사법위원장)</BILL_NM>
    <COMMITTEE_NM>법제사법위원회</COMMITTEE_NM>
    <PROC_RESULT_CD>원안가결</PROC_RESULT_CD>
    <RGS_PROC_DT>2026-03-20</RGS_PROC_DT>
  </row>
</nwbpacrgavhjryiph>`;
    const parsed = parseAgendaXml(xml, {
      sourceUrl: "https://example.test/portal/openapi/nwbpacrgavhjryiph",
      retrievedAt: "2026-03-22T11:45:00+09:00",
      snapshotId: "snapshot-20260322-114500"
    });

    expect(parsed.agendas).toHaveLength(1);
    expect(parsed.agendas[0]?.billName).toContain("공소청법안");
    expect(parsed.agendas[0]?.committeeName).toBe("법제사법위원회");
  });

  it("parses plenary schedule rows into meetings", () => {
    const xml = readFileSync(resolve(officialDir, "plenary_schedule.xml"), "utf8");
    const parsed = parseMeetingXml(xml, {
      sourceUrl: "https://example.test/portal/openapi/nekcaiymatialqlxr",
      retrievedAt: "2026-03-22T11:45:00+09:00",
      snapshotId: "snapshot-20260322-114500"
    });

    expect(parsed.meetings).toHaveLength(1);
    expect(parsed.meetings[0]).toMatchObject({
      meetingId: "plenary-22-418-14-20260322",
      meetingType: "Plenary Session",
      isLive: false
    });
  });

  it("parses live api rows", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<WEBCASTREALTIEM>
  <head>
    <list_total_count>1</list_total_count>
  </head>
  <row>
    <CMIT_NM>본회의</CMIT_NM>
    <CONF_NM>제433회 국회(임시회) 제02차 본회의[3/19 14:30]</CONF_NM>
    <LBRD_STAT>개의</LBRD_STAT>
  </row>
</WEBCASTREALTIEM>`;
    const parsed = parseLiveSignalXml(xml);

    expect(parsed).toMatchObject({
      isLive: true,
      title: "제433회 국회(임시회) 제02차 본회의[3/19 14:30]"
    });
  });

  it("keeps available member-level vote facts for secret ballots", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<국회의원본회의표결정보>
  <row>
    <AGE>22</AGE>
    <BILL_NO>220099</BILL_NO>
    <BILL_NAME>Secret Ballot Motion</BILL_NAME>
    <VOTE_METHOD>무기명</VOTE_METHOD>
    <VOTE_DATE>2026-03-22T15:00:00+09:00</VOTE_DATE>
    <HG_NM>홍길동</HG_NM>
    <POLY_NM>테스트당</POLY_NM>
    <RESULT_VOTE_MOD>반대</RESULT_VOTE_MOD>
  </row>
</국회의원본회의표결정보>`;
    const parsed = parseOfficialVoteXml(xml, {
      sourceUrl: "https://example.test/portal/openapi/nojepdqqaweusdfbi",
      retrievedAt: "2026-03-22T15:05:00+09:00",
      snapshotId: "snapshot-secret"
    });

    expect(parsed.rollCalls).toHaveLength(1);
    expect(parsed.rollCalls[0]?.voteVisibility).toBe("secret");
    expect(parsed.members).toHaveLength(0);
    expect(parsed.voteFacts).toHaveLength(1);
    expect(parsed.voteFacts[0]).toMatchObject({
      memberId: null,
      memberName: "홍길동",
      party: "테스트당",
      voteCode: "no"
    });
  });

  it("keeps rows with missing member id or missing member name", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<국회의원본회의표결정보>
  <row>
    <AGE>22</AGE>
    <BILL_NO>2217594</BILL_NO>
    <BILL_NAME>공소청법안(대안)</BILL_NAME>
    <VOTE_DATE>2026-03-20 15:51:26.0</VOTE_DATE>
    <HG_NM>이름만있음</HG_NM>
    <POLY_NM>무소속</POLY_NM>
    <RESULT_VOTE_MOD>기권</RESULT_VOTE_MOD>
  </row>
  <row>
    <AGE>22</AGE>
    <BILL_NO>2217594</BILL_NO>
    <VOTE_DATE>2026-03-20 15:51:26.0</VOTE_DATE>
    <MONA_CD>M999</MONA_CD>
    <POLY_NM>테스트당</POLY_NM>
    <RESULT_VOTE_MOD>반대</RESULT_VOTE_MOD>
  </row>
</국회의원본회의표결정보>`;
    const parsed = parseOfficialVoteXml(xml, {
      sourceUrl: "https://example.test/portal/openapi/nojepdqqaweusdfbi",
      retrievedAt: "2026-03-22T11:45:00+09:00",
      snapshotId: "snapshot-20260322-114500"
    });

    expect(parsed.voteFacts).toHaveLength(2);
    expect(parsed.voteFacts[0]).toMatchObject({
      memberId: null,
      memberName: "이름만있음",
      party: "무소속",
      voteCode: "abstain"
    });
    expect(parsed.voteFacts[1]).toMatchObject({
      memberId: "M999",
      memberName: null,
      party: "테스트당",
      voteCode: "no"
    });
  });

  it("skips aggregate rows that have no member id and no member name", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<국회의원본회의표결정보>
  <row>
    <AGE>22</AGE>
    <BILL_NO>2219000</BILL_NO>
    <BILL_NAME>집계 전용 안건</BILL_NAME>
    <VOTE_DATE>2026-03-21 15:51:26.0</VOTE_DATE>
    <RESULT_VOTE_MOD>찬성</RESULT_VOTE_MOD>
  </row>
  <row>
    <AGE>22</AGE>
    <BILL_NO>2219000</BILL_NO>
    <BILL_NAME>집계 전용 안건</BILL_NAME>
    <VOTE_DATE>2026-03-21 15:51:26.0</VOTE_DATE>
    <HG_NM>홍길동</HG_NM>
    <POLY_NM>테스트당</POLY_NM>
    <RESULT_VOTE_MOD>반대</RESULT_VOTE_MOD>
  </row>
</국회의원본회의표결정보>`;
    const parsed = parseOfficialVoteXml(xml, {
      sourceUrl: "https://example.test/portal/openapi/nojepdqqaweusdfbi",
      retrievedAt: "2026-03-22T11:45:00+09:00",
      snapshotId: "snapshot-20260322-114500"
    });

    expect(parsed.voteFacts).toHaveLength(1);
    expect(parsed.voteFacts[0]).toMatchObject({
      memberName: "홍길동",
      voteCode: "no"
    });
  });

  it("parses current-member roster rows from nwvrqwxyaytdsfvhu", () => {
    const payload = readFileSync(resolve(officialDir, "member_info/page-1.xml"), "utf8");
    const parsed = parseMemberInfoXml(payload);

    expect(parsed.currentAssembly).toMatchObject({
      assemblyNo: 22,
      label: "제22대 국회"
    });
    expect(parsed.members).toHaveLength(3);
    expect(parsed.members[0]).toMatchObject({
      memberId: "M001",
      name: "김아라",
      committeeMemberships: ["과학기술정보방송통신위원회", "예산결산특별위원회"],
      photoUrl: null,
      officialProfileUrl: "https://www.assembly.go.kr/members/22nd/KIMARA",
      officialExternalUrl: "https://blog.example.kr/kim-ara",
      isCurrentMember: true
    });
    expect(parsed.members[1]?.officialExternalUrl).toBeNull();
    expect(parsed.members[2]?.proportionalFlag).toBe(true);
  });

  it("parses ALLNAMEMBER profile rows without promoting them to canonical member IDs", () => {
    const payload = readFileSync(resolve(officialDir, "member_profile_all/page-1.xml"), "utf8");
    const parsed = parseMemberProfileAllXml(payload);

    expect(parsed.currentAssembly).toMatchObject({
      assemblyNo: 22,
      label: "제22대 국회"
    });
    expect(parsed.profiles).toHaveLength(4);
    expect(parsed.profiles[0]).toMatchObject({
      naasCd: "NAAS001",
      name: "김아라",
      party: "미래개혁당",
      district: "서울 중구",
      committeeMemberships: ["과학기술정보방송통신위원회", "예산결산특별위원회"],
      photoUrl: "https://www.assembly.go.kr/static/portal/img/openassm/new/thumb/member-m001.jpg",
      officialProfileUrl: "https://www.assembly.go.kr/members/22nd/KIMARA",
      officialExternalUrl: "https://blog.example.kr/kim-ara",
      profile: {
        nameHanja: "金아라",
        nameEnglish: "KIM ARA",
        officePhone: "02-784-0001",
        aideNames: ["나보좌"]
      }
    });
    expect(parsed.profiles[2]?.photoUrl).toBeNull();
    expect(parsed.profiles[2]?.proportionalFlag).toBe(true);
    expect(parsed.profiles[3]).toMatchObject({
      naasCd: "NAAS999",
      name: "퇴직의원",
      photoUrl: "https://www.assembly.go.kr/static/portal/img/openassm/new/thumb/member-former.jpg"
    });
  });

  it("parses committee roster rows into member-to-committee links", () => {
    const xml = readFileSync(resolve(officialDir, "committee_roster/page-1.xml"), "utf8");
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
    const xml = readFileSync(resolve(officialDir, "committee_overview/page-1.xml"), "utf8");
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

  it("parses member history rows into tenure periods", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<nexgtxtmaamffofof>
  <row>
    <HG_NM>김아라</HG_NM>
    <HJ_NM>金아라</HJ_NM>
    <FRTO_DATE>2024.05.30 ~ 2028.05.29</FRTO_DATE>
    <PROFILE_SJ>제22대 국회의원</PROFILE_SJ>
    <MONA_CD>M001</MONA_CD>
    <UNIT_CD>100022</UNIT_CD>
    <UNIT_NM>제22대</UNIT_NM>
  </row>
  <row>
    <HG_NM>박민</HG_NM>
    <HJ_NM>朴敏</HJ_NM>
    <FRTO_DATE>2026.03.21 ~ 2028.05.29</FRTO_DATE>
    <PROFILE_SJ>제22대 국회의원</PROFILE_SJ>
    <MONA_CD>M002</MONA_CD>
    <UNIT_CD>100022</UNIT_CD>
    <UNIT_NM>제22대</UNIT_NM>
  </row>
  <row>
    <HG_NM>박민</HG_NM>
    <HJ_NM>朴敏</HJ_NM>
    <FRTO_DATE>2020.05.30 ~ 2024.05.29</FRTO_DATE>
    <PROFILE_SJ>제21대 국회의원</PROFILE_SJ>
    <MONA_CD>M002</MONA_CD>
    <UNIT_CD>100022</UNIT_CD>
    <UNIT_NM>제22대</UNIT_NM>
  </row>
</nexgtxtmaamffofof>`;

    const parsed = parseMemberHistoryXml(xml);

    expect(parsed).toEqual([
      {
        memberId: "M001",
        name: "김아라",
        assemblyNo: 22,
        unitCd: "100022",
        startDate: "2024-05-30",
        endDate: "2028-05-29"
      },
      {
        memberId: "M002",
        name: "박민",
        assemblyNo: 22,
        unitCd: "100022",
        startDate: "2026-03-21",
        endDate: "2028-05-29"
      },
      {
        memberId: "M002",
        name: "박민",
        assemblyNo: 21,
        unitCd: "100022",
        startDate: "2020-05-30",
        endDate: "2024-05-29"
      }
    ]);
  });

  it("parses official bill vote summary rows into tally counts", () => {
    const xml = readFileSync(resolve(officialDir, "bill_vote_summary/page-1.xml"), "utf8");
    const parsed = parseBillVoteSummaryXml(xml);

    expect(parsed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          billId: "PRC_A1B2C3D4E5F6",
          officialSourceUrl: "http://likms.assembly.go.kr/bill/billDetail.do?billId=PRC_A1B2C3D4E5F6",
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
