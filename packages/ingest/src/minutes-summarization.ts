import { isOfficialAssemblyMinutesViewerUrl } from "./minutes-transcript.js";
import { sha256 } from "./utils.js";

import type {
  AssemblyMinutesAgendaItem,
  AssemblyMinutesStatement,
  AssemblyMinutesTranscript
} from "./minutes-transcript.js";
import type {
  MemberStatementSummariesExport,
  MemberStatementSummaryItem
} from "@lawmaker-monitor/schemas";

export const MINUTES_SUMMARY_PROMPT_VERSION = "minutes-summary-v4";

export type MinutesSummaryMember = {
  memberId: string;
  name: string;
  party: string;
  officialProfileUrl?: string | null;
};

export type MinutesSummaryGroup = {
  groupId: string;
  member: MinutesSummaryMember;
  documentId: string;
  meetingTitle: string;
  meetingDate: string;
  committeeName: string | null;
  agendaTitle: string;
  billIds: string[];
  speakerRole: string | null;
  text: string;
  statementIds: string[];
  sourceUrl: string;
  sourceFragment: string;
};

export type MinutesDocumentMemberSummary = MemberStatementSummaryItem & {
  memberId: string;
  name: string;
  party: string;
};

export type MinutesDocumentSummaryArtifact = {
  schemaVersion: 1;
  sourceKind?: "official_minutes_transcript";
  generatedAt: string;
  documentId: string;
  sourceContentSha256: string;
  sourceTranscriptPath: string;
  sourceDocumentPath: string;
  sourceUrl: string;
  modelId: string;
  promptVersion: string;
  summaryGroupCount: number;
  complete: boolean;
  summaries: MinutesDocumentMemberSummary[];
};

export type SummarizeMinutesText = (input: {
  group: MinutesSummaryGroup;
  text: string;
  partialSummaries?: string[];
}) => Promise<string>;

function normalizeMemberName(value: string): string {
  return value.replace(/\s+/g, "").trim();
}

function normalizeOfficialProfileUrl(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value, "https://www.assembly.go.kr");
    return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

function normalizeAgendaReference(value: string): string {
  return value.normalize("NFKC").replace(/[^\p{L}\p{N}]/gu, "");
}

function buildAgendaReferenceKeys(title: string): string[] {
  const subject = title
    .replace(/^\s*\d+\.\s*/, "")
    .split("(")[0]
    ?.trim();
  if (!subject) {
    return [];
  }

  return [
    subject,
    subject.replace(/(?:일부|전부)?개정법률안$/, "").trim(),
    subject.replace(/법률안$/, "").trim()
  ]
    .map(normalizeAgendaReference)
    .filter(
      (value, index, values) =>
        value.length >= 4 && values.indexOf(value) === index
    );
}

function isPresidingOfficerStatement(statement: AssemblyMinutesStatement) {
  const normalizedRole = statement.speakerRole?.replace(/\s+/g, "") ?? "";
  return normalizedRole === "의장" || normalizedRole === "부의장";
}

function isProceduralStatement(statement: AssemblyMinutesStatement): boolean {
  const text = statement.paragraphs.join(" ").replace(/\s+/g, " ").trim();
  if (text.length >= 80) {
    return false;
  }

  return [
    /개의를\s*선언/,
    /산회를\s*선포/,
    /정회를\s*(?:선포|하겠)/,
    /회의를\s*속개/,
    /(?:안건|의사일정).{0,20}상정/,
    /법안을.{0,20}상정/,
    /가결되었음을\s*선포/,
    /의결되었음을\s*선포/
  ].some((pattern) => pattern.test(text));
}

