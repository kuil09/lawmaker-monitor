import { dateInTimeZone } from "./document-mirror.js";

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

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
}): T[] {
  return args.documents
    .map((document, index) => ({ document, index }))
    .filter(
      ({ document }) =>
        document.publishedDate <= args.targetDate && !args.isCurrent(document)
    )
    .sort((left, right) => {
      const leftIsTarget = left.document.publishedDate === args.targetDate;
      const rightIsTarget = right.document.publishedDate === args.targetDate;
      if (leftIsTarget !== rightIsTarget) {
        return leftIsTarget ? -1 : 1;
      }

      return (
        right.document.publishedDate.localeCompare(
          left.document.publishedDate
        ) || left.index - right.index
      );
    })
    .map(({ document }) => document)
    .slice(0, args.maxDocuments);
}
