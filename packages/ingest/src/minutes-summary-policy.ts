import { dateInTimeZone } from "./document-mirror.js";

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export function shouldRunScheduledMinutesRecovery(
  state: {
    remainingDocuments: number;
    groupsFailed?: number;
    updatedAt: string;
  } | null,
  now = new Date()
): boolean {
  if (!state) return true;
  if (state.remainingDocuments === 0 && !state.groupsFailed) return false;
  const age = now.getTime() - Date.parse(state.updatedAt);
  return (
    Boolean(state.groupsFailed) ||
    !Number.isFinite(age) ||
    age < 0 ||
    age >= 18 * 3_600_000
  );
}

function isValidIsoDate(value: string): boolean {
  if (!isoDatePattern.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month! - 1 &&
    date.getUTCDate() === day
  );
}

export function resolveMinutesSummaryTargetDate(
  configuredDate: string | undefined,
  now = new Date()
): string {
  const value = configuredDate?.trim();
  if (!value) {
    return dateInTimeZone("Asia/Seoul", now);
  }
  if (!isValidIsoDate(value)) {
    throw new Error(
      `MINUTES_SUMMARY_TARGET_DATE must be a valid YYYY-MM-DD date: ${value}`
    );
  }
  return value;
}

export function selectPendingMinutesDocuments<
  T extends { publishedDate: string }
>(args: {
  documents: T[];
  targetDate: string;
  maxDocuments: number;
  isCurrent: (document: T) => boolean;
  lastAttemptAt?: (document: T) => string | undefined;
  nextRetryAt?: (document: T) => string | undefined;
  now?: Date;
  priority?: "recent" | "oldest";
}): T[] {
  const recentCutoff = new Date(`${args.targetDate}T00:00:00Z`);
  recentCutoff.setUTCDate(recentCutoff.getUTCDate() - 14);
  const cutoff = recentCutoff.toISOString().slice(0, 10);
  return args.documents
    .map((document, index) => ({ document, index }))
    .filter(
      ({ document }) =>
        document.publishedDate <= args.targetDate &&
        !args.isCurrent(document) &&
        (!args.nextRetryAt?.(document) ||
          Date.parse(args.nextRetryAt(document)!) <=
            (args.now ?? new Date()).getTime())
    )
    .sort((left, right) => {
      if (args.priority === "oldest") {
        const dateOrder = left.document.publishedDate.localeCompare(
          right.document.publishedDate
        );
        if (dateOrder !== 0) return dateOrder;
      }
      const leftIsTarget = left.document.publishedDate === args.targetDate;
      const rightIsTarget = right.document.publishedDate === args.targetDate;
      if (leftIsTarget !== rightIsTarget) {
        return leftIsTarget ? -1 : 1;
      }

      const leftIsRecent = left.document.publishedDate >= cutoff;
      const rightIsRecent = right.document.publishedDate >= cutoff;
      if (leftIsRecent !== rightIsRecent) return leftIsRecent ? -1 : 1;

      const leftAttempt = args.lastAttemptAt?.(left.document) ?? "";
      const rightAttempt = args.lastAttemptAt?.(right.document) ?? "";
      if (leftAttempt !== rightAttempt)
        return leftAttempt.localeCompare(rightAttempt);
      return (
        right.document.publishedDate.localeCompare(
          left.document.publishedDate
        ) || left.index - right.index
      );
    })
    .map(({ document }) => document)
    .slice(0, args.maxDocuments);
}
