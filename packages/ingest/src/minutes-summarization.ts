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
export const MINUTES_SUMMARY_PROMPT_VERSION = "minutes-summary-v6-extractive";
const MAX_MINUTES_SUMMARY_GROUP_CHARACTERS = 800;
const MAX_INTERVENING_STATEMENTS = 8;

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
    Array<{
      group: MinutesSummaryGroup;
      paragraphs: string[];
      characterCount: number;
      lastStatementIndex: number;
    }>
  >();

  for (const [
    statementIndex,
    statement
  ] of args.transcript.statements.entries()) {
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

    const baseGroupKey = [
      args.transcript.documentId,
      agenda.agendaItemId,
      member.memberId
    ].join(":");
    const segments = grouped.get(baseGroupKey) ?? [];
    const statementCharacterCount = statement.paragraphs.reduce(
      (total, paragraph) => total + paragraph.length + 1,
      0
    );
    const currentSegment = segments.at(-1);
    if (
      currentSegment &&
      statementIndex - currentSegment.lastStatementIndex <=
        MAX_INTERVENING_STATEMENTS &&
      currentSegment.characterCount + statementCharacterCount <=
        MAX_MINUTES_SUMMARY_GROUP_CHARACTERS
    ) {
      currentSegment.paragraphs.push(...statement.paragraphs);
      currentSegment.group.statementIds.push(statement.statementId);
      currentSegment.characterCount += statementCharacterCount;
      currentSegment.lastStatementIndex = statementIndex;
      continue;
    }

    const segmentIndex = segments.length;
    const groupId = sha256(`${baseGroupKey}:segment:${segmentIndex}`);
    segments.push({
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
      paragraphs: [...statement.paragraphs],
      characterCount: statementCharacterCount,
      lastStatementIndex: statementIndex
    });
    grouped.set(baseGroupKey, segments);
  }

  return [...grouped.values()]
    .flat()
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

function normalizeEvidenceText(value: string): string {
  return value.normalize("NFKC").replace(/[^\p{L}\p{N}]/gu, "");
}

function buildCharacterBigrams(value: string): string[] {
  const normalized = normalizeEvidenceText(value);
  const bigrams: string[] = [];
  for (let index = 0; index < normalized.length - 1; index += 1) {
    bigrams.push(normalized.slice(index, index + 2));
  }
  return bigrams;
}

function extractNumericClaims(value: string): string[] {
  return (
    value.match(
      /\d+(?:[,.]\d+)*(?:\s*(?:년|월|일|시|분|초|살|명|건|회|차|억|만|천|%))?/g
    ) ?? []
  ).map((claim) => claim.replace(/\s+/g, ""));
}

function extractRoleLinkedNames(value: string): string[] {
  const names: string[] = [];
  const pattern =
    /([가-힣]{2,8})\s+(?:전\s+)?(?:서울)?(?:시장|대통령후보|대통령|국회의원|의원|위원|장관|차관|검사장|차장검사|검사|판사|대법관|처장|조정관|당협위원장)/g;
  for (const match of value.matchAll(pattern)) {
    const name = match[1];
    if (name) {
      names.push(name);
    }
  }
  return names;
}

