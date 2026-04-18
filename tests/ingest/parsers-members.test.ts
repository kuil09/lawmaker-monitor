import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  parseMemberHistoryXml,
  parseMemberInfoXml,
  parseMemberProfileAllXml
} from "../../packages/ingest/src/parsers.js";

const snapshotDir = resolve(
  process.cwd(),
  "tests/fixtures/raw/fixture-snapshot-20260322-114500"
);
const officialDir = resolve(snapshotDir, "official");

describe("member parsers", () => {
  it("parses current-member roster rows from nwvrqwxyaytdsfvhu", () => {
    const payload = readFileSync(
      resolve(officialDir, "member_info/page-1.xml"),
      "utf8"
    );
    const parsed = parseMemberInfoXml(payload);

    expect(parsed.currentAssembly).toMatchObject({
      assemblyNo: 22,
      label: "제22대 국회"
    });
    expect(parsed.members).toHaveLength(3);
    expect(parsed.members[0]).toMatchObject({
      memberId: "M001",
      name: "김아라",
      committeeMemberships: [
        "과학기술정보방송통신위원회",
        "예산결산특별위원회"
      ],
      photoUrl: null,
      officialProfileUrl: "https://www.assembly.go.kr/members/22nd/KIMARA",
      officialExternalUrl: "https://blog.example.kr/kim-ara",
      isCurrentMember: true
    });
    expect(parsed.members[1]?.officialExternalUrl).toBeNull();
    expect(parsed.members[2]?.proportionalFlag).toBe(true);
  });

  it("parses ALLNAMEMBER profile rows without promoting them to canonical member IDs", () => {
    const payload = readFileSync(
      resolve(officialDir, "member_profile_all/page-1.xml"),
      "utf8"
    );
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
      committeeMemberships: [
        "과학기술정보방송통신위원회",
        "예산결산특별위원회"
      ],
      photoUrl:
        "https://www.assembly.go.kr/static/portal/img/openassm/new/thumb/member-m001.jpg",
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
      photoUrl:
        "https://www.assembly.go.kr/static/portal/img/openassm/new/thumb/member-former.jpg"
    });
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
});
