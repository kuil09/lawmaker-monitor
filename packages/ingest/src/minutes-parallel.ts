import {
  buildExtractiveMinutesSummary,
  buildMinutesSummaryGroups,
  MINUTES_SUMMARY_PROMPT_VERSION,
  NoPublishableMinutesSourceError,
  splitExtractiveCandidates,
  type MinutesDocumentSummaryArtifact,
  type MinutesSummaryMember
} from "./minutes-summarization.js";
import { sha256 } from "./utils.js";

import type { AssemblyMinutesTranscript } from "./minutes-transcript.js";

export const MINUTES_WORKERS = 8;
export const MINUTES_WORKER_GROUPS = 160;

export type MinutesWorkerPlan = {
  batchId: string;
  sourceCommit: string;
  contextHash: string;
  modelId: string;
  promptVersion: string;
  targetDate: string;
  workers: Array<{
    id: number;
    documents: Array<{ documentId: string; sourceHash: string }>;
    plannedGroups: number;
  }>;
};

export type MinutesWorkerResult = {
  batchId: string;
  sourceCommit: string;
  contextHash: string;
  workerId: number;
  startedAt: string;
  elapsedMs: number;
  timeLimitReached: boolean;
  artifacts: MinutesDocumentSummaryArtifact[];
};

export function minutesMemberContext(members: MinutesSummaryMember[]): string {
  return sha256(
    JSON.stringify(
      [...members].sort((a, b) => a.memberId.localeCompare(b.memberId))
    )
  );
}

// Input is oldest first. Whole documents stay together; a large document can
// consume one worker's entire allowance without blocking the other workers.
export function assignMinutesDocument(
  workers: MinutesWorkerPlan["workers"],
  document: { documentId: string; sourceHash: string },
  readyGroups: number
): boolean {
  const available = workers
    .filter(
      (worker) =>
        worker.documents.length < 20 &&
        worker.plannedGroups < MINUTES_WORKER_GROUPS
    )
    .sort((a, b) => a.plannedGroups - b.plannedGroups || a.id - b.id);
  const worker = available[0];
  if (!worker) return false;
  worker.documents.push(document);
  worker.plannedGroups = Math.min(
    MINUTES_WORKER_GROUPS,
    worker.plannedGroups + Math.max(1, readyGroups)
  );
  return true;
}

// Accept exactly the same ordered source-sentence selections as the producer,
// including its added terminal punctuation. Similarity is not source proof.
export function isExactMinutesSelection(
  summary: string,
  text: string
): boolean {
  const candidates = splitExtractiveCandidates(text).map((sentence) =>
    /[.!?]$/.test(sentence) ? sentence : `${sentence}.`
  );
  const match = (remaining: string, start: number, depth: number): boolean => {
    if (!remaining) return depth > 0;
    if (depth === 3) return false;
    for (let index = start; index < candidates.length; index++) {
      const sentence = candidates[index]!;
      if (remaining === sentence) return true;
      if (
        remaining.startsWith(`${sentence} `) &&
        match(remaining.slice(sentence.length + 1), index + 1, depth + 1)
      )
        return true;
    }
    return false;
  };
  return match(summary, 0, 0);
}

