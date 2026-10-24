import { appendFile, readdir, readFile, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  latestVotesExportSchema,
  memberActivityCalendarExportSchema,
  memberActivityCalendarMemberDetailExportSchema,
  memberStatementSummariesExportSchema,
  memberStatementSummariesIndexExportSchema,
  voteMinutesOpinionsExportSchema
} from "@lawmaker-monitor/schemas";

import {
  canStartMinutesRequest,
  measureMinutesProcessing,
  MinutesSummaryDeadlineError,
  type MinutesSummaryBatch
} from "../minutes-backfill-policy.js";
import {
  buildMemberStatementSummaryExports,
  buildMinutesSummaryGroups,
  createLlamaServerSummarizer,
  DEFAULT_MINUTES_SUMMARY_MODEL,
  isPublishableExtractiveMinutesSummary,
  NoPublishableMinutesSourceError,
  MINUTES_SUMMARY_PROMPT_VERSION,
  rebindMinutesSummaryArtifact,
  summarizeMinutesGroup,
  type MinutesDocumentSummaryArtifact,
  type MinutesSummaryMember
} from "../minutes-summarization.js";
import {
  resolveMinutesSummaryTargetDate,
  selectPendingMinutesDocuments
} from "../minutes-summary-policy.js";
import {
  isOfficialAssemblyMinutesViewerUrl,
  type AssemblyMinutesTranscript
} from "../minutes-transcript.js";
import {
  readJsonFile,
  readPositiveInteger,
  sha256,
  writeJsonFile
} from "../utils.js";
import { buildVoteMinutesOpinionsExport } from "../vote-minutes-opinions.js";

import type {
  MirroredDocumentIndex,
  MirroredDocumentIndexItem
} from "../document-mirror.js";

type SummaryConfig = {
  dataRepoDir: string;
  documentIndexPath: string;
  memberCalendarPath: string;
  latestVotesPath: string;
  artifactDirectory: string;
  memberExportDirectory: string;
  voteOpinionExportPath: string;
  statePath: string;
  modelId: string;
  endpoint: string;
  maxDocuments: number;
  maxGroups: number;
  concurrency: number;
  requestTimeoutMs: number;
  targetDate: string;
  runMode: "standard" | "backfill";
  maxDurationMs: number;
};

type SummaryState = {
  updatedAt: string;
  lastProgressAt: string | null;
  modelId: string;
  promptVersion: string;
  sourceKind: "official_minutes_transcript";
  targetDate: string;
  documentsVisited: number;
  documentsCompleted: number;
  groupsSummarized: number;
  groupsFailed: number;
  groupsSkipped: number;
  remainingDocuments: number;
  membersPublished: number;
  mirroredDocuments: number;
  transcriptDocuments: number;
  summarizedDocuments: number;
  latestMirroredMeetingDate: string | null;
  latestSummarizedMeetingDate: string | null;
  reboundDocuments: number;
  reboundSummaries: number;
  remainingGroups?: number;
  readyGroups?: number;
  deferredGroups?: number;
  oldestPendingMeetingDate?: string | null;
  elapsedMs?: number;
  timeLimitReached?: boolean;
  runMode?: "standard" | "backfill";
  processingMetrics?: ReturnType<typeof measureMinutesProcessing>;
};

