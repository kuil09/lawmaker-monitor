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

export const DEFAULT_MINUTES_SUMMARY_MODEL =
  "LGAI-EXAONE/EXAONE-4.0-1.2B-GGUF:Q8_0";
export const MINUTES_SUMMARY_PROMPT_VERSION = "minutes-summary-v5";

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
  maxCharacters = 5_000
): string[] {
  const normalizedMaxCharacters = Math.max(1, Math.floor(maxCharacters));
  const normalizedText = value
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .join("\n");
  const chunks: string[] = [];
  for (
    let offset = 0;
    offset < normalizedText.length;
    offset += normalizedMaxCharacters
  ) {
    chunks.push(normalizedText.slice(offset, offset + normalizedMaxCharacters));
  }

  return chunks;
}

export function sanitizeModelSummary(
  value: string,
  options?: {
    allowTrailingFragment?: boolean;
    sourceText?: string;
  }
): string {
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

  if (
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(normalized)
  ) {
    throw new Error("The local model returned a non-Korean CJK script.");
  }

  if (/[a-z]/.test(normalized)) {
    throw new Error("The local model returned lowercase Latin text.");
  }

  if (options?.sourceText) {
    const sourceLatinTokens = new Set(
      options.sourceText.match(/[A-Z][A-Z0-9]*(?:[&+._-][A-Z0-9]+)*/g) ?? []
    );
    const unexpectedLatinTokens = (
      normalized.match(/[A-Z][A-Z0-9]*(?:[&+._-][A-Z0-9]+)*/g) ?? []
    ).filter((token) => !sourceLatinTokens.has(token));
    if (unexpectedLatinTokens.length > 0) {
      throw new Error(
        "The local model introduced Latin text not in the source."
      );
    }
  }

  const hangulCount = normalized.match(/[가-힣]/g)?.length ?? 0;
  const letterCount = normalized.match(/\p{L}/gu)?.length ?? 0;
  if (hangulCount < 10 || hangulCount / Math.max(letterCount, 1) < 0.5) {
    throw new Error("The local model returned insufficient Korean text.");
  }

  const endsWithEllipsis = /(?:\.{2,}|…+)$/.test(normalized);
  let completedSummary =
    !endsWithEllipsis && /[.!?]$/.test(normalized)
      ? normalized
      : !endsWithEllipsis && /(?:다|요|함|임|됨|음)$/.test(normalized)
        ? `${normalized}.`
        : null;
  if (!completedSummary && options?.allowTrailingFragment) {
    const withoutTrailingEllipsis = normalized
      .replace(/\s*(?:\.{2,}|…+)$/, "")
      .trim();
    const finalBoundary = Math.max(
      withoutTrailingEllipsis.lastIndexOf("."),
      withoutTrailingEllipsis.lastIndexOf("!"),
      withoutTrailingEllipsis.lastIndexOf("?")
    );
    if (finalBoundary >= 9) {
      completedSummary = withoutTrailingEllipsis
        .slice(0, finalBoundary + 1)
        .trim();
    }
  }
  if (!completedSummary) {
    throw new Error("The local model returned an unfinished summary.");
  }

  if (completedSummary.length > 600) {
    throw new Error("The local model returned an overlong summary.");
  }

  return completedSummary;
}

export function isPublishableMinutesSummary(value: string): boolean {
  try {
    sanitizeModelSummary(value);
    return true;
  } catch {
    return false;
  }
}

export function buildMinutesSummaryPrompt(args: {
  group: MinutesSummaryGroup;
  text: string;
  partialSummaries?: string[];
}): string {
  const sourceLabel = args.partialSummaries?.length
    ? "부분 요약:"
    : "발언 원문:";
  const sourceText = args.partialSummaries?.length
    ? args.partialSummaries.map((summary) => `- ${summary}`).join("\n")
    : args.text;

  return [
    "/no_think",
    "다음은 대한민국 국회 회의록에서 특정 의원의 발언만 추출한 내용입니다.",
    `회의: ${args.group.meetingTitle} (${args.group.meetingDate})`,
    `안건: ${args.group.agendaTitle}`,
    `의안번호: ${args.group.billIds.join(", ") || "해당 없음"}`,
    `발언자: ${args.group.member.name}${args.group.speakerRole ? ` (${args.group.speakerRole})` : ""}`,
    "",
    sourceLabel,
    sourceText,
    "",
    "원문에 명시된 입장, 제안, 근거만 사용해 한국어 2~3문장으로 요약하세요.",
    "추측, 평가, 배경지식, 새로운 숫자를 추가하지 마세요.",
    "영어 일반 단어를 쓰거나 영어 단어에 한국어 조사를 붙이지 말고 자연스러운 한국어로 풀어 쓰세요.",
    "영문 알파벳은 원문에 실제로 나온 공식 대문자 약어 또는 고유명사에만 사용하세요.",
    "현대 한국어 문장으로 작성하고 한자, 중국어, 일본어를 섞지 마세요.",
    "각 문장은 완결된 종결어미와 문장부호로 끝내세요.",
    "제목이나 글머리표 없이 요약문만 출력하세요."
  ].join("\n");
}

