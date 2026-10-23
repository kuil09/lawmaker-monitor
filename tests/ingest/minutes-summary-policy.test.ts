import { describe, expect, it } from "vitest";

import {
  resolveMinutesSummaryTargetDate,
  shouldRunScheduledMinutesRecovery,
  selectPendingMinutesDocuments
} from "../../packages/ingest/src/minutes-summary-policy.js";

describe("minutes summary policy", () => {
  it("recovers a missed batch without duplicating a recent successful bounded batch", () => {
    const now = new Date("2026-10-23T18:30:00Z");
    expect(shouldRunScheduledMinutesRecovery(null, now)).toBe(true);
    expect(
      shouldRunScheduledMinutesRecovery(
        { updatedAt: "2026-10-23T15:40:00Z", remainingDocuments: 1700 },
        now
      )
    ).toBe(false);
    expect(
      shouldRunScheduledMinutesRecovery(
        { updatedAt: "2026-10-22T15:40:00Z", remainingDocuments: 1700 },
        now
      )
    ).toBe(true);
    expect(
      shouldRunScheduledMinutesRecovery(
        {
          updatedAt: "2026-10-23T15:40:00Z",
          remainingDocuments: 1700,
          groupsFailed: 1
        },
        now
      )
    ).toBe(true);
    expect(
      shouldRunScheduledMinutesRecovery(
        { updatedAt: "2026-10-20T15:40:00Z", remainingDocuments: 0 },
        now
      )
    ).toBe(false);
    expect(
      shouldRunScheduledMinutesRecovery(
        { updatedAt: "invalid", remainingDocuments: 2 },
        now
      )
    ).toBe(true);
  });
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

  it("prioritizes the target date, then catches up from newest pending documents", () => {
    const documents = [
      { documentId: "today-current", publishedDate: "2026-08-04" },
      { documentId: "today-first", publishedDate: "2026-08-04" },
      { documentId: "today-second", publishedDate: "2026-08-04" },
      { documentId: "historical", publishedDate: "2026-08-03" },
      { documentId: "older", publishedDate: "2026-08-02" },
      { documentId: "future", publishedDate: "2026-08-05" }
    ];

    expect(
      selectPendingMinutesDocuments({
        documents,
        targetDate: "2026-08-04",
        maxDocuments: 4,
        isCurrent: (document) => document.documentId === "today-current"
      })
    ).toEqual([
      { documentId: "today-first", publishedDate: "2026-08-04" },
      { documentId: "today-second", publishedDate: "2026-08-04" },
      { documentId: "historical", publishedDate: "2026-08-03" },
      { documentId: "older", publishedDate: "2026-08-02" }
    ]);
  });
});
