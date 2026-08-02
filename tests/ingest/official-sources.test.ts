import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildCommitteeCareerSheetRequest,
  buildLikmsVoteMemberListRequest,
  buildPlenaryAttendanceFileListRequest,
  buildPlenaryAttendanceFileRequest,
  buildVoteDetailRequest,
  resolveAssemblyApiConfig
} from "../../packages/ingest/src/assembly-api.js";
import {
  parseCommitteeCareerSheetJson,
  loadOfficialMinutesAttendanceMeetings,
  parseOfficialMinutesAttendanceHtml,
  supplementOfficialMinutesAttendance
} from "../../packages/ingest/src/official-attendance.js";
import {
  countLikmsNamedVotes,
  parseLikmsVoteInfoHtml,
  parseLikmsVoteMemberListHtml
} from "../../packages/ingest/src/likms-votes.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

const completeLikmsVoteHtml = `
  <input name="billId" value="PRC_TEST" />
  <input id="voteBillNo" value="2212345" />
  <input id="voteBillName" value="공식 표결안" />
  <p id="procDt">의결일 2026-08-01</p>
  <p id="memberTcnt">재적 300인 재석 3인</p>
  <p id="voteTcnt">찬성 1인 반대 1인 기권 1인</p>
  <ul id="voteAgreeList">
    <li><a href="/assembly/member/kim"><p>김 아라</p></a></li>
  </ul>
  <ul id="voteDisAgreeList">
    <li><a href="/assembly/member/lee"><img alt="국회의원:이 보라" /></a></li>
  </ul>
  <ul id="voteAbsList">
    <li><a href="/assembly/member/park"><p>박 초록</p></a></li>
  </ul>
`;

describe("official LIKMS vote responses", () => {
  it("parses named lists and requires their tally to equal the embedded official tally", () => {
    const parsed = parseLikmsVoteInfoHtml(completeLikmsVoteHtml);

    expect(parsed).toMatchObject({
      billId: "PRC_TEST",
      billNo: "2212345",
      billName: "공식 표결안",
      voteDate: "2026-08-01",
      registeredCount: 300,
      presentCount: 3,
      yesCount: 1,
      noCount: 1,
      abstainCount: 1,
      records: [
        {
          memberName: "김 아라",
          officialProfileUrl: "/assembly/member/kim",
          voteCode: "yes"
        },
        {
          memberName: "이 보라",
          officialProfileUrl: "/assembly/member/lee",
          voteCode: "no"
        },
        {
          memberName: "박 초록",
          officialProfileUrl: "/assembly/member/park",
          voteCode: "abstain"
        }
      ]
    });
    expect(countLikmsNamedVotes(parsed.records)).toEqual({
      yes: 1,
      no: 1,
      abstain: 1,
      present: 3
    });
  });

  it("rejects a LIKMS response whose named voters do not match its official tally", () => {
    expect(() =>
      parseLikmsVoteInfoHtml(
        completeLikmsVoteHtml.replace(
          "찬성 1인 반대 1인 기권 1인",
          "찬성 2인 반대 1인 기권 1인"
        )
      )
    ).toThrow(/does not match its embedded tally/);
  });

  it("deduplicates repeated names only within the same official vote section", () => {
    const records = parseLikmsVoteMemberListHtml(
      completeLikmsVoteHtml.replace(
        '</ul>\n  <ul id="voteDisAgreeList">',
        '<li><a href="/assembly/member/kim"><p>김 아라</p></a></li></ul>\n  <ul id="voteDisAgreeList">'
      )
    );

    expect(
      records.filter((record) => record.memberName === "김 아라")
    ).toHaveLength(1);
  });
});

