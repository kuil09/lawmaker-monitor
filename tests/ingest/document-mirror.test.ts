import { describe, expect, it } from "vitest";

import {
  buildDocumentId,
  buildDocumentPaths,
  dateInTimeZone,
  detectFileExtension,
  isPastDocumentDate,
  mergeDocumentIndex,
  normalizeDocumentDate,
  slugifySegment
} from "../../packages/ingest/src/document-mirror.js";

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
});
