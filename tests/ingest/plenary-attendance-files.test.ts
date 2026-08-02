import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";

import { parseOfficialPlenaryAttendanceXlsx } from "../../packages/ingest/src/plenary-attendance-files.js";

function buildAttendanceXlsx(
  args: {
    statusForFirstMember?: string;
    includeBlankStatus?: boolean;
  } = {}
): Uint8Array {
  const sharedStrings = [
    "구분",
    "436회(임시)",
    "의원명",
    "(2026년06월05일)",
    "(2026년06월11일)",
    "(2026년06월18일)",
    "(2026년06월30일)",
    "(2026년07월01일)",
    "김 아라",
    "이 보라",
    args.statusForFirstMember ?? "출석",
    "결석",
    "청가",
    "출장",
    "결석신고서",
    "* 회의일수: 출석 + 결석 + 청가 + 출장 + 결석신고서"
  ];
  const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8"?>
    <sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      ${sharedStrings.map((value) => `<si><t>${value}</t></si>`).join("")}
    </sst>`;
  const sharedCell = (reference: string, index: number) =>
    `<c r="${reference}" t="s"><v>${index}</v></c>`;
  const worksheetXml = `<?xml version="1.0" encoding="UTF-8"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetData>
        <row r="1">${sharedCell("A1", 0)}${sharedCell("C1", 1)}</row>
        <row r="2">${sharedCell("A2", 2)}${sharedCell("C2", 3)}${sharedCell("D2", 4)}${sharedCell("E2", 5)}${sharedCell("F2", 6)}${sharedCell("G2", 7)}</row>
        <row r="3">${sharedCell("A3", 8)}${sharedCell("C3", 10)}${sharedCell("D3", 11)}${sharedCell("E3", 12)}${sharedCell("F3", 13)}${sharedCell("G3", 14)}</row>
        <row r="4">${sharedCell("A4", 9)}${sharedCell("C4", 11)}${args.includeBlankStatus ? "" : sharedCell("D4", 10)}${sharedCell("E4", 10)}</row>
        <row r="5">${sharedCell("C5", 15)}</row>
      </sheetData>
    </worksheet>`;

  return zipSync({
    "xl/sharedStrings.xml": strToU8(sharedStringsXml),
    "xl/worksheets/sheet1.xml": strToU8(worksheetXml)
  });
}

describe("official plenary attendance XLSX parser", () => {
  it("parses shared strings into per-date explicit attendance statuses", () => {
    const meetings = parseOfficialPlenaryAttendanceXlsx({
      content: buildAttendanceXlsx({ includeBlankStatus: true }),
      sourceUrl: "https://record.assembly.go.kr/attendance/436.xlsx",
      retrievedAt: "2026-08-02T00:00:00.000Z",
      sourceHash: "fixture-hash"
    });

    expect(meetings).toEqual([
      expect.objectContaining({
        documentId: "official-plenary-attendance-436-2026-06-05",
        sessionNo: 436,
        meetingDate: "2026-06-05",
        meetingType: "plenary",
        committeeName: null,
        presentNames: ["김 아라"],
        absentNames: ["이 보라"],
        leaveNames: [],
        tripNames: [],
        sourceHash: "fixture-hash"
      }),
      expect.objectContaining({
        meetingDate: "2026-06-11",
        presentNames: [],
        absentNames: ["김 아라"],
        leaveNames: [],
        tripNames: []
      }),
      expect.objectContaining({
        meetingDate: "2026-06-18",
        presentNames: ["이 보라"],
        absentNames: [],
        leaveNames: ["김 아라"],
        tripNames: []
      }),
      expect.objectContaining({
        meetingDate: "2026-06-30",
        presentNames: [],
        absentNames: [],
        leaveNames: [],
        tripNames: ["김 아라"]
      }),
      expect.objectContaining({
        meetingDate: "2026-07-01",
        presentNames: [],
        absentNames: ["김 아라"],
        leaveNames: [],
        tripNames: []
      })
    ]);
  });

  it("fails closed for a non-empty status outside the official status vocabulary", () => {
    expect(() =>
      parseOfficialPlenaryAttendanceXlsx({
        content: buildAttendanceXlsx({ statusForFirstMember: "기타" }),
        sourceUrl: "https://record.assembly.go.kr/attendance/436.xlsx",
        retrievedAt: "2026-08-02T00:00:00.000Z"
      })
    ).toThrow(/Unknown non-empty plenary attendance status/);
  });

  it("treats an official dash marker as no published status", () => {
    const [meeting] = parseOfficialPlenaryAttendanceXlsx({
      content: buildAttendanceXlsx({ statusForFirstMember: "-" }),
      sourceUrl: "https://record.assembly.go.kr/attendance/436.xlsx",
      retrievedAt: "2026-08-02T00:00:00.000Z"
    });

    expect(meeting).toMatchObject({
      presentNames: [],
      absentNames: ["이 보라"]
    });
  });
});
