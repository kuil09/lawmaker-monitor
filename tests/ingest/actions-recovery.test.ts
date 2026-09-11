import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";

import { buildOfficialAttendanceFacts } from "../../packages/ingest/src/official-facts.js";
import { parseOfficialPlenaryAttendanceXlsx } from "../../packages/ingest/src/plenary-attendance-files.js";

import type { MemberRecord } from "@lawmaker-monitor/schemas";
import type { MemberTenureIndex } from "../../packages/ingest/src/tenure.js";

const member = (memberId: string, nameHanja: string): MemberRecord => ({
  memberId,
  name: "박지원",
  party: "더불어민주당",
  committeeMemberships: [],
  isCurrentMember: true,
  proportionalFlag: false,
  assemblyNo: 22,
  profile: {
    nameHanja,
    aideNames: [],
    chiefSecretaryNames: [],
    secretaryNames: []
  }
});
const senior = member("8BF5855P", "朴智元");
const junior = member("H7X3372O", "朴芝源");
const tenureIndex: MemberTenureIndex = new Map([
  [senior.memberId, [{ startDate: "2024-05-30", endDate: null }]],
  [junior.memberId, [{ startDate: "2026-06-04", endDate: null }]]
]);

function workbook(rows: Array<[string, string]>) {
  const strings = ["438회(임시)", "의원명", "(2026년08월20일)", ...rows.flat()];
  const cell = (ref: string, index: number) =>
    `<c r="${ref}" t="s"><v>${index}</v></c>`;
  return zipSync({
    "xl/sharedStrings.xml": strToU8(
      `<sst>${strings.map((s) => `<si><t>${s}</t></si>`).join("")}</sst>`
    ),
    "xl/worksheets/sheet1.xml": strToU8(
      `<worksheet><sheetData><row r="1">${cell("C1", 0)}</row><row r="2">${cell("A2", 1)}${cell("C2", 2)}</row>${rows.map((_, i) => `<row r="${i + 3}">${cell(`A${i + 3}`, 3 + i * 2)}${cell(`C${i + 3}`, 4 + i * 2)}</row>`).join("")}</sheetData></worksheet>`
    )
  });
}

function resolveRows(
  rows: Array<[string, string]>,
  members = [senior, junior],
  tenures = tenureIndex
) {
  const meetings = parseOfficialPlenaryAttendanceXlsx({
    content: workbook(rows),
    sourceUrl:
      "https://open.assembly.go.kr/portal/data/file/downloadFileData.do",
    retrievedAt: "2026-09-11T10:08:19.200Z"
  });
  return buildOfficialAttendanceFacts({
    members,
    careers: [],
    meetings: meetings.map((meeting) => ({
      ...meeting,
      requiresExplicitStatus: true
    })),
    tenureIndex: tenures
  });
}

describe("issue 48 workbook-to-identity regression", () => {
  it("resolves the real 438th session Hangul/Hanja rows without profile links", () => {
    const facts = resolveRows([
      ["박지원", "출석"],
      ["朴芝源", "출석"]
    ]);
    expect(facts.map((f) => [f.memberId, f.status])).toEqual([
      [senior.memberId, "present"],
      [junior.memberId, "present"]
    ]);
    expect(facts.every((f) => f.memberName === "박지원")).toBe(true);
  });
  it.each(["결석", "청가", "출장"])(
    "uses official Hanja identity even when statuses differ: %s",
    (status) => {
      const facts = resolveRows([
        ["박지원", "출석"],
        ["朴芝源", status]
      ]);
      expect(facts.find((f) => f.memberId === senior.memberId)?.status).toBe(
        "present"
      );
      expect(facts.find((f) => f.memberId === junior.memberId)?.status).toBe(
        (
          { 결석: "absent", 청가: "leave", 출장: "trip" } as Record<
            string,
            string
          >
        )[status]
      );
    }
  );
  it("preserves namesake row counts instead of deduplicating by name", () => {
    expect(
      resolveRows([
        ["박지원", "출석"],
        ["박지원", "출석"]
      ])
    ).toHaveLength(2);
  });
  it("does not assign one Hangul row to two people", () => {
    expect(() => resolveRows([["박지원", "출석"]])).toThrow(
      /remaining rows=1, unresolved candidates=\[8BF5855P\/朴智元,H7X3372O\/朴芝源\]/
    );
  });
  it("rejects split statuses without an identifying spelling", () => {
    expect(() =>
      resolveRows([
        ["박지원", "출석"],
        ["박지원", "결석"]
      ])
    ).toThrow(/conflicting statuses/);
  });
  it("rejects ambiguous or unknown Hanja rather than transliterating", () => {
    expect(() =>
      resolveRows(
        [
          ["박지원", "출석"],
          ["朴芝源", "출석"]
        ],
        [member(senior.memberId, "朴芝源"), junior]
      )
    ).toThrow(/Hanja name is unresolved or ambiguous/);
    expect(() =>
      resolveRows([
        ["박지원", "출석"],
        ["未知名", "출석"]
      ])
    ).toThrow(/Hanja name is unresolved or ambiguous/);
  });
  it("rejects duplicate Hanja rows and conflicting statuses for one identity", () => {
    expect(() =>
      resolveRows([
        ["박지원", "출석"],
        ["朴芝源", "출석"],
        ["朴芝源", "출석"]
      ])
    ).toThrow(/duplicate or conflicting/);
    expect(() =>
      resolveRows([
        ["박지원", "출석"],
        ["朴芝源", "출석"],
        ["朴芝源", "결석"]
      ])
    ).toThrow(/duplicate or conflicting/);
  });
  it("rejects duplicate member IDs instead of treating them as namesakes", () => {
    expect(() =>
      resolveRows(
        [
          ["박지원", "출석"],
          ["박지원", "출석"]
        ],
        [senior, senior]
      )
    ).toThrow(/duplicate member ID/);
  });
  it("rejects Hangul/Hanja double rows for a single person", () => {
    expect(() =>
      resolveRows(
        [
          ["박지원", "출석"],
          ["朴智元", "출석"]
        ],
        [senior]
      )
    ).toThrow(/duplicate identity rows/);
  });
  it("uses meeting-date tenure before matching namesakes", () => {
    const tenures: MemberTenureIndex = new Map([
      ...tenureIndex,
      [junior.memberId, [{ startDate: "2026-09-01", endDate: null }]]
    ]);
    expect(
      resolveRows([["박지원", "출석"]], [senior, junior], tenures).map(
        (f) => f.memberId
      )
    ).toEqual([senior.memberId]);
  });
  it("rejects a repeated row for a single eligible member", () => {
    expect(() =>
      resolveRows(
        [
          ["박지원", "출석"],
          ["박지원", "출석"]
        ],
        [senior]
      )
    ).toThrow(/duplicate rows/);
  });
});
