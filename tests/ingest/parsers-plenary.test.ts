import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  parseAgendaXml,
  parseLiveSignalXml,
  parseMeetingXml,
  parseOfficialVoteXml,
  parseVoteDetailPayload
} from "../../packages/ingest/src/parsers.js";

const snapshotDir = resolve(process.cwd(), "tests/fixtures/raw/fixture-snapshot-20260322-114500");
const officialDir = resolve(snapshotDir, "official");

describe("plenary and vote parsers", () => {
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
});