export function resolveStatementAgendaItem(args: {
  statement: AssemblyMinutesStatement;
  agendaItems: AssemblyMinutesAgendaItem[];
}): AssemblyMinutesAgendaItem | null {
  if (
    isPresidingOfficerStatement(args.statement) ||
    isProceduralStatement(args.statement)
  ) {
    return null;
  }

  const sourceText = normalizeAgendaReference(
    args.statement.paragraphs.join(" ")
  );
  const matches = args.agendaItems
    .filter((agenda) => agenda.billIds.length > 0)
    .map((agenda) => {
      const positions = buildAgendaReferenceKeys(agenda.title)
        .map((key) => sourceText.indexOf(key))
        .filter((position) => position >= 0);
      return {
        agenda,
        position: positions.length > 0 ? Math.min(...positions) : -1
      };
    })
    .filter((match) => match.position >= 0)
    .sort((left, right) => left.position - right.position);

  if (matches.length === 1) {
    return matches[0]?.agenda ?? null;
  }

  const normalizedRole = args.statement.speakerRole?.replace(/\s+/g, "") ?? "";
  const first = matches[0];
  const second = matches[1];
  if (
    normalizedRole === "의원" &&
    first &&
    second &&
    first.position <= 200 &&
    second.position - first.position >= 100
  ) {
    return first.agenda;
  }

  if (matches.length === 0) {
    const declaredAgenda = args.agendaItems.find(
      (agenda) => agenda.agendaItemId === args.statement.agendaItemId
    );
    if (declaredAgenda) {
      return declaredAgenda;
    }

    if (
      args.statement.agendaItemId === "item0" &&
      /(?:의원|위원|위원장|위원장대리)$/.test(normalizedRole)
    ) {
      return {
        agendaItemId: "item0",
        title: "회의 일반 발언",
        billIds: [],
        billDetailUrl: null
      };
    }
  }

  return null;
}

function buildUniqueMemberLookup(
  members: MinutesSummaryMember[]
): Map<string, MinutesSummaryMember> {
  const grouped = new Map<string, MinutesSummaryMember[]>();

  for (const member of members) {
    const key = normalizeMemberName(member.name);
    grouped.set(key, [...(grouped.get(key) ?? []), member]);
  }

  return new Map(
    [...grouped.entries()].flatMap(([name, matches]) =>
      matches.length === 1 && matches[0] ? [[name, matches[0]]] : []
    )
  );
}

function buildUniqueProfileLookup(
  members: MinutesSummaryMember[]
): Map<string, MinutesSummaryMember> {
  const grouped = new Map<string, MinutesSummaryMember[]>();

  for (const member of members) {
    const key = normalizeOfficialProfileUrl(member.officialProfileUrl);
    if (!key) {
      continue;
    }
    grouped.set(key, [...(grouped.get(key) ?? []), member]);
  }

  return new Map(
    [...grouped.entries()].flatMap(([profileUrl, matches]) =>
      matches.length === 1 && matches[0] ? [[profileUrl, matches[0]]] : []
    )
  );
}

function resolveStatementMember(args: {
  statement: AssemblyMinutesStatement;
  memberByName: Map<string, MinutesSummaryMember>;
  memberByProfileUrl: Map<string, MinutesSummaryMember>;
}): MinutesSummaryMember | null {
  const profileKey = normalizeOfficialProfileUrl(
    args.statement.officialProfileUrl
  );
  if (profileKey) {
    const profileMatch = args.memberByProfileUrl.get(profileKey);
    if (profileMatch) {
      return profileMatch;
    }
  }

  return (
    args.memberByName.get(normalizeMemberName(args.statement.speakerName)) ??
    null
  );
}

