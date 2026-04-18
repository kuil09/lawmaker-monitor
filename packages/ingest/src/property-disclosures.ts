import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { propertyDisclosureOverrides } from "./property-disclosure-overrides.js";
import { mapWithConcurrency, readJsonFile, sha256 } from "./utils.js";

import type {
  MirroredDocumentIndex,
  MirroredDocumentMetadata
} from "./document-mirror.js";
import type { MemberTenureIndex, MemberTenurePeriod } from "./tenure.js";
import type {
  MemberAssetsHistoryExport,
  MemberAssetsIndexExport,
  MemberRecord
} from "@lawmaker-monitor/schemas";

type PdfTextToken = {
  str: string;
  transform?: number[];
  width?: number;
};

type PdfLine = {
  pageNumber: number;
  text: string;
};

type ParsedDisclosureRecordBlock = {
  disclosureName: string;
  officeTitle: string | null;
  pageStart: number;
  pageEnd: number;
  lines: string[];
};

type ParsedAmountTail = {
  detailText: string;
  previousAmount: number;
  increaseAmount: number;
  decreaseAmount: number;
  currentAmount: number;
  reasonText: string | null;
};

type ParsedCategoryBlock = {
  categoryOrder: number;
  categoryKey: string;
  categoryLabel: string;
  previousAmount: number;
  increaseAmount: number;
  decreaseAmount: number;
  currentAmount: number;
  lines: string[];
};

export type PropertyDisclosureFileRecord = {
  disclosureFileId: string;
  sourceDocumentId: string;
  sourceId: string;
  fileSeq: number;
  infId: string;
  infSeq: number;
  issueNo: string | null;
  viewFileNm: string;
  reportedAt: string;
  fileExt: string;
  cvtFileSize: string | null;
  sourceUrl: string;
  downloadUrl: string;
  metadataRelativePath: string;
  latestRelativePath: string;
  contentSha256: string;
  currentBytes: number;
};

export type PropertyDisclosureRecord = {
  disclosureRecordId: string;
  disclosureFileId: string;
  sourceDocumentId: string;
  fileSeq: number;
  issueNo: string | null;
  disclosureName: string;
  normalizedName: string;
  officeTitle: string | null;
  sectionLabel: string;
  reportedAt: string;
  pageStart: number;
  pageEnd: number;
  memberId: string | null;
  mappingStatus: "matched" | "override" | "unmatched";
  previousAmount: number;
  increaseAmount: number;
  decreaseAmount: number;
  currentAmount: number;
  deltaAmount: number;
  valueChangeAmount: number;
  rawSummaryText: string;
};

export type PropertyDisclosureCategoryRecord = {
  disclosureCategoryId: string;
  disclosureRecordId: string;
  categoryOrder: number;
  categoryKey: string;
  categoryLabel: string;
  previousAmount: number;
  increaseAmount: number;
  decreaseAmount: number;
  currentAmount: number;
};

export type PropertyDisclosureItemRecord = {
  disclosureItemId: string;
  disclosureCategoryId: string;
  disclosureRecordId: string;
  categoryOrder: number;
  itemOrder: number;
  relation: string | null;
  assetTypeLabel: string | null;
  locationText: string | null;
  measureText: string | null;
  reasonText: string | null;
  rawDetailText: string;
  previousAmount: number;
  increaseAmount: number;
  decreaseAmount: number;
  currentAmount: number;
};

export type PropertyDisclosureArtifacts = {
  files: PropertyDisclosureFileRecord[];
  records: PropertyDisclosureRecord[];
  categories: PropertyDisclosureCategoryRecord[];
  items: PropertyDisclosureItemRecord[];
  memberAssetsIndex: MemberAssetsIndexExport;
  memberAssetsHistory: MemberAssetsHistoryExport[];
};

type BuildPropertyDisclosureArtifactsInput = {
  assemblyLabel: string;
  assemblyNo: number;
  currentMembers: MemberRecord[];
  dataRepoDir: string;
  generatedAt: string;
  indexPath?: string;
  propertySourceId?: string;
  snapshotId: string;
  tenureIndex: MemberTenureIndex;
};

const DEFAULT_PROPERTY_DOCUMENT_INDEX_PATH =
  "raw/index/assembly_property_document_index.json";
const DEFAULT_PROPERTY_SOURCE_ID = "assembly-property-disclosures";
const PROPERTY_DISCLOSURE_MEMBER_HISTORY_DIR = "exports/member_assets_history";
const realEstateCategoryLabels = new Set(["건물", "토지"]);
const PROPERTY_DISCLOSURE_SECTION_LABEL = "국회의원";
const PROPERTY_DISCLOSURE_START_DATE = "2024-05-30";
const require = createRequire(import.meta.url);
const pdfjsDistRoot = dirname(
  dirname(dirname(require.resolve("pdfjs-dist/legacy/build/pdf.mjs")))
);

const relationTokens = [
  "본인",
  "배우자",
  "부",
  "모",
  "장남",
  "차남",
  "장녀",
  "차녀",
  "손자",
  "손녀",
  "시모",
  "시부",
  "장모",
  "장인",
  "조모",
  "조부",
  "외조모",
  "외조부",
  "자녀",
  "친족",
  "기타"
] as const;

const locationPrefixes = [
  "서울특별시",
  "부산광역시",
  "대구광역시",
  "인천광역시",
  "광주광역시",
  "대전광역시",
  "울산광역시",
  "세종특별자치시",
  "경기도",
  "강원특별자치도",
  "충청북도",
  "충청남도",
  "전북특별자치도",
  "전라북도",
  "전라남도",
  "경상북도",
  "경상남도",
  "제주특별자치도"
] as const;

const primaryCategoryOrder = [
  "예금",
  "건물",
  "토지",
  "증권",
  "채무",
  "부동산에 관한 규정이 준용되는 권리와 자동차·건설기계·선박 및 항공기",
  "정치자금법에 따른 정치자금의 수입 및 지출을 위한 예금계좌의 예금",
  "현금",
  "채권"
] as const;