describe("official committee and minutes attendance sources", () => {
  it("parses dated committee careers from the official sheet and skips incomplete rows", () => {
    const careers = parseCommitteeCareerSheetJson(
      JSON.stringify({
        data: [
          {
            PROFILE_UNIT_NM: "제22대 국회",
            HG_NM: "김 아라",
            PROFILE_SJ: "제22대 과학기술정보방송통신위원회",
            FRTO_DATE: "2024.05.30 ~ 2026.08.01"
          },
          {
            PROFILE_UNIT_NM: "제22대 국회",
            HG_NM: "누락",
            PROFILE_SJ: "기획재정위원회",
            FRTO_DATE: ""
          }
        ]
      })
    );

    expect(careers).toEqual([
      {
        assemblyNo: 22,
        memberName: "김 아라",
        committeeName: "과학기술정보방송통신위원회",
        startDate: "2024-05-30",
        endDate: "2026-08-01"
      }
    ]);
  });

  it("parses official plenary and committee attendance statuses", () => {
    const attendance = parseOfficialMinutesAttendanceHtml(`
      <p><strong>◯출석 의원 (2인)</strong></p>
      <div class="con"><a href="/members/1"><span class="name">김 아라</span></a><a href="/members/2"><span class="name">이 보라</span></a></div>
      <p><strong>◯청가 의원 (1인)</strong></p>
      <div class="con"><span class="name">박 초록</span></div>
      <p><strong>◯출장 위원 (1인)</strong></p>
      <div class="con"><a href="/members/4"><span class="name">최 파랑</span></a></div>
    `);

    expect(attendance).toEqual({
      presentNames: ["김 아라", "이 보라"],
      leaveNames: ["박 초록"],
      tripNames: ["최 파랑"]
    });
  });

  it("loads official plenary and standing-committee minute records with their distinct statuses", async () => {
    const dataRepoDir = await mkdtemp(join(tmpdir(), "official-attendance-"));
    temporaryDirectories.push(dataRepoDir);
    const indexDir = join(dataRepoDir, "raw/index");
    const minutesDir = join(dataRepoDir, "raw/minutes");
    await mkdir(indexDir, { recursive: true });
    await mkdir(minutesDir, { recursive: true });
    await writeFile(
      join(minutesDir, "plenary.html"),
      '<p><strong>◯출석 의원 (1인)</strong></p><div class="con"><span class="name">김 아라</span></div><p><strong>◯청가 의원 (1인)</strong></p><div class="con"><span class="name">이 보라</span></div>'
    );
    await writeFile(
      join(minutesDir, "committee.html"),
      '<p><strong>◯출석 위원 (1인)</strong></p><div class="con"><span class="name">박 초록</span></div><p><strong>◯출장 위원 (1인)</strong></p><div class="con"><span class="name">최 파랑</span></div>'
    );
    await writeFile(
      join(minutesDir, "ceremony.html"),
      '<div class="minutes_header"><div class="tit_wrap"><p class="num">개회식</p></div></div><p><strong>◯출석 의원 (1인)</strong></p><div class="con"><span class="name">제외 대상</span></div>'
    );
    await writeFile(
      join(indexDir, "document_index.json"),
      JSON.stringify({
        updatedAt: "2026-08-02T00:00:00.000Z",
        items: [
          {
            documentId: "committee-1",
            sourceId: "assembly-minutes",
            sourceUrl:
              "https://record.assembly.go.kr/assembly/viewer/minutes/xml.do?key=committee-1",
            title: "제22대 제1회 과학기술정보방송통신위원회 회의록",
            publishedDate: "2026-08-02",
            latestRelativePath: "raw/minutes/committee.html",
            currentContentSha256: "committee-hash"
          },
          {
            documentId: "plenary-1",
            sourceId: "assembly-minutes",
            sourceUrl:
              "https://record.assembly.go.kr/assembly/viewer/minutes/xml.do?key=plenary-1",
            title: "제22대 제1회 국회본회의 회의록",
            publishedDate: "2026-08-01",
            latestRelativePath: "raw/minutes/plenary.html",
            lastMirroredAt: "2026-08-02T01:00:00.000Z",
            currentContentSha256: "plenary-hash"
          },
          {
            documentId: "plenary-ceremony",
            sourceId: "assembly-minutes",
            sourceUrl:
              "https://record.assembly.go.kr/assembly/viewer/minutes/xml.do?key=plenary-ceremony",
            title: "제22대 제1회 국회본회의 회의록",
            publishedDate: "2026-08-01",
            latestRelativePath: "raw/minutes/ceremony.html",
            currentContentSha256: "ceremony-hash"
          }
        ]
      })
    );

    await expect(
      loadOfficialMinutesAttendanceMeetings({ dataRepoDir, assemblyNo: 22 })
    ).resolves.toEqual([
      expect.objectContaining({
        documentId: "plenary-1",
        meetingType: "plenary",
        committeeName: null,
        presentNames: ["김 아라"],
        leaveNames: ["이 보라"],
        tripNames: [],
        sourceHash: "plenary-hash"
      }),
      expect.objectContaining({
        documentId: "committee-1",
        meetingType: "committee",
        committeeName: "과학기술정보방송통신위원회",
        presentNames: ["박 초록"],
        leaveNames: [],
        tripNames: ["최 파랑"],
        sourceHash: "committee-hash"
      })
    ]);
  });

  it("uses official XLSX rows for missing minutes attendance and omitted plenary dates", () => {
    const minutesMeeting = {
      documentId: "minutes-1",
      meetingDate: "2026-04-17",
      meetingType: "plenary" as const,
      committeeName: null,
      presentNames: [],
      absentNames: [],
      leaveNames: [],
      tripNames: [],
      sourceUrl:
        "https://record.assembly.go.kr/assembly/viewer/minutes/xml.do?id=1&type=view",
      retrievedAt: "2026-08-01T00:00:00.000Z",
      sourceHash: "minutes-hash"
    };
    const fileMeeting = {
      documentId: "file-1",
      sessionNo: 434,
      meetingDate: "2026-04-17",
      meetingType: "plenary" as const,
      committeeName: null,
      presentNames: ["김 아라"],
      absentNames: ["이 보라"],
      leaveNames: [],
      tripNames: [],
      sourceUrl:
        "https://open.assembly.go.kr/portal/data/file/downloadFileData.do?fileSeq=1",
      retrievedAt: "2026-08-02T00:00:00.000Z",
      sourceHash: "file-hash"
    };

    expect(
      supplementOfficialMinutesAttendance({
        minutesMeetings: [minutesMeeting],
        plenaryFileMeetings: [
          fileMeeting,
          {
            ...fileMeeting,
            documentId: "file-only",
            meetingDate: "2026-05-08"
          }
        ]
      })
    ).toEqual([
      {
        ...minutesMeeting,
        presentNames: ["김 아라"],
        absentNames: ["이 보라"],
        requiresExplicitStatus: true,
        sourceUrl: fileMeeting.sourceUrl,
        retrievedAt: fileMeeting.retrievedAt,
        sourceHash: fileMeeting.sourceHash
      },
      {
        documentId: "file-only",
        meetingDate: "2026-05-08",
        meetingType: "plenary",
        committeeName: null,
        presentNames: ["김 아라"],
        absentNames: ["이 보라"],
        leaveNames: [],
        tripNames: [],
        requiresExplicitStatus: true,
        sourceUrl: fileMeeting.sourceUrl,
        retrievedAt: fileMeeting.retrievedAt,
        sourceHash: fileMeeting.sourceHash
      }
    ]);
  });
});