function loadConfig(): SummaryConfig {
  const isBackfill = process.env.MINUTES_SUMMARY_RUN_MODE === "backfill";
  const repositoryRoot = resolve(
    fileURLToPath(new URL("../../../../", import.meta.url))
  );
  const dataRepoDir = resolve(
    repositoryRoot,
    process.env.DATA_REPO_DIR?.trim() || "published-data"
  );

  return {
    dataRepoDir,
    documentIndexPath:
      process.env.MINUTES_DOCUMENT_INDEX_PATH?.trim() ||
      "raw/index/document_index.json",
    memberCalendarPath:
      process.env.MINUTES_MEMBER_CALENDAR_PATH?.trim() ||
      "exports/member_activity_calendar.json",
    latestVotesPath:
      process.env.MINUTES_LATEST_VOTES_PATH?.trim() ||
      "exports/latest_votes.json",
    artifactDirectory:
      process.env.MINUTES_SUMMARY_ARTIFACT_DIR?.trim() ||
      "curated/minutes_summaries/documents",
    memberExportDirectory:
      process.env.MINUTES_SUMMARY_EXPORT_DIR?.trim() ||
      "exports/member_statement_summaries",
    voteOpinionExportPath:
      process.env.MINUTES_VOTE_OPINION_EXPORT_PATH?.trim() ||
      "exports/vote_minutes_opinions.json",
    statePath:
      process.env.MINUTES_SUMMARY_STATE_PATH?.trim() ||
      "manifests/minutes_summary_state.json",
    modelId:
      process.env.MINUTES_SUMMARY_MODEL?.trim() ||
      DEFAULT_MINUTES_SUMMARY_MODEL,
    endpoint:
      process.env.MINUTES_SUMMARY_ENDPOINT?.trim() ||
      "http://127.0.0.1:8080/v1/chat/completions",
    maxDocuments: Math.min(
      readPositiveInteger("MINUTES_SUMMARY_MAX_DOCUMENTS", 20),
      isBackfill ? 20 : Infinity
    ),
    maxGroups: Math.min(
      readPositiveInteger("MINUTES_SUMMARY_MAX_GROUPS", 160),
      isBackfill ? 160 : Infinity
    ),
    concurrency: Math.min(
      readPositiveInteger("MINUTES_SUMMARY_CONCURRENCY", 4),
      8
    ),
    requestTimeoutMs: readPositiveInteger(
      "MINUTES_SUMMARY_REQUEST_TIMEOUT_MS",
      60_000
    ),
    targetDate: resolveMinutesSummaryTargetDate(
      process.env.MINUTES_SUMMARY_TARGET_DATE
    ),
    runMode: isBackfill ? "backfill" : "standard",
    maxDurationMs: Math.min(
      readPositiveInteger("MINUTES_SUMMARY_MAX_DURATION_MS", 20 * 60_000),
      20 * 60_000
    )
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]!);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, runWorker)
  );
  return results;
}

function artifactRelativePath(
  config: SummaryConfig,
  documentId: string
): string {
  return join(config.artifactDirectory, `${documentId}.json`);
}

function isTranscriptDocument(
  item: MirroredDocumentIndexItem
): item is MirroredDocumentIndexItem & {
  transcriptRelativePath: string;
  transcriptContentSha256: string;
} {
  return Boolean(
    item.transcriptRelativePath &&
    item.transcriptContentSha256 &&
    isOfficialAssemblyMinutesViewerUrl(item.sourceUrl)
  );
}

export function isCurrentSummaryArtifact(
  item: MirroredDocumentIndexItem & {
    transcriptContentSha256: string;
  },
  artifact: MinutesDocumentSummaryArtifact | undefined,
  config: Pick<SummaryConfig, "modelId">
): boolean {
  return Boolean(
    artifact?.complete &&
    artifact.sourceKind === "official_minutes_transcript" &&
    artifact.sourceContentSha256 === item.transcriptContentSha256 &&
    artifact.modelId === config.modelId &&
    artifact.promptVersion === MINUTES_SUMMARY_PROMPT_VERSION
  );
}

function buildSummaryCoverage(args: {
  documentIndex: MirroredDocumentIndex;
  candidateDocuments: Array<
    MirroredDocumentIndexItem & {
      transcriptRelativePath: string;
      transcriptContentSha256: string;
    }
  >;
  artifactByDocumentId: Map<string, MinutesDocumentSummaryArtifact>;
  config: Pick<SummaryConfig, "modelId">;
}): Pick<
  SummaryState,
  | "mirroredDocuments"
  | "transcriptDocuments"
  | "summarizedDocuments"
  | "remainingDocuments"
  | "latestMirroredMeetingDate"
  | "latestSummarizedMeetingDate"