function isPdfTextToken(value: unknown): value is PdfTextToken {
  return Boolean(value && typeof value === "object" && "str" in value);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeDisclosureName(value: string): string {
  return normalizeWhitespace(value).replace(/\s+/g, "");
}

function normalizeCategoryLabel(value: string): string {
  return normalizeWhitespace(value.replace(/\(소계\)/g, ""));
}

function normalizeCategoryKey(value: string): string {
  const label = normalizeCategoryLabel(value)
    .replace(/[()]/g, "")
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return label || "unknown";
}

function toInt(value: string): number {
  return Number.parseInt(value.replaceAll(",", ""), 10);
}

function isNumericToken(value: string): boolean {
  return /^-?[\d,]+$/.test(value);
}

function isNumericOrTransactionToken(value: string): boolean {
  return isNumericToken(value) || /^\(-?[\d,]+\)$/.test(value);
}

function isPageMarker(value: string): boolean {
  return /^-\s*\d+\s*-$/.test(value);
}

function isHeaderNoise(value: string): boolean {
  return (
    isPageMarker(value) ||
    value === "(단위 : 천원)" ||
    value.includes("본인과의 관계") ||
    value.includes("재산의 종류 소재지") ||
    value.includes("변동액") ||
    value.includes("증가액") ||
    value.includes("감소액") ||
    value.includes("현재가액") ||
    value.includes("종전가액") ||
    value === "변동사유"
  );
}

function isRelationLine(value: string): boolean {
  return relationTokens.some(
    (token) => value.startsWith(`${token} `) || value === token
  );
}

function extractIssueNo(title: string): string | null {
  const matched = normalizeWhitespace(title).match(/제(\d{4}-\d+)호/);
  return matched?.[1] ?? null;
}

function buildMemberAssetsHistoryPath(memberId: string): string {
  return `${PROPERTY_DISCLOSURE_MEMBER_HISTORY_DIR}/${memberId}.json`;
}

function isWithinTenure(
  reportedAt: string,
  periods: MemberTenurePeriod[]
): boolean {
  return periods.some((period) => {
    if (reportedAt.localeCompare(period.startDate) < 0) {
      return false;
    }

    if (period.endDate && reportedAt.localeCompare(period.endDate) > 0) {
      return false;
    }

    return true;
  });
}

function resolvePropertyDisclosureOverride(args: {
  disclosureName: string;
  fileSeq: number;
  reportedAt: string;
}): string | null {
  const matched = propertyDisclosureOverrides.find((override) => {
    if (override.disclosureName !== args.disclosureName) {
      return false;
    }

    if (override.fileSeq !== undefined && override.fileSeq !== args.fileSeq) {
      return false;
    }

    if (
      override.effectiveDate !== undefined &&
      override.effectiveDate !== args.reportedAt
    ) {
      return false;
    }

    return true;
  });

  return matched?.memberId ?? null;
}

function buildAmountTail(input: string): ParsedAmountTail | null {
  const tokens = normalizeWhitespace(input).split(" ").filter(Boolean);
  if (tokens.length === 0) {
    return null;
  }

  const reasonTokens: string[] = [];
  let cursor = tokens.length - 1;

  while (cursor >= 0 && !isNumericOrTransactionToken(tokens[cursor] ?? "")) {
    reasonTokens.unshift(tokens[cursor] ?? "");
    cursor -= 1;
  }

  if (cursor < 0) {
    return null;
  }

  const numericTokens: string[] = [];
  while (cursor >= 0 && isNumericOrTransactionToken(tokens[cursor] ?? "")) {
    numericTokens.unshift(tokens[cursor] ?? "");
    cursor -= 1;
  }

  const mainNumbers = numericTokens.filter(isNumericToken);
  if (mainNumbers.length < 4) {
    return null;
  }

  const amountValues = mainNumbers.slice(-4).map(toInt);
  const previousAmount = amountValues[0] ?? 0;
  const increaseAmount = amountValues[1] ?? 0;
  const decreaseAmount = amountValues[2] ?? 0;
  const currentAmount = amountValues[3] ?? 0;

  return {
    detailText: tokens
      .slice(0, cursor + 1)
      .join(" ")
      .trim(),
    previousAmount,
    increaseAmount,
    decreaseAmount,
    currentAmount,
    reasonText: reasonTokens.join(" ").trim() || null
  };
}

function parseCategoryLine(
  lines: string[],
  startIndex: number
): {
  consumed: number;
  categoryLabel: string;
  previousAmount: number;
  increaseAmount: number;
  decreaseAmount: number;
  currentAmount: number;
} | null {
  let combined = lines[startIndex] ?? "";
  let cursor = startIndex;

  while (cursor < lines.length) {
    const parsed = buildAmountTail(combined);
    if (combined.startsWith("▶") && parsed) {
      return {
        consumed: cursor - startIndex + 1,
        categoryLabel: normalizeCategoryLabel(
          parsed.detailText.replace(/^▶\s*/, "")
        ),
        previousAmount: parsed.previousAmount,
        increaseAmount: parsed.increaseAmount,
        decreaseAmount: parsed.decreaseAmount,
        currentAmount: parsed.currentAmount
      };
    }

    const nextLine = lines[cursor + 1];
    if (!nextLine || nextLine.startsWith("▶") || nextLine.startsWith("총 계")) {
      break;
    }

    cursor += 1;
    combined = `${combined} ${nextLine}`.trim();
  }

  const label = normalizeCategoryLabel(combined.replace(/^▶\s*/, ""));
  if (!label) {
    return null;
  }

  return {
    consumed: cursor - startIndex + 1,
    categoryLabel: label,
    previousAmount: 0,
    increaseAmount: 0,
    decreaseAmount: 0,
    currentAmount: 0
  };
}

export function parsePropertyDisclosureSummary(
  lines: string[],
  startIndex: number
): {
  consumed: number;
  previousAmount: number;
  increaseAmount: number;
  decreaseAmount: number;
  currentAmount: number;
  deltaAmount: number;
  valueChangeAmount: number;
  rawSummaryText: string;
} | null {
  const previousLine = normalizeWhitespace(lines[startIndex - 1] ?? "");
  const currentLine = normalizeWhitespace(lines[startIndex] ?? "");
  const nextLine = normalizeWhitespace(lines[startIndex + 1] ?? "");
  const nextNextLine = normalizeWhitespace(lines[startIndex + 2] ?? "");
  const candidates = [
    { text: currentLine, consumed: 1 },
    {
      text: normalizeWhitespace(`${currentLine} ${nextLine}`),
      consumed: nextLine ? 2 : 1
    },
    {
      text: normalizeWhitespace(`${previousLine} ${currentLine}`),
      consumed: 1
    },
    {
      text: normalizeWhitespace(`${previousLine} ${currentLine} ${nextLine}`),
      consumed: nextLine ? 2 : 1
    },
    {
      text: normalizeWhitespace(
        `${previousLine} ${currentLine} ${nextLine} ${nextNextLine}`
      ),
      consumed: nextNextLine ? 3 : nextLine ? 2 : 1
    }
  ].filter((candidate) => candidate.text.length > 0);

  for (const candidate of candidates) {
    const singleLineMatched = candidate.text.match(
      /^총\s*계\s+(-?[\d,]+)\s+(-?[\d,]+)\s+(-?[\d,]+)\s+(-?[\d,]+)\s+증감액:\s*(-?[\d,]+)천원\s*\(?가액변동:\s*(-?[\d,]+)천원\)?$/
    );
    if (singleLineMatched) {
      return {
        consumed: candidate.consumed,
        previousAmount: toInt(singleLineMatched[1] ?? "0"),
        increaseAmount: toInt(singleLineMatched[2] ?? "0"),
        decreaseAmount: toInt(singleLineMatched[3] ?? "0"),
        currentAmount: toInt(singleLineMatched[4] ?? "0"),
        deltaAmount: toInt(singleLineMatched[5] ?? "0"),
        valueChangeAmount: toInt(singleLineMatched[6] ?? "0"),
        rawSummaryText: candidate.text
      };
    }

    const multiLineMatched = candidate.text.match(
      /^증감액:\s*(-?[\d,]+)천원\s+총\s*계\s+(-?[\d,]+)\s+(-?[\d,]+)\s+(-?[\d,]+)\s+(-?[\d,]+)\s+\(?가액변동:\s*(-?[\d,]+)천원\)?$/
    );
    if (multiLineMatched) {
      return {
        consumed: candidate.consumed,
        previousAmount: toInt(multiLineMatched[2] ?? "0"),
        increaseAmount: toInt(multiLineMatched[3] ?? "0"),
        decreaseAmount: toInt(multiLineMatched[4] ?? "0"),
        currentAmount: toInt(multiLineMatched[5] ?? "0"),
        deltaAmount: toInt(multiLineMatched[1] ?? "0"),
        valueChangeAmount: toInt(multiLineMatched[6] ?? "0"),
        rawSummaryText: candidate.text
      };
    }
  }

  return null;
}

function splitCategoryItems(lines: string[]): string[] {
  const items: string[] = [];
  let current = "";

  for (const line of lines.map(normalizeWhitespace).filter(Boolean)) {
    if (
      isHeaderNoise(line) ||
      line.startsWith("총 계") ||
      line.startsWith("▶")
    ) {
      continue;
    }

    if (isRelationLine(line)) {
      if (current) {
        items.push(current);
      }

      current = line;
      continue;
    }

    if (!current) {
      current = line;
      continue;
    }

    current = `${current} ${line}`.trim();
  }

  if (current) {
    items.push(current);
  }

  return items;
}

function splitDetailFields(input: {
  categoryLabel: string;
  detailText: string;
  reasonText: string | null;
}): {
  relation: string | null;
  assetTypeLabel: string | null;
  locationText: string | null;
  measureText: string | null;
  reasonText: string | null;
  rawDetailText: string;
} {
  const rawDetailText = normalizeWhitespace(input.detailText);
  const relation =
    relationTokens.find(
      (token) =>
        rawDetailText === token || rawDetailText.startsWith(`${token} `)
    ) ?? null;
  const withoutRelation = relation
    ? rawDetailText.slice(relation.length).trim()
    : rawDetailText;
  const locationPrefix =
    locationPrefixes.find((prefix) => withoutRelation.includes(prefix)) ?? null;
  const locationIndex = locationPrefix
    ? withoutRelation.indexOf(locationPrefix)
    : -1;
  const assetTypeLabel =
    locationIndex > 0
      ? withoutRelation.slice(0, locationIndex).trim() || null
      : withoutRelation || null;

  const locationText =
    locationIndex >= 0
      ? withoutRelation.slice(locationIndex).trim() || null
      : null;
  const measureMatch =
    rawDetailText.match(/(\d[\d,.]*㎡(?:\s*중\s*\d[\d,.]*㎡)?)/g)?.join(", ") ??
    rawDetailText.match(/배기량\([^)]+\)/)?.[0] ??
    rawDetailText.match(/\d[\d,.]*(?:주|cc)/)?.[0] ??
    null;

  return {
    relation,
    assetTypeLabel,
    locationText,
    measureText: measureMatch,
    reasonText: input.reasonText,
    rawDetailText
  };
}