describe("official supplemental request builders", () => {
  it("builds official POST request bodies and paginated OpenAPI vote requests", () => {
    const careerRequest = buildCommitteeCareerSheetRequest({
      page: 3,
      rows: 200
    });
    const careerUrl = new URL(careerRequest.url);
    const careerBody = new URLSearchParams(careerRequest.body);
    const likmsRequest = buildLikmsVoteMemberListRequest("PRC_TEST");
    const likmsBody = new URLSearchParams(likmsRequest.body);
    const attendanceListRequest = buildPlenaryAttendanceFileListRequest({
      rows: 200
    });
    const attendanceFileRequest = buildPlenaryAttendanceFileRequest(10001869);
    const voteRequest = buildVoteDetailRequest(resolveAssemblyApiConfig(), {
      assemblyNo: "22",
      billId: "PRC_TEST",
      page: 4,
      rows: 50
    });
    const voteUrl = new URL(voteRequest.url);

    expect(careerRequest.method).toBe("POST");
    expect(careerUrl.origin).toBe("https://open.assembly.go.kr");
    expect(careerUrl.pathname).toBe("/portal/data/sheet/searchSheetData.do");
    expect(careerUrl.searchParams.get("page")).toBe("3");
    expect(careerBody.get("infId")).toBe("ORNDP7000993P115502");
    expect(careerBody.get("infSeq")).toBe("1");
    expect(careerBody.get("rows")).toBe("200");
    expect(careerBody.get("page")).toBeNull();

    expect(likmsRequest.method).toBe("POST");
    expect(new URL(likmsRequest.url).origin).toBe(
      "https://likms.assembly.go.kr"
    );
    expect(new URL(likmsRequest.url).pathname).toBe(
      "/bill/bi/bill/detail/voteInfo.do"
    );
    expect(likmsBody.get("billId")).toBe("PRC_TEST");
    expect(likmsRequest.headers).toMatchObject({
      "x-requested-with": "XMLHttpRequest"
    });
    expect(likmsRequest.headers).toMatchObject({
      referer: expect.stringContaining("billId=PRC_TEST")
    });

    expect(attendanceListRequest.method).toBe("POST");
    expect(new URL(attendanceListRequest.url).pathname).toBe(
      "/portal/data/file/searchFileData.do"
    );
    expect(new URLSearchParams(attendanceListRequest.body).get("infId")).toBe(
      "O4Q5B50011905O18367"
    );
    expect(new URLSearchParams(attendanceListRequest.body).get("rows")).toBe(
      "200"
    );
    expect(new URL(attendanceFileRequest.url).pathname).toBe(
      "/portal/data/file/downloadFileData.do"
    );
    expect(new URL(attendanceFileRequest.url).searchParams.get("fileSeq")).toBe(
      "10001869"
    );

    expect(voteUrl.searchParams.get("pIndex")).toBe("4");
    expect(voteUrl.searchParams.get("pSize")).toBe("50");
  });
});
