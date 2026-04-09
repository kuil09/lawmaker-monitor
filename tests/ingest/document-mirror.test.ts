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
  slugifySegment
} from "../../packages/ingest/src/document-mirror.js";
import {
  buildAssemblyFileServiceSourceSnapshot,
  buildAssemblySearchWindows,
  resolveMirrorDataRepoDir,
  resolveNextBackfillCursorDate,
  shouldSkipAssemblyFileServiceRefresh
} from "../../packages/ingest/src/scripts/mirror-documents.js";

describe("document mirror helpers", () => {
  it("normalizes multiple public document date formats", () => {
    expect(normalizeDocumentDate("2026.02.23.")).toBe("2026-02-23");
    expect(normalizeDocumentDate("2026-02-23")).toBe("2026-02-23");
    expect(normalizeDocumentDate("2026년 2월 23일")).toBe("2026-02-23");
    expect(normalizeDocumentDate("date unavailable")).toBeNull();
  });

  it("builds stable document ids and storage paths", () => {
    const documentId = buildDocumentId(
      "제22대국회 제432회 국회운영위원회",
      "https://record.assembly.go.kr/doc/123.pdf",
      "2026-02-23"
    );

    expect(documentId).toContain("2026-02-23");
    expect(slugifySegment("Committee Minutes / Session #1")).toBe("committee-minutes-session-1");

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
    expect(paths.versionRelativePath).toContain("/versions/2026-03-22T00-30-00-000Z.pdf");
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
    const date = dateInTimeZone("Asia/Seoul", new Date("2026-03-21T15:10:00.000Z"));
    expect(date).toBe("2026-03-22");
  });

  it("prefers document and download identifiers over shared source pages", () => {
    const sharedSourceUrl = "https://open.assembly.go.kr/portal/data/service/selectServicePage.do/O2853M000835T714700";
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
        sourceUrl: "https://record.assembly.go.kr/assembly/viewer/minutes/download/pdf.do?id=123"
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

  it("resolves the mirror data repository path from the repository root instead of the workspace cwd", () => {
    expect(resolveMirrorDataRepoDir("/repo/root", "published-data")).toBe(
      "/repo/root/published-data"
    );
    expect(resolveMirrorDataRepoDir("/repo/root", "/tmp/property-data")).toBe(
      "/tmp/property-data"
    );
  });
});