export function buildMinutesSummaryGroups(args: {
  transcript: AssemblyMinutesTranscript;
  members: MinutesSummaryMember[];
}): MinutesSummaryGroup[] {
  if (!isOfficialAssemblyMinutesViewerUrl(args.transcript.sourceUrl)) {
    throw new Error(
      `Minutes summaries require an individual official minutes document URL: ${args.transcript.sourceUrl}`
    );
  }

  const memberByName = buildUniqueMemberLookup(args.members);
  const memberByProfileUrl = buildUniqueProfileLookup(args.members);
  const grouped = new Map<
    string,
    {
      group: MinutesSummaryGroup;
      paragraphs: string[];
    }
  >();

  for (const statement of args.transcript.statements) {
    const agenda = resolveStatementAgendaItem({
      statement,
      agendaItems: args.transcript.agendaItems
    });
    if (!agenda) {
      continue;
    }

    const member = resolveStatementMember({
      statement,
      memberByName,
      memberByProfileUrl
    });
    if (!member) {
      continue;
    }

    const groupId = sha256(
      [args.transcript.documentId, agenda.agendaItemId, member.memberId].join(
        ":"
      )
    );
    const existing = grouped.get(groupId);
    if (existing) {
      existing.paragraphs.push(...statement.paragraphs);
      existing.group.statementIds.push(statement.statementId);
      continue;
    }

    grouped.set(groupId, {
      group: {
        groupId,
        member,
        documentId: args.transcript.documentId,
        meetingTitle: args.transcript.meetingTitle,
        meetingDate: args.transcript.meetingDate,
        committeeName: args.transcript.committeeName,
        agendaTitle: agenda.title,
        billIds: agenda.billIds,
        speakerRole: statement.speakerRole,
        text: "",
        statementIds: [statement.statementId],
        sourceUrl: args.transcript.sourceUrl,
        sourceFragment: statement.sourceFragment
      },
      paragraphs: [...statement.paragraphs]
    });
  }

  return [...grouped.values()]
    .map(({ group, paragraphs }) => ({
      ...group,
      text: paragraphs.join("\n").trim()
    }))
    .filter((group) => group.text.length >= 20)
    .sort((left, right) => {
      const byMember = left.member.name.localeCompare(
        right.member.name,
        "ko-KR"
      );
      return byMember !== 0
        ? byMember
        : left.agendaTitle.localeCompare(right.agendaTitle, "ko-KR");
    });
}

export function chunkMinutesText(
  value: string,
  maxCharacters = 5_000,
  maxChunks = 4
): string[] {
  const normalizedMaxChunks = Math.max(1, Math.floor(maxChunks));
  const normalizedText = value
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .join("\n");
  const effectiveMaxCharacters = Math.max(
    maxCharacters,
    Math.ceil(normalizedText.length / normalizedMaxChunks)
  );
  const chunks: string[] = [];
  for (
    let offset = 0;
    offset < normalizedText.length;
    offset += effectiveMaxCharacters
  ) {
    chunks.push(normalizedText.slice(offset, offset + effectiveMaxCharacters));
  }

  return chunks;
}

