import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildDocumentId,
  buildDocumentPaths,
  dateInTimeZone,
  detectFileExtension,
  isPastDocumentDate,
  mergeDocumentIndex,
  normalizeDocumentDate,
  selectExistingMirroredMetadata,
  slugifySegment,
  toIndexItem
} from "../../packages/ingest/src/document-mirror.js";
import {
  buildAssemblySearchWindows,
  hasPendingBackfill,
  resolveEffectiveRecentDays,
  resolveNextBackfillCursorDate,
  resolvePublishedBackfillCursor,
  sortDatedItemsNewestFirst,
  splitAssemblySearchWindowsByDay
} from "../../packages/ingest/src/assembly-mirror-policy.js";
import {
  assertAssemblyMinutesSearchFallbackPayloadMatchesCandidate,
  assertAssemblyMinutesViewerPayloadMatchesCandidate,
  assertAssemblySearchResponsesComplete,
  auditExistingAssemblyMinutesRetry,
  buildAssemblyFileServiceSourceSnapshot,
  buildExistingAssemblyMinutesRetryCollection,
  buildAssemblyMinutesCatalogCandidate,
  buildAssemblyMinutesCatalogParams,
  buildAssemblyMinutesParams,
  buildAssemblyMinutesSearchFallbackHtml,
  buildAssemblyMinutesSearchFallbackParams,
  isAssemblyMinutesViewerUrl,
  mirroredDocumentMatchesMetadata,
  normalizeCompactAssemblyDate,
  resolveMirrorDownloadConcurrency,
  resolveMirrorRecentDays,
  resolveMirrorDataRepoDir,
  responsePageCount,
  selectCompleteAssemblyMinutesSearchFallbackMeeting,
  selectCompleteAssemblyMinutesSearchFallbackRows,
  shouldBlockBackfillCursorOnDownloadFailure,
  shouldReuseExistingBackfillDocument,
  shouldSkipAssemblyFileServiceRefresh,
  splitAssemblySearchSpeakerLabel
} from "../../packages/ingest/src/scripts/mirror-documents.js";
import { parseOfficialMinutesAttendanceHtml } from "../../packages/ingest/src/official-attendance.js";
import { parseAssemblyMinutesViewerHtml } from "../../packages/ingest/src/minutes-transcript.js";
import { buildMinutesSummaryGroups } from "../../packages/ingest/src/minutes-summarization.js";
import { sha256Buffer } from "../../packages/ingest/src/utils.js";

import type { MirroredDocumentMetadata } from "../../packages/ingest/src/document-mirror.js";

function buildViewerIntegrityFixture(args?: {
  minutesId?: string;
  meetingDate?: string;
  publishedCount?: number;
  names?: string[];
  includeAttendance?: boolean;
}): string {
  const minutesId = args?.minutesId ?? "57073";
  const meetingDate = args?.meetingDate ?? "2026.07.30";
  const names = args?.names ?? ["이소희", "김위원"];
  const publishedCount = args?.publishedCount ?? names.length;
  const [year, month, day] = meetingDate.split(".");
  const attendanceHtml =
    args?.includeAttendance === false
      ? ""
      : `
        <div class="minutes_footer">
          <div class="list">
            <p><strong>◯출석 위원(${publishedCount}인)</strong></p>
            <div class="con">
              ${names
                .map(
                  (name, index) =>
                    `<a href="/members/member-${index}"><span class="name">${name}</span></a>`
                )
                .join("")}
            </div>
          </div>
        </div>
      `;
  return `
    <div id="header">
      <h2><span class="date">(${meetingDate}.)</span></h2>
    </div>
    <div class="minutes_header">
      <div class="place"><p class="con">${year}년 ${month}월 ${day}일</p></div>
    </div>
    ${attendanceHtml}
    <script>const mnts_id = ${minutesId};</script>
  `;
}

function buildRetryMetadata(args: {
  documentId: string;
  minutesId: string;
  publishedDate: string;
  latestRelativePath: string;
  body: Buffer;
  sourceUrl?: string;
}): MirroredDocumentMetadata {
  const sourceUrl =
    args.sourceUrl ??
    `https://record.assembly.go.kr/assembly/viewer/minutes/xml.do?id=${args.minutesId}&type=view`;
  return {
    documentId: args.documentId,
    sourceId: "assembly-minutes",
    sourceUrl,
    downloadUrl: sourceUrl,
    title: "제22대 제437회 보건복지위원회 회의록",
    publishedDate: args.publishedDate,
    discoveredFromUrl:
      "https://open.assembly.go.kr/portal/data/service/selectServicePage.do/OR137O001023MZ19321",
    firstMirroredAt: "2026-08-01T00:00:00.000Z",
    lastMirroredAt: "2026-08-01T00:00:00.000Z",
    latestRelativePath: args.latestRelativePath,
    metadataRelativePath: `${args.latestRelativePath}.metadata.json`,
    currentContentSha256: sha256Buffer(args.body),
    currentContentType: "text/html",
    currentBytes: args.body.byteLength,
    sourceMetadata: {
      minutesId: args.minutesId,
      committeeName: "보건복지위원회"
    },
    versions: [
      {
        retrievedAt: "2026-08-01T00:00:00.000Z",
        relativePath: args.latestRelativePath,
        contentSha256: sha256Buffer(args.body),
        bytes: args.body.byteLength
      }
    ]
  };
}