function resolveCategorySortKey(
  categoryLabel: string,
  fallbackOrder: number
): string {
  const primaryIndex = primaryCategoryOrder.findIndex(
    (value) => value === categoryLabel
  );
  if (primaryIndex >= 0) {
    return `${String(primaryIndex).padStart(2, "0")}:${fallbackOrder}`;
  }

  return `99:${String(fallbackOrder).padStart(2, "0")}:${categoryLabel}`;
}

async function extractPdfLines(pdfPath: string): Promise<PdfLine[]> {
  const data = new Uint8Array(await readFile(pdfPath));
  const document = await getDocument({
    data,
    cMapUrl: `${join(pdfjsDistRoot, "cmaps")}/`,
    useWorkerFetch: false,
    isEvalSupported: false
  }).promise;
  const lines: PdfLine[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const tokens = (content.items as unknown[])
      .filter(isPdfTextToken)
      .map((item) => ({
        text: normalizeWhitespace(item.str ?? ""),
        x: item.transform?.[4] ?? 0,
        y: item.transform?.[5] ?? 0,
        width: item.width ?? 0
      }))
      .filter((item) => item.text.length > 0)
      .sort((left, right) => {
        const yGap = Math.abs(left.y - right.y);
        if (yGap > 1.5) {
          return right.y - left.y;
        }

        return left.x - right.x;
      });

    const pageLines: Array<{
      y: number;
      items: Array<{ text: string; x: number; width: number }>;
    }> = [];

    for (const token of tokens) {
      const currentLine = pageLines.at(-1);
      if (!currentLine || Math.abs(currentLine.y - token.y) > 2.5) {
        pageLines.push({
          y: token.y,
          items: [{ text: token.text, x: token.x, width: token.width }]
        });
        continue;
      }

      currentLine.items.push({
        text: token.text,
        x: token.x,
        width: token.width
      });
    }

    for (const pageLine of pageLines) {
      const sortedItems = [...pageLine.items].sort(
        (left, right) => left.x - right.x
      );
      let text = "";
      let lastEndX: number | null = null;

      for (const item of sortedItems) {
        const needsGap =
          lastEndX !== null && item.x - lastEndX > 4 && !text.endsWith(" ");
        text += `${needsGap ? " " : ""}${item.text}`;
        lastEndX = item.x + item.width;
      }

      const normalized = normalizeWhitespace(text);
      if (!normalized) {
        continue;
      }

      lines.push({
        pageNumber,
        text: normalized
      });
    }
  }

  if (lines.length === 0) {
    throw new Error(
      `Property disclosure PDF has no extractable text layer: ${pdfPath}`
    );
  }

  return lines;
}

