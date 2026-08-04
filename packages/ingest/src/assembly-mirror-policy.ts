import type { DocumentMirrorState } from "./document-mirror.js";

export type AssemblySearchWindow = {
  label: "recent" | "backfill";
  startDate: string;
  endDate: string;
};

export type AssemblySearchWindowConfig = {
  recentDays: number;
  backfillStartDate: string;
  backfillDays: number;
};

type SearchWindowOptions = {
  includeAllBackfillWindows?: boolean;
  backfillCursorDate?: string;
  includeRecent?: boolean;
  latestDateOnly?: boolean;
  maxBackfillWindows?: number;
};

export function shiftIsoDate(date: string, days: number): string {
  const [year, month, day] = date
    .split("-")
    .map((part) => Number.parseInt(part, 10));
  if (!year || !month || !day) {
    throw new Error(`Invalid ISO date: ${date}`);
  }

  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function resolveEffectiveRecentDays(
  configuredDays: number,
  minimumDays: number
): number {
  return Math.max(1, configuredDays, minimumDays);
}

export function sortDatedItemsNewestFirst<
  T extends { publishedDate: string | null }
>(items: T[]): T[] {
  return [...items].sort((left, right) => {
    if (!left.publishedDate) {
      return right.publishedDate ? 1 : 0;
    }
    if (!right.publishedDate) {
      return -1;
    }
    return right.publishedDate.localeCompare(left.publishedDate);
  });
}

export function buildAssemblySearchWindows(
  cutoffDate: string,
  config: AssemblySearchWindowConfig,
  existingState: Pick<DocumentMirrorState, "nextBackfillCursorDate"> | null,
  options?: SearchWindowOptions
): AssemblySearchWindow[] {
  if (options?.latestDateOnly) {
    return [
      {
        label: "recent",
        startDate: cutoffDate,
        endDate: cutoffDate
      }
    ];
  }

  const yesterday = shiftIsoDate(cutoffDate, -1);
  const windows: AssemblySearchWindow[] = [];

  if (config.recentDays > 0 && options?.includeRecent !== false) {
    windows.push({
      label: "recent",
      startDate: shiftIsoDate(yesterday, -(config.recentDays - 1)),
      endDate: yesterday
    });
  }

  const backfillCursor =
    options?.backfillCursorDate?.trim() ||
    existingState?.nextBackfillCursorDate?.trim() ||
    config.backfillStartDate;
  if (backfillCursor <= yesterday && config.backfillDays > 0) {
    let cursor = backfillCursor;
    let backfillWindowCount = 0;
    const backfillWindowLimit = options?.includeAllBackfillWindows
      ? Number.POSITIVE_INFINITY
      : Math.max(1, options?.maxBackfillWindows ?? 1);

    while (cursor <= yesterday && backfillWindowCount < backfillWindowLimit) {
      const backfillEndDate =
        shiftIsoDate(cursor, config.backfillDays - 1) <= yesterday
          ? shiftIsoDate(cursor, config.backfillDays - 1)
          : yesterday;
      const overlapsRecent = windows.some(
        (window) =>
          cursor >= window.startDate && backfillEndDate <= window.endDate
      );

      if (!overlapsRecent) {
        windows.push({
          label: "backfill",
          startDate: cursor,
          endDate: backfillEndDate
        });
        backfillWindowCount += 1;
      }

      cursor = shiftIsoDate(backfillEndDate, 1);
    }
  }

  return [
    ...new Map(
      windows.map((window) => [
        `${window.label}:${window.startDate}:${window.endDate}`,
        window
      ])
    ).values()
  ];
}

export function splitAssemblySearchWindowsByDay(
  windows: AssemblySearchWindow[]
): AssemblySearchWindow[] {
  return windows.flatMap((window) => {
    const dailyWindows: AssemblySearchWindow[] = [];
    let cursor = window.startDate;
    while (cursor <= window.endDate) {
      dailyWindows.push({
        label: window.label,
        startDate: cursor,
        endDate: cursor
      });
      cursor = shiftIsoDate(cursor, 1);
    }
    return dailyWindows;
  });
}

export function resolveNextBackfillCursorDate(args: {
  cutoffDate: string;
  config: Pick<AssemblySearchWindowConfig, "backfillStartDate">;
  existingState: Pick<DocumentMirrorState, "nextBackfillCursorDate"> | null;
  windows: AssemblySearchWindow[];
}): string | null {
  const yesterday = shiftIsoDate(args.cutoffDate, -1);
  const latestBackfillWindow = args.windows
    .filter((window) => window.label === "backfill")
    .at(-1);

  if (latestBackfillWindow) {
    return shiftIsoDate(latestBackfillWindow.endDate, 1);
  }

  return (
    args.existingState?.nextBackfillCursorDate ??
    (args.config.backfillStartDate <= yesterday
      ? args.config.backfillStartDate
      : null)
  );
}

export function resolvePublishedBackfillCursor(args: {
  proposedCursor: string | null | undefined;
  fallbackCursor: string;
  skippedWithoutDate: number;
  downloadFailures?: number;
  reachedDownloadLimit: boolean;
}): string | null | undefined {
  // Transcript failures remain eligible for the independent stale-transcript
  // retry queue, so they must not pin the document discovery cursor.
  if (
    args.skippedWithoutDate > 0 ||
    (args.downloadFailures ?? 0) > 0 ||
    args.reachedDownloadLimit
  ) {
    return args.fallbackCursor;
  }
  return args.proposedCursor;
}

export function hasPendingBackfill(args: {
  nextBackfillCursorDate?: string | null;
  recentWindowStartDate?: string;
}): boolean {
  return Boolean(
    args.nextBackfillCursorDate &&
    args.recentWindowStartDate &&
    args.nextBackfillCursorDate < args.recentWindowStartDate
  );
}