describe("document mirror helpers", () => {
  it("keeps the recent safety floor for both official minutes collectors", () => {
    expect(resolveMirrorRecentDays("assembly_minutes_search", 3, 30)).toBe(30);
    expect(resolveMirrorRecentDays("assembly_minutes_catalog", 3, 30)).toBe(30);
    expect(resolveMirrorRecentDays("assembly_file_service", 3, 30)).toBe(3);
    expect(
      resolveMirrorDownloadConcurrency("assembly_minutes_catalog", 4)
    ).toBe(1);
    expect(resolveMirrorDownloadConcurrency("assembly_file_service", 4)).toBe(
      4
    );
  });

  it("reuses successful official backfill documents while retrying gaps", () => {
    expect(
      shouldReuseExistingBackfillDocument({
        mode: "assembly_minutes_catalog",
        skipRecent: true,
        workItemKind: "discovered",
        hasExistingMetadata: true,
        hasFreshTranscript: true,
        rawMatchesMetadata: true
      })
    ).toBe(true);
    expect(
      shouldReuseExistingBackfillDocument({
        mode: "assembly_minutes_catalog",
        skipRecent: true,
        workItemKind: "discovered",
        hasExistingMetadata: false,
        hasFreshTranscript: true,
        rawMatchesMetadata: true
      })
    ).toBe(false);
    expect(
      shouldReuseExistingBackfillDocument({
        mode: "assembly_minutes_catalog",
        skipRecent: false,
        workItemKind: "discovered",
        hasExistingMetadata: true,
        hasFreshTranscript: true,
        rawMatchesMetadata: true
      })
    ).toBe(false);
    expect(
      shouldReuseExistingBackfillDocument({
        mode: "assembly_minutes_catalog",
        skipRecent: true,
        workItemKind: "transcript-refresh",
        hasExistingMetadata: true,
        hasFreshTranscript: true,
        rawMatchesMetadata: true
      })
    ).toBe(false);
    expect(
      shouldReuseExistingBackfillDocument({
        mode: "assembly_minutes_catalog",
        skipRecent: true,
        workItemKind: "discovered",
        hasExistingMetadata: true,
        hasFreshTranscript: false,
        rawMatchesMetadata: true
      })
    ).toBe(false);
    expect(
      shouldReuseExistingBackfillDocument({
        mode: "assembly_minutes_catalog",
        skipRecent: true,
        workItemKind: "discovered",
        hasExistingMetadata: true,
        hasFreshTranscript: true,
        rawMatchesMetadata: false
      })
    ).toBe(false);
    expect(
      shouldReuseExistingBackfillDocument({
        mode: "assembly_minutes_catalog",
        skipRecent: false,
        retryExistingOnly: true,
        workItemKind: "discovered",
        hasExistingMetadata: true,
        hasFreshTranscript: true,
        rawMatchesMetadata: true
      })
    ).toBe(true);
  });

  it("builds an existing-only retry from every indexed official minutes document", () => {
    const body = Buffer.from(
      buildViewerIntegrityFixture({
        minutesId: "57073",
        meetingDate: "2026.07.30"
      })
    );
    const official = buildRetryMetadata({
      documentId: "assembly-minutes-minutes-57073",
      minutesId: "57073",
      publishedDate: "2026-07-30",
      latestRelativePath: "raw/official/latest.html",
      body
    });
    const appendix = buildRetryMetadata({
      documentId: "assembly-minutes-appendix-1",
      minutesId: "1",
      publishedDate: "2026-07-30",
      latestRelativePath: "raw/appendix/latest.html",
      body,
      sourceUrl:
        "https://record.assembly.go.kr/assembly/mnts/apdix/apdixDownload.do?fileId=1"
    });
    const existingIndex = mergeDocumentIndex(
      "assembly-minutes",
      [toIndexItem(official), toIndexItem(appendix)],
      "2026-08-01T00:00:00.000Z"
    );
    const collection = buildExistingAssemblyMinutesRetryCollection({
      existingIndex,
      existingMetadataByDocumentId: new Map([
        [official.documentId, official],
        [appendix.documentId, appendix]
      ]),
      existingState: null,
      sourceId: "assembly-minutes"
    });

    expect(collection.candidates).toHaveLength(1);
    expect(collection.candidates[0]?.documentId).toBe(official.documentId);
    expect(collection.pagesVisited).toBe(0);
    expect(collection.nextBackfillCursorDate).toBeUndefined();

    expect(() =>
      buildExistingAssemblyMinutesRetryCollection({
        existingIndex,
        existingMetadataByDocumentId: new Map([
          [appendix.documentId, appendix]
        ]),
        existingState: null,
        sourceId: "assembly-minutes"
      })
    ).toThrow(/metadata is missing/);
    expect(() =>
      buildExistingAssemblyMinutesRetryCollection({
        existingIndex,
        existingMetadataByDocumentId: new Map([
          [official.documentId, official]
        ]),
        existingState: null,
        sourceId: "assembly-minutes"
      })
    ).toThrow(/assembly-minutes-appendix-1/);
  });

  it("keeps the indexed retry pending until every official raw artifact is valid", async () => {
    const root = await mkdtemp(join(tmpdir(), "existing-minutes-retry-"));
    try {
      const validBody = Buffer.from(
        buildViewerIntegrityFixture({
          minutesId: "57073",
          meetingDate: "2026.07.30"
        })
      );
      const invalidBody = Buffer.from(
        buildViewerIntegrityFixture({
          minutesId: "57073",
          meetingDate: "2026.07.31"
        })
      );
      const valid = buildRetryMetadata({
        documentId: "assembly-minutes-minutes-57073",
        minutesId: "57073",
        publishedDate: "2026-07-30",
        latestRelativePath: "raw/valid/latest.html",
        body: validBody
      });
      const invalid = buildRetryMetadata({
        documentId: "assembly-minutes-minutes-57074",
        minutesId: "57074",
        publishedDate: "2026-07-31",
        latestRelativePath: "raw/invalid/latest.html",
        body: invalidBody
      });
      await mkdir(join(root, "raw/valid"), { recursive: true });
      await mkdir(join(root, "raw/invalid"), { recursive: true });
      await writeFile(join(root, valid.latestRelativePath), validBody);
      await writeFile(join(root, invalid.latestRelativePath), invalidBody);
      const existingIndex = mergeDocumentIndex(
        "assembly-minutes",
        [toIndexItem(valid), toIndexItem(invalid)],
        "2026-08-01T00:00:00.000Z"
      );
      const metadataByDocumentId = new Map([
        [valid.documentId, valid],
        [invalid.documentId, invalid]
      ]);
      const collection = buildExistingAssemblyMinutesRetryCollection({
        existingIndex,
        existingMetadataByDocumentId: metadataByDocumentId,
        existingState: null,
        sourceId: "assembly-minutes"
      });

      await expect(
        auditExistingAssemblyMinutesRetry({
          dataRepoDir: root,
          candidates: collection.candidates,
          metadataByDocumentId
        })
      ).resolves.toEqual({ checked: 2, invalid: 1 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reuses a mirrored document only when the raw file matches metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "document-mirror-reuse-"));
    try {
      const relativePath = "raw/assembly-minutes/example/latest.html";
      const path = join(root, relativePath);
      const body = Buffer.from("<html>official minutes</html>");
      await mkdir(join(root, "raw/assembly-minutes/example"), {
        recursive: true
      });
      await writeFile(path, body);
      const metadata = {
        latestRelativePath: relativePath,
        currentBytes: body.byteLength,
        currentContentSha256: sha256Buffer(body)
      };

      await expect(
        mirroredDocumentMatchesMetadata(root, metadata)
      ).resolves.toBe(true);
      await writeFile(path, Buffer.from("<html>corrupted</html>"));
      await expect(
        mirroredDocumentMatchesMetadata(root, metadata)
      ).resolves.toBe(false);
      await rm(path);
      await expect(
        mirroredDocumentMatchesMetadata(root, metadata)
      ).resolves.toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("validates the official viewer meeting identity, date, and attendance", () => {
    const sourceUrl =
      "https://record.assembly.go.kr/assembly/viewer/minutes/xml.do?id=57073&type=view";
    const validHtml = buildViewerIntegrityFixture();

    expect(() =>
      assertAssemblyMinutesViewerPayloadMatchesCandidate({
        html: validHtml,
        sourceUrl,
        responseUrl: sourceUrl,
        expectedMinutesId: "57073",
        expectedMeetingDate: "2026-07-30"
      })
    ).not.toThrow();
    expect(() =>
      assertAssemblyMinutesViewerPayloadMatchesCandidate({
        html: buildViewerIntegrityFixture({
          publishedCount: 2,
          names: ["이소희"]
        }).replace(
          "<script>",
          '<p class="tmp">(임시회의록)</p><div class="minutes_body"></div><script>'
        ),
        sourceUrl,
        expectedMinutesId: "57073",
        expectedMeetingDate: "2026-07-30"
      })
    ).toThrow(/attendance list count mismatch/);
    expect(() =>
      assertAssemblyMinutesViewerPayloadMatchesCandidate({
        html: buildViewerIntegrityFixture({ minutesId: "57054" }),
        sourceUrl,
        expectedMinutesId: "57073",
        expectedMeetingDate: "2026-07-30"
      })
    ).toThrow(/payload id mismatch/);
    expect(() =>
      assertAssemblyMinutesViewerPayloadMatchesCandidate({
        html: buildViewerIntegrityFixture({
          meetingDate: "2026.07.29"
        }),
        sourceUrl,
        expectedMinutesId: "57073",
        expectedMeetingDate: "2026-07-30"
      })
    ).toThrow(/payload date mismatch/);
    expect(() =>
      assertAssemblyMinutesViewerPayloadMatchesCandidate({
        html: buildViewerIntegrityFixture({
          publishedCount: 2,
          names: ["이소희"]
        }),
        sourceUrl,
        expectedMinutesId: "57073",
        expectedMeetingDate: "2026-07-30"
      })
    ).toThrow(/attendance list count mismatch/);
    expect(() =>
      assertAssemblyMinutesViewerPayloadMatchesCandidate({
        html: buildViewerIntegrityFixture({
          publishedCount: 2,
          names: ["이소희", "이소희"]
        }),
        sourceUrl,
        expectedMinutesId: "57073",
        expectedMeetingDate: "2026-07-30"
      })
    ).toThrow(/unique 1/);
    expect(() =>
      assertAssemblyMinutesViewerPayloadMatchesCandidate({
        html: buildViewerIntegrityFixture({
          includeAttendance: false
        }),
        sourceUrl,
        expectedMinutesId: "57073",
        expectedMeetingDate: "2026-07-30"
      })
    ).toThrow(/no verified attendance list/);
    expect(() =>
      assertAssemblyMinutesViewerPayloadMatchesCandidate({
        html: buildViewerIntegrityFixture({
          includeAttendance: false
        }).replace(
          "<script>",
          '<p class="tmp">(임시회의록)</p><div class="minutes_body"></div><script>'
        ),
        sourceUrl,
        expectedMinutesId: "57073",
        expectedMeetingDate: "2026-07-30"
      })
    ).not.toThrow();
    expect(() =>
      assertAssemblyMinutesViewerPayloadMatchesCandidate({
        html: buildViewerIntegrityFixture({
          includeAttendance: false
        }),
        sourceUrl,
        expectedMinutesId: "57073",
        expectedMeetingDate: "2026-07-30",
        requireAttendance: false
      })
    ).not.toThrow();
  });

  it("does not reuse a hash-valid official viewer cached under the wrong meeting", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "document-mirror-semantic-reuse-")
    );
    try {
      const relativePath = "raw/assembly-minutes/57073/latest.html";
      const path = join(root, relativePath);
      const body = Buffer.from(
        buildViewerIntegrityFixture({ minutesId: "57054" })
      );
      await mkdir(join(root, "raw/assembly-minutes/57073"), {
        recursive: true
      });
      await writeFile(path, body);

      await expect(
        mirroredDocumentMatchesMetadata(root, {
          latestRelativePath: relativePath,
          currentBytes: body.byteLength,
          currentContentSha256: sha256Buffer(body),
          sourceUrl:
            "https://record.assembly.go.kr/assembly/viewer/minutes/xml.do?id=57073&type=view",
          publishedDate: "2026-07-30",
          sourceMetadata: {
            minutesId: "57073",
            classCode: "2"
          }
        })
      ).resolves.toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not require attendance for minutes outside attendance aggregation", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "document-mirror-non-attendance-reuse-")
    );
    try {
      const relativePath = "raw/assembly-minutes/57073/latest.html";
      const body = Buffer.from(
        buildViewerIntegrityFixture({ includeAttendance: false })
      );
      await mkdir(join(root, "raw/assembly-minutes/57073"), {
        recursive: true
      });
      await writeFile(join(root, relativePath), body);

      await expect(
        mirroredDocumentMatchesMetadata(root, {
          latestRelativePath: relativePath,
          currentBytes: body.byteLength,
          currentContentSha256: sha256Buffer(body),
          sourceUrl:
            "https://record.assembly.go.kr/assembly/viewer/minutes/xml.do?id=57073&type=view",
          publishedDate: "2026-07-30",
          title: "제22대 제437회 특별위원회 회의록",
          sourceMetadata: {
            minutesId: "57073",
            classCode: "2"
          }
        })
      ).resolves.toBe(true);
      await expect(
        mirroredDocumentMatchesMetadata(root, {
          latestRelativePath: relativePath,
          currentBytes: body.byteLength,
          currentContentSha256: sha256Buffer(body),
          sourceUrl:
            "https://record.assembly.go.kr/assembly/viewer/minutes/xml.do?id=57073&type=view",
          publishedDate: "2026-07-30",
          title: "제22대 제437회 국회본회의 회의록",
          sourceMetadata: {
            minutesId: "57073",
            classCode: "1"
          }
        })
      ).resolves.toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("blocks the backfill cursor only when a discovered raw document is missing", () => {
    expect(
      shouldBlockBackfillCursorOnDownloadFailure({
        workItemKind: "discovered",
        rawMatchesMetadata: false
      })
    ).toBe(true);
    expect(
      shouldBlockBackfillCursorOnDownloadFailure({
        workItemKind: "discovered",
        rawMatchesMetadata: true
      })
    ).toBe(false);
    expect(
      shouldBlockBackfillCursorOnDownloadFailure({
        workItemKind: "transcript-refresh",
        rawMatchesMetadata: false
      })
    ).toBe(false);
  });

  it("enforces a safe recent-window floor for minutes discovery", () => {
    expect(resolveEffectiveRecentDays(3, 30)).toBe(30);
    expect(resolveEffectiveRecentDays(45, 30)).toBe(45);
  });

  it("reports whether the historical backfill has reached the recent window", () => {
    expect(
      hasPendingBackfill({
        nextBackfillCursorDate: "2024-07-11",
        recentWindowStartDate: "2026-06-27"
      })
    ).toBe(true);
    expect(
      hasPendingBackfill({
        nextBackfillCursorDate: "2026-06-27",
        recentWindowStartDate: "2026-06-27"
      })
    ).toBe(false);
  });

  it("processes the newest discovered minutes before older backfill items", () => {
    expect(
      sortDatedItemsNewestFirst([
        { id: "old", publishedDate: "2024-07-01" },
        { id: "unknown", publishedDate: null },
        { id: "latest", publishedDate: "2026-07-14" }
      ]).map((item) => item.id)
    ).toEqual(["latest", "old", "unknown"]);
  });

  it("normalizes multiple public document date formats", () => {
    expect(normalizeDocumentDate("2026.02.23.")).toBe("2026-02-23");
    expect(normalizeDocumentDate("2026-02-23")).toBe("2026-02-23");
    expect(normalizeDocumentDate("2026년 2월 23일")).toBe("2026-02-23");
    expect(normalizeDocumentDate("date unavailable")).toBeNull();
    expect(normalizeCompactAssemblyDate("20250710000000")).toBe("2025-07-10");
  });

  it("limits transcript parsing to the official minutes viewer", () => {
    expect(
      isAssemblyMinutesViewerUrl(
        "https://record.assembly.go.kr/assembly/viewer/minutes/xml.do?id=55092&type=view"
      )
    ).toBe(true);
    expect(
      isAssemblyMinutesViewerUrl(
        "https://record.assembly.go.kr/assembly/viewer/minutes/download/apndx.do?id=1356097"
      )
    ).toBe(false);
  });

  it("builds stable document ids and storage paths", () => {
    const documentId = buildDocumentId(
      "제22대국회 제432회 국회운영위원회",
      "https://record.assembly.go.kr/doc/123.pdf",
      "2026-02-23"
    );

    expect(documentId).toContain("2026-02-23");
    expect(slugifySegment("Committee Minutes / Session #1")).toBe(
      "committee-minutes-session-1"
    );

    const paths = buildDocumentPaths({
      sourceId: "assembly-public-documents",
      documentId,
      publishedDate: "2026-02-23",
      retrievedAt: "2026-03-22T00:30:00.000Z",
      fileExtension: "pdf"
    });

    expect(paths.relativeDirectory).toBe(
      `raw/documents/assembly-public-documents/2026/02/23/${documentId}`
    );
    expect(paths.latestRelativePath.endsWith("/latest.pdf")).toBe(true);
    expect(paths.versionRelativePath).toContain(
      "/versions/2026-03-22T00-30-00-000Z.pdf"
    );
  });

  it("treats only older documents as mirror targets", () => {
    expect(isPastDocumentDate("2026-03-21", "2026-03-22")).toBe(true);
    expect(isPastDocumentDate("2026-03-22", "2026-03-22")).toBe(false);
    expect(isPastDocumentDate("2026-03-23", "2026-03-22")).toBe(false);
  });

  it("detects download extensions from content disposition and content type", () => {
    expect(
      detectFileExtension(
        "https://record.assembly.go.kr/assembly/viewer/minutes/download/hwp.do?id=123",
        "application/octet-stream",
        'attachment; filename="minutes.hwp"'
      )
    ).toBe("hwp");
    expect(
      detectFileExtension(
        "https://record.assembly.go.kr/assembly/viewer/minutes/download/img.do?id=123",
        "image/png"
      )
    ).toBe("png");
  });

  it("merges and sorts mirrored index entries", () => {
    const merged = mergeDocumentIndex(
      "assembly-public-documents",
      [
        {
          documentId: "doc-a",
          sourceId: "assembly-public-documents",
          sourceUrl: "https://example.test/a.pdf",
          title: "Older minutes",
          publishedDate: "2026-02-20",
          latestRelativePath: "raw/documents/a/latest.pdf",
          metadataRelativePath: "raw/documents/a/metadata.json",
          lastMirroredAt: "2026-03-22T00:00:00.000Z",
          currentContentSha256: "hash-a",
          currentContentType: "application/pdf",
          currentBytes: 100,
          versionCount: 1
        },
        {
          documentId: "doc-b",
          sourceId: "assembly-public-documents",
          sourceUrl: "https://example.test/b.pdf",
          title: "Newer minutes",
          publishedDate: "2026-02-21",
          latestRelativePath: "raw/documents/b/latest.pdf",
          metadataRelativePath: "raw/documents/b/metadata.json",
          lastMirroredAt: "2026-03-22T00:00:00.000Z",
          currentContentSha256: "hash-b",
          currentContentType: "application/pdf",
          currentBytes: 200,
          versionCount: 2
        }
      ],
      "2026-03-22T00:00:00.000Z"
    );

    expect(merged.items[0]?.documentId).toBe("doc-b");
    expect(merged.items[1]?.documentId).toBe("doc-a");
  });

  it("formats cutoff dates in the configured time zone", () => {
    const date = dateInTimeZone(
      "Asia/Seoul",
      new Date("2026-03-21T15:10:00.000Z")
    );
    expect(date).toBe("2026-03-22");
  });

  it("prefers document and download identifiers over shared source pages", () => {
    const sharedSourceUrl =
      "https://open.assembly.go.kr/portal/data/service/selectServicePage.do/O2853M000835T714700";
    const lookup = {
      byDocumentId: new Map([
        [
          "assembly-property-disclosures-file-10001552",
          {
            documentId: "assembly-property-disclosures-file-10001552",
            sourceId: "assembly-property-disclosures",
            sourceUrl: sharedSourceUrl,
            downloadUrl:
              "https://open.assembly.go.kr/portal/data/file/downloadFileData.do?infId=O2853M000835T714700&infSeq=1&fileSeq=10001552",
            title: "재산신고내역(제2024-6호)",
            publishedDate: "2024-07-30",
            discoveredFromUrl: sharedSourceUrl,
            firstMirroredAt: "2026-04-09T22:04:13.823Z",
            lastMirroredAt: "2026-04-09T22:04:13.823Z",
            latestRelativePath: "raw/documents/a/latest.pdf",
            metadataRelativePath: "raw/documents/a/metadata.json",
            currentContentSha256: "hash-a",
            currentContentType: "application/pdf",
            currentBytes: 100,
            versions: []
          }
        ]
      ]),
      bySourceUrl: new Map([
        [
          sharedSourceUrl,
          {
            documentId: "assembly-property-disclosures-file-10001552",
            sourceId: "assembly-property-disclosures",
            sourceUrl: sharedSourceUrl,
            downloadUrl:
              "https://open.assembly.go.kr/portal/data/file/downloadFileData.do?infId=O2853M000835T714700&infSeq=1&fileSeq=10001552",
            title: "재산신고내역(제2024-6호)",
            publishedDate: "2024-07-30",
            discoveredFromUrl: sharedSourceUrl,
            firstMirroredAt: "2026-04-09T22:04:13.823Z",
            lastMirroredAt: "2026-04-09T22:04:13.823Z",
            latestRelativePath: "raw/documents/a/latest.pdf",
            metadataRelativePath: "raw/documents/a/metadata.json",
            currentContentSha256: "hash-a",
            currentContentType: "application/pdf",
            currentBytes: 100,
            versions: []
          }
        ]
      ]),
      byDownloadUrl: new Map([
        [
          "https://open.assembly.go.kr/portal/data/file/downloadFileData.do?infId=O2853M000835T714700&infSeq=1&fileSeq=10001552",
          {
            documentId: "assembly-property-disclosures-file-10001552",
            sourceId: "assembly-property-disclosures",
            sourceUrl: sharedSourceUrl,
            downloadUrl:
              "https://open.assembly.go.kr/portal/data/file/downloadFileData.do?infId=O2853M000835T714700&infSeq=1&fileSeq=10001552",
            title: "재산신고내역(제2024-6호)",
            publishedDate: "2024-07-30",
            discoveredFromUrl: sharedSourceUrl,
            firstMirroredAt: "2026-04-09T22:04:13.823Z",
            lastMirroredAt: "2026-04-09T22:04:13.823Z",
            latestRelativePath: "raw/documents/a/latest.pdf",
            metadataRelativePath: "raw/documents/a/metadata.json",
            currentContentSha256: "hash-a",
            currentContentType: "application/pdf",
            currentBytes: 100,
            versions: []
          }
        ]
      ])
    };

    expect(
      selectExistingMirroredMetadata(lookup, {
        documentId: "assembly-property-disclosures-file-10001553",
        sourceUrl: sharedSourceUrl,
        downloadUrl:
          "https://open.assembly.go.kr/portal/data/file/downloadFileData.do?infId=O2853M000835T714700&infSeq=1&fileSeq=10001553"
      })
    ).toBeUndefined();

    expect(
      selectExistingMirroredMetadata(lookup, {
        documentId: "assembly-property-disclosures-file-10001552",
        sourceUrl: sharedSourceUrl,
        downloadUrl:
          "https://open.assembly.go.kr/portal/data/file/downloadFileData.do?infId=O2853M000835T714700&infSeq=1&fileSeq=10001552"
      })?.documentId
    ).toBe("assembly-property-disclosures-file-10001552");

    expect(
      selectExistingMirroredMetadata(lookup, {
        sourceUrl:
          "https://record.assembly.go.kr/assembly/viewer/minutes/download/pdf.do?id=123"
      })
    ).toBeUndefined();
  });

  it("builds a stable assembly file service snapshot independent of item order", () => {
    const left = buildAssemblyFileServiceSourceSnapshot([
      {
        infId: "O2853M000835T714700",
        infSeq: 1,
        fileSeq: 10001553,
        viewFileNm: "재산신고내역(제2024-7호)",
        fileExt: "pdf",
        ftCrDttm: "20240829",
        cvtFileSize: "12345"
      },
      {
        infId: "O2853M000835T714700",
        infSeq: 1,
        fileSeq: 10001552,
        viewFileNm: "재산신고내역(제2024-6호)",
        fileExt: "pdf",
        ftCrDttm: "20240730",
        cvtFileSize: "67890"
      }
    ]);
    const right = buildAssemblyFileServiceSourceSnapshot([
      {
        infId: "O2853M000835T714700",
        infSeq: 1,
        fileSeq: 10001552,
        viewFileNm: "재산신고내역(제2024-6호)",
        fileExt: "pdf",
        ftCrDttm: "20240730",
        cvtFileSize: "67890"
      },
      {
        infId: "O2853M000835T714700",
        infSeq: 1,
        fileSeq: 10001553,
        viewFileNm: "재산신고내역(제2024-7호)",
        fileExt: "pdf",
        ftCrDttm: "20240829",
        cvtFileSize: "12345"
      }
    ]);

    expect(left.count).toBe(2);
    expect(left.sha256).toBe(right.sha256);
  });

  it("skips assembly file refresh only when backfill is complete and the source snapshot matches", () => {
    expect(
      shouldSkipAssemblyFileServiceRefresh({
        existingState: {
          sourceId: "assembly-property-disclosures",
          updatedAt: "2026-04-10T00:00:00.000Z",
          cutoffDate: "2026-04-10",
          pagesVisited: 1,
          discoveredCandidates: 0,
          downloaded: 0,
          updated: 0,
          unchanged: 0,
          skippedTodayOrFuture: 0,
          skippedWithoutDate: 0,
          lastStartUrl:
            "https://open.assembly.go.kr/portal/data/service/selectServicePage.do/O2853M000835T714700",
          nextBackfillCursorDate: "2026-04-10",
          sourceSnapshotSha256: "same-hash",
          sourceSnapshotCount: 19,
          skippedBySourceSnapshot: true
        },
        hasBackfillWindow: false,
        sourceSnapshotSha256: "same-hash",
        sourceSnapshotCount: 19
      })
    ).toBe(true);

    expect(
      shouldSkipAssemblyFileServiceRefresh({
        existingState: {
          sourceId: "assembly-property-disclosures",
          updatedAt: "2026-04-10T00:00:00.000Z",
          cutoffDate: "2026-04-10",
          pagesVisited: 1,
          discoveredCandidates: 0,
          downloaded: 0,
          updated: 0,
          unchanged: 0,
          skippedTodayOrFuture: 0,
          skippedWithoutDate: 0,
          lastStartUrl:
            "https://open.assembly.go.kr/portal/data/service/selectServicePage.do/O2853M000835T714700",
          nextBackfillCursorDate: "2025-01-01",
          sourceSnapshotSha256: "same-hash",
          sourceSnapshotCount: 19,
          skippedBySourceSnapshot: false
        },
        hasBackfillWindow: true,
        sourceSnapshotSha256: "same-hash",
        sourceSnapshotCount: 19
      })
    ).toBe(false);
  });

  it("expands property file-service backfill windows across the full outstanding range", () => {
    const windows = buildAssemblySearchWindows(
      "2024-08-31",
      {
        recentDays: 7,
        backfillStartDate: "2024-05-30",
        backfillDays: 31
      } as Parameters<typeof buildAssemblySearchWindows>[1],
      {
        sourceId: "assembly-property-disclosures",
        updatedAt: "2026-04-10T00:00:00.000Z",
        cutoffDate: "2024-08-31",
        pagesVisited: 1,
        discoveredCandidates: 0,
        downloaded: 0,
        updated: 0,
        unchanged: 0,
        skippedTodayOrFuture: 0,
        skippedWithoutDate: 0,
        lastStartUrl:
          "https://open.assembly.go.kr/portal/data/service/selectServicePage.do/O2853M000835T714700",
        nextBackfillCursorDate: "2024-05-30"
      },
      {
        includeAllBackfillWindows: true
      }
    );

    expect(windows).toEqual([
      {
        label: "recent",
        startDate: "2024-08-24",
        endDate: "2024-08-30"
      },
      {
        label: "backfill",
        startDate: "2024-05-30",
        endDate: "2024-06-29"
      },
      {
        label: "backfill",
        startDate: "2024-06-30",
        endDate: "2024-07-30"
      },
      {
        label: "backfill",
        startDate: "2024-07-31",
        endDate: "2024-08-30"
      }
    ]);
  });

  it("advances the property backfill cursor to the end of the last expanded window", () => {
    const windows = buildAssemblySearchWindows(
      "2024-08-31",
      {
        recentDays: 7,
        backfillStartDate: "2024-05-30",
        backfillDays: 31
      } as Parameters<typeof buildAssemblySearchWindows>[1],
      {
        sourceId: "assembly-property-disclosures",
        updatedAt: "2026-04-10T00:00:00.000Z",
        cutoffDate: "2024-08-31",
        pagesVisited: 1,
        discoveredCandidates: 0,
        downloaded: 0,
        updated: 0,
        unchanged: 0,
        skippedTodayOrFuture: 0,
        skippedWithoutDate: 0,
        lastStartUrl:
          "https://open.assembly.go.kr/portal/data/service/selectServicePage.do/O2853M000835T714700",
        nextBackfillCursorDate: "2024-05-30"
      },
      {
        includeAllBackfillWindows: true
      }
    );

    expect(
      resolveNextBackfillCursorDate({
        cutoffDate: "2024-08-31",
        config: {
          backfillStartDate: "2024-05-30"
        } as Parameters<typeof resolveNextBackfillCursorDate>[0]["config"],
        existingState: {
          nextBackfillCursorDate: "2024-05-30"
        },
        windows
      })
    ).toBe("2024-08-31");
  });

  it("expands a bounded number of backfill windows from an override cursor", () => {
    const windows = buildAssemblySearchWindows(
      "2024-07-01",
      {
        recentDays: 3,
        backfillStartDate: "2024-05-30",
        backfillDays: 7
      } as Parameters<typeof buildAssemblySearchWindows>[1],
      null,
      {
        backfillCursorDate: "2024-06-01",
        includeRecent: false,
        maxBackfillWindows: 2
      }
    );

    expect(windows).toEqual([
      {
        label: "backfill",
        startDate: "2024-06-01",
        endDate: "2024-06-07"
      },
      {
        label: "backfill",
        startDate: "2024-06-08",
        endDate: "2024-06-14"
      }
    ]);
  });

  it("splits Assembly minutes windows into daily API searches", () => {
    expect(
      splitAssemblySearchWindowsByDay([
        {
          label: "backfill",
          startDate: "2024-06-01",
          endDate: "2024-06-03"
        }
      ])
    ).toEqual([
      {
        label: "backfill",
        startDate: "2024-06-01",
        endDate: "2024-06-01"
      },
      {
        label: "backfill",
        startDate: "2024-06-02",
        endDate: "2024-06-02"
      },
      {
        label: "backfill",
        startDate: "2024-06-03",
        endDate: "2024-06-03"
      }
    ]);
  });

  it("removes default committee filters from broad minutes searches", () => {
    const params = buildAssemblyMinutesParams(
      new Map([
        ["CMIT_CD", ["22-1-ZA", "22-2-AA"]],
        ["SUBJ_CD", ["legacy-subject"]],
        ["SPK_CD", ["legacy-speaker"]],
        ["S_TH", ["24"]],
        ["E_TH", ["24"]]
      ]),
      {
        label: "backfill",
        startDate: "2025-07-23",
        endDate: "2025-07-23"
      },
      1,
      100
    );

    expect(params.getAll("CMIT_CD")).toEqual([]);
    expect(params.getAll("SUBJ_CD")).toEqual([]);
    expect(params.getAll("SPK_CD")).toEqual([]);
    expect(params.get("S_TH")).toBe("24");
    expect(params.get("E_TH")).toBe("24");
    expect(params.get("listCount")).toBe("100");
  });

  it("calculates search pages using the configured API page size", () => {
    expect(
      responsePageCount(
        {
          record1: {
            totalCount: 648,
            resultList: []
          }
        },
        false,
        100
      )
    ).toBe(7);
  });

  it("fails closed when an official minutes range response omits rows", () => {
    const completeResponses = [
      {
        record1: {
          totalCount: 2,
          resultList: [{ MNTS_ID: "1" }]
        }
      },
      {
        record1: {
          totalCount: 2,
          resultList: [{ MNTS_ID: "2" }]
        }
      }
    ];

    expect(() =>
      assertAssemblySearchResponsesComplete(completeResponses, false)
    ).not.toThrow();
    expect(() =>
      assertAssemblySearchResponsesComplete(
        [
          completeResponses[0],
          {
            record1: {
              totalCount: 2,
              resultList: []
            }
          }
        ],
        false
      )
    ).toThrow(/expected 2, received 1/);
    expect(() =>
      assertAssemblySearchResponsesComplete(
        [
          completeResponses[0],
          {
            record1: {
              totalCount: 3,
              resultList: [{ MNTS_ID: "2" }]
            }
          }
        ],
        false
      )
    ).toThrow(/incomplete/);
  });

  it("maps the registered official minutes catalog to canonical viewer records", () => {
    const service = {
      infId: "OO1X9P001017YF13038",
      kind: "plenary" as const
    };
    const params = buildAssemblyMinutesCatalogParams({
      service,
      window: {
        label: "backfill",
        startDate: "2026-07-20",
        endDate: "2026-07-26"
      },
      assemblyNo: 22,
      rows: 50_000
    });
    expect(params.getAll("CONF_DATE")).toEqual(["2026-07-20", "2026-07-26"]);
    expect(params.get("DAE_NUM")).toBe("22");

    const item = {
      CONFER_NUM: "57000",
      CONF_LINK_URL:
        "https://record.assembly.go.kr/assembly/viewer/minutes/xml.do?id=57000&type=view",
      CONF_DATE: "2026-07-23",
      DAE_NUM: "22",
      CLASS_NAME: "국회본회의",
      CLASS_CODE: 1,
      TITLE: "제427회국회(임시회)",
      SUB_NAME: "의사일정 제1항"
    };
    const candidate = buildAssemblyMinutesCatalogCandidate({
      item,
      config: {
        assemblyNo: 22,
        sourceId: "assembly-minutes"
      },
      service,
      discoveredFromUrl:
        "https://open.assembly.go.kr/portal/data/service/selectServicePage.do/OO1X9P001017YF13038"
    });

    expect(candidate).toMatchObject({
      documentId: "assembly-minutes-minutes-57000",
      title: "제22대 제427회 국회본회의 회의록",
      publishedDate: "2026-07-23",
      sourceMetadata: {
        assemblyNo: "22",
        sessionNo: "427",
        committeeName: null,
        catalogInfId: "OO1X9P001017YF13038",
        classCode: "1"
      }
    });
    expect(() =>
      buildAssemblyMinutesCatalogCandidate({
        item: {
          ...item,
          CONF_LINK_URL:
            "https://record.assembly.go.kr/assembly/viewer/minutes/xml.do?id=57001&type=view"
        },
        config: {
          assemblyNo: 22,
          sourceId: "assembly-minutes"
        },
        service,
        discoveredFromUrl: candidate.discoveredFromUrl
      })
    ).toThrow(/mismatched viewer link/);
    expect(() =>
      buildAssemblyMinutesCatalogCandidate({
        item: {
          ...item,
          CLASS_CODE: undefined
        },
        config: {
          assemblyNo: 22,
          sourceId: "assembly-minutes"
        },
        service,
        discoveredFromUrl: candidate.discoveredFromUrl
      })
    ).toThrow(/valid meeting id, link, date, or assembly number/);
  });

  it("builds a complete official search fallback for broken viewer links", () => {
    const params = buildAssemblyMinutesSearchFallbackParams({
      meetingDate: "2025-02-26",
      classCode: "2"
    });
    expect(params.get("startDate")).toBe("20250226");
    expect(params.get("endDate")).toBe("20250226");
    expect(params.get("collection")).toBe("record2");
    expect(params.get("CLASS_CD")).toBe("2");
    expect(params.get("listCount")).toBe("50000");
    const legacyParams = buildAssemblyMinutesSearchFallbackParams({
      meetingDate: "2025-02-26"
    });
    expect(legacyParams.get("collection")).toBe(
      "record1,record2,record3,record4,record5,record6,record7"
    );
    expect(legacyParams.get("CLASS_CD")).toBe("1,2,3,4,5,6,7");

    const rows = [
      {
        MNTS_ID: "52713",
        DATE: "20250226",
        CLASS_CD: "2",
        DOCID: "CN054816_ITETC",
        ETC_CNTS:
          "◯출석 위원(2인) 김가람 이나래 ◯청가 위원(1인) 박다온 ◯출장 위원(1인) 최라온"
      },
      {
        MNTS_ID: "52713",
        DATE: "20250226",
        CLASS_CD: "2",
        DOCID: "CN054816_IT0_SP1",
        ITEM_ID: "0",
        ITEM_NM: "개의",
        SPK_ID: "1",
        SPK_SORT: "1",
        SPK_CD: "100",
        SPK_NM: "위원장 김가람",
        SPK_CNTS: "성원이 되었으므로 회의를 개회하겠습니다."
      }
    ];
    const selected = selectCompleteAssemblyMinutesSearchFallbackRows({
      response: {
        record2: {
          totalCount: rows.length,
          resultList: rows
        }
      },
      recordKey: "record2",
      minutesId: "52713",
      meetingDate: "2025-02-26",
      classCode: "2"
    });
    expect(
      selectCompleteAssemblyMinutesSearchFallbackMeeting({
        response: {
          record2: {
            totalCount: rows.length,
            resultList: rows
          }
        },
        minutesId: "52713",
        meetingDate: "2025-02-26"
      })
    ).toEqual({
      classCode: "2",
      rows
    });
    const sourceUrl =
      "https://record.assembly.go.kr/assembly/mnts/search/search.do";
    const viewerUrl =
      "https://record.assembly.go.kr/assembly/viewer/minutes/xml.do?id=52713&type=view";
    const html = buildAssemblyMinutesSearchFallbackHtml({
      minutesId: "52713",
      meetingDate: "2025-02-26",
      meetingTitle: "제22대 제422회 교육위원회 회의록",
      rows: selected,
      sourceUrl
    });

    expect(parseOfficialMinutesAttendanceHtml(html)).toEqual({
      presentNames: ["김가람", "이나래"],
      leaveNames: ["박다온"],
      tripNames: ["최라온"]
    });
    const transcript = parseAssemblyMinutesViewerHtml({
      documentId: "assembly-minutes-minutes-52713",
      sourceUrl: viewerUrl,
      fallbackMeetingDate: "2025-02-26",
      fallbackTitle: "제22대 제422회 교육위원회 회의록",
      html
    });
    expect(transcript.statements).toEqual([
      expect.objectContaining({
        speakerName: "김가람",
        speakerRole: "위원장",
        sourceMemberId: "100"
      })
    ]);
    expect(
      buildMinutesSummaryGroups({
        transcript,
        members: [
          {
            memberId: "member-100",
            name: "김가람",
            party: "테스트당"
          }
        ]
      })
    ).toEqual([
      expect.objectContaining({
        member: expect.objectContaining({
          memberId: "member-100",
          name: "김가람"
        })
      })
    ]);
    expect(html).toContain("official-search-rows");
    expect(html).toContain(sourceUrl);
    expect(() =>
      assertAssemblyMinutesSearchFallbackPayloadMatchesCandidate({
        html,
        expectedMinutesId: "52713",
        expectedMeetingDate: "2025-02-26",
        expectedClassCode: "2"
      })
    ).not.toThrow();
    expect(() =>
      assertAssemblyMinutesSearchFallbackPayloadMatchesCandidate({
        html: html.replace('"MNTS_ID":"52713"', '"MNTS_ID":"52714"'),
        expectedMinutesId: "52713",
        expectedMeetingDate: "2025-02-26",
        expectedClassCode: "2"
      })
    ).toThrow(/embedded row mismatch/);

    const nonAttendanceHtml = buildAssemblyMinutesSearchFallbackHtml({
      minutesId: "52713",
      meetingDate: "2025-02-26",
      meetingTitle: "제22대 제422회 특별위원회 회의록",
      rows: selected.map((row) => ({
        ...row,
        ETC_CNTS: undefined
      })),
      sourceUrl,
      requireAttendance: false
    });
    expect(() =>
      assertAssemblyMinutesSearchFallbackPayloadMatchesCandidate({
        html: nonAttendanceHtml,
        expectedMinutesId: "52713",
        expectedMeetingDate: "2025-02-26",
        expectedClassCode: "2",
        requireAttendance: false
      })
    ).not.toThrow();
  });

  it("separates official search speaker names from their roles", () => {
    expect(splitAssemblySearchSpeakerLabel("위원장 최민희")).toEqual({
      name: "최민희",
      role: "위원장"
    });
    expect(splitAssemblySearchSpeakerLabel("김문수 위원")).toEqual({
      name: "김문수",
      role: "위원"
    });
    expect(splitAssemblySearchSpeakerLabel("교육부차관 오석환")).toEqual({
      name: "오석환",
      role: "교육부차관"
    });
    expect(splitAssemblySearchSpeakerLabel("김문수위원")).toEqual({
      name: "김문수",
      role: "위원"
    });
  });

  it("rejects an incomplete official search fallback response", () => {
    expect(() =>
      selectCompleteAssemblyMinutesSearchFallbackRows({
        response: {
          record2: {
            totalCount: 2,
            resultList: [{ MNTS_ID: "52713" }]
          }
        },
        recordKey: "record2",
        minutesId: "52713",
        meetingDate: "2025-02-26",
        classCode: "2"
      })
    ).toThrow(/incomplete/);
    expect(() =>
      buildAssemblyMinutesSearchFallbackParams({
        meetingDate: "2025-02-26",
        classCode: "9"
      })
    ).toThrow(/invalid class code/);
  });

  it("rejects mismatched official fallback meeting metadata", () => {
    expect(() =>
      selectCompleteAssemblyMinutesSearchFallbackRows({
        response: {
          record2: {
            totalCount: 1,
            resultList: [
              {
                MNTS_ID: "52713",
                DATE: "20250225",
                CLASS_CD: "2"
              }
            ]
          }
        },
        recordKey: "record2",
        minutesId: "52713",
        meetingDate: "2025-02-26",
        classCode: "2"
      })
    ).toThrow(/mismatched meeting metadata/);
    expect(() =>
      selectCompleteAssemblyMinutesSearchFallbackRows({
        response: {
          record2: {
            totalCount: 1,
            resultList: [
              {
                MNTS_ID: "52713",
                DATE: "20250226",
                CLASS_CD: "3"
              }
            ]
          }
        },
        recordKey: "record2",
        minutesId: "52713",
        meetingDate: "2025-02-26",
        classCode: "2"
      })
    ).toThrow(/mismatched meeting metadata/);
  });

  it("rejects fallback minutes without a verified attendance section", () => {
    expect(() =>
      buildAssemblyMinutesSearchFallbackHtml({
        minutesId: "52713",
        meetingDate: "2025-02-26",
        meetingTitle: "제22대 제422회 교육위원회 회의록",
        rows: [
          {
            MNTS_ID: "52713",
            DATE: "20250226",
            CLASS_CD: "2",
            ITEM_ID: "0",
            SPK_ID: "1",
            SPK_NM: "김문수 위원",
            SPK_CNTS: "정책 현안에 관하여 질의하겠습니다."
          }
        ],
        sourceUrl:
          "https://record.assembly.go.kr/assembly/mnts/search/search.do"
      })
    ).toThrow(/no verified attendance section/);
  });

  it("advances the backfill cursor when only transcript parsing fails", () => {
    expect(
      resolvePublishedBackfillCursor({
        proposedCursor: "2024-06-08",
        fallbackCursor: "2024-06-01",
        skippedWithoutDate: 0,
        reachedDownloadLimit: false
      })
    ).toBe("2024-06-08");
  });

  it("does not advance the backfill cursor after incomplete document mirroring", () => {
    expect(
      resolvePublishedBackfillCursor({
        proposedCursor: "2024-06-08",
        fallbackCursor: "2024-06-01",
        skippedWithoutDate: 0,
        downloadFailures: 1,
        reachedDownloadLimit: false
      })
    ).toBe("2024-06-01");

    expect(
      resolvePublishedBackfillCursor({
        proposedCursor: "2024-06-08",
        fallbackCursor: "2024-06-01",
        skippedWithoutDate: 0,
        downloadFailures: 0,
        reachedDownloadLimit: false
      })
    ).toBe("2024-06-08");
  });

  it("resolves the mirror data repository path from the repository root instead of the workspace cwd", () => {
    expect(resolveMirrorDataRepoDir("/repo/root", "published-data")).toBe(
      "/repo/root/published-data"
    );
    expect(resolveMirrorDataRepoDir("/repo/root", "/tmp/property-data")).toBe(
      "/tmp/property-data"
    );
  });
});