export function extractLawmakerLines(lines: PdfLine[]): PdfLine[] {
  const startIndex = lines.findIndex((line) =>
    line.text.includes("1. 국회의원")
  );
  if (startIndex < 0) {
    return [];
  }

  const sectionLines = lines.slice(startIndex + 1);
  const endIndex = sectionLines.findIndex((line) =>
    /^2\.\s+\S/.test(line.text)
  );
  return endIndex >= 0 ? sectionLines.slice(0, endIndex) : sectionLines;
}

function splitDisclosureRecordBlocks(
  lines: PdfLine[]
): ParsedDisclosureRecordBlock[] {
  const blocks: ParsedDisclosureRecordBlock[] = [];
  let current: ParsedDisclosureRecordBlock | null = null;

  for (const line of lines) {
    if (isHeaderNoise(line.text)) {
      continue;
    }

    const headerMatch = line.text.match(
      /(?:소속\s+국회\s+)?직위\s+(.+?)\s+성명\s+([가-힣]{2,10})$/
    );
    if (headerMatch) {
      if (current) {
        blocks.push(current);
      }

      current = {
        disclosureName: headerMatch[2] ?? "",
        officeTitle: normalizeWhitespace(headerMatch[1] ?? "") || null,
        pageStart: line.pageNumber,
        pageEnd: line.pageNumber,
        lines: []
      };
      continue;
    }

    if (!current) {
      continue;
    }

    current.lines.push(line.text);
    current.pageEnd = line.pageNumber;
  }

  if (current) {
    blocks.push(current);
  }

  return blocks;
}

function buildMappedMember(args: {
  currentMembers: MemberRecord[];
  recordName: string;
  fileSeq: number;
  reportedAt: string;
  tenureIndex: MemberTenureIndex;
}): {
  memberId: string | null;
  mappingStatus: "matched" | "override" | "unmatched";
} {
  const overrideMemberId = resolvePropertyDisclosureOverride({
    disclosureName: args.recordName,
    fileSeq: args.fileSeq,
    reportedAt: args.reportedAt
  });
  if (overrideMemberId) {
    return {
      memberId: overrideMemberId,
      mappingStatus: "override"
    };
  }

  const exactMatches = args.currentMembers.filter(
    (member) =>
      member.name === args.recordName &&
      isWithinTenure(
        args.reportedAt,
        args.tenureIndex.get(member.memberId) ?? []
      )
  );

  if (exactMatches.length > 1) {
    throw new Error(
      `Ambiguous current-member property disclosure match for ${args.recordName} (${args.reportedAt}, fileSeq ${args.fileSeq}).`
    );
  }

  if (exactMatches.length === 1) {
    return {
      memberId: exactMatches[0]?.memberId ?? null,
      mappingStatus: "matched"
    };
  }

  return {
    memberId: null,
    mappingStatus: "unmatched"
  };
}

function buildMemberPublicProfile(member: MemberRecord): {
  name: string;
  party: string;
  district?: string | null;
  photoUrl?: string | null;
  officialProfileUrl?: string | null;
  officialExternalUrl?: string | null;
  profile?: MemberRecord["profile"];
} {
  return {
    name: member.name,
    party: member.party,
    ...(member.district !== undefined
      ? { district: member.district ?? null }
      : {}),
    ...(member.photoUrl !== undefined
      ? { photoUrl: member.photoUrl ?? null }
      : {}),
    ...(member.officialProfileUrl !== undefined
      ? { officialProfileUrl: member.officialProfileUrl ?? null }
      : {}),
    ...(member.officialExternalUrl !== undefined
      ? { officialExternalUrl: member.officialExternalUrl ?? null }
      : {}),
    ...(member.profile ? { profile: member.profile } : {})
  };
}

