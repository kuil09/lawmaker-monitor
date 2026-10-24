import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";

import {
  toIndexItem,
  type MirroredDocumentMetadata
} from "../../packages/ingest/src/document-mirror.js";
import {
  hasBoundMinutesTranscript,
  parseAssemblyMinutesViewerHtml
} from "../../packages/ingest/src/minutes-transcript.js";
import { repairMinutesTranscripts } from "../../packages/ingest/src/scripts/repair-minutes-transcripts.js";
import { mirrorAssemblyMinutesTranscript } from "../../packages/ingest/src/scripts/mirror-documents.js";
import { sha256 } from "../../packages/ingest/src/utils.js";

it("repairs a checksum-valid transcript from another meeting, archives it, and binds only verified source bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "minutes-binding-"));
  const sourceUrl =
    "https://record.assembly.go.kr/assembly/viewer/minutes/xml.do?id=1&type=view";
  const html = `<div id="header"><h2><span class="date">(2024.05.30.)</span></h2></div>
    <div class="minutes_header"><div class="place"><p class="con">2024년 5월 30일</p></div></div>
    <script>const mnts_id = 1;</script><div class="minutes_body"><a id="item1" class="tit">1. 정책 개선</a>
    <div id="spk_1" class="item1 speaker" data-name="김아라"><div class="talk"><span class="spk_sub">교육 현장의 문제를 해결하기 위한 지원 정책을 구체적으로 마련해야 합니다.</span></div></div></div>`;
  const metadata: MirroredDocumentMetadata = {
    documentId: "one",
    sourceId: "assembly-minutes",
    sourceUrl,
    title: "제22대 제415회 특별위원회 회의록",
    publishedDate: "2024-05-30",
    discoveredFromUrl: sourceUrl,
    firstMirroredAt: "2026-10-24T00:00:00Z",
    lastMirroredAt: "2026-10-24T00:00:00Z",
    latestRelativePath: "raw/one/latest.html",
    metadataRelativePath: "raw/one/metadata.json",
    currentContentSha256: sha256(html),
    currentContentType: "text/html",
    currentBytes: Buffer.byteLength(html),
    versions: [],
    transcriptRelativePath: "raw/one/latest.transcript.json",
    transcriptParserVersion: "2"
  };
  const old = parseAssemblyMinutesViewerHtml({
    documentId: "one",
    sourceUrl,
    fallbackMeetingDate: metadata.publishedDate,
    fallbackTitle: metadata.title,
    html: html.replace(
      "교육 현장의 문제를 해결하기 위한 지원 정책을 구체적으로 마련해야 합니다.",
      "다른 회의의 예산에 관해서는 지방 문화재 지원 비용을 확대하는 것이 필요합니다."
    )
  });
  const oldBytes = JSON.stringify(old, null, 2);
  metadata.transcriptContentSha256 = sha256(oldBytes);
  metadata.transcriptStatementCount = old.statements.length;
  const write = async (path: string, value: string | object) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(
      join(root, path),
      typeof value === "string" ? value : JSON.stringify(value)
    );
  };
  const read = async (path: string) =>
    JSON.parse(await readFile(join(root, path), "utf8"));
  try {
    await write(metadata.latestRelativePath, html);
    await write(metadata.metadataRelativePath, metadata);
    await write(metadata.transcriptRelativePath!, oldBytes);
    await write("raw/index/document_index.json", {
      sourceId: "assembly-minutes",
      updatedAt: metadata.lastMirroredAt,
      items: [toIndexItem(metadata)]
    });
    expect(hasBoundMinutesTranscript(metadata)).toBe(false);
    expect(
      (await repairMinutesTranscripts(root)).changedDocuments
    ).toHaveLength(1);
    expect(
      (await read(metadata.transcriptRelativePath!)).statements[0].paragraphs[0]
    ).toContain("다른 회의");
    const result = await repairMinutesTranscripts(root, true);
    expect(result).toMatchObject({ checked: 1, boundDocuments: 1 });
    const repaired = await read(metadata.metadataRelativePath);
    expect(hasBoundMinutesTranscript(repaired)).toBe(true);
    expect(
      (await read(metadata.transcriptRelativePath!)).statements[0].paragraphs[0]
    ).toContain("교육 현장");
    expect(
      await readFile(
        join(
          root,
          `raw/one/transcript-versions/repair-original-${metadata.transcriptContentSha256}.json`
        ),
        "utf8"
      )
    ).toBe(oldBytes);
    expect(
      await readFile(join(root, metadata.latestRelativePath), "utf8")
    ).toBe(html);
    expect(
      (await read("raw/index/document_index.json")).items[0]
        .transcriptSourceContentSha256
    ).toBe(metadata.currentContentSha256);
    expect(
      (await repairMinutesTranscripts(root)).changedDocuments
    ).toHaveLength(0);
    await expect(
      mirrorAssemblyMinutesTranscript({
        candidate: { sourceUrl },
        metadata: repaired,
        config: { dataRepoDir: root },
        retrievedAt: new Date().toISOString(),
        downloaded: {
          body: Buffer.from("different source"),
          contentType: "text/html"
        }
      } as Parameters<typeof mirrorAssemblyMinutesTranscript>[0])
    ).rejects.toThrow("preserved source snapshot");
    const untouched = await readFile(
      join(root, metadata.metadataRelativePath),
      "utf8"
    );
    await write(
      metadata.latestRelativePath,
      html.replace("mnts_id = 1", "mnts_id = 2")
    );
    await expect(repairMinutesTranscripts(root, true)).rejects.toThrow(
      "unverified source"
    );
    expect(
      await readFile(join(root, metadata.metadataRelativePath), "utf8")
    ).toBe(untouched);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
