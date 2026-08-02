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

export type OfficialAttendanceMemberReference = {
  name: string;
  officialProfileUrl: string;
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
  presentMemberReferences?: OfficialAttendanceMemberReference[];
  leaveMemberReferences?: OfficialAttendanceMemberReference[];
  tripMemberReferences?: OfficialAttendanceMemberReference[];
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

function readAttendanceSection(
  html: string,
  sectionPattern: RegExp
): {
  names: string[];
  memberReferences: OfficialAttendanceMemberReference[];
  parsedCount: number;
  publishedCount: number | null;
} {
  const $ = load(html);
  const heading = $("strong")
    .filter((_, element) =>
      sectionPattern.test($(element).text().replace(/\s+/g, " ").trim())
    )
    .first();
  if (heading.length === 0) {
    return {
      names: [],
      memberReferences: [],
      parsedCount: 0,
      publishedCount: null
    };
  }

  const nameElements = heading
    .closest("p")
    .next(".con")
    .find("a[href*='/members/'] .name, .name");
  const names = nameElements
    .map((_, element) => normalizeComparableText($(element).text()))
    .get()
    .filter(Boolean);
  const memberReferences = nameElements
    .map((_, element) => {
      const name = normalizeComparableText($(element).text());
      const href = $(element).closest("a[href*='/members/']").attr("href");
      if (!name || !href) {
        return null;
      }

      try {
        const url = new URL(href, "https://www.assembly.go.kr");
        if (
          url.hostname !== "www.assembly.go.kr" ||
          !url.pathname.includes("/members/")
        ) {
          return null;
        }
        url.hash = "";
        return {
          name,
          officialProfileUrl: url.toString()
        };
      } catch {
        return null;
      }
    })
    .get()
    .filter(
      (
        reference
      ): reference is {
        name: string;
        officialProfileUrl: string;
      } => reference !== null
    );
  const publishedCount = Number.parseInt(
    heading.text().match(/\((\d+)인\)/)?.[1] ?? "",
    10
  );
  return {
    names: [...new Set(names)],
    memberReferences: [
      ...new Map(
        memberReferences.map((reference) => [
          `${reference.name}:${reference.officialProfileUrl}`,
          reference
        ])
      ).values()
    ],
    parsedCount: names.length,
    publishedCount: Number.isFinite(publishedCount) ? publishedCount : null
  };
}

function assertAttendanceSectionCount(
  section: {
    names: string[];
    parsedCount: number;
    publishedCount: number | null;
  },
  acceptedCount = section.names.length
): void {
  if (
    section.parsedCount !== section.names.length ||
    (section.publishedCount !== null &&
      section.publishedCount !== acceptedCount)
  ) {
    throw new Error(
      `Official minutes attendance list count mismatch: heading ${section.publishedCount}, parsed ${section.parsedCount}, unique ${section.names.length}.`
    );
  }
}

function normalizeMemberProfileUrlForComparison(value: string): string {
  try {
    const url = new URL(value, "https://www.assembly.go.kr");
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().toLowerCase();
  } catch {
    return value.trim().toLowerCase();
  }
}

function normalizeLowerPriorityAttendanceSection(args: {
  names: string[];
  memberReferences: OfficialAttendanceMemberReference[];
  higherPriorityNames: ReadonlySet<string>;
  higherPriorityReferences: OfficialAttendanceMemberReference[];
}): {
  names: string[];
  memberReferences: OfficialAttendanceMemberReference[];
} {
  const higherPriorityIdentities = new Set(
    args.higherPriorityReferences.map((reference) =>
      [
        normalizeComparableText(reference.name),
        normalizeMemberProfileUrlForComparison(reference.officialProfileUrl)
      ].join(":")
    )
  );
  const memberReferences = args.memberReferences.filter(
    (reference) =>
      !higherPriorityIdentities.has(
        [
          normalizeComparableText(reference.name),
          normalizeMemberProfileUrlForComparison(reference.officialProfileUrl)
        ].join(":")
      )
  );
  const retainedReferenceNames = new Set(
    memberReferences.map((reference) => reference.name)
  );
  const originalReferenceNames = new Set(
    args.memberReferences.map((reference) => reference.name)
  );
  const higherPriorityReferenceNames = new Set(
    args.higherPriorityReferences.map((reference) =>
      normalizeComparableText(reference.name)
    )
  );
  const names = args.names.filter((name) => {
    if (retainedReferenceNames.has(name)) {
      return true;
    }
    if (originalReferenceNames.has(name)) {
      return false;
    }
    // A linked higher-priority row and an unlinked lower-priority row can
    // represent two different members with the same name. Preserve the
    // lower-priority row so the fact builder can assign it to the remaining
    // eligible identity.
    if (higherPriorityReferenceNames.has(normalizeComparableText(name))) {
      return true;
    }
    return !args.higherPriorityNames.has(name);
  });

  return { names, memberReferences };
}

export function parseOfficialMinutesAttendanceHtml(html: string): {
  presentNames: string[];
  leaveNames: string[];
  tripNames: string[];
  presentMemberReferences: OfficialAttendanceMemberReference[];
  leaveMemberReferences: OfficialAttendanceMemberReference[];
  tripMemberReferences: OfficialAttendanceMemberReference[];
} {
  const present = readAttendanceSection(html, /^◯출석 (?:의원|위원)\s*\(/);
  const leave = readAttendanceSection(html, /^◯청가 (?:의원|위원)\s*\(/);
  const trip = readAttendanceSection(html, /^◯출장 (?:의원|위원)\s*\(/);
  assertAttendanceSectionCount(leave);
  assertAttendanceSectionCount(trip);
  const presentNames = new Set(present.names);
  const normalizedLeave = normalizeLowerPriorityAttendanceSection({
    names: leave.names,
    memberReferences: leave.memberReferences,
    higherPriorityNames: presentNames,
    higherPriorityReferences: present.memberReferences
  });
  const leaveNames = new Set(normalizedLeave.names);
  const normalizedTrip = normalizeLowerPriorityAttendanceSection({
    names: trip.names,
    memberReferences: trip.memberReferences,
    higherPriorityNames: new Set([...presentNames, ...leaveNames]),
    higherPriorityReferences: [
      ...present.memberReferences,
      ...normalizedLeave.memberReferences
    ]
  });
  const normalizedAttendanceCount =
    present.names.length +
    normalizedLeave.names.length +
    normalizedTrip.names.length;
  const publishedPresentCount =
    present.publishedCount === normalizedAttendanceCount
      ? normalizedAttendanceCount
      : present.names.length;
  assertAttendanceSectionCount(present, publishedPresentCount);

  return {
    presentNames: present.names,
    leaveNames: normalizedLeave.names,
    tripNames: normalizedTrip.names,
    presentMemberReferences: present.memberReferences,
    leaveMemberReferences: normalizedLeave.memberReferences,
    tripMemberReferences: normalizedTrip.memberReferences
  };
}

function isMainStandingCommittee(title: string): boolean {
  return (
    /위원회 회의록$/.test(title) &&
    !title.includes("(") &&
    !title.includes("소위원회") &&
    !title.includes("안건조정위원회") &&
    !title.includes("특별위원회")
  );
}

function isSubcommitteeMeetingSubtitle(
  value: string | null | undefined
): boolean {
  return /(?:소위원회|안건조정위원회)(?:회의록)?$/.test(
    normalizeComparableText(value)
  );
}

export function isOfficialAttendanceRelevantMinutesTitle(
  title: string,
  meetingSubtitle?: string | null
): boolean {
  return (
    title.includes("국회본회의 회의록") ||
    (isMainStandingCommittee(title) &&
      !isSubcommitteeMeetingSubtitle(meetingSubtitle))
  );
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

    let meetingSubtitle: string | null | undefined;
    if (item.metadataRelativePath) {
      try {
        const metadata = JSON.parse(
          await readFile(
            join(args.dataRepoDir, item.metadataRelativePath),
            "utf8"
          )
        ) as MirroredDocumentMetadata;
        meetingSubtitle = metadata.sourceMetadata?.meetingSubtitle;
        if (
          isPlenary &&
          normalizeComparableText(meetingSubtitle) === "개회식"
        ) {
          continue;
        }
      } catch {
        // Older mirrors may not include metadata. The HTML remains authoritative.
      }
    }
    if (!isOfficialAttendanceRelevantMinutesTitle(title, meetingSubtitle)) {
      continue;
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
        tripNames: [],
        presentMemberReferences: [],
        leaveMemberReferences: [],
        tripMemberReferences: []
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
      presentMemberReferences: attendance.presentMemberReferences,
      leaveMemberReferences: attendance.leaveMemberReferences,
      tripMemberReferences: attendance.tripMemberReferences,
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
  ): OfficialMinutesAttendanceMeeting => {
    const filterReferences = (
      references: OfficialAttendanceMemberReference[] | undefined,
      names: string[]
    ): OfficialAttendanceMemberReference[] => {
      const allowedNames = new Set(names.map(normalizeComparableText));
      return (references ?? []).filter((reference) =>
        allowedNames.has(normalizeComparableText(reference.name))
      );
    };

    return {
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
      presentMemberReferences: filterReferences(
        minutesMeeting?.presentMemberReferences,
        supplement.presentNames
      ),
      leaveMemberReferences: filterReferences(
        minutesMeeting?.leaveMemberReferences,
        supplement.leaveNames
      ),
      tripMemberReferences: filterReferences(
        minutesMeeting?.tripMemberReferences,
        supplement.tripNames
      ),
      requiresExplicitStatus: true,
      sourceUrl: supplement.sourceUrl,
      retrievedAt: supplement.retrievedAt,
      sourceHash: supplement.sourceHash
    };
  };

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