async function parseMirroredPropertyDisclosure(args: {
  currentMembers: MemberRecord[];
  metadata: MirroredDocumentMetadata;
  propertyFile: PropertyDisclosureFileRecord;
  tenureIndex: MemberTenureIndex;
  dataRepoDir: string;
}): Promise<{
  records: PropertyDisclosureRecord[];
  categories: PropertyDisclosureCategoryRecord[];
  items: PropertyDisclosureItemRecord[];
}> {
  const pdfPath = join(args.dataRepoDir, args.metadata.latestRelativePath);
  const lines = extractLawmakerLines(await extractPdfLines(pdfPath));
  if (lines.length === 0) {
    return {
      records: [],
      categories: [],
      items: []
    };
  }
  const blocks = splitDisclosureRecordBlocks(lines);

  if (blocks.length === 0) {
    throw new Error(
      `Could not parse any lawmaker disclosure records from ${args.propertyFile.viewFileNm} (${args.propertyFile.fileSeq}).`
    );
  }

  const records: PropertyDisclosureRecord[] = [];
  const categories: PropertyDisclosureCategoryRecord[] = [];
  const items: PropertyDisclosureItemRecord[] = [];

  for (const block of blocks) {
    let categoryOrder = 0;
    const categoryBlocks: ParsedCategoryBlock[] = [];
    let summary: {
      previousAmount: number;
      increaseAmount: number;
      decreaseAmount: number;
      currentAmount: number;
      deltaAmount: number;
      valueChangeAmount: number;
      rawSummaryText: string;
    } | null = null;

    for (let index = 0; index < block.lines.length; index += 1) {
      const line = block.lines[index] ?? "";
      if (
        !line ||
        isHeaderNoise(line) ||
        line.startsWith("증감액:") ||
        line.startsWith("(가액변동:") ||
        line.startsWith("가액변동:")
      ) {
        continue;
      }

      if (line.startsWith("총 계")) {
        const parsedSummary = parsePropertyDisclosureSummary(
          block.lines,
          index
        );
        if (!parsedSummary) {
          throw new Error(
            `Could not parse total summary for ${block.disclosureName} in fileSeq ${args.propertyFile.fileSeq}.`
          );
        }

        summary = parsedSummary;
        index += parsedSummary.consumed - 1;
        continue;
      }

      if (!line.startsWith("▶")) {
        const currentCategory = categoryBlocks.at(-1);
        if (currentCategory) {
          currentCategory.lines.push(line);
        }
        continue;
      }

      const parsedCategory = parseCategoryLine(block.lines, index);
      if (!parsedCategory) {
        continue;
      }

      categoryOrder += 1;
      categoryBlocks.push({
        categoryOrder,
        categoryKey: normalizeCategoryKey(parsedCategory.categoryLabel),
        categoryLabel: parsedCategory.categoryLabel,
        previousAmount: parsedCategory.previousAmount,
        increaseAmount: parsedCategory.increaseAmount,
        decreaseAmount: parsedCategory.decreaseAmount,
        currentAmount: parsedCategory.currentAmount,
        lines: []
      });
      index += parsedCategory.consumed - 1;
    }

    if (!summary) {
      throw new Error(
        `Could not locate total summary for ${block.disclosureName} in fileSeq ${args.propertyFile.fileSeq}.`
      );
    }

    const mapping = buildMappedMember({
      currentMembers: args.currentMembers,
      recordName: block.disclosureName,
      fileSeq: args.propertyFile.fileSeq,
      reportedAt: args.propertyFile.reportedAt,
      tenureIndex: args.tenureIndex
    });
    const recordId = sha256(
      `${args.propertyFile.fileSeq}:${args.propertyFile.reportedAt}:${normalizeDisclosureName(block.disclosureName)}:${args.propertyFile.issueNo ?? ""}`
    ).slice(0, 20);
    const disclosureRecordId = `adr_${recordId}`;

    records.push({
      disclosureRecordId,
      disclosureFileId: args.propertyFile.disclosureFileId,
      sourceDocumentId: args.propertyFile.sourceDocumentId,
      fileSeq: args.propertyFile.fileSeq,
      issueNo: args.propertyFile.issueNo,
      disclosureName: block.disclosureName,
      normalizedName: normalizeDisclosureName(block.disclosureName),
      officeTitle: block.officeTitle,
      sectionLabel: PROPERTY_DISCLOSURE_SECTION_LABEL,
      reportedAt: args.propertyFile.reportedAt,
      pageStart: block.pageStart,
      pageEnd: block.pageEnd,
      memberId: mapping.memberId,
      mappingStatus: mapping.mappingStatus,
      previousAmount: summary.previousAmount,
      increaseAmount: summary.increaseAmount,
      decreaseAmount: summary.decreaseAmount,
      currentAmount: summary.currentAmount,
      deltaAmount: summary.deltaAmount,
      valueChangeAmount: summary.valueChangeAmount,
      rawSummaryText: summary.rawSummaryText
    });

    for (const categoryBlock of categoryBlocks) {
      const disclosureCategoryId = `adc_${sha256(
        `${disclosureRecordId}:${categoryBlock.categoryOrder}:${categoryBlock.categoryKey}`
      ).slice(0, 20)}`;

      categories.push({
        disclosureCategoryId,
        disclosureRecordId,
        categoryOrder: categoryBlock.categoryOrder,
        categoryKey: categoryBlock.categoryKey,
        categoryLabel: categoryBlock.categoryLabel,
        previousAmount: categoryBlock.previousAmount,
        increaseAmount: categoryBlock.increaseAmount,
        decreaseAmount: categoryBlock.decreaseAmount,
        currentAmount: categoryBlock.currentAmount
      });

      const categoryItems = splitCategoryItems(categoryBlock.lines);
      categoryItems.forEach((rawItem, itemIndex) => {
        const parsedTail = buildAmountTail(rawItem);
        if (!parsedTail) {
          return;
        }

        const fields = splitDetailFields({
          categoryLabel: categoryBlock.categoryLabel,
          detailText: parsedTail.detailText,
          reasonText: parsedTail.reasonText
        });
        const disclosureItemId = `adi_${sha256(
          `${disclosureCategoryId}:${itemIndex + 1}:${fields.rawDetailText}`
        ).slice(0, 20)}`;

        items.push({
          disclosureItemId,
          disclosureCategoryId,
          disclosureRecordId,
          categoryOrder: categoryBlock.categoryOrder,
          itemOrder: itemIndex + 1,
          relation: fields.relation,
          assetTypeLabel: fields.assetTypeLabel,
          locationText: fields.locationText,
          measureText: fields.measureText,
          reasonText: fields.reasonText,
          rawDetailText: fields.rawDetailText,
          previousAmount: parsedTail.previousAmount,
          increaseAmount: parsedTail.increaseAmount,
          decreaseAmount: parsedTail.decreaseAmount,
          currentAmount: parsedTail.currentAmount
        });
      });
    }
  }

  return { records, categories, items };
}