export function sanitizeModelSummary(value: string): string {
  const withoutThinking = value
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\/?think>/gi, "")
    .trim();
  const normalized = withoutThinking
    .replace(/^```(?:text|markdown)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/^(?:요약|답변)\s*[:：]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.length < 10) {
    throw new Error("The local model returned an empty or unusable summary.");
  }

  return normalized.slice(0, 600);
}

export function buildMinutesSummaryPrompt(args: {
  group: MinutesSummaryGroup;
  text: string;
  partialSummaries?: string[];
}): string {
  const partialContext = args.partialSummaries?.length
    ? `부분 요약:\n${args.partialSummaries.map((summary) => `- ${summary}`).join("\n")}\n\n`
    : "";

  return [
    "/no_think",
    "다음은 대한민국 국회 회의록에서 특정 의원의 발언만 추출한 내용입니다.",
    `회의: ${args.group.meetingTitle} (${args.group.meetingDate})`,
    `안건: ${args.group.agendaTitle}`,
    `의안번호: ${args.group.billIds.join(", ") || "해당 없음"}`,
    `발언자: ${args.group.member.name}${args.group.speakerRole ? ` (${args.group.speakerRole})` : ""}`,
    "",
    partialContext,
    "발언 원문:",
    args.text,
    "",
    "원문에 명시된 입장, 제안, 근거만 사용해 한국어 2~3문장으로 요약하세요.",
    "추측, 평가, 배경지식, 새로운 숫자를 추가하지 마세요.",
    "제목이나 글머리표 없이 요약문만 출력하세요."
  ].join("\n");
}

export function createLlamaServerSummarizer(args: {
  endpoint: string;
  modelId: string;
  timeoutMs?: number;
}): SummarizeMinutesText {
  return async (input) => {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(
      () => controller.abort(),
      args.timeoutMs ?? 120_000
    );

    try {
      const response = await fetch(args.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: args.modelId,
          messages: [
            {
              role: "system",
              content:
                "You faithfully summarize Korean National Assembly statements using only the supplied text. Never infer speaker identity or unsupported facts."
            },
            {
              role: "user",
              content: buildMinutesSummaryPrompt(input)
            }
          ],
          temperature: 0.1,
          max_tokens: 220,
          stream: false,
          chat_template_kwargs: {
            enable_thinking: false
          }
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(
          `Local model request failed: ${response.status} ${response.statusText}`
        );
      }

      const payload = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: unknown;
          };
        }>;
      };
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new Error("Local model response did not contain text.");
      }

      return sanitizeModelSummary(content);
    } finally {
      clearTimeout(timeoutHandle);
    }
  };
}

export async function summarizeMinutesGroup(args: {
  group: MinutesSummaryGroup;
  summarize: SummarizeMinutesText;
}): Promise<string> {
  const chunks = chunkMinutesText(args.group.text);
  if (chunks.length === 0) {
    throw new Error(`Summary group ${args.group.groupId} has no source text.`);
  }

  if (chunks.length === 1 && chunks[0]) {
    return args.summarize({
      group: args.group,
      text: chunks[0]
    });
  }

  const partialSummaries: string[] = [];
  for (const chunk of chunks) {
    partialSummaries.push(
      await args.summarize({
        group: args.group,
        text: chunk
      })
    );
  }

  return args.summarize({
    group: args.group,
    text: partialSummaries.join("\n"),
    partialSummaries
  });
}

export function buildMemberStatementSummaryExports(args: {
  generatedAt: string;
  assemblyNo: number;
  assemblyLabel: string;
  modelId: string;
  promptVersion: string;
  members: MinutesSummaryMember[];
  artifacts: MinutesDocumentSummaryArtifact[];
}): MemberStatementSummariesExport[] {
  const summariesByMemberId = new Map<string, MemberStatementSummaryItem[]>();

  for (const artifact of args.artifacts) {
    if (
      !isOfficialAssemblyMinutesViewerUrl(artifact.sourceUrl) ||
      !artifact.sourceTranscriptPath.endsWith(".transcript.json")
    ) {
      continue;
    }

    for (const summary of artifact.summaries) {
      summariesByMemberId.set(summary.memberId, [
        ...(summariesByMemberId.get(summary.memberId) ?? []),
        {
          statementId: summary.statementId,
          documentId: summary.documentId,
          meetingTitle: summary.meetingTitle,
          meetingDate: summary.meetingDate,
          committeeName: summary.committeeName,
          agendaTitle: summary.agendaTitle,
          billIds: summary.billIds,
          speakerRole: summary.speakerRole,
          summary: summary.summary,
          evidenceExcerpt: summary.evidenceExcerpt,
          sourceUrl: summary.sourceUrl,
          sourceFragment: summary.sourceFragment,
          sourceDocumentPath: summary.sourceDocumentPath,
          sourceContentSha256: summary.sourceContentSha256,
          sourceKind: "official_minutes_transcript"
        }
      ]);
    }
  }

  return args.members.flatMap((member) => {
    const summaries = summariesByMemberId.get(member.memberId) ?? [];
    if (summaries.length === 0) {
      return [];
    }

    return [
      {
        generatedAt: args.generatedAt,
        assemblyNo: args.assemblyNo,
        assemblyLabel: args.assemblyLabel,
        memberId: member.memberId,
        name: member.name,
        party: member.party,
        modelId: args.modelId,
        promptVersion: args.promptVersion,
        summaries: summaries.sort((left, right) => {
          const byDate = right.meetingDate.localeCompare(left.meetingDate);
          return byDate !== 0
            ? byDate
            : left.agendaTitle.localeCompare(right.agendaTitle, "ko-KR");
        })
      }
    ];
  });
}
