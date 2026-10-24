import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  toIndexItem,
  type MirroredDocumentIndex,
  type MirroredDocumentMetadata
} from "../document-mirror.js";
import {
  mergeMinutesWorkerArtifact,
  isExactMinutesSelection
} from "../minutes-parallel.js";
import {
  buildMinutesSummaryGroups,
  rebindMinutesSummaryArtifact,
  MINUTES_SUMMARY_PROMPT_VERSION,
  type MinutesDocumentSummaryArtifact,
  type MinutesSummaryMember
} from "../minutes-summarization.js";
import {
  ASSEMBLY_MINUTES_TRANSCRIPT_PARSER_VERSION,
  isOfficialAssemblyMinutesViewerUrl,
  parseAssemblyMinutesViewerHtml,
  type AssemblyMinutesTranscript
} from "../minutes-transcript.js";
import { readJsonFile, sha256, writeJsonFile } from "../utils.js";
import { mirroredDocumentMatchesMetadata } from "./mirror-documents.js";

export async function repairMinutesTranscripts(
  directory: string,
  apply = false
) {
  const indexPath = join(directory, "raw/index/document_index.json");
  const index = JSON.parse(
    await readFile(indexPath, "utf8")
  ) as MirroredDocumentIndex;
  const calendar = await readJsonFile<{
    assembly: { members: MinutesSummaryMember[] };
  }>(join(directory, "exports/member_activity_calendar.json"), {
    assembly: { members: [] }
  });
  const members = calendar.assembly.members;
  const verifiedAt = new Date().toISOString();
  const stamp = verifiedAt.replace(/[:.]/g, "-");
  const writes: Array<{ path: string; content: string }> = [];
  const report = {
    verifiedAt,
    checked: 0,
    changedDocuments: [] as Array<{
      documentId: string;
      previousStatements: number;
      correctedStatements: number;
      retainedExcerpts: number;
      removedExcerpts: number;
    }>,
    boundDocuments: 0
  };
  for (const item of index.items) {
    if (
      !item.transcriptRelativePath ||
      !isOfficialAssemblyMinutesViewerUrl(item.sourceUrl)
    )
      continue;
    const metadata = JSON.parse(
      await readFile(join(directory, item.metadataRelativePath), "utf8")
    ) as MirroredDocumentMetadata;
    if (
      metadata.sourceUrl !== item.sourceUrl ||
      metadata.currentContentSha256 !== item.currentContentSha256 ||
      !(await mirroredDocumentMatchesMetadata(directory, metadata))
    )
      throw new Error(
        `Cannot repair against an unverified source: ${item.documentId}`
      );
    const previousBytes = await readFile(
      join(directory, item.transcriptRelativePath),
      "utf8"
    );
    if (sha256(previousBytes) !== item.transcriptContentSha256)
      throw new Error(
        `Transcript checksum mismatch during repair: ${item.documentId}`
      );
    const previous = JSON.parse(previousBytes) as AssemblyMinutesTranscript;
    const corrected = parseAssemblyMinutesViewerHtml({
      documentId: item.documentId,
      sourceUrl: item.sourceUrl,
      fallbackMeetingDate: item.publishedDate,
      fallbackTitle: item.title,
      html: await readFile(join(directory, item.latestRelativePath), "utf8")
    });
    if (!corrected.statements.length)
      throw new Error(
        `Preserved source has no transcript body: ${item.documentId}`
      );
    if (JSON.stringify(previous) !== JSON.stringify(corrected)) {
      const content = JSON.stringify(corrected, null, 2);
      const hash = sha256(content);
      const archive = join(
        dirname(item.transcriptRelativePath),
        "transcript-versions"
      );
      const previousPath = join(
        archive,
        `repair-original-${item.transcriptContentSha256}.json`
      );
      const correctedPath = join(archive, `${stamp}.json`);
      writes.push(
        { path: previousPath, content: previousBytes },
        { path: correctedPath, content },
        { path: item.transcriptRelativePath, content }
      );
      metadata.transcriptVersions = [
        ...(metadata.transcriptVersions ?? []),
        {
          retrievedAt: verifiedAt,
          relativePath: previousPath,
          contentSha256: item.transcriptContentSha256!,
          statementCount: previous.statements.length
        },
        {
          retrievedAt: verifiedAt,
          relativePath: correctedPath,
          contentSha256: hash,
          statementCount: corrected.statements.length
        }
      ];
      metadata.transcriptContentSha256 = hash;
      metadata.transcriptStatementCount = corrected.statements.length;
      let retainedExcerpts = 0,
        removedExcerpts = 0;
      const artifactPath = join(
        "curated/minutes_summaries/documents",
        `${item.documentId}.json`
      );
      const artifact =
        await readJsonFile<MinutesDocumentSummaryArtifact | null>(
          join(directory, artifactPath),
          null
        );
      if (
        artifact?.promptVersion === MINUTES_SUMMARY_PROMPT_VERSION &&
        artifact.sourceContentSha256 === item.transcriptContentSha256 &&
        artifact.sourceKind === "official_minutes_transcript"
      ) {
        const rebound = rebindMinutesSummaryArtifact({
          artifact,
          transcript: corrected,
          members,
          generatedAt: verifiedAt
        });
        const groups = new Map(
          buildMinutesSummaryGroups({ transcript: corrected, members }).map(
            (group) => [group.groupId, group]
          )
        );
        rebound.summaries = rebound.summaries.filter((summary) =>
          isExactMinutesSelection(
            summary.summary,
            groups.get(summary.statementId)!.text
          )
        );
        rebound.sourceContentSha256 = hash;
        const merged = mergeMinutesWorkerArtifact({
          incoming: rebound,
          transcript: corrected,
          sourceHash: hash,
          transcriptPath: item.transcriptRelativePath,
          documentPath: item.latestRelativePath,
          members,
          modelId: artifact.modelId,
          generatedAt: verifiedAt
        });
        retainedExcerpts = merged.artifact.summaries.length;
        removedExcerpts = artifact.summaries.length - retainedExcerpts;
        writes.push({
          path: artifactPath,
          content: JSON.stringify(merged.artifact, null, 2)
        });
      }
      report.changedDocuments.push({
        documentId: item.documentId,
        previousStatements: previous.statements.length,
        correctedStatements: corrected.statements.length,
        retainedExcerpts,
        removedExcerpts
      });
    }
    metadata.transcriptSourceContentSha256 = metadata.currentContentSha256;
    metadata.transcriptParserVersion =
      ASSEMBLY_MINUTES_TRANSCRIPT_PARSER_VERSION;
    writes.push({
      path: item.metadataRelativePath,
      content: JSON.stringify(metadata, null, 2)
    });
    Object.assign(item, toIndexItem(metadata));
    report.checked++;
    report.boundDocuments++;
    if (report.checked % 100 === 0)
      process.stdout.write(
        `Verified ${report.checked} transcript/source pairs.\n`
      );
  }
  // Validate the whole corpus before replacing any current pointer. Old source
  // bytes and transcript versions are retained, including the corrupt snapshot.
  if (apply) {
    for (const write of writes) {
      const path = join(directory, write.path);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, write.content);
    }
    index.updatedAt = verifiedAt;
    await writeJsonFile(indexPath, index);
    await writeJsonFile(
      join(directory, "manifests/minutes_transcript_integrity.json"),
      report
    );
  }
  return report;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const directory = resolve(process.env.DATA_REPO_DIR || "published-data");
  process.stdout.write(
    `${JSON.stringify(await repairMinutesTranscripts(directory, process.argv.includes("--apply")), null, 2)}\n`
  );
}