function buildPropertyDisclosureFileRecord(
  metadata: MirroredDocumentMetadata
): PropertyDisclosureFileRecord | null {
  const fileSeqRaw = metadata.sourceMetadata?.fileSeq;
  const infId =
    typeof metadata.sourceMetadata?.infId === "string"
      ? metadata.sourceMetadata.infId
      : null;
  const infSeqRaw = metadata.sourceMetadata?.infSeq;
  const reportedAt =
    typeof metadata.sourceMetadata?.ftCrDttm === "string"
      ? metadata.sourceMetadata.ftCrDttm
      : metadata.publishedDate;
  const fileExt =
    typeof metadata.sourceMetadata?.fileExt === "string"
      ? metadata.sourceMetadata.fileExt
      : (metadata.latestRelativePath.split(".").at(-1) ?? "pdf");

  if (
    typeof fileSeqRaw !== "number" ||
    !infId ||
    typeof infSeqRaw !== "number" ||
    !reportedAt
  ) {
    return null;
  }

  return {
    disclosureFileId: `adf_${fileSeqRaw}`,
    sourceDocumentId: metadata.documentId,
    sourceId: metadata.sourceId,
    fileSeq: fileSeqRaw,
    infId,
    infSeq: infSeqRaw,
    issueNo: extractIssueNo(metadata.title),
    viewFileNm:
      typeof metadata.sourceMetadata?.viewFileNm === "string"
        ? metadata.sourceMetadata.viewFileNm
        : metadata.title,
    reportedAt,
    fileExt,
    cvtFileSize:
      typeof metadata.sourceMetadata?.cvtFileSize === "string"
        ? metadata.sourceMetadata.cvtFileSize
        : null,
    sourceUrl: metadata.sourceUrl,
    downloadUrl: metadata.downloadUrl ?? metadata.sourceUrl,
    metadataRelativePath: metadata.metadataRelativePath,
    latestRelativePath: metadata.latestRelativePath,
    contentSha256: metadata.currentContentSha256,
    currentBytes: metadata.currentBytes
  };
}

