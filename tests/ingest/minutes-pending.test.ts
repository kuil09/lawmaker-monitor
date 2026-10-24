import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  isPendingAssemblyMinutesViewerHtml,
  parseAssemblyMinutesViewerHtml
} from "../../packages/ingest/src/minutes-transcript.js";
import {
  mirrorAssemblyMinutesTranscript,
  mirrorCandidate
} from "../../packages/ingest/src/scripts/mirror-documents.js";
import type { MirroredDocumentMetadata } from "../../packages/ingest/src/document-mirror.js";

const pending = `<div id="header"><h2><span class="date">(2025.09.06.)</span></h2></div><script>const mnts_id = 55355;</script><div class="minutes_header"><h1>국회운영위원회회의록</h1><p class="tmp">(임시회의록)</p></div><div class="minutes_body"></div>`;
describe("official minutes availability", () => {
  it.each([false, true])(
    "preserves published transcript metadata on raw changes (published=%s)",
    async (published) => {
      const root = await mkdtemp(join(tmpdir(), "minutes-pending-"));
      try {
        const sourceUrl =
          "https://record.assembly.go.kr/assembly/viewer/minutes/xml.do?id=55355&type=view";
        const previous: MirroredDocumentMetadata = {
          documentId: "minutes-55355",
          sourceId: "assembly-minutes",
          sourceUrl,
          title: "국회운영위원회회의록",
          publishedDate: "2025-09-06",
          discoveredFromUrl: sourceUrl,
          firstMirroredAt: "2026-10-20T00:00:00Z",
          lastMirroredAt: "2026-10-20T00:00:00Z",
          latestRelativePath: "old.html",
          metadataRelativePath: "metadata.json",
          currentContentSha256: "old",
          currentContentType: "text/html",
          currentBytes: 3,
          versions: [],
          ...(published
            ? {
                transcriptRelativePath: "previous.transcript.json",
                transcriptContentSha256: "published-sha",
                transcriptStatementCount: 1,
                transcriptParserVersion: "v7",
                transcriptVersions: [
                  {
                    relativePath: "previous.transcript.json",
                    contentSha256: "published-sha",
                    retrievedAt: "2026-10-20T00:00:00Z",
                    statementCount: 1
                  }
                ]
              }
            : {})
        };
        if (published)
          await writeFile(
            join(root, "previous.transcript.json"),
            '{"statements":["preserved"]}'
          );
        const candidate = {
          documentId: previous.documentId,
          sourceUrl,
          title: previous.title,
          publishedDate: previous.publishedDate,
          discoveredFromUrl: sourceUrl
        };
        const config = {
          mode: "assembly_minutes_search",
          dataRepoDir: root,
          sourceId: "assembly-minutes",
          timeoutMs: 1000,
          timeZone: "Asia/Seoul"
        } as Parameters<typeof mirrorCandidate>[1];
        const api = {
          get: async () => ({
            body: async () => Buffer.from(pending),
            url: () => sourceUrl,
            headers: () => ({ "content-type": "text/html" })
          })
        } as unknown as Parameters<typeof mirrorCandidate>[2];
        const retrievedAt = "2026-10-23T00:00:00Z";
        const outcome = await mirrorCandidate(
          candidate,
          config,
          api,
          previous,
          retrievedAt
        );
        expect(outcome.type).toBe("downloaded");
        const parse = () =>
          mirrorAssemblyMinutesTranscript({
            candidate,
            config,
            metadata: outcome.metadata,
            downloaded: outcome.downloaded,
            retrievedAt
          });
        if (published) {
          expect(outcome.metadata.transcriptVersions).toEqual(
            previous.transcriptVersions
          );
          await expect(parse()).rejects.toThrow(
            "returned no member statements"
          );
          const saved = JSON.parse(
            await readFile(
              join(root, outcome.metadata.metadataRelativePath),
              "utf8"
            )
          );
          expect(saved.transcriptRelativePath).toBe(
            previous.transcriptRelativePath
          );
          expect(
            await readFile(join(root, "previous.transcript.json"), "utf8")
          ).toContain("preserved");
        } else {
          const result = await parse();
          expect(result.pending).toBe(true);
          expect(result.written).toBe(false);
          expect(result.metadata.transcriptRelativePath).toBeUndefined();
          expect(result.metadata.sourceMetadata?.transcriptAvailability).toBe(
            "pending_official_body"
          );
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  );
  it("distinguishes an empty temporary official body from a published transcript", () => {
    expect(isPendingAssemblyMinutesViewerHtml(pending)).toBe(true);
    expect(
      parseAssemblyMinutesViewerHtml({
        documentId: "pending",
        sourceUrl:
          "https://record.assembly.go.kr/assembly/viewer/minutes/xml.do?id=55355&type=view",
        fallbackMeetingDate: "2025-09-06",
        fallbackTitle: "국회운영위원회",
        html: pending
      }).statements
    ).toEqual([]);
  });
  it("does not classify arbitrary empty or changed pages as pending", () => {
    expect(
      isPendingAssemblyMinutesViewerHtml("<h1>Upstream unavailable</h1>")
    ).toBe(false);
    expect(
      isPendingAssemblyMinutesViewerHtml(
        pending.replace("(임시회의록)", "(확정회의록)")
      )
    ).toBe(false);
    expect(
      isPendingAssemblyMinutesViewerHtml(
        pending.replace(
          '<div class="minutes_body"></div>',
          '<div class="minutes_body"><p>실제 본문이 있지만 발언자를 읽지 못한 경우</p></div>'
        )
      )
    ).toBe(false);
    expect(
      isPendingAssemblyMinutesViewerHtml(
        pending.replace(
          '<div class="minutes_body"></div>',
          '<div class="minutes_body"><img src="scan.png" alt="회의록 스캔"></div>'
        )
      )
    ).toBe(false);
  });
});