> {
  const summarizedDocuments = args.candidateDocuments.filter((item) =>
    isCurrentSummaryArtifact(
      item,
      args.artifactByDocumentId.get(item.documentId),
      args.config
    )
  );

  return {
    mirroredDocuments: args.documentIndex.items.length,
    transcriptDocuments: args.candidateDocuments.length,
    summarizedDocuments: summarizedDocuments.length,
    remainingDocuments:
      args.candidateDocuments.length - summarizedDocuments.length,
    latestMirroredMeetingDate:
      args.documentIndex.items
        .map((item) => item.publishedDate)
        .sort((left, right) => right.localeCompare(left))[0] ?? null,
    latestSummarizedMeetingDate:
      summarizedDocuments
        .map((item) => item.publishedDate)
        .sort((left, right) => right.localeCompare(left))[0] ?? null
  };
}

async function readTranscript(
  config: SummaryConfig,
  item: MirroredDocumentIndexItem & {
    transcriptRelativePath: string;
    transcriptContentSha256: string;
  }
): Promise<AssemblyMinutesTranscript> {
  const content = await readFile(
    join(config.dataRepoDir, item.transcriptRelativePath),
    "utf8"
  );
  if (sha256(content) !== item.transcriptContentSha256)
    throw new Error(
      `Minutes transcript checksum mismatch: ${item.transcriptRelativePath}`
    );
  const payload = JSON.parse(content) as AssemblyMinutesTranscript;
  if (
    payload.schemaVersion !== 1 ||
    payload.documentId !== item.documentId ||
    !Array.isArray(payload.agendaItems) ||
    !Array.isArray(payload.statements) ||
    !isOfficialAssemblyMinutesViewerUrl(payload.sourceUrl) ||
    payload.sourceUrl !== item.sourceUrl
  ) {
    throw new Error(
      `Unsupported minutes transcript: ${item.transcriptRelativePath}`
    );
  }

  return payload;
}

async function loadAllArtifacts(
  config: SummaryConfig
): Promise<MinutesDocumentSummaryArtifact[]> {
  const directory = join(config.dataRepoDir, config.artifactDirectory);
  let filenames: string[];
  try {
    filenames = await readdir(directory);
  } catch {
    return [];
  }

  const artifacts: MinutesDocumentSummaryArtifact[] = [];
  for (const filename of filenames.filter((value) => value.endsWith(".json"))) {
    const artifact = await readJsonFile<MinutesDocumentSummaryArtifact | null>(
      join(directory, filename),
      null
    );
    if (artifact?.schemaVersion === 1) {
      artifacts.push(artifact);
    }
  }

  return artifacts;
}