function assertNoDuplicateDisclosureRecords(
  records: PropertyDisclosureRecord[]
): void {
  const seen = new Map<string, PropertyDisclosureRecord>();

  for (const record of records) {
    const key = `${record.reportedAt}:${record.normalizedName}:${record.issueNo ?? ""}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, record);
      continue;
    }

    throw new Error(
      `Duplicate property disclosure record collision detected for ${record.disclosureName} (${record.reportedAt}, issue ${record.issueNo ?? "unknown"}).`
    );
  }
}

type MemberAssetSeriesPointRecord = MemberAssetsHistoryExport["series"][number];
type MemberAssetCategorySeriesRecord =
  MemberAssetsHistoryExport["categorySeries"][number];
type MemberAssetCategoryPointRecord =
  MemberAssetCategorySeriesRecord["points"][number];

function isDebtCategoryLabel(categoryLabel: string): boolean {
  return categoryLabel === "채무";
}

function buildCategorySeries(
  rows: Array<{
    categoryKey: string;
    categoryLabel: string;
    categoryOrder: number;
    point: MemberAssetCategoryPointRecord;
  }>
): MemberAssetsHistoryExport["categorySeries"] {
  const categorySeriesMap = new Map<
    string,
    {
      categoryKey: string;
      categoryLabel: string;
      order: number;
      points: MemberAssetCategoryPointRecord[];
    }
  >();

  for (const row of rows) {
    const existing = categorySeriesMap.get(row.categoryKey) ?? {
      categoryKey: row.categoryKey,
      categoryLabel: row.categoryLabel,
      order: row.categoryOrder,
      points: []
    };
    existing.order = Math.min(existing.order, row.categoryOrder);
    existing.points.push(row.point);
    categorySeriesMap.set(row.categoryKey, existing);
  }

  return [...categorySeriesMap.values()]
    .sort((left, right) =>
      resolveCategorySortKey(left.categoryLabel, left.order).localeCompare(
        resolveCategorySortKey(right.categoryLabel, right.order),
        "ko-KR"
      )
    )
    .map((series) => ({
      categoryKey: series.categoryKey,
      categoryLabel: series.categoryLabel,
      points: series.points.sort((left, right) =>
        left.reportedAt.localeCompare(right.reportedAt)
      )
    }));
}

function buildLatestSummary(
  point: MemberAssetSeriesPointRecord
): MemberAssetsHistoryExport["latestSummary"] {
  return {
    reportedAt: point.reportedAt,
    issueNo: point.issueNo,
    previousAmount: point.previousAmount,
    increaseAmount: point.increaseAmount,
    decreaseAmount: point.decreaseAmount,
    currentAmount: point.currentAmount,
    deltaAmount: point.deltaAmount,
    valueChangeAmount: point.valueChangeAmount
  };
}

function buildLatestRealEstateTotal(
  categorySeries: MemberAssetsHistoryExport["categorySeries"],
  reportedAt: string
): number {
  return categorySeries.reduce((sum, category) => {
    if (!realEstateCategoryLabels.has(category.categoryLabel)) {
      return sum;
    }

    return (
      sum +
      (category.points.find((point) => point.reportedAt === reportedAt)
        ?.currentAmount ?? 0)
    );
  }, 0);
}

function buildSelfOnlyScopedHistory(args: {
  categoriesByDisclosureCategoryId: Map<
    string,
    PropertyDisclosureCategoryRecord
  >;
  itemsByRecordId: Map<string, PropertyDisclosureItemRecord[]>;
  sortedRecords: Array<PropertyDisclosureRecord & { memberId: string }>;
}): MemberAssetsHistoryExport["selfOnly"] {
  const series: MemberAssetSeriesPointRecord[] = [];
  const categoryRows: Array<{
    categoryKey: string;
    categoryLabel: string;
    categoryOrder: number;
    point: MemberAssetCategoryPointRecord;
  }> = [];

  for (const record of args.sortedRecords) {
    const selfOnlyItems = (
      args.itemsByRecordId.get(record.disclosureRecordId) ?? []
    ).filter((item) => item.relation === "본인");
    const categoryTotals = new Map<
      string,
      {
        categoryKey: string;
        categoryLabel: string;
        categoryOrder: number;
        previousAmount: number;
        increaseAmount: number;
        decreaseAmount: number;
        currentAmount: number;
      }
    >();

    let previousAmount = 0;
    let increaseAmount = 0;
    let decreaseAmount = 0;
    let currentAmount = 0;

    for (const item of selfOnlyItems) {
      const category = args.categoriesByDisclosureCategoryId.get(
        item.disclosureCategoryId
      );
      if (!category) {
        continue;
      }

      const sign = isDebtCategoryLabel(category.categoryLabel) ? -1 : 1;
      previousAmount += sign * item.previousAmount;
      increaseAmount += sign * item.increaseAmount;
      decreaseAmount += sign * item.decreaseAmount;
      currentAmount += sign * item.currentAmount;

      const categoryTotal = categoryTotals.get(category.categoryKey) ?? {
        categoryKey: category.categoryKey,
        categoryLabel: category.categoryLabel,
        categoryOrder: category.categoryOrder,
        previousAmount: 0,
        increaseAmount: 0,
        decreaseAmount: 0,
        currentAmount: 0
      };
      categoryTotal.previousAmount += item.previousAmount;
      categoryTotal.increaseAmount += item.increaseAmount;
      categoryTotal.decreaseAmount += item.decreaseAmount;
      categoryTotal.currentAmount += item.currentAmount;
      categoryTotals.set(category.categoryKey, categoryTotal);
    }

    const deltaAmount = currentAmount - previousAmount;
    const valueChangeAmount = deltaAmount - increaseAmount + decreaseAmount;

    series.push({
      reportedAt: record.reportedAt,
      issueNo: record.issueNo,
      previousAmount,
      increaseAmount,
      decreaseAmount,
      currentAmount,
      deltaAmount,
      valueChangeAmount
    });

    for (const category of categoryTotals.values()) {
      categoryRows.push({
        categoryKey: category.categoryKey,
        categoryLabel: category.categoryLabel,
        categoryOrder: category.categoryOrder,
        point: {
          reportedAt: record.reportedAt,
          issueNo: record.issueNo,
          previousAmount: category.previousAmount,
          increaseAmount: category.increaseAmount,
          decreaseAmount: category.decreaseAmount,
          currentAmount: category.currentAmount
        }
      });
    }
  }

  const latestPoint = series.at(-1);
  if (!latestPoint) {
    return undefined;
  }

  return {
    series,
    categorySeries: buildCategorySeries(categoryRows),
    latestSummary: buildLatestSummary(latestPoint)
  };
}

function buildMemberAssetExports(args: {
  assemblyLabel: string;
  assemblyNo: number;
  items: PropertyDisclosureItemRecord[];
  currentMembers: MemberRecord[];
  generatedAt: string;
  records: PropertyDisclosureRecord[];
  categories: PropertyDisclosureCategoryRecord[];
  snapshotId: string;
}): {
  memberAssetsIndex: MemberAssetsIndexExport;
  memberAssetsHistory: MemberAssetsHistoryExport[];
} {
  const currentMembersById = new Map(
    args.currentMembers.map((member) => [member.memberId, member] as const)
  );
  const currentRecords = args.records
    .filter((record) => record.memberId && record.mappingStatus !== "unmatched")
    .filter(
      (record): record is PropertyDisclosureRecord & { memberId: string } =>
        Boolean(record.memberId && currentMembersById.has(record.memberId))
    );
  const categoriesByRecordId = new Map<
    string,
    PropertyDisclosureCategoryRecord[]
  >();

  for (const category of args.categories) {
    const bucket = categoriesByRecordId.get(category.disclosureRecordId) ?? [];
    bucket.push(category);
    categoriesByRecordId.set(category.disclosureRecordId, bucket);
  }
  const categoriesByDisclosureCategoryId = new Map(
    args.categories.map(
      (category) => [category.disclosureCategoryId, category] as const
    )
  );
  const itemsByRecordId = new Map<string, PropertyDisclosureItemRecord[]>();
  for (const item of args.items) {
    const bucket = itemsByRecordId.get(item.disclosureRecordId) ?? [];
    bucket.push(item);
    itemsByRecordId.set(item.disclosureRecordId, bucket);
  }

  const recordsByMemberId = new Map<
    string,
    Array<PropertyDisclosureRecord & { memberId: string }>
  >();
  for (const record of currentRecords) {
    const bucket = recordsByMemberId.get(record.memberId) ?? [];
    bucket.push(record);
    recordsByMemberId.set(record.memberId, bucket);
  }

  const histories: MemberAssetsHistoryExport[] = [];
  const members = [...recordsByMemberId.entries()]
    .map(([memberId, memberRecords]) => {
      const member = currentMembersById.get(memberId);
      if (!member) {
        return null;
      }

      const sortedRecords = [...memberRecords].sort((left, right) => {
        const byDate = left.reportedAt.localeCompare(right.reportedAt);
        if (byDate !== 0) {
          return byDate;
        }

        return left.fileSeq - right.fileSeq;
      });
      const firstRecord = sortedRecords[0];
      const latestRecord = sortedRecords.at(-1);
      if (!firstRecord || !latestRecord) {
        return null;
      }

      const categorySeries = buildCategorySeries(
        sortedRecords.flatMap((record) =>
          (categoriesByRecordId.get(record.disclosureRecordId) ?? []).map(
            (category) => ({
              categoryKey: category.categoryKey,
              categoryLabel: category.categoryLabel,
              categoryOrder: category.categoryOrder,
              point: {
                reportedAt: record.reportedAt,
                issueNo: record.issueNo,
                previousAmount: category.previousAmount,
                increaseAmount: category.increaseAmount,
                decreaseAmount: category.decreaseAmount,
                currentAmount: category.currentAmount
              }
            })
          )
        )
      );
      const latestSummary = buildLatestSummary({
        reportedAt: latestRecord.reportedAt,
        issueNo: latestRecord.issueNo,
        previousAmount: latestRecord.previousAmount,
        increaseAmount: latestRecord.increaseAmount,
        decreaseAmount: latestRecord.decreaseAmount,
        currentAmount: latestRecord.currentAmount,
        deltaAmount: latestRecord.deltaAmount,
        valueChangeAmount: latestRecord.valueChangeAmount
      });
      const selfOnly = buildSelfOnlyScopedHistory({
        categoriesByDisclosureCategoryId,
        itemsByRecordId,
        sortedRecords
      });

      histories.push({
        generatedAt: args.generatedAt,
        snapshotId: args.snapshotId,
        assemblyNo: args.assemblyNo,
        assemblyLabel: args.assemblyLabel,
        memberId,
        series: sortedRecords.map((record) => ({
          reportedAt: record.reportedAt,
          issueNo: record.issueNo,
          previousAmount: record.previousAmount,
          increaseAmount: record.increaseAmount,
          decreaseAmount: record.decreaseAmount,
          currentAmount: record.currentAmount,
          deltaAmount: record.deltaAmount,
          valueChangeAmount: record.valueChangeAmount
        })),
        categorySeries,
        latestSummary,
        selfOnly
      });

      return {
        memberId,
        ...buildMemberPublicProfile(member),
        firstDisclosureDate: firstRecord.reportedAt,
        latestDisclosureDate: latestRecord.reportedAt,
        latestTotal: latestRecord.currentAmount,
        latestRealEstateTotal: buildLatestRealEstateTotal(
          categorySeries,
          latestRecord.reportedAt
        ),
        totalDelta: latestRecord.currentAmount - firstRecord.currentAmount,
        historyPath: buildMemberAssetsHistoryPath(memberId),
        latestSummary
      };
    })
    .filter((member): member is NonNullable<typeof member> => Boolean(member))
    .sort((left, right) => left.name.localeCompare(right.name, "ko-KR"));

  return {
    memberAssetsIndex: {
      generatedAt: args.generatedAt,
      snapshotId: args.snapshotId,
      assemblyNo: args.assemblyNo,
      assemblyLabel: args.assemblyLabel,
      members
    },
    memberAssetsHistory: histories.sort((left, right) =>
      left.memberId.localeCompare(right.memberId)
    )
  };
}

export async function buildPropertyDisclosureArtifacts(
  input: BuildPropertyDisclosureArtifactsInput
): Promise<PropertyDisclosureArtifacts> {
  const indexPath = input.indexPath ?? DEFAULT_PROPERTY_DOCUMENT_INDEX_PATH;
  const propertySourceId = input.propertySourceId ?? DEFAULT_PROPERTY_SOURCE_ID;
  const mirroredIndex = await readJsonFile<MirroredDocumentIndex | null>(
    join(input.dataRepoDir, indexPath),
    null
  );

  const emptyExports = buildMemberAssetExports({
    assemblyLabel: input.assemblyLabel,
    assemblyNo: input.assemblyNo,
    items: [],
    currentMembers: input.currentMembers,
    generatedAt: input.generatedAt,
    records: [],
    categories: [],
    snapshotId: input.snapshotId
  });

  if (!mirroredIndex || mirroredIndex.items.length === 0) {
    return {
      files: [],
      records: [],
      categories: [],
      items: [],
      ...emptyExports
    };
  }

  const mirroredMetadata = (
    await mapWithConcurrency(mirroredIndex.items, 4, async (item) =>
      readJsonFile<MirroredDocumentMetadata | null>(
        join(input.dataRepoDir, item.metadataRelativePath),
        null
      )
    )
  ).filter((metadata): metadata is MirroredDocumentMetadata =>
    Boolean(metadata && metadata.sourceId === propertySourceId)
  );
  const propertyFiles = mirroredMetadata
    .map(buildPropertyDisclosureFileRecord)
    .filter((file): file is PropertyDisclosureFileRecord => Boolean(file))
    .filter((file) => file.reportedAt >= PROPERTY_DISCLOSURE_START_DATE)
    .sort((left, right) => {
      const byDate = left.reportedAt.localeCompare(right.reportedAt);
      if (byDate !== 0) {
        return byDate;
      }

      return left.fileSeq - right.fileSeq;
    });

  if (propertyFiles.length === 0) {
    return {
      files: [],
      records: [],
      categories: [],
      items: [],
      ...emptyExports
    };
  }

  const metadataByDocumentId = new Map(
    mirroredMetadata.map((metadata) => [metadata.documentId, metadata] as const)
  );

  const parsedPayloads = await mapWithConcurrency(
    propertyFiles,
    2,
    async (propertyFile) => {
      const metadata = metadataByDocumentId.get(propertyFile.sourceDocumentId);
      if (!metadata) {
        throw new Error(
          `Could not resolve mirrored metadata for property disclosure fileSeq ${propertyFile.fileSeq}.`
        );
      }

      return parseMirroredPropertyDisclosure({
        currentMembers: input.currentMembers,
        metadata,
        propertyFile,
        tenureIndex: input.tenureIndex,
        dataRepoDir: input.dataRepoDir
      });
    }
  );

  const records = parsedPayloads.flatMap((payload) => payload.records);
  const categories = parsedPayloads.flatMap((payload) => payload.categories);
  const items = parsedPayloads.flatMap((payload) => payload.items);

  assertNoDuplicateDisclosureRecords(records);

  return {
    files: propertyFiles,
    records,
    categories,
    items,
    ...buildMemberAssetExports({
      assemblyLabel: input.assemblyLabel,
      assemblyNo: input.assemblyNo,
      items,
      currentMembers: input.currentMembers,
      generatedAt: input.generatedAt,
      records,
      categories,
      snapshotId: input.snapshotId
    })
  };
}

export {
  DEFAULT_PROPERTY_DOCUMENT_INDEX_PATH,
  DEFAULT_PROPERTY_SOURCE_ID,
  PROPERTY_DISCLOSURE_MEMBER_HISTORY_DIR
};
