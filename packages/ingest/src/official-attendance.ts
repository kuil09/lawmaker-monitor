import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { load } from "cheerio";

import { normalizeComparableText } from "./parsers/helpers.js";
import { readString, sha256 } from "./utils.js";

import type { OfficialPlenaryAttendanceFileMeeting } from "./plenary-attendance-files.js";
import type { MemberRecord } from "@lawmaker-monitor/schemas";

export type CommitteeCareerRecord = {
  assemblyNo: number;
  memberName: string;
  committeeName: string;
  startDate: string;
  endDate: string | null;
};

export type OfficialMinutesAttendanceMeeting = {
  documentId: string;
  meetingDate: string;
  meetingType: "plenary" | "committee";
  committeeName: string | null;
  presentNames: string[];
  absentNames?: string[];
  leaveNames: string[];
  tripNames: string[];
  requiresExplicitStatus?: boolean;
  sourceUrl: string;
  retrievedAt: string;
  sourceHash: string;
};

type MirroredDocumentIndex = {
  updatedAt?: string;
  items?: Array<{
    documentId?: string;
    sourceId?: string;
    sourceUrl?: string;
    title?: string;
    publishedDate?: string | null;
    latestRelativePath?: string;
    metadataRelativePath?: string;
    lastMirroredAt?: string;
    currentContentSha256?: string;
  }>;
};

type MirroredDocumentMetadata = {
  sourceMetadata?: {
    meetingSubtitle?: string | null;
  };
};