async function publishVoteMinutesOpinions(args: {
  config: SummaryConfig;
  generatedAt: string;
  modelId: string;
  promptVersion: string;
  memberCalendar: ReturnType<typeof memberActivityCalendarExportSchema.parse>;
  artifacts: MinutesDocumentSummaryArtifact[];
}): Promise<void> {
  const latestVotes = latestVotesExportSchema.parse(
    JSON.parse(
      await readFile(
        join(args.config.dataRepoDir, args.config.latestVotesPath),
        "utf8"
      )
    )
  );
  const voteRecordsByMemberId = new Map<
    string,
    ReturnType<
      typeof memberActivityCalendarMemberDetailExportSchema.parse
    >["voteRecords"]
  >();

  for (const member of args.memberCalendar.assembly.members) {
    try {
      const detail = memberActivityCalendarMemberDetailExportSchema.parse(
        JSON.parse(
          await readFile(
            join(args.config.dataRepoDir, member.voteRecordsPath),
            "utf8"
          )
        )
      );
      voteRecordsByMemberId.set(member.memberId, detail.voteRecords);
    } catch {
      // A missing detail file leaves the member's stance unresolved.
    }
  }

  const payload = voteMinutesOpinionsExportSchema.parse(
    buildVoteMinutesOpinionsExport({
      generatedAt: args.generatedAt,
      latestVotes,
      modelId: args.modelId,
      promptVersion: args.promptVersion,
      artifacts: args.artifacts,
      voteRecordsByMemberId
    })
  );
  await writeJsonFile(
    join(args.config.dataRepoDir, args.config.voteOpinionExportPath),
    payload
  );
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const config = loadConfig();
  const generatedAt = new Date().toISOString();
  const previousState = await readJsonFile<SummaryState | null>(
    join(config.dataRepoDir, config.statePath),
    null
  );
  const documentIndex = await readJsonFile<MirroredDocumentIndex>(
    join(config.dataRepoDir, config.documentIndexPath),
    {
      sourceId: "assembly-minutes",
      updatedAt: generatedAt,
      items: []
    }
  );
  const memberCalendar = memberActivityCalendarExportSchema.parse(
    JSON.parse(
      await readFile(
        join(config.dataRepoDir, config.memberCalendarPath),
        "utf8"
      )
    )
  );
  const members: MinutesSummaryMember[] = memberCalendar.assembly.members.map(
    (member) => ({
      memberId: member.memberId,
      name: member.name,
      party: member.party,
      officialProfileUrl: member.officialProfileUrl ?? null
    })
  );
  const allTranscriptDocuments =
    documentIndex.items.filter(isTranscriptDocument);
  const candidateDocuments = allTranscriptDocuments.filter(
    (item) => item.publishedDate <= config.targetDate
  );
  const artifactByDocumentId = new Map(
    (await loadAllArtifacts(config)).map((artifact) => [
      artifact.documentId,
      artifact
    ])
  );
  const repairAgendas = process.argv.includes("--rebind-agendas");
  let reboundDocuments = 0;
  let reboundSummaries = 0;
  if (repairAgendas) {
    for (const item of allTranscriptDocuments) {
      const artifact = artifactByDocumentId.get(item.documentId);
      if (
        artifact?.promptVersion !== "minutes-summary-v7-extractive-ranker" ||
        artifact.modelId !== config.modelId ||
        artifact.sourceContentSha256 !== item.transcriptContentSha256
      )
        continue;
      const repaired = rebindMinutesSummaryArtifact({
        artifact,
        transcript: await readTranscript(config, item),
        members,
        generatedAt
      });
      artifactByDocumentId.set(item.documentId, repaired);
      await writeJsonFile(
        join(config.dataRepoDir, artifactRelativePath(config, item.documentId)),
        repaired
      );
      reboundDocuments += 1;
      reboundSummaries += repaired.summaries.length;
    }
    if (process.env.GITHUB_OUTPUT) {
      await appendFile(
        process.env.GITHUB_OUTPUT,
        `changed=${reboundDocuments > 0}\n`
      );
    }
    if (reboundDocuments === 0) {
      process.stdout.write("No legacy agenda bindings require repair.\n");
      return;
    }
  }
  const pendingDocuments = selectPendingMinutesDocuments({
    documents: candidateDocuments,
    targetDate: config.targetDate,
    maxDocuments: config.maxDocuments,
    priority: config.runMode === "backfill" ? "oldest" : "recent",
    lastAttemptAt: (item) =>
      artifactByDocumentId.get(item.documentId)?.generatedAt,
    nextRetryAt: (item) =>
      artifactByDocumentId.get(item.documentId)?.nextRetryAt,
    isCurrent: (item) =>
      isCurrentSummaryArtifact(
        item,
        artifactByDocumentId.get(item.documentId),
        config
      )
  });
  if (process.argv.includes("--check-pending")) {
    process.stdout.write(`${pendingDocuments.length > 0}\n`);
    return;
  }
  const currentArtifacts = () =>
    allTranscriptDocuments.flatMap((item) => {
      const artifact = artifactByDocumentId.get(item.documentId);
      return artifact?.sourceContentSha256 === item.transcriptContentSha256
        ? [artifact]
        : [];
    });
  if (pendingDocuments.length === 0 && !repairAgendas) {
    try {
      const memberIndex = memberStatementSummariesIndexExportSchema.parse(
        JSON.parse(
          await readFile(
            join(
              config.dataRepoDir,
              config.memberExportDirectory,
              "index.json"
            ),
            "utf8"
          )
        )
      );
      const idleState: SummaryState = {
        updatedAt: generatedAt,
        lastProgressAt:
          previousState?.lastProgressAt ?? previousState?.updatedAt ?? null,
        modelId: config.modelId,
        promptVersion: MINUTES_SUMMARY_PROMPT_VERSION,
        sourceKind: "official_minutes_transcript",
        targetDate: config.targetDate,
        documentsVisited: 0,
        documentsCompleted: 0,
        groupsSummarized: 0,
        groupsFailed: 0,
        groupsSkipped: 0,
        reboundDocuments: 0,
        reboundSummaries: 0,
        membersPublished: memberIndex.members.length,
        ...buildSummaryCoverage({
          documentIndex,
          candidateDocuments,
          artifactByDocumentId,
          config
        })
      };
      const stateFile = join(config.dataRepoDir, config.statePath);
      const existingState = await readJsonFile<SummaryState | null>(
        stateFile,
        null
      );
      if (
        existingState?.modelId !== idleState.modelId ||
        existingState.promptVersion !== idleState.promptVersion ||
        existingState.remainingDocuments !== idleState.remainingDocuments ||
        existingState.membersPublished !== idleState.membersPublished ||
        existingState.latestMirroredMeetingDate !==
          idleState.latestMirroredMeetingDate ||
        existingState.latestSummarizedMeetingDate !==
          idleState.latestSummarizedMeetingDate
      ) {
        await writeJsonFile(stateFile, idleState);
      }
      await publishVoteMinutesOpinions({
        config,
        generatedAt,
        modelId: config.modelId,
        promptVersion: MINUTES_SUMMARY_PROMPT_VERSION,
        memberCalendar,
        artifacts: currentArtifacts()
      });
      process.stdout.write(`${JSON.stringify(idleState, null, 2)}\n`);
      return;
    } catch {
      process.stdout.write(
        "No pending transcripts; rebuilding the missing summary index.\n"
      );
    }
  }

  const deadline = Date.now() + config.maxDurationMs;
  const summarize = createLlamaServerSummarizer({
    endpoint: config.endpoint,
    modelId: config.modelId,
    timeoutMs: config.requestTimeoutMs,
    deadline
  });
  let remainingGroupBudget = config.maxGroups;
  let groupsSummarized = 0;
  let groupsFailed = 0;
  let groupsSkipped = 0;
  let documentsVisited = 0;
  let documentsCompleted = 0;
  let timeLimitReached = false;

  for (const item of repairAgendas ? [] : pendingDocuments) {
    if (!canStartMinutesRequest(deadline, config.requestTimeoutMs)) {
      timeLimitReached = true;
      break;
    }
    documentsVisited += 1;
    const transcript = await readTranscript(config, item);
    const groups = buildMinutesSummaryGroups({
      transcript,
      members
    });
    const existingArtifact = artifactByDocumentId.get(item.documentId);
    const canReuseExisting =
      existingArtifact?.sourceContentSha256 === item.transcriptContentSha256 &&
      existingArtifact.sourceKind === "official_minutes_transcript" &&
      existingArtifact.modelId === config.modelId &&
      existingArtifact.promptVersion === MINUTES_SUMMARY_PROMPT_VERSION;
    const summaries = canReuseExisting
      ? existingArtifact.summaries.filter((summary) =>
          isPublishableExtractiveMinutesSummary(summary.summary)
        )
      : [];
    const skippedGroups = canReuseExisting
      ? [...(existingArtifact.skippedGroups ?? [])]
      : [];
    const failures = new Map(
      (canReuseExisting ? (existingArtifact.failedGroups ?? []) : []).map(
        (failure) => [failure.statementId, failure]
      )
    );
    const completedGroupIds = new Set([
      ...summaries.map((summary) => summary.statementId),
      ...skippedGroups.map((group) => group.statementId)
    ]);

    const groupsToSummarize = groups
      .filter(
        (group) =>
          !completedGroupIds.has(group.groupId) &&
          (!failures.has(group.groupId) ||
            Date.parse(failures.get(group.groupId)!.nextRetryAt) <=
              Date.parse(generatedAt))
      )
      .slice(0, remainingGroupBudget);
    remainingGroupBudget -= groupsToSummarize.length;
    const results = await mapWithConcurrency(
      groupsToSummarize,
      config.concurrency,
      async (group) => {
        if (!canStartMinutesRequest(deadline, config.requestTimeoutMs)) {
          timeLimitReached = true;
          return { group, summary: null, error: null, deferred: true };
        }
        try {
          return {
            group,
            summary: await summarizeMinutesGroup({
              group,
              summarize
            }),
            error: null,
            deferred: false
          };
        } catch (error) {
          if (error instanceof MinutesSummaryDeadlineError) {
            timeLimitReached = true;
            return { group, summary: null, error: null, deferred: true };
          }
          return {
            group,
            summary: null,
            error,
            deferred: false
          };
        }
      }
    );

    for (const result of results) {
      if (result.deferred) continue;
      if (result.summary) {
        const { group, summary } = result;
        summaries.push({
          statementId: group.groupId,
          documentId: group.documentId,
          meetingTitle: group.meetingTitle,
          meetingDate: group.meetingDate,
          committeeName: group.committeeName,
          agendaTitle: group.agendaTitle,
          billIds: group.billIds,
          speakerRole: group.speakerRole,
          summary,
          evidenceExcerpt: summary,
          sourceUrl: group.sourceUrl,
          sourceFragment: group.sourceFragment,
          sourceDocumentPath: item.latestRelativePath,
          sourceContentSha256: item.transcriptContentSha256,
          sourceKind: "official_minutes_transcript",
          memberId: group.member.memberId,
          name: group.member.name,
          party: group.member.party
        });
        completedGroupIds.add(group.groupId);
        failures.delete(group.groupId);
        groupsSummarized += 1;
        continue;
      }

      if (result.error instanceof NoPublishableMinutesSourceError) {
        skippedGroups.push({
          statementId: result.group.groupId,
          reason: result.error.message
        });
        completedGroupIds.add(result.group.groupId);
        failures.delete(result.group.groupId);
        groupsSkipped += 1;
        continue;
      }
      groupsFailed += 1;
      const attempts = (failures.get(result.group.groupId)?.attempts ?? 0) + 1;
      failures.set(result.group.groupId, {
        statementId: result.group.groupId,
        attempts,
        nextRetryAt: new Date(
          Date.parse(generatedAt) + Math.min(24 * 7, 2 ** attempts) * 3_600_000
        ).toISOString(),
        error:
          result.error instanceof Error
            ? result.error.message
            : String(result.error)
      });
      process.stderr.write(
        `Could not summarize ${item.documentId}/${result.group.groupId}: ${
          result.error instanceof Error
            ? result.error.message
            : String(result.error)
        }\n`
      );
    }

    const complete = groups.every((group) =>
      completedGroupIds.has(group.groupId)
    );
    if (complete) {
      documentsCompleted += 1;
    }

    const artifact: MinutesDocumentSummaryArtifact = {
      schemaVersion: 1,
      sourceKind: "official_minutes_transcript",
      generatedAt,
      documentId: item.documentId,
      sourceContentSha256: item.transcriptContentSha256,
      sourceTranscriptPath: item.transcriptRelativePath,
      sourceDocumentPath: item.latestRelativePath,
      sourceUrl: item.sourceUrl,
      modelId: config.modelId,
      promptVersion: MINUTES_SUMMARY_PROMPT_VERSION,
      summaryGroupCount: groups.length,
      complete,
      summaries,
      skippedGroups,
      failedGroups: [...failures.values()],
      nextRetryAt:
        groups.every(
          (group) =>
            completedGroupIds.has(group.groupId) || failures.has(group.groupId)
        ) && failures.size > 0
          ? [...failures.values()]
              .map((failure) => failure.nextRetryAt)
              .sort()[0]
          : undefined
    };
    artifactByDocumentId.set(item.documentId, artifact);
    await writeJsonFile(
      join(config.dataRepoDir, artifactRelativePath(config, item.documentId)),
      artifact
    );

    if (remainingGroupBudget <= 0 || timeLimitReached) {
      break;
    }
  }

  const memberExports = buildMemberStatementSummaryExports({
    generatedAt,
    assemblyNo: memberCalendar.assemblyNo,
    assemblyLabel: memberCalendar.assemblyLabel,
    modelId: config.modelId,
    promptVersion: MINUTES_SUMMARY_PROMPT_VERSION,
    members,
    artifacts: allTranscriptDocuments.flatMap((item) => {
      const artifact = artifactByDocumentId.get(item.documentId);
      return artifact?.sourceContentSha256 === item.transcriptContentSha256
        ? [artifact]
        : [];
    })
  });
  for (const payload of memberExports) {
    const validated = memberStatementSummariesExportSchema.parse(payload);
    await writeJsonFile(
      join(
        config.dataRepoDir,
        config.memberExportDirectory,
        `${payload.memberId}.json`
      ),
      validated
    );
  }
  const memberIndex = memberStatementSummariesIndexExportSchema.parse({
    generatedAt,
    assemblyNo: memberCalendar.assemblyNo,
    assemblyLabel: memberCalendar.assemblyLabel,
    modelId: config.modelId,
    promptVersion: MINUTES_SUMMARY_PROMPT_VERSION,
    members: memberExports.map((payload) => ({
      memberId: payload.memberId,
      name: payload.name,
      party: payload.party,
      summaryCount: payload.summaries.length,
      path: join(
        config.memberExportDirectory,
        `${payload.memberId}.json`
      ).replaceAll("\\", "/")
    }))
  });
  await writeJsonFile(
    join(config.dataRepoDir, config.memberExportDirectory, "index.json"),
    memberIndex
  );
  const retainedExportFilenames = new Set([
    "index.json",
    ...memberExports.map((payload) => `${payload.memberId}.json`)
  ]);
  const publishedExportDirectory = join(
    config.dataRepoDir,
    config.memberExportDirectory
  );
  for (const filename of await readdir(publishedExportDirectory)) {
    if (filename.endsWith(".json") && !retainedExportFilenames.has(filename)) {
      await unlink(join(publishedExportDirectory, filename));
    }
  }
  await publishVoteMinutesOpinions({
    config,
    generatedAt,
    modelId: config.modelId,
    promptVersion: MINUTES_SUMMARY_PROMPT_VERSION,
    memberCalendar,
    artifacts: currentArtifacts()
  });

  const state: SummaryState = {
    updatedAt: generatedAt,
    lastProgressAt:
      groupsSummarized > 0 || documentsCompleted > 0 || reboundSummaries > 0
        ? generatedAt
        : (previousState?.lastProgressAt ?? previousState?.updatedAt ?? null),
    modelId: config.modelId,
    promptVersion: MINUTES_SUMMARY_PROMPT_VERSION,
    sourceKind: "official_minutes_transcript",
    targetDate: config.targetDate,
    documentsVisited,
    documentsCompleted,
    groupsSummarized,
    groupsFailed,
    groupsSkipped,
    reboundDocuments,
    reboundSummaries,
    runMode: config.runMode,
    elapsedMs: Date.now() - startedAt,
    timeLimitReached,
    membersPublished: memberExports.length,
    ...buildSummaryCoverage({
      documentIndex,
      candidateDocuments,
      artifactByDocumentId,
      config
    })
  };
  // Cache grouping by verified transcript bytes and member identity. Counting
  // backlog work never calls the model and never marks unprocessed groups done.
  const workloadPath = join(
    config.dataRepoDir,
    "curated/minutes_summaries/workload_index.json"
  );
  const memberSignature = sha256(JSON.stringify(members));
  const workload = await readJsonFile<{
    signature: string;
    documents: Record<string, { hash: string; groupIds: string[] }>;
  }>(workloadPath, { signature: "", documents: {} });
  const signature = `${MINUTES_SUMMARY_PROMPT_VERSION}:${memberSignature}`;
  if (workload.signature !== signature) workload.documents = {};
  workload.signature = signature;
  state.remainingGroups = 0;
  state.readyGroups = 0;
  state.deferredGroups = 0;
  state.oldestPendingMeetingDate = null;
  for (const item of candidateDocuments) {
    const artifact = artifactByDocumentId.get(item.documentId);
    if (isCurrentSummaryArtifact(item, artifact, config)) continue;
    const cached = workload.documents[item.documentId];
    const groupIds =
      cached?.hash === item.transcriptContentSha256
        ? cached.groupIds
        : buildMinutesSummaryGroups({
            transcript: await readTranscript(config, item),
            members
          }).map((group) => group.groupId);
    workload.documents[item.documentId] = {
      hash: item.transcriptContentSha256,
      groupIds
    };
    const reusable =
      artifact?.sourceContentSha256 === item.transcriptContentSha256 &&
      artifact.modelId === config.modelId &&
      artifact.promptVersion === MINUTES_SUMMARY_PROMPT_VERSION;
    const completed = new Set(
      reusable
        ? [
            ...artifact.summaries
              .filter((entry) =>
                isPublishableExtractiveMinutesSummary(entry.summary)
              )
              .map((entry) => entry.statementId),
            ...(artifact.skippedGroups ?? []).map((entry) => entry.statementId)
          ]
        : []
    );
    const pending = groupIds.filter((id) => !completed.has(id));
    const deferred = pending.filter(
      (id) =>
        reusable &&
        artifact.failedGroups?.some(
          (entry) =>
            entry.statementId === id &&
            Date.parse(entry.nextRetryAt) > Date.now()
        )
    ).length;
    state.remainingGroups += pending.length;
    state.deferredGroups += deferred;
    state.readyGroups += pending.length - deferred;
    if (
      !state.oldestPendingMeetingDate ||
      item.publishedDate < state.oldestPendingMeetingDate
    )
      state.oldestPendingMeetingDate = item.publishedDate;
  }
  await writeJsonFile(workloadPath, workload);
  state.elapsedMs = Date.now() - startedAt;
  if (!repairAgendas) {
    const historyPath = join(
      config.dataRepoDir,
      "manifests/minutes_summary_history.json"
    );
    const history = await readJsonFile<{ batches: MinutesSummaryBatch[] }>(
      historyPath,
      { batches: [] }
    );
    const batchId = process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`
      : generatedAt;
    history.batches = history.batches.filter(
      (batch) =>
        batch.batchId !== batchId &&
        Date.now() - Date.parse(batch.completedAt) < 14 * 86_400_000
    );
    history.batches.push({
      batchId,
      completedAt: new Date().toISOString(),
      runMode: config.runMode,
      elapsedMs: state.elapsedMs,
      documentsCompleted,
      groupsSummarized,
      groupsSkipped,
      groupsFailed,
      transcriptDocuments: state.transcriptDocuments,
      remainingDocuments: state.remainingDocuments,
      remainingGroups: state.remainingGroups
    });
    await writeJsonFile(historyPath, history);
    state.processingMetrics = measureMinutesProcessing(
      history.batches,
      state.remainingGroups
    );
  }
  await writeJsonFile(join(config.dataRepoDir, config.statePath), state);
  process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);

  if (groupsFailed > 0) {
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void main();
}
