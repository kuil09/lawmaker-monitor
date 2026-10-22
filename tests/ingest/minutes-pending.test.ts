import { describe, expect, it } from "vitest";

import {
  isPendingAssemblyMinutesViewerHtml,
  parseAssemblyMinutesViewerHtml
} from "../../packages/ingest/src/minutes-transcript.js";

const pending = `<div class="minutes_header"><h1>국회운영위원회회의록</h1><p class="tmp">(임시회의록)</p></div><div class="minutes_body"></div>`;
describe("official minutes availability", () => {
  it("distinguishes an empty temporary official body from a published transcript", () => {
    expect(isPendingAssemblyMinutesViewerHtml(pending)).toBe(true);
    expect(
      parseAssemblyMinutesViewerHtml({
        documentId: "pending",
        sourceUrl:
          "https://record.assembly.go.kr/assembly/viewer/minutes/xml.do?id=55355&type=view",
        fallbackMeetingDate: "2025-09-06",
        fallbackTitle: "국회운영위원회",
        html: pending
      }).statements
    ).toEqual([]);
  });
  it("does not classify arbitrary empty or changed pages as pending", () => {
    expect(
      isPendingAssemblyMinutesViewerHtml("<h1>Upstream unavailable</h1>")
    ).toBe(false);
    expect(
      isPendingAssemblyMinutesViewerHtml(
        pending.replace("(임시회의록)", "(확정회의록)")
      )
    ).toBe(false);
    expect(
      isPendingAssemblyMinutesViewerHtml(
        pending.replace(
          '<div class="minutes_body"></div>',
          '<div class="minutes_body"><p>실제 본문이 있지만 발언자를 읽지 못한 경우</p></div>'
        )
      )
    ).toBe(false);
    expect(
      isPendingAssemblyMinutesViewerHtml(
        pending.replace(
          '<div class="minutes_body"></div>',
          '<div class="minutes_body"><img src="scan.png" alt="회의록 스캔"></div>'
        )
      )
    ).toBe(false);
  });
});
