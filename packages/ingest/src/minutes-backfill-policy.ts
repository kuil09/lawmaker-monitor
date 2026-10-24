import { dateInTimeZone } from "./document-mirror.js";

export class MinutesSummaryDeadlineError extends Error {
  constructor() {
    super("Minutes summary processing time budget exhausted.");
  }
}

export type MinutesBackfillBudget = {
  reservations: Array<{
    batchId: string;
    startedAt: string;
    minutes: number;
    workers?: number;
  }>;
};

// Reserve the whole job timeout before starting inference. A killed job still
// consumes its reservation, so retries cannot evade the daily ceiling.
export function reserveMinutesBackfill(
  budget: MinutesBackfillBudget,
  batchId: string,
  now = new Date(),
  parallel = false
): { admitted: boolean; budget: MinutesBackfillBudget } {
  const day = dateInTimeZone("Asia/Seoul", now);
  if (
    !Array.isArray(budget.reservations) ||
    budget.reservations.some(
      (entry) =>
        !entry.batchId ||
        !Number.isFinite(Date.parse(entry.startedAt)) ||
        !(
          (entry.minutes === 30 && entry.workers === undefined) ||
          (entry.minutes === 265 && entry.workers === 8)
        )
    )
  )
    throw new Error(
      "Invalid minutes backfill budget; refusing to reset the ceiling."
    );
  const reservations = budget.reservations.filter(
    (entry) => now.getTime() - Date.parse(entry.startedAt) < 14 * 86_400_000
  );
  const today = reservations.filter(
    (entry) => dateInTimeZone("Asia/Seoul", new Date(entry.startedAt)) === day
  );
  const minutes = parallel ? 265 : 30;
  const admitted =
    !reservations.some((entry) => entry.batchId === batchId) &&
    today.length < 8 &&
    today.reduce((total, entry) => total + entry.minutes, 0) + minutes <= 2120;
  if (admitted)
    reservations.push({
      batchId,
      startedAt: now.toISOString(),
      minutes,
      ...(parallel ? { workers: 8 } : {})
    });
  return { admitted, budget: { reservations } };
}

export function needsMinutesAnalysisRefresh(
  summaries: { generatedAt: string; members: Array<{ summaryCount: number }> },
  analysis: { generatedAt: string; coverage: { statements: number } } | null
): boolean {
  if (!analysis) return true;
  const summaryTime = Date.parse(summaries.generatedAt);
  const analysisTime = Date.parse(analysis.generatedAt);
  if (!Number.isFinite(summaryTime) || !Number.isFinite(analysisTime))
    throw new Error("Invalid minutes publication timestamp.");
  return (
    summaryTime > analysisTime ||
    summaries.members.reduce((sum, member) => sum + member.summaryCount, 0) !==
      analysis.coverage.statements
  );
}

export function canStartMinutesRequest(
  deadline: number,
  requestTimeoutMs: number,
  now = Date.now()
): boolean {
  return now + requestTimeoutMs <= deadline;
}

export type MinutesSummaryBatch = {
  batchId: string;
  completedAt: string;
  runMode: string;
  elapsedMs: number;
  workerElapsedMs?: number;
  workersExpected?: number;
  missingWorkers?: number;
  documentsCompleted: number;
  groupsSummarized: number;
  groupsSkipped: number;
  groupsFailed: number;
  transcriptDocuments: number;
  remainingDocuments: number;
  remainingGroups: number;
};

export function measureMinutesProcessing(
  history: MinutesSummaryBatch[],
  remainingGroups: number,
  now = new Date()
) {
  const batches = history.filter(
    (entry) => now.getTime() - Date.parse(entry.completedAt) <= 7 * 86_400_000
  );
  const elapsedMs = batches.reduce((sum, batch) => sum + batch.elapsedMs, 0);
  const groups = batches.reduce(
    (sum, batch) => sum + batch.groupsSummarized + batch.groupsSkipped,
    0
  );
  const groupsPerMinute = elapsedMs > 0 ? groups / (elapsedMs / 60_000) : 0;
  const first = batches[0];
  const last = batches.at(-1);
  return {
    observedBatches: batches.length,
    observedHours:
      first && last
        ? (Date.parse(last.completedAt) - Date.parse(first.completedAt)) /
          3_600_000
        : 0,
    groupsPerMinute,
    estimatedRemainingProcessingMinutes:
      groupsPerMinute > 0 ? remainingGroups / groupsPerMinute : null,
    completedDocuments: batches.reduce(
      (sum, batch) => sum + batch.documentsCompleted,
      0
    ),
    incomingDocuments:
      first && last && batches.length > 1
        ? Math.max(0, last.transcriptDocuments - first.transcriptDocuments)
        : null,
    netBacklogChange:
      first && last && batches.length > 1
        ? last.remainingDocuments - first.remainingDocuments
        : null
  };
}
