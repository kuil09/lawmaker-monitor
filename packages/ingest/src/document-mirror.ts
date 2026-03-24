import { join } from "node:path";

import { sha256 } from "./utils.js";

export type MirroredDocumentVersion = {
  retrievedAt: string;
  relativePath: string;
  contentSha256: string;
  bytes: number;
};

export type MirroredDocumentMetadata = {
  documentId: string;
  sourceId: string;
  sourceUrl: string;
  title: string;
  publishedDate: string;
  discoveredFromUrl: string;
  firstMirroredAt: string;
  lastMirroredAt: string;
  latestRelativePath: string;
  metadataRelativePath: string;
  currentContentSha256: string;
  currentContentType: string;
  currentBytes: number;
  versions: MirroredDocumentVersion[];
};

export type MirroredDocumentIndexItem = {
  documentId: string;
  sourceId: string;
  sourceUrl: string;
  title: string;
  publishedDate: string;
  latestRelativePath: string;
  metadataRelativePath: string;
  lastMirroredAt: string;
  currentContentSha256: string;
  currentContentType: string;
  currentBytes: number;
  versionCount: number;
};

export type MirroredDocumentIndex = {
  sourceId: string;
  updatedAt: string;
  items: MirroredDocumentIndexItem[];
};

export type DocumentMirrorState = {
  sourceId: string;
  updatedAt: string;
  cutoffDate: string;
  pagesVisited: number;
  discoveredCandidates: number;
  downloaded: number;
  updated: number;
  unchanged: number;
  skippedTodayOrFuture: number;
  skippedWithoutDate: number;
  lastStartUrl: string;
  recentWindowStartDate?: string;
  recentWindowEndDate?: string;
  nextBackfillCursorDate?: string | null;
};

export type DocumentPathSet = {
  relativeDirectory: string;
  metadataRelativePath: string;
  latestRelativePath: string;
  versionRelativePath: string;
};

export type BuildPathInput = {
  sourceId: string;
  documentId: string;
  publishedDate: string;
  retrievedAt: string;
  fileExtension: string;
};

export function slugifySegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

export function normalizeDocumentDate(value: string): string | null {
  const compact = value.trim();
  if (!compact) {
    return null;
  }

  const match = compact.match(/(20\d{2})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/);
  if (!match) {
    return null;
  }

  const [, year, rawMonth, rawDay] = match;
  if (!year || !rawMonth || !rawDay) {
    return null;
  }

  const month = rawMonth.padStart(2, "0");
  const day = rawDay.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function dateInTimeZone(timeZone: string, now = new Date()): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  return formatter.format(now);
}

export function isPastDocumentDate(documentDate: string, cutoffDate: string): boolean {
  return documentDate < cutoffDate;
}

function extensionFromContentDisposition(contentDisposition?: string): string | null {
  if (!contentDisposition) {
    return null;
  }

  const filenameMatch =
    contentDisposition.match(/filename\*=UTF-8''([^;]+)/i) ??
    contentDisposition.match(/filename="?([^";]+)"?/i);
  if (!filenameMatch?.[1]) {
    return null;
  }

  const filename = filenameMatch[1].trim().toLowerCase();
  const extensionMatch = filename.match(/\.([a-z0-9]+)$/i);
  return extensionMatch?.[1] ?? null;
}

export function detectFileExtension(
  url: string,
  contentType?: string,
  contentDisposition?: string
): string {
  const pathname = new URL(url).pathname.toLowerCase();
  const contentTypeValue = (contentType ?? "").toLowerCase();
  const dispositionExtension = extensionFromContentDisposition(contentDisposition);

  if (dispositionExtension) {
    return dispositionExtension;
  }

  if (pathname.endsWith(".pdf") || contentTypeValue.includes("application/pdf")) {
    return "pdf";
  }

  if (
    pathname.endsWith(".hwp") ||
    contentTypeValue.includes("application/hwp") ||
    contentTypeValue.includes("application/x-hwp") ||
    contentTypeValue.includes("application/haansofthwp")
  ) {
    return "hwp";
  }

  if (pathname.endsWith(".xml") || contentTypeValue.includes("xml")) {
    return "xml";
  }

  if (pathname.endsWith(".html") || contentTypeValue.includes("html")) {
    return "html";
  }

  if (contentTypeValue.includes("image/jpeg")) {
    return "jpg";
  }

  if (contentTypeValue.includes("image/png")) {
    return "png";
  }

  if (contentTypeValue.includes("image/gif")) {
    return "gif";
  }

  if (contentTypeValue.includes("application/zip")) {
    return "zip";
  }

  return "bin";
}

export function buildDocumentId(title: string, sourceUrl: string, publishedDate: string): string {
  const slug = slugifySegment(title) || "document";
  const shortHash = sha256(`${publishedDate}:${sourceUrl}`).slice(0, 10);
  return `${publishedDate}-${slug}-${shortHash}`;
}

export function buildDocumentPaths(input: BuildPathInput): DocumentPathSet {
  const [year, month, day] = input.publishedDate.split("-");
  if (!year || !month || !day) {
    throw new Error(`Invalid published date for mirrored document: ${input.publishedDate}`);
  }

  const versionStamp = input.retrievedAt.replace(/[:.]/g, "-");
  const relativeDirectory = join(
    "raw",
    "documents",
    input.sourceId,
    year,
    month,
    day,
    input.documentId
  );

  return {
    relativeDirectory,
    metadataRelativePath: join(relativeDirectory, "metadata.json"),
    latestRelativePath: join(relativeDirectory, `latest.${input.fileExtension}`),
    versionRelativePath: join(relativeDirectory, "versions", `${versionStamp}.${input.fileExtension}`)
  };
}

export function toIndexItem(metadata: MirroredDocumentMetadata): MirroredDocumentIndexItem {
  return {
    documentId: metadata.documentId,
    sourceId: metadata.sourceId,
    sourceUrl: metadata.sourceUrl,
    title: metadata.title,
    publishedDate: metadata.publishedDate,
    latestRelativePath: metadata.latestRelativePath,
    metadataRelativePath: metadata.metadataRelativePath,
    lastMirroredAt: metadata.lastMirroredAt,
    currentContentSha256: metadata.currentContentSha256,
    currentContentType: metadata.currentContentType,
    currentBytes: metadata.currentBytes,
    versionCount: metadata.versions.length
  };
}

export function mergeDocumentIndex(
  sourceId: string,
  items: MirroredDocumentIndexItem[],
  updatedAt: string
): MirroredDocumentIndex {
  const byId = new Map<string, MirroredDocumentIndexItem>();

  for (const item of items) {
    byId.set(item.documentId, item);
  }

  return {
    sourceId,
    updatedAt,
    items: [...byId.values()].sort((left, right) => {
      const byDate = right.publishedDate.localeCompare(left.publishedDate);
      return byDate !== 0 ? byDate : left.title.localeCompare(right.title);
    })
  };
}
