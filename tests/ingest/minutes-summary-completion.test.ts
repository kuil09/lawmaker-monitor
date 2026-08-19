import { describe, expect, it } from "vitest";

import {
  isPublishableMinutesSummary,
  MINUTES_SUMMARY_PROMPT_VERSION,
  type MinutesDocumentSummaryArtifact
} from "../../packages/ingest/src/minutes-summarization.js";
import { isCurrentSummaryArtifact } from "../../packages/ingest/src/scripts/summarize-minutes.js";

import type { MirroredDocumentIndexItem } from "../../packages/ingest/src/document-mirror.js";

describe("minutes summary completion", () => {
  it("does not retry a complete artifact only because an excluded short excerpt remains", () => {
    const document = {
      documentId: "minutes-1",
      transcriptContentSha256: "transcript-sha"
    } as MirroredDocumentIndexItem & {
      transcriptContentSha256: string;
    };
    const artifact = {
      complete: true,
      sourceKind: "official_minutes_transcript",
      sourceContentSha256: "transcript-sha",
      modelId: "test-model",
      promptVersion: MINUTES_SUMMARY_PROMPT_VERSION,
      summaries: [{ summary: "다 우리는 준비했어요." }]
    } as unknown as MinutesDocumentSummaryArtifact;

    expect(isPublishableMinutesSummary(artifact.summaries[0]!.summary)).toBe(
      false
    );
    expect(
      isCurrentSummaryArtifact(document, artifact, { modelId: "test-model" })
    ).toBe(true);
  });
});