export function mergeMinutesWorkerArtifact(args: {
  incoming: MinutesDocumentSummaryArtifact;
  current?: MinutesDocumentSummaryArtifact;
  transcript: AssemblyMinutesTranscript;
  sourceHash: string;
  transcriptPath: string;
  documentPath: string;
  members: MinutesSummaryMember[];
  modelId: string;
  generatedAt: string;
}): {
  artifact: MinutesDocumentSummaryArtifact;
  added: number;
  skipped: number;
} {
  const { incoming, transcript } = args;
  const compatible = (artifact: MinutesDocumentSummaryArtifact) =>
    artifact.documentId === transcript.documentId &&
    artifact.sourceContentSha256 === args.sourceHash &&
    artifact.sourceKind === "official_minutes_transcript" &&
    artifact.sourceUrl === transcript.sourceUrl &&
    artifact.modelId === args.modelId &&
    artifact.promptVersion === MINUTES_SUMMARY_PROMPT_VERSION;
  if (!compatible(incoming))
    throw new Error("Worker artifact provenance mismatch.");
  const current =
    args.current && compatible(args.current) ? args.current : undefined;
  const groups = buildMinutesSummaryGroups({
    transcript,
    members: args.members
  });
  const byId = new Map(groups.map((group) => [group.groupId, group]));
  const summaries = new Map<
    string,
    MinutesDocumentSummaryArtifact["summaries"][number]
  >();
  const skips = new Map<string, { statementId: string; reason: string }>();
  const failures = new Map<
    string,
    NonNullable<MinutesDocumentSummaryArtifact["failedGroups"]>[number]
  >();
  let added = 0;
  let skipped = 0;
  for (const [artifact, isIncoming] of [
    [current, false],
    [incoming, true]
  ] as const) {
    if (!artifact) continue;
    for (const summary of artifact.summaries) {
      const group = byId.get(summary.statementId);
      if (
        !group ||
        summary.memberId !== group.member.memberId ||
        !group.statementIds.includes(
          summary.sourceFragment.replace(/^#/, "")
        ) ||
        !isExactMinutesSelection(summary.summary, group.text)
      )
        throw new Error(`Invalid source selection: ${summary.statementId}`);
      if (summaries.has(group.groupId) || skips.has(group.groupId)) continue;
      summaries.set(group.groupId, {
        statementId: group.groupId,
        documentId: group.documentId,
        meetingTitle: group.meetingTitle,
        meetingDate: group.meetingDate,
        committeeName: group.committeeName,
        agendaTitle: group.agendaTitle,
        billIds: group.billIds,
        speakerRole: group.speakerRole,
        summary: summary.summary,
        evidenceExcerpt: summary.summary,
        sourceUrl: group.sourceUrl,
        sourceFragment: summary.sourceFragment,
        sourceDocumentPath: args.documentPath,
        sourceContentSha256: args.sourceHash,
        sourceKind: "official_minutes_transcript",
        memberId: group.member.memberId,
        name: group.member.name,
        party: group.member.party
      });
      if (isIncoming) added++;
    }
    for (const entry of artifact.skippedGroups ?? []) {
      const group = byId.get(entry.statementId);
      if (!group) throw new Error("Unknown skipped worker group.");
      if (summaries.has(group.groupId) || skips.has(group.groupId)) continue;
      try {
        buildExtractiveMinutesSummary(group.text);
        throw new Error("Worker skipped a publishable group.");
      } catch (error) {
        if (!(error instanceof NoPublishableMinutesSourceError)) throw error;
        skips.set(group.groupId, {
          statementId: group.groupId,
          reason: error.message
        });
        if (isIncoming) skipped++;
      }
    }
    for (const failure of artifact.failedGroups ?? []) {
      if (
        !byId.has(failure.statementId) ||
        !Number.isSafeInteger(failure.attempts) ||
        failure.attempts < 1 ||
        !Number.isFinite(Date.parse(failure.nextRetryAt))
      )
        throw new Error("Invalid worker retry state.");
      // Preserve a newer publisher's retry state as well as its selections.
      if (!failures.has(failure.statementId))
        failures.set(failure.statementId, failure);
    }
  }
  for (const id of [...summaries.keys(), ...skips.keys()]) failures.delete(id);
  const complete = groups.every(
    (group) => summaries.has(group.groupId) || skips.has(group.groupId)
  );
  return {
    added,
    skipped,
    artifact: {
      schemaVersion: 1,
      sourceKind: "official_minutes_transcript",
      generatedAt: args.generatedAt,
      documentId: transcript.documentId,
      sourceContentSha256: args.sourceHash,
      sourceTranscriptPath: args.transcriptPath,
      sourceDocumentPath: args.documentPath,
      sourceUrl: transcript.sourceUrl,
      modelId: args.modelId,
      promptVersion: MINUTES_SUMMARY_PROMPT_VERSION,
      summaryGroupCount: groups.length,
      complete,
      summaries: [...summaries.values()],
      skippedGroups: [...skips.values()],
      failedGroups: [...failures.values()],
      nextRetryAt:
        summaries.size + skips.size + failures.size === groups.length &&
        failures.size > 0
          ? [...failures.values()].map((entry) => entry.nextRetryAt).sort()[0]
          : undefined
    }
  };
}