function normalizeDate(value: string): string | null {
  const match = value.trim().match(/^(\d{4})[.-](\d{2})[.-](\d{2})$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function normalizeCommitteeName(value: string): string {
  return value
    .replace(/^제\d+대\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseCommitteeCareerSheetJson(
  payload: string
): CommitteeCareerRecord[] {
  const parsed = JSON.parse(payload) as {
    data?: Array<Record<string, unknown>>;
  };

  return (parsed.data ?? []).flatMap((row): CommitteeCareerRecord[] => {
    const assemblyLabel = readString(row.PROFILE_UNIT_NM);
    const assemblyNo = Number.parseInt(
      assemblyLabel?.match(/(\d+)/)?.[1] ?? "",
      10
    );
    const memberName = readString(row.HG_NM);
    const rawCommitteeName = readString(row.PROFILE_SJ);
    const period = readString(row.FRTO_DATE);
    const [rawStartDate, rawEndDate] = period
      ?.split("~")
      .map((value) => value.trim()) ?? ["", ""];
    const startDate = rawStartDate ? normalizeDate(rawStartDate) : null;
    const endDate = rawEndDate ? normalizeDate(rawEndDate) : null;

    if (
      !Number.isFinite(assemblyNo) ||
      assemblyNo <= 0 ||
      !memberName ||
      !rawCommitteeName ||
      !startDate
    ) {
      return [];
    }

    return [
      {
        assemblyNo,
        memberName,
        committeeName: normalizeCommitteeName(rawCommitteeName),
        startDate,
        endDate
      }
    ];
  });
}

function readSectionNames(html: string, sectionPattern: RegExp): string[] {
  const $ = load(html);
  const heading = $("strong")
    .filter((_, element) =>
      sectionPattern.test($(element).text().replace(/\s+/g, " ").trim())
    )
    .first();
  if (heading.length === 0) {
    return [];
  }

  const names = heading
    .closest("p")
    .next(".con")
    .find("a[href*='/members/'] .name, .name")
    .map((_, element) => normalizeComparableText($(element).text()))
    .get()
    .filter(Boolean);
  const publishedCount = Number.parseInt(
    heading.text().match(/\((\d+)인\)/)?.[1] ?? "",
    10
  );
  const uniqueNames = [...new Set(names)];
  if (
    Number.isFinite(publishedCount) &&
    (publishedCount !== names.length || publishedCount !== uniqueNames.length)
  ) {
    throw new Error(
      `Official minutes attendance list count mismatch: heading ${publishedCount}, parsed ${names.length}, unique ${uniqueNames.length}.`
    );
  }

  return uniqueNames;
}

export function parseOfficialMinutesAttendanceHtml(html: string): {
  presentNames: string[];
  leaveNames: string[];
  tripNames: string[];
} {
  return {
    presentNames: readSectionNames(html, /^◯출석 (?:의원|위원)\s*\(/),
    leaveNames: readSectionNames(html, /^◯청가 (?:의원|위원)\s*\(/),
    tripNames: readSectionNames(html, /^◯출장 (?:의원|위원)\s*\(/)
  };
}

function isMainStandingCommittee(title: string): boolean {
  return (
    /위원회 회의록$/.test(title) &&
    !title.includes("(") &&
    !title.includes("소위원회") &&
    !title.includes("특별위원회")
  );
}

export function isOfficialAttendanceRelevantMinutesTitle(
  title: string
): boolean {
  return title.includes("국회본회의 회의록") || isMainStandingCommittee(title);
}

function assertOfficialMinutesUrl(sourceUrl: string): void {
  const url = new URL(sourceUrl);
  if (
    url.origin !== "https://record.assembly.go.kr" ||
    url.pathname !== "/assembly/viewer/minutes/xml.do"
  ) {
    throw new Error(
      `Attendance minutes must use the official National Assembly viewer, got ${sourceUrl}.`
    );
  }
}

function isPlenaryOpeningCeremonyHtml(html: string): boolean {
  const $ = load(html);
  return (
    normalizeComparableText(
      $(".minutes_header .tit_wrap > .num").first().text()
    ) === "개회식" ||
    normalizeComparableText($("h2 strong").first().text()).includes(
      "개회식국회본회의"
    )
  );
}

export async function loadOfficialMinutesAttendanceMeetings(args: {
  dataRepoDir: string;
  assemblyNo: number;
}): Promise<OfficialMinutesAttendanceMeeting[]> {
  const indexPath = join(args.dataRepoDir, "raw/index/document_index.json");
  let index: MirroredDocumentIndex;
  try {
    index = JSON.parse(
      await readFile(indexPath, "utf8")
    ) as MirroredDocumentIndex;
  } catch {
    return [];
  }

  const assemblyPrefix = `제${args.assemblyNo}대 `;
  const meetings: OfficialMinutesAttendanceMeeting[] = [];

  for (const item of index.items ?? []) {
    const title = item.title?.trim() ?? "";
    const isPlenary = title.includes("국회본회의 회의록");
    if (
      item.sourceId !== "assembly-minutes" ||
      !title.startsWith(assemblyPrefix) ||
      (!isPlenary && !isMainStandingCommittee(title)) ||
      !item.documentId ||
      !item.sourceUrl ||
      !item.publishedDate ||
      !item.latestRelativePath
    ) {
      continue;
    }

    if (isPlenary && item.metadataRelativePath) {
      try {
        const metadata = JSON.parse(
          await readFile(
            join(args.dataRepoDir, item.metadataRelativePath),
            "utf8"
          )
        ) as MirroredDocumentMetadata;
        if (
          normalizeComparableText(metadata.sourceMetadata?.meetingSubtitle) ===
          "개회식"
        ) {
          continue;
        }
      } catch {
        // Older mirrors may not include metadata. The HTML remains authoritative.
      }
    }

    assertOfficialMinutesUrl(item.sourceUrl);
    const html = await readFile(
      join(args.dataRepoDir, item.latestRelativePath),
      "utf8"
    );
    if (isPlenary && isPlenaryOpeningCeremonyHtml(html)) {
      continue;
    }
    let attendance: ReturnType<typeof parseOfficialMinutesAttendanceHtml>;
    try {
      attendance = parseOfficialMinutesAttendanceHtml(html);
    } catch (error) {
      if (
        !isPlenary ||
        !(error instanceof Error) ||
        !error.message.includes("attendance list count mismatch")
      ) {
        throw error;
      }
      attendance = {
        presentNames: [],
        leaveNames: [],
        tripNames: []
      };
    }

    const committeeName = isPlenary
      ? null
      : normalizeCommitteeName(
          title
            .replace(assemblyPrefix, "")
            .replace(/^제\d+회\s*/, "")
            .replace(/\s*회의록$/, "")
        );

    meetings.push({
      documentId: item.documentId,
      meetingDate: item.publishedDate,
      meetingType: isPlenary ? "plenary" : "committee",
      committeeName,
      presentNames: attendance.presentNames,
      absentNames: [],
      leaveNames: attendance.leaveNames,
      tripNames: attendance.tripNames,
      requiresExplicitStatus: false,
      sourceUrl: item.sourceUrl,
      retrievedAt:
        item.lastMirroredAt ?? index.updatedAt ?? new Date(0).toISOString(),
      sourceHash: item.currentContentSha256 ?? sha256(html)
    });
  }

  return meetings.sort((left, right) => {
    const byDate = left.meetingDate.localeCompare(right.meetingDate);
    return byDate || left.documentId.localeCompare(right.documentId);
  });
}

function hasPublishedAttendance(
  meeting: Pick<
    OfficialMinutesAttendanceMeeting,
    "presentNames" | "leaveNames" | "tripNames"
  >
): boolean {
  return (
    meeting.presentNames.length > 0 ||
    meeting.leaveNames.length > 0 ||
    meeting.tripNames.length > 0
  );
}

export function supplementOfficialMinutesAttendance(args: {
  minutesMeetings: OfficialMinutesAttendanceMeeting[];
  plenaryFileMeetings: OfficialPlenaryAttendanceFileMeeting[];
}): OfficialMinutesAttendanceMeeting[] {
  const fileMeetingsByDate = new Map<
    string,
    OfficialPlenaryAttendanceFileMeeting[]
  >();
  for (const meeting of args.plenaryFileMeetings) {
    fileMeetingsByDate.set(meeting.meetingDate, [
      ...(fileMeetingsByDate.get(meeting.meetingDate) ?? []),
      meeting
    ]);
  }

  for (const [meetingDate, meetings] of fileMeetingsByDate) {
    if (meetings.length > 1) {
      throw new Error(
        `Multiple official plenary attendance files contain ${meetingDate}.`
      );
    }
  }

  const plenaryMinutesDates = new Set<string>();
  for (const meeting of args.minutesMeetings) {
    if (meeting.meetingType !== "plenary") {
      continue;
    }
    if (plenaryMinutesDates.has(meeting.meetingDate)) {
      throw new Error(
        `Multiple official plenary minutes contain ${meeting.meetingDate}.`
      );
    }
    plenaryMinutesDates.add(meeting.meetingDate);
  }

  const fromAttendanceFile = (
    supplement: OfficialPlenaryAttendanceFileMeeting,
    minutesMeeting?: OfficialMinutesAttendanceMeeting
  ): OfficialMinutesAttendanceMeeting => ({
    ...(minutesMeeting ?? {
      documentId: supplement.documentId,
      meetingDate: supplement.meetingDate,
      meetingType: "plenary" as const,
      committeeName: null
    }),
    presentNames: supplement.presentNames,
    absentNames: supplement.absentNames,
    leaveNames: supplement.leaveNames,
    tripNames: supplement.tripNames,
    requiresExplicitStatus: true,
    sourceUrl: supplement.sourceUrl,
    retrievedAt: supplement.retrievedAt,
    sourceHash: supplement.sourceHash
  });

  const supplementedMinutes = args.minutesMeetings.flatMap((meeting) => {
    if (meeting.meetingType === "plenary") {
      const supplements = fileMeetingsByDate.get(meeting.meetingDate) ?? [];
      if (supplements.length > 0) {
        return [fromAttendanceFile(supplements[0]!, meeting)];
      }
    }
    return hasPublishedAttendance(meeting) ? [meeting] : [];
  });

  const fileOnlyMeetings = args.plenaryFileMeetings
    .filter((meeting) => !plenaryMinutesDates.has(meeting.meetingDate))
    .map((meeting) => fromAttendanceFile(meeting));

  return [...supplementedMinutes, ...fileOnlyMeetings].sort((left, right) => {
    const byDate = left.meetingDate.localeCompare(right.meetingDate);
    return byDate || left.documentId.localeCompare(right.documentId);
  });
}

function buildMemberResolver(
  members: MemberRecord[]
): Map<string, MemberRecord> {
  const byName = new Map<string, MemberRecord[]>();
  for (const member of members) {
    const key = normalizeComparableText(member.name);
    const candidates = byName.get(key) ?? [];
    candidates.push(member);
    byName.set(key, candidates);
  }

  return new Map(
    [...byName.entries()].flatMap(([name, candidates]) =>
      candidates.length === 1 && candidates[0] ? [[name, candidates[0]]] : []
    )
  );
}

export function resolveCommitteeCareerMembers(args: {
  careers: CommitteeCareerRecord[];
  members: MemberRecord[];
}): Array<CommitteeCareerRecord & { memberId: string }> {
  const memberByName = buildMemberResolver(args.members);

  return args.careers.flatMap((career) => {
    const member = memberByName.get(normalizeComparableText(career.memberName));
    return member ? [{ ...career, memberId: member.memberId }] : [];
  });
}
