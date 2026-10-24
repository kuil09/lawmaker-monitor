import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { voteMinutesOpinionsExportSchema } from "@lawmaker-monitor/schemas";

import {
  DEFAULT_MINUTES_SUMMARY_MODEL,
  MINUTES_SUMMARY_PROMPT_VERSION
} from "./minutes-summarization.js";
import {
  hasBoundMinutesTranscript,
  isOfficialAssemblyMinutesViewerUrl
} from "./minutes-transcript.js";
import { buildVoteMinutesOpinionsExport } from "./vote-minutes-opinions.js";

import type { MirroredDocumentIndex } from "./document-mirror.js";
import type { MinutesDocumentSummaryArtifact } from "./minutes-summarization.js";
import type {
  LatestVotesExport,
  MemberActivityCalendarMemberDetailExport
} from "@lawmaker-monitor/schemas";

export async function rebuildPublishedVoteMinutesOpinions(args: {
  dataRepoDir: string;
  latestVotes: LatestVotesExport;
  memberDetails: MemberActivityCalendarMemberDetailExport[];
  modelId?: string;
}) {
  let index: MirroredDocumentIndex;
  let filenames: string[];
  const directory = join(
    args.dataRepoDir,
    "curated/minutes_summaries/documents"
  );
  try {
    index = JSON.parse(
      await readFile(
        join(args.dataRepoDir, "raw/index/document_index.json"),
        "utf8"
      )
    );
    filenames = await readdir(directory);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
    index = {
      sourceId: "assembly-minutes",
      updatedAt: args.latestVotes.generatedAt,
      items: []
    };
    filenames = [];
  }
  const currentDocuments = new Map(
    index.items.map((item) => [item.documentId, item])
  );
  const artifacts: MinutesDocumentSummaryArtifact[] = [];
  for (const filename of filenames.filter((name) => name.endsWith(".json"))) {
    const artifact: MinutesDocumentSummaryArtifact = JSON.parse(
      await readFile(join(directory, filename), "utf8")
    );
    const document = currentDocuments.get(artifact.documentId);
    if (
      document?.transcriptContentSha256 &&
      hasBoundMinutesTranscript(document) &&
      artifact.sourceContentSha256 === document.transcriptContentSha256 &&
      artifact.sourceKind === "official_minutes_transcript" &&
      isOfficialAssemblyMinutesViewerUrl(artifact.sourceUrl) &&
      artifact.sourceTranscriptPath === document.transcriptRelativePath
    ) {
      artifacts.push(artifact);
    }
  }
  return voteMinutesOpinionsExportSchema.parse(
    buildVoteMinutesOpinionsExport({
      generatedAt: args.latestVotes.generatedAt,
      latestVotes: args.latestVotes,
      modelId: args.modelId ?? DEFAULT_MINUTES_SUMMARY_MODEL,
      promptVersion: MINUTES_SUMMARY_PROMPT_VERSION,
      artifacts,
      voteRecordsByMemberId: new Map(
        args.memberDetails.map((member) => [
          member.memberId,
          member.voteRecords
        ])
      )
    })
  );
}