export function createLlamaServerSummarizer(args: {
  endpoint: string;
  modelId: string;
  timeoutMs?: number;
}): SummarizeMinutesText {
  return async (input) => {
    let lastContent: string | null = null;
    let lastError: unknown;
    const timeoutMs = args.timeoutMs ?? 120_000;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
      const messages = [
        {
          role: "system",
          content:
            "대한민국 국회 회의록의 의원 발언을 제공된 원문만 사용해 자연스러운 현대 한국어로 충실히 요약하세요. 영어 일반 단어를 섞지 말고, 영문 알파벳은 원문에 실제로 나온 공식 대문자 약어나 고유명사에만 사용하세요. 발언자나 원문에 없는 사실을 추론하지 마세요."
        },
        {
          role: "user",
          content: [
            buildMinutesSummaryPrompt(input),
            attempt > 0
              ? "이전 시도는 형식을 충족하지 못했습니다. 영어 일반 단어와 원문에 없는 영문 표현을 모두 제거하고, 반드시 자연스러운 한국어 완결문으로 끝내세요."
              : ""
          ]
            .filter(Boolean)
            .join("\n\n")
        }
      ];

      try {
        const response = await fetch(args.endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            model: args.modelId,
            messages,
            temperature: 0.1,
            max_tokens: attempt === 0 ? 384 : 512,
            stream: false,
            chat_template_kwargs: {
              enable_thinking: false
            }
          }),
          signal: controller.signal
        });
        if (!response.ok) {
          const responseBody = (await response.text()).replace(/\s+/g, " ");
          throw new Error(
            `Local model request failed: ${response.status} ${response.statusText}${
              responseBody ? ` — ${responseBody.slice(0, 500)}` : ""
            }`
          );
        }

        const payload = (await response.json()) as {
          choices?: Array<{
            message?: {
              content?: unknown;
            };
            finish_reason?: unknown;
          }>;
        };
        const content = payload.choices?.[0]?.message?.content;
        if (typeof content !== "string") {
          throw new Error("Local model response did not contain text.");
        }
        lastContent = content;

        if (payload.choices?.[0]?.finish_reason === "length") {
          throw new Error("The local model reached its output token limit.");
        }

        return sanitizeModelSummary(content, {
          sourceText: [
            input.group.meetingTitle,
            input.group.agendaTitle,
            input.text
          ].join("\n")
        });
      } catch (error) {
        lastError = controller.signal.aborted
          ? new Error(`Local model request timed out after ${timeoutMs}ms.`)
          : error;
      } finally {
        clearTimeout(timeoutHandle);
      }
    }

    if (lastContent) {
      try {
        return sanitizeModelSummary(lastContent, {
          allowTrailingFragment: true,
          sourceText: [
            input.group.meetingTitle,
            input.group.agendaTitle,
            input.text
          ].join("\n")
        });
      } catch {
        // Fall through to the exact-source fallback for already concise text.
      }
    }

    const conciseSource = input.text.replace(/\s+/g, " ").trim();
    if (conciseSource.length <= 240) {
      try {
        return sanitizeModelSummary(conciseSource, {
          sourceText: conciseSource
        });
      } catch {
        // Preserve the model error when the source is not publishable as-is.
      }
    }

    throw (
      lastError ??
      new Error("The local model did not return a valid Korean summary.")
    );
  };
}

function groupPartialSummaries(
  summaries: string[],
  maxCharacters = 5_000
): string[][] {
  const batches: string[][] = [];
  let currentBatch: string[] = [];
  let currentLength = 0;

  for (const summary of summaries) {
    const addedLength = summary.length + (currentBatch.length > 0 ? 1 : 0);
    if (
      currentBatch.length > 0 &&
      currentLength + addedLength > maxCharacters
    ) {
      batches.push(currentBatch);
      currentBatch = [];
      currentLength = 0;
    }
    currentBatch.push(summary);
    currentLength += summary.length + (currentBatch.length > 1 ? 1 : 0);
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
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

  let partialSummaries: string[] = [];
  for (const chunk of chunks) {
    partialSummaries.push(
      await args.summarize({
        group: args.group,
        text: chunk
      })
    );
  }

  while (partialSummaries.join("\n").length > 5_000) {
    const reducedSummaries: string[] = [];
    for (const batch of groupPartialSummaries(partialSummaries)) {
      reducedSummaries.push(
        await args.summarize({
          group: args.group,
          text: batch.join("\n"),
          partialSummaries: batch
        })
      );
    }
    partialSummaries = reducedSummaries;
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
      artifact.modelId !== args.modelId ||
      artifact.promptVersion !== args.promptVersion ||
      !isOfficialAssemblyMinutesViewerUrl(artifact.sourceUrl) ||
      !artifact.sourceTranscriptPath.endsWith(".transcript.json")
    ) {
      continue;
    }

    for (const summary of artifact.summaries) {
      if (!isPublishableMinutesSummary(summary.summary)) {
        continue;
      }
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
