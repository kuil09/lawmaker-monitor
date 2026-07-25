import { access, readdir, readFile, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  memberActivityCalendarExportSchema,
  memberStatementSummariesExportSchema,
  memberStatementSummariesIndexExportSchema
} from "@lawmaker-monitor/schemas";

import {
  buildMemberStatementSummaryExports,
  buildMinutesSummaryGroups,
  createLlamaServerSummarizer,
  MINUTES_SUMMARY_PROMPT_VERSION,
  summarizeMinutesGroup,
  type MinutesDocumentSummaryArtifact,
  type MinutesSummaryMember
} from "../minutes-summarization.js";
import {
  isOfficialAssemblyMinutesViewerUrl,
  type AssemblyMinutesTranscript
} from "../minutes-transcript.js";
import { readJsonFile, writeJsonFile } from "../utils.js";

import type {
  MirroredDocumentIndex,
  MirroredDocumentIndexItem
} from "../document-mirror.js";

type SummaryConfig = {
  dataRepoDir: string;
  documentIndexPath: string;
  memberCalendarPath: string;
  artifactDirectory: string;
  memberExportDirectory: string;
  statePath: string;
  modelId: string;
  endpoint: string;
  maxDocuments: number;
  maxGroups: number;
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
};

function readPositiveInteger(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

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
    artifactDirectory:
      process.env.MINUTES_SUMMARY_ARTIFACT_DIR?.trim() ||
      "curated/minutes_summaries/documents",
    memberExportDirectory:
      process.env.MINUTES_SUMMARY_EXPORT_DIR?.trim() ||
      "exports/member_statement_summaries",
    statePath:
      process.env.MINUTES_SUMMARY_STATE_PATH?.trim() ||
      "manifests/minutes_summary_state.json",
    modelId:
      process.env.MINUTES_SUMMARY_MODEL?.trim() || "Qwen/Qwen3-1.7B-GGUF:Q8_0",
    endpoint:
      process.env.MINUTES_SUMMARY_ENDPOINT?.trim() ||
      "http://127.0.0.1:8080/v1/chat/completions",
    maxDocuments: readPositiveInteger("MINUTES_SUMMARY_MAX_DOCUMENTS", 8),
    maxGroups: readPositiveInteger("MINUTES_SUMMARY_MAX_GROUPS", 64)
  };
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

async function retrySummary<T>(task: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
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
    .filter((item) => {
      const artifact = artifactByDocumentId.get(item.documentId);
      return !(
        artifact?.complete &&
        artifact.sourceKind === "official_minutes_transcript" &&
        artifact.sourceContentSha256 === item.transcriptContentSha256 &&
        artifact.modelId === config.modelId &&
        artifact.promptVersion === MINUTES_SUMMARY_PROMPT_VERSION
      );
    })
    .sort((left, right) =>
      right.publishedDate.localeCompare(left.publishedDate)
    )
    .slice(0, config.maxDocuments);
  if (pendingDocuments.length === 0) {
    try {
      await access(
        join(config.dataRepoDir, config.memberExportDirectory, "index.json")
      );
      process.stdout.write("No pending minutes transcripts to summarize.\n");
      return;
    } catch {
      process.stdout.write(
        "No pending transcripts; rebuilding the missing summary index.\n"
      );
    }
  }

  const summarize = createLlamaServerSummarizer({
    endpoint: config.endpoint,
    modelId: config.modelId
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
    const summaries = canReuseExisting ? [...existingArtifact.summaries] : [];
    const completedGroupIds = new Set(
      summaries.map((summary) => summary.statementId)
    );

    for (const group of groups) {
      if (remainingGroupBudget <= 0) {
        break;
      }
      if (completedGroupIds.has(group.groupId)) {
        continue;
      }

      remainingGroupBudget -= 1;
      try {
        const summary = await retrySummary(() =>
          summarizeMinutesGroup({
            group,
            summarize
          })
        );
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
          evidenceExcerpt: group.text.replace(/\s+/g, " ").slice(0, 280),
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
      } catch (error) {
        groupsFailed += 1;
        process.stderr.write(
          `Could not summarize ${item.documentId}/${group.groupId}: ${
            error instanceof Error ? error.message : String(error)
          }\n`
        );
      }
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
    artifacts: [...artifactByDocumentId.values()]
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

  const remainingDocuments = candidateDocuments.filter((item) => {
    const artifact = artifactByDocumentId.get(item.documentId);
    return !(
      artifact?.complete &&
      artifact.sourceKind === "official_minutes_transcript" &&
      artifact.sourceContentSha256 === item.transcriptContentSha256 &&
      artifact.modelId === config.modelId &&
      artifact.promptVersion === MINUTES_SUMMARY_PROMPT_VERSION
    );
  }).length;
  const state: SummaryState = {
    updatedAt: generatedAt,
    modelId: config.modelId,
    promptVersion: MINUTES_SUMMARY_PROMPT_VERSION,
    sourceKind: "official_minutes_transcript",
    documentsVisited: pendingDocuments.length,
    documentsCompleted,
    groupsSummarized,
    groupsFailed,
    remainingDocuments,
    membersPublished: memberExports.length
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
