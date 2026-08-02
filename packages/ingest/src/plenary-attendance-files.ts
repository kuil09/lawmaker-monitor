import { unzipSync, strFromU8 } from "fflate";

import { sha256Buffer } from "./utils.js";

export type OfficialPlenaryAttendanceFileMeeting = {
  documentId: string;
  sessionNo: number;
  meetingDate: string;
  meetingType: "plenary";
  committeeName: null;
  presentNames: string[];
  absentNames: string[];
  leaveNames: string[];
  tripNames: string[];
  sourceUrl: string;
  retrievedAt: string;
  sourceHash: string;
};

type SpreadsheetRow = Map<string, string>;

const attendanceStatusByLabel = {
  출석: "present",
  결석: "absent",
  청가: "leave",
  출장: "trip",
  결석신고서: "absent"
} as const;

type AttendanceStatus =
  (typeof attendanceStatusByLabel)[keyof typeof attendanceStatusByLabel];

const emptyAttendanceLabels = new Set(["-", "–", "—"]);

function decodeXmlText(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function readTextNodes(xml: string): string {
  return decodeXmlText(
    [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
      .map((match) => match[1] ?? "")
      .join("")
  );
}

function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((match) =>
    readTextNodes(match[1] ?? "")
  );
}

function parseWorksheetRows(
  xml: string,
  sharedStrings: string[]
): SpreadsheetRow[] {
  return [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((rowMatch) => {
    const row = new Map<string, string>();
    const rowXml = rowMatch[1] ?? "";
    for (const cellMatch of rowXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attributes = cellMatch[1] ?? "";
      const cellXml = cellMatch[2] ?? "";
      const reference = attributes.match(/\br="([A-Z]+)\d+"/)?.[1];
      if (!reference) {
        continue;
      }

      const cellType = attributes.match(/\bt="([^"]+)"/)?.[1];
      const value = cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
      if (cellType === "s") {
        const index = Number.parseInt(value, 10);
        const sharedValue = sharedStrings[index];
        if (!Number.isFinite(index) || sharedValue === undefined) {
          throw new Error(
            `Invalid XLSX shared string index for cell ${reference}.`
          );
        }
        row.set(reference, sharedValue.trim());
      } else if (cellType === "inlineStr") {
        row.set(reference, readTextNodes(cellXml).trim());
      } else {
        row.set(reference, decodeXmlText(value).trim());
      }
    }
    return row;
  });
}

function parseMeetingDate(value: string): string | null {
  const match = value.match(/^\((\d{4})년(\d{1,2})월(\d{1,2})일\)$/);
  if (!match) {
    return null;
  }

  const [, year, month, day] = match;
  if (!year || !month || !day) {
    return null;
  }
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function parseSessionNo(
  rows: SpreadsheetRow[],
  dateHeaderRowIndex: number
): number {
  const sessionNumbers = new Set<number>();
  for (const row of rows.slice(0, dateHeaderRowIndex + 1)) {
    for (const value of row.values()) {
      const match = value.match(/(?:^|\s)(\d+)회(?:\(|\s|$)/);
      if (match?.[1]) {
        sessionNumbers.add(Number.parseInt(match[1], 10));
      }
    }
  }

  if (sessionNumbers.size !== 1) {
    throw new Error(
      `Expected exactly one National Assembly session header, found ${sessionNumbers.size}.`
    );
  }

  return [...sessionNumbers][0]!;
}

function uniqueNames(names: string[]): string[] {
  return [...new Set(names)];
}

export function parseOfficialPlenaryAttendanceXlsx(args: {
  content: Uint8Array;
  sourceUrl: string;
  retrievedAt: string;
  sourceHash?: string;
  documentIdPrefix?: string;
}): OfficialPlenaryAttendanceFileMeeting[] {
  const contents = unzipSync(args.content);
  const sharedStringsXml = contents["xl/sharedStrings.xml"];
  const worksheetXml = contents["xl/worksheets/sheet1.xml"];
  if (!sharedStringsXml || !worksheetXml) {
    throw new Error(
      "Official plenary attendance XLSX is missing shared strings or sheet1."
    );
  }

  const rows = parseWorksheetRows(
    strFromU8(worksheetXml),
    parseSharedStrings(strFromU8(sharedStringsXml))
  );
  const dateHeaders: Array<{ column: string; meetingDate: string }> = [];
  let dateHeaderRowIndex = -1;
  let memberNameColumn: string | null = null;

  rows.forEach((row, index) => {
    const rowDates = [...row.entries()].flatMap(([column, value]) => {
      const meetingDate = parseMeetingDate(value);
      return meetingDate ? [{ column, meetingDate }] : [];
    });
    if (rowDates.length > 0) {
      if (dateHeaderRowIndex >= 0) {
        throw new Error(
          "Official plenary attendance XLSX has multiple date header rows."
        );
      }
      dateHeaderRowIndex = index;
      dateHeaders.push(...rowDates);
      memberNameColumn =
        [...row.entries()].find(([, value]) => value === "의원명")?.[0] ?? null;
    }
  });

  if (dateHeaderRowIndex < 0 || dateHeaders.length === 0 || !memberNameColumn) {
    throw new Error(
      "Official plenary attendance XLSX is missing date or member headers."
    );
  }

  const sessionNo = parseSessionNo(rows, dateHeaderRowIndex);
  const namesByDateAndStatus = new Map<
    string,
    Record<AttendanceStatus, string[]>
  >(
    dateHeaders.map(({ meetingDate }) => [
      meetingDate,
      { present: [], absent: [], leave: [], trip: [] }
    ])
  );

  for (const row of rows.slice(dateHeaderRowIndex + 1)) {
    const name = row.get(memberNameColumn)?.trim();
    if (!name) {
      continue;
    }
    const dateCells = dateHeaders.flatMap(({ column, meetingDate }) => {
      const label = row.get(column)?.trim();
      return label ? [{ column, meetingDate, label }] : [];
    });
    if (dateCells.length === 0) {
      continue;
    }

    for (const { column, meetingDate, label } of dateCells) {
      if (emptyAttendanceLabels.has(label)) {
        continue;
      }
      const status =
        attendanceStatusByLabel[label as keyof typeof attendanceStatusByLabel];
      if (!status) {
        throw new Error(
          `Unknown non-empty plenary attendance status "${label}" in ${column} for ${name}.`
        );
      }
      namesByDateAndStatus.get(meetingDate)?.[status].push(name);
    }
  }

  const sourceHash = args.sourceHash ?? sha256Buffer(Buffer.from(args.content));
  const documentIdPrefix =
    args.documentIdPrefix?.trim() || "official-plenary-attendance";

  return dateHeaders
    .map(({ meetingDate }) => {
      const names = namesByDateAndStatus.get(meetingDate);
      if (!names) {
        throw new Error(`Missing attendance accumulator for ${meetingDate}.`);
      }
      return {
        documentId: `${documentIdPrefix}-${sessionNo}-${meetingDate}`,
        sessionNo,
        meetingDate,
        meetingType: "plenary" as const,
        committeeName: null,
        presentNames: uniqueNames(names.present),
        absentNames: uniqueNames(names.absent),
        leaveNames: uniqueNames(names.leave),
        tripNames: uniqueNames(names.trip),
        sourceUrl: args.sourceUrl,
        retrievedAt: args.retrievedAt,
        sourceHash
      };
    })
    .sort((left, right) => left.meetingDate.localeCompare(right.meetingDate));
}
