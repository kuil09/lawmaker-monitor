import { describe, expect, it, vi, afterEach } from "vitest";

import {
  canStartMinutesRequest,
  measureMinutesProcessing,
  needsMinutesAnalysisRefresh,
  reserveMinutesBackfill,
  MinutesSummaryDeadlineError,
  type MinutesBackfillBudget,
  type MinutesSummaryBatch
} from "../../packages/ingest/src/minutes-backfill-policy.js";
import {
  createLlamaServerSummarizer,
  type MinutesSummaryGroup
} from "../../packages/ingest/src/minutes-summarization.js";
import { selectPendingMinutesDocuments } from "../../packages/ingest/src/minutes-summary-policy.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("bounded minutes backfill", () => {
  it("charges failed attempts in advance and prevents a ninth daily batch", () => {
    const now = new Date("2026-10-24T14:00:00Z");
    let budget: MinutesBackfillBudget = { reservations: [] };
    for (let index = 0; index < 8; index++) {
      const result = reserveMinutesBackfill(budget, `run-${index}`, now);
      expect(result.admitted).toBe(true);
      budget = result.budget;
    }
    expect(reserveMinutesBackfill(budget, "extra-retry", now).admitted).toBe(
      false
    );
    expect(
      budget.reservations.reduce((sum, entry) => sum + entry.minutes, 0)
    ).toBe(240);
    expect(
      reserveMinutesBackfill(
        budget,
        "next-day",
        new Date("2026-10-24T15:00:00Z")
      ).admitted
    ).toBe(true);
    expect(reserveMinutesBackfill(budget, "run-0", now).admitted).toBe(false);
    expect(() =>
      reserveMinutesBackfill(
        { reservations: [{ batchId: "bad", startedAt: "bad", minutes: 30 }] },
        "new",
        now
      )
    ).toThrow("refusing to reset");
  });

  it("reserves recent work for the normal run and serves the oldest historical work first", () => {
    const documents = [
      { id: "recent", publishedDate: "2026-10-20" },
      { id: "old", publishedDate: "2024-06-01" },
      { id: "oldest", publishedDate: "2024-05-30" },
      { id: "future", publishedDate: "2026-10-25" }
    ];
    const args = {
      documents,
      targetDate: "2026-10-24",
      maxDocuments: 2,
      isCurrent: () => false
    };
    expect(
      selectPendingMinutesDocuments({ ...args, priority: "oldest" }).map(
        (item) => item.id
      )
    ).toEqual(["oldest", "old"]);
    expect(
      selectPendingMinutesDocuments({ ...args, priority: "recent" }).map(
        (item) => item.id
      )[0]
    ).toBe("recent");
    expect(
      selectPendingMinutesDocuments({
        ...args,
        priority: "oldest",
        nextRetryAt: (item) =>
          item.id === "oldest" ? "2026-10-25T00:00:00Z" : undefined,
        now: new Date("2026-10-24T00:00:00Z")
      }).map((item) => item.id)
    ).toEqual(["old", "recent"]);
  });

  it("refreshes changed content even when the number of quotes stays equal", () => {
    const summaries = {
      generatedAt: "2026-10-24T06:00:00Z",
      members: [{ summaryCount: 10 }]
    };
    expect(needsMinutesAnalysisRefresh(summaries, null)).toBe(true);
    expect(
      needsMinutesAnalysisRefresh(summaries, {
        generatedAt: "2026-10-24T05:00:00Z",
        coverage: { statements: 10 }
      })
    ).toBe(true);
    expect(
      needsMinutesAnalysisRefresh(summaries, {
        generatedAt: "2026-10-24T07:00:00Z",
        coverage: { statements: 10 }
      })
    ).toBe(false);
    expect(
      needsMinutesAnalysisRefresh(summaries, {
        generatedAt: "2026-10-24T07:00:00Z",
        coverage: { statements: 9 }
      })
    ).toBe(true);
  });

  it("does not start requests that cannot fit and stops internal model retries at the shared deadline", async () => {
    expect(canStartMinutesRequest(1000, 100, 901)).toBe(false);
    expect(canStartMinutesRequest(1000, 100, 900)).toBe(true);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-24T00:00:00Z"));
    const fetchMock = vi.fn().mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 200);
      throw new Error("Temporary request failure");
    });
    vi.stubGlobal("fetch", fetchMock);
    const summarize = createLlamaServerSummarizer({
      endpoint: "http://localhost/unused",
      modelId: "test",
      deadline: Date.now() + 100
    });
    await expect(
      summarize({
        group: {
          billIds: [],
          member: { name: "김아라" }
        } as MinutesSummaryGroup,
        text: [
          "국민을 위한 정책을 충분히 검토하고 지원 기준을 구체적으로 마련해야 합니다.",
          "중소기업이 피해를 입지 않도록 예산 배분 기준을 정해야 합니다.",
          "사업의 효과를 정기적으로 평가하여 결과를 국회에 보고해야 합니다.",
          "관계 부처와 협의하여 현장 의견을 반영하는 절차를 마련해야 합니다."
        ].join(" ")
      })
    ).rejects.toBeInstanceOf(MinutesSummaryDeadlineError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports measured capacity and backlog growth without inventing a one-batch arrival rate", () => {
    const batch = {
      batchId: "one",
      completedAt: "2026-10-23T00:00:00Z",
      runMode: "backfill",
      elapsedMs: 60_000,
      documentsCompleted: 2,
      groupsSummarized: 8,
      groupsSkipped: 2,
      groupsFailed: 0,
      transcriptDocuments: 100,
      remainingDocuments: 50,
      remainingGroups: 200
    } satisfies MinutesSummaryBatch;
    expect(
      measureMinutesProcessing([batch], 200, new Date(batch.completedAt))
    ).toMatchObject({
      groupsPerMinute: 10,
      estimatedRemainingProcessingMinutes: 20,
      incomingDocuments: null,
      netBacklogChange: null
    });
    expect(
      measureMinutesProcessing(
        [
          batch,
          {
            ...batch,
            batchId: "two",
            completedAt: "2026-10-24T00:00:00Z",
            transcriptDocuments: 105,
            remainingDocuments: 45
          }
        ],
        180,
        new Date("2026-10-24T01:00:00Z")
      )
    ).toMatchObject({
      observedHours: 24,
      incomingDocuments: 5,
      netBacklogChange: -5
    });
  });
});
