import { describe, expect, it } from "vitest";

import {
  resolveMinutesSummaryTargetDate,
  selectPendingMinutesDocuments
} from "../../packages/ingest/src/minutes-summary-policy.js";

describe("minutes summary policy", () => {
  it("resolves the target date in Korea", () => {
    expect(
      resolveMinutesSummaryTargetDate(
        undefined,
        new Date("2026-08-03T15:30:00.000Z")
      )
    ).toBe("2026-08-04");
    expect(resolveMinutesSummaryTargetDate("2026-08-02")).toBe("2026-08-02");
    expect(() => resolveMinutesSummaryTargetDate("2026-02-30")).toThrow(
      "valid YYYY-MM-DD"
    );
  });

  it("selects only unsummarized documents from the target date", () => {
    const documents = [
      { documentId: "today-current", publishedDate: "2026-08-04" },
      { documentId: "today-first", publishedDate: "2026-08-04" },
      { documentId: "today-second", publishedDate: "2026-08-04" },
      { documentId: "historical", publishedDate: "2026-08-03" }
    ];

    expect(
      selectPendingMinutesDocuments({
        documents,
        targetDate: "2026-08-04",
        maxDocuments: 1,
        isCurrent: (document) => document.documentId === "today-current"
      })
    ).toEqual([{ documentId: "today-first", publishedDate: "2026-08-04" }]);
  });
});
