import { load } from "cheerio";

export type AssemblyMinutesAgendaItem = {
  agendaItemId: string;
  title: string;
  billIds: string[];
  billDetailUrl: string | null;
};

export type AssemblyMinutesStatement = {
  statementId: string;
  agendaItemId: string;
  speakerName: string;
  speakerRole: string | null;
  sourceMemberId: string | null;
  officialProfileUrl: string | null;
  paragraphs: string[];
  sourceFragment: string;
};

export type AssemblyMinutesTranscript = {
  schemaVersion: 1;
  documentId: string;
  sourceUrl: string;
  meetingTitle: string;
  meetingDate: string;
  committeeName: string | null;
  agendaItems: AssemblyMinutesAgendaItem[];
  statements: AssemblyMinutesStatement[];
};

export const ASSEMBLY_MINUTES_TRANSCRIPT_PARSER_VERSION = "2";

function normalizeText(value: string): string {
  return value.replaceAll("\u00a0", " ").replace(/\s+/g, " ").trim();
}

export function isOfficialAssemblyMinutesViewerUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "record.assembly.go.kr" &&
      url.pathname === "/assembly/viewer/minutes/xml.do" &&
      Boolean(url.searchParams.get("id"))
    );
  } catch {
    return false;
  }
}

function extractBillIds(value: string): string[] {
  const ids = new Set<string>();

  for (const match of value.matchAll(/의안번호\s*[:：]?\s*(\d{5,})/g)) {
    const billId = match[1];
    if (billId) {
      ids.add(billId);
    }
  }

  return [...ids];
}

function normalizeViewerDate(value: string): string | null {
  const matched = value.match(/(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (!matched?.[1] || !matched[2] || !matched[3]) {
    return null;
  }

  return `${matched[1]}-${matched[2].padStart(2, "0")}-${matched[3].padStart(2, "0")}`;
}

function extractCommitteeName(meetingTitle: string): string | null {
  const viewerMatch = meetingTitle.match(/제\d+차\s+(.+?)(?:\s*$)/);
  if (viewerMatch?.[1]) {
    return normalizeText(viewerMatch[1]);
  }

  const catalogMatch = meetingTitle.match(
    /제\d+대(?:국회)?\s+제\d+회\s+(.+?)\s+회의록$/
  );
  return catalogMatch?.[1] ? normalizeText(catalogMatch[1]) : null;
}

export function parseAssemblyMinutesViewerHtml(args: {
  documentId: string;
  sourceUrl: string;
  fallbackMeetingDate: string;
  fallbackTitle: string;
  html: string;
}): AssemblyMinutesTranscript {
  const $ = load(args.html);
  const headerTitle = normalizeText($("#header .tit h2 strong").first().text());
  const headerDate = normalizeText($("#header .tit h2 .date").first().text());
  const normalizedHeaderDate = normalizeViewerDate(headerDate);
  const headerMatchesCatalog =
    normalizedHeaderDate === args.fallbackMeetingDate;
  const meetingTitle =
    headerMatchesCatalog && headerTitle ? headerTitle : args.fallbackTitle;

  const agendaItems: AssemblyMinutesAgendaItem[] = [];
  $(".minutes_body a.tit[id^='item']").each((_, element) => {
    const agendaItemId = $(element).attr("id");
    const title = normalizeText($(element).text());
    if (!agendaItemId || !title) {
      return;
    }

    agendaItems.push({
      agendaItemId,
      title,
      billIds: extractBillIds(title),
      billDetailUrl: $(element).attr("href") ?? null
    });
  });

  const statements: AssemblyMinutesStatement[] = [];
  $(".minutes_body .speaker").each((_, element) => {
    const speaker = $(element);
    const statementId = speaker.attr("id");
    const speakerName = normalizeText(speaker.attr("data-name") ?? "");
    if (!statementId || !speakerName) {
      return;
    }

    const agendaItemId =
      speaker
        .attr("class")
        ?.split(/\s+/)
        .find((className) => /^item\d+$/.test(className)) ?? "item0";
    const paragraphs = speaker
      .find(".talk .spk_sub")
      .toArray()
      .map((paragraph) => normalizeText($(paragraph).text()))
      .filter(Boolean);

    if (paragraphs.length === 0) {
      return;
    }

    statements.push({
      statementId,
      agendaItemId,
      speakerName,
      speakerRole: normalizeText(speaker.attr("data-pos") ?? "") || null,
      sourceMemberId: normalizeText(speaker.attr("data-mem_id") ?? "") || null,
      officialProfileUrl:
        speaker.find(".man a[href]").first().attr("href") ?? null,
      paragraphs,
      sourceFragment: `#${statementId}`
    });
  });

  return {
    schemaVersion: 1,
    documentId: args.documentId,
    sourceUrl: args.sourceUrl,
    meetingTitle,
    meetingDate: args.fallbackMeetingDate,
    committeeName: extractCommitteeName(meetingTitle),
    agendaItems,
    statements
  };
}
