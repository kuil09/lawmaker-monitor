import { readdir, readFile, unlink } from "node:fs/promises";
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
  buildMemberStatementSummaryExports,
  buildMinutesSummaryGroups,
  createLlamaServerSummarizer,
  DEFAULT_MINUTES_SUMMARY_MODEL,
  isPublishableMinutesSummary,
  MINUTES_SUMMARY_PROMPT_VERSION,
  summarizeMinutesGroup,
  type MinutesDocumentSummaryArtifact,
  type MinutesSummaryMember
} from "../minutes-summarization.js";
import {
  isOfficialAssemblyMinutesViewerUrl,
  type AssemblyMinutesTranscript
} from "../minutes-transcript.js";
import { readJsonFile, readPositiveInteger, writeJsonFile } from "../utils.js";
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
};

type SummaryState = {
  updatedAt: string;
  modelId: string;
  promptVersion: string;
  sourceKind: "official_minutes_transcript";
  documentsVisited: number;
  documentsCompleted: number;
  groupsSummarized: number;
  groupsFailed: number;
  remainingDocuments: number;
  membersPublished: number;
  mirroredDocuments: number;
  transcriptDocuments: number;
  summarizedDocuments: number;
  latestMirroredMeetingDate: string | null;
  latestSummarizedMeetingDate: string | null;
};

function loadConfig(): SummaryConfig {
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
    maxDocuments: readPositiveInteger("MINUTES_SUMMARY_MAX_DOCUMENTS", 1),
    maxGroups: readPositiveInteger("MINUTES_SUMMARY_MAX_GROUPS", 8),
    concurrency: Math.min(
      readPositiveInteger("MINUTES_SUMMARY_CONCURRENCY", 2),
      8
    ),
    requestTimeoutMs: readPositiveInteger(
      "MINUTES_SUMMARY_REQUEST_TIMEOUT_MS",
      60_000
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

function isCurrentSummaryArtifact(
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
    artifact.promptVersion === MINUTES_SUMMARY_PROMPT_VERSION &&
    artifact.summaries.every((summary) =>
      isPublishableMinutesSummary(summary.summary)
    )
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
  }
): Promise<AssemblyMinutesTranscript> {
  const payload = JSON.parse(
    await readFile(
      join(config.dataRepoDir, item.transcriptRelativePath),
      "utf8"
    )
  ) as AssemblyMinutesTranscript;
  if (
    payload.schemaVersion !== 1 ||
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
  const config = loadConfig();
  const generatedAt = new Date().toISOString();
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
  const candidateDocuments = documentIndex.items.filter(isTranscriptDocument);
  const artifactByDocumentId = new Map(
    (await loadAllArtifacts(config)).map((artifact) => [
      artifact.documentId,
      artifact
    ])
  );
  const pendingDocuments = candidateDocuments
    .filter(
      (item) =>
        !isCurrentSummaryArtifact(
          item,
          artifactByDocumentId.get(item.documentId),
          config
        )
    )
    .sort((left, right) =>
      right.publishedDate.localeCompare(left.publishedDate)
    )
    .slice(0, config.maxDocuments);
  const currentArtifacts = () =>
    candidateDocuments.flatMap((item) => {
      const artifact = artifactByDocumentId.get(item.documentId);
      return artifact?.sourceContentSha256 === item.transcriptContentSha256
        ? [artifact]
        : [];
    });
  if (pendingDocuments.length === 0) {
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
        modelId: config.modelId,
        promptVersion: MINUTES_SUMMARY_PROMPT_VERSION,
        sourceKind: "official_minutes_transcript",
        documentsVisited: 0,
        documentsCompleted: 0,
        groupsSummarized: 0,
        groupsFailed: 0,
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

  const summarize = createLlamaServerSummarizer({
    endpoint: config.endpoint,
    modelId: config.modelId,
    timeoutMs: config.requestTimeoutMs
  });
  let remainingGroupBudget = config.maxGroups;
  let groupsSummarized = 0;
  let groupsFailed = 0;
  let documentsCompleted = 0;

  for (const item of pendingDocuments) {
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
          isPublishableMinutesSummary(summary.summary)
        )
      : [];
    const completedGroupIds = new Set(
      summaries.map((summary) => summary.statementId)
    );

    const groupsToSummarize = groups
      .filter((group) => !completedGroupIds.has(group.groupId))
      .slice(0, remainingGroupBudget);
    remainingGroupBudget -= groupsToSummarize.length;
    const results = await mapWithConcurrency(
      groupsToSummarize,
      config.concurrency,
      async (group) => {
        try {
          return {
            group,
            summary: await summarizeMinutesGroup({
              group,
              summarize
            }),
            error: null
          };
        } catch (error) {
          return {
            group,
            summary: null,
            error
          };
        }
      }
    );

    for (const result of results) {
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
        groupsSummarized += 1;
        continue;
      }

      groupsFailed += 1;
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
      summaries
    };
    artifactByDocumentId.set(item.documentId, artifact);
    await writeJsonFile(
      join(config.dataRepoDir, artifactRelativePath(config, item.documentId)),
      artifact
    );

    if (remainingGroupBudget <= 0) {
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
    artifacts: candidateDocuments.flatMap((item) => {
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
    modelId: config.modelId,
    promptVersion: MINUTES_SUMMARY_PROMPT_VERSION,
    sourceKind: "official_minutes_transcript",
    documentsVisited: pendingDocuments.length,
    documentsCompleted,
    groupsSummarized,
    groupsFailed,
    membersPublished: memberExports.length,
    ...buildSummaryCoverage({
      documentIndex,
      candidateDocuments,
      artifactByDocumentId,
      config
    })
  };
  await writeJsonFile(join(config.dataRepoDir, config.statePath), state);
  process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);

  if (groupsFailed > 0 && groupsSummarized === 0) {
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void main();
}