function extractInstitutionTokens(value: string): string[] {
  return value
    .split(/[\s,.;:!?()[\]{}"'“”‘’]+/)
    .map((token) =>
      token.replace(
        /(?:에게서|에게|에서|으로|까지|부터|보다|처럼|에|의|은|는|이|가|을|를|도|와|과|만|로)+$/g,
        ""
      )
    )
    .filter((token) =>
      /(?:위원회|법사위|당협위|지검|대법원|법원|검찰|경찰|선관위|법무부)$/.test(
        token
      )
    );
}

export function assertModelSummarySourceFidelity(args: {
  summary: string;
  sourceText: string;
  allowedNames?: string[];
}): void {
  const normalizedSource = normalizeEvidenceText(args.sourceText);
  const sourceNumbers = new Set(extractNumericClaims(args.sourceText));
  const unsupportedNumbers = extractNumericClaims(args.summary).filter(
    (claim) => !sourceNumbers.has(claim)
  );
  if (unsupportedNumbers.length > 0) {
    throw new Error(
      `The local model introduced numeric claims not in the source: ${unsupportedNumbers.join(", ")}`
    );
  }

  const sourceNames = new Set([
    ...extractRoleLinkedNames(args.sourceText),
    ...(args.allowedNames ?? [])
  ]);
  const unsupportedNames = extractRoleLinkedNames(args.summary).filter(
    (name) => !sourceNames.has(name)
  );
  if (unsupportedNames.length > 0) {
    throw new Error(
      `The local model introduced named people not in the source: ${unsupportedNames.join(", ")}`
    );
  }

  const unsupportedInstitutions = extractInstitutionTokens(args.summary).filter(
    (institution) =>
      !normalizedSource.includes(normalizeEvidenceText(institution))
  );
  if (unsupportedInstitutions.length > 0) {
    throw new Error(
      `The local model introduced institutions not in the source: ${unsupportedInstitutions.join(", ")}`
    );
  }

  const sourceBigrams = new Set(buildCharacterBigrams(args.sourceText));
  for (const sentence of args.summary.split(/(?<=[.!?])\s+/)) {
    const bigrams = buildCharacterBigrams(sentence);
    if (bigrams.length < 12) {
      continue;
    }
    const supported = bigrams.filter((bigram) =>
      sourceBigrams.has(bigram)
    ).length;
    if (supported / bigrams.length < 0.62) {
      throw new Error(
        "The local model returned a sentence with insufficient source overlap."
      );
    }
  }
}

function splitExtractiveCandidates(value: string): string[] {
  return value
    .replace(
      /\((?:영상자료를 보며|발언시간 초과로 마이크 중단|마이크 중단 이후 계속 발언한 부분)\)/g,
      " "
    )
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter(
      (sentence) =>
        sentence.length >= 10 &&
        sentence.length <= 260 &&
        !/^(?:이상입니다|감사합니다|다음 것 보여 주세요|PPT 좀 띄워 주세요)[.!?]?$/.test(
          sentence
        )
    );
}

function scoreExtractiveCandidate(
  sentence: string,
  modelHint: string | undefined
): number {
  const positionKeywords =
    sentence.match(
      /요구|촉구|제안|강조|비판|지적|반대|찬성|필요|문제|조사|보고|개선|신속|기각|위반|수사|분리/g
    )?.length ?? 0;
  const lengthScore = sentence.length >= 45 && sentence.length <= 190 ? 2 : 0;
  if (!modelHint) {
    return positionKeywords * 2 + lengthScore;
  }

  const hintBigrams = new Set(buildCharacterBigrams(modelHint));
  const sentenceBigrams = buildCharacterBigrams(sentence);
  const overlap =
    sentenceBigrams.length > 0
      ? sentenceBigrams.filter((bigram) => hintBigrams.has(bigram)).length /
        sentenceBigrams.length
      : 0;
  return positionKeywords * 2 + lengthScore + overlap * 10;
}

export function buildExtractiveMinutesSummary(
  sourceText: string,
  modelHint?: string
): string {
  const candidates = splitExtractiveCandidates(sourceText);
  if (candidates.length === 0) {
    throw new Error("The source did not contain a publishable sentence.");
  }

  const ranked = candidates
    .map((sentence, index) => ({
      sentence,
      index,
      score: scoreExtractiveCandidate(sentence, modelHint)
    }))
    .sort(
      (left, right) => right.score - left.score || left.index - right.index
    );
  const selected = ranked
    .slice(0, Math.min(3, ranked.length))
    .sort((left, right) => left.index - right.index);
  const summaryParts: string[] = [];
  let totalLength = 0;

  for (const item of selected) {
    const sentence = /[.!?]$/.test(item.sentence)
      ? item.sentence
      : `${item.sentence}.`;
    const addedLength = sentence.length + (summaryParts.length > 0 ? 1 : 0);
    if (totalLength + addedLength > 600) {
      continue;
    }
    summaryParts.push(sentence);
    totalLength += addedLength;
  }

  if (summaryParts.length === 0) {
    throw new Error("The source sentences exceeded the publication boundary.");
  }

  return summaryParts.join(" ");
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
    "원문 문장의 핵심 단어, 고유명사, 수치, 기관, 인과관계와 긍정·부정 방향을 바꾸지 마세요.",
    "확신할 수 없는 내용은 추론하거나 보완하지 말고 원문 표현을 그대로 사용하세요.",
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

        const sourceText = [
          input.group.member.name,
          input.group.meetingTitle,
          input.group.agendaTitle,
          input.text
        ].join("\n");
        const sanitized = sanitizeModelSummary(content, { sourceText });
        assertModelSummarySourceFidelity({
          summary: sanitized,
          sourceText,
          allowedNames: [input.group.member.name]
        });
        return buildExtractiveMinutesSummary(input.text, sanitized);
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
        const sourceText = [
          input.group.member.name,
          input.group.meetingTitle,
          input.group.agendaTitle,
          input.text
        ].join("\n");
        const sanitized = sanitizeModelSummary(lastContent, {
          allowTrailingFragment: true,
          sourceText
        });
        assertModelSummarySourceFidelity({
          summary: sanitized,
          sourceText,
          allowedNames: [input.group.member.name]
        });
        return buildExtractiveMinutesSummary(input.text, sanitized);
      } catch {
        // Fall through to the source-only extractive fallback.
      }
    }

    try {
      return buildExtractiveMinutesSummary(input.text);
    } catch {
      // Preserve the model error when the source has no safe extractive result.
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
