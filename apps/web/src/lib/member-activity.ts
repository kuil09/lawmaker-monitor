import type {
  MemberActivityCalendarAssembly,
  MemberActivityCalendarMember
} from "@lawmaker-monitor/schemas";

export type CalendarDisplayState =
  | "empty"
  | "yes"
  | "no"
  | "abstain"
  | "absent"
  | "unknown";

export type CalendarCell = {
  date: string | null;
  state: CalendarDisplayState;
  yesCount: number;
  noCount: number;
  abstainCount: number;
  absentCount: number;
  unknownCount: number;
  totalRollCalls: number;
};

export type CalendarWeek = {
  label: string;
  days: CalendarCell[];
};

export type CalendarComparableState = Exclude<CalendarDisplayState, "empty">;
export type HeadToHeadSummary = {
  leftNegativeDays: number;
  rightNegativeDays: number;
  leftAbsentDays: number;
  rightAbsentDays: number;
  leftCurrentStreak: number;
  rightCurrentStreak: number;
  leftLongestStreak: number;
  rightLongestStreak: number;
};

export type MemberDayBreakdown = {
  yesDays: number;
  noDays: number;
  abstainDays: number;
  absentDays: number;
};

export type MemberAttendanceSummary = MemberDayBreakdown & {
  eligibleDays: number;
  attendedDays: number;
  attendanceRate: number;
};

function parseDateKey(dateKey: string): Date {
  const [yearValue, monthValue, dayValue] = dateKey
    .split("-")
    .map((value) => Number(value));
  const year = Number.isFinite(yearValue) ? Number(yearValue) : 1970;
  const month = Number.isFinite(monthValue) ? Number(monthValue) : 1;
  const day = Number.isFinite(dayValue) ? Number(dayValue) : 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, amount: number): Date {
  return new Date(date.getTime() + amount * 24 * 60 * 60 * 1000);
}

function matchesQuery(
  member: MemberActivityCalendarMember,
  query: string
): boolean {
  if (!query) {
    return true;
  }

  const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
  if (!normalizedQuery) {
    return true;
  }

  return (
    member.name.toLocaleLowerCase("ko-KR").includes(normalizedQuery) ||
    member.party.toLocaleLowerCase("ko-KR").includes(normalizedQuery)
  );
}

export function getMemberDayBreakdown(
  member: MemberActivityCalendarMember
): MemberDayBreakdown {
  return {
    yesDays: member.dayStates.filter((day) => day.state === "yes").length,
    noDays: member.dayStates.filter((day) => day.state === "no").length,
    abstainDays: member.dayStates.filter((day) => day.state === "abstain")
      .length,
    absentDays: member.dayStates.filter((day) => day.state === "absent").length
  };
}

export function getMemberAttendanceSummary(
  member: MemberActivityCalendarMember
): MemberAttendanceSummary {
  const breakdown = getMemberDayBreakdown(member);
  const eligibleDays = member.dayStates.length;
  const attendedDays = Math.max(0, eligibleDays - breakdown.absentDays);

  return {
    ...breakdown,
    eligibleDays,
    attendedDays,
    attendanceRate: eligibleDays > 0 ? attendedDays / eligibleDays : 0
  };
}

export function getCurrentStreak(
  member: MemberActivityCalendarMember,
  includeAbsent: boolean
): number {
  return includeAbsent
    ? member.currentNegativeOrAbsentStreak
    : member.currentNegativeStreak;
}

export function getLongestStreak(
  member: MemberActivityCalendarMember,
  includeAbsent: boolean
): number {
  return includeAbsent
    ? member.longestNegativeOrAbsentStreak
    : member.longestNegativeStreak;
}

export function rankActivityMembers(
  assembly: MemberActivityCalendarAssembly,
  includeAbsent: boolean,
  query = ""
): MemberActivityCalendarMember[] {
  return assembly.members
    .filter((member) => matchesQuery(member, query))
    .sort((left, right) => {
      const rightStreak = getCurrentStreak(right, includeAbsent);
      const leftStreak = getCurrentStreak(left, includeAbsent);
      if (rightStreak !== leftStreak) {
        return rightStreak - leftStreak;
      }

      const rightNegativeDays =
        right.negativeDays + (includeAbsent ? right.absentDays : 0);
      const leftNegativeDays =
        left.negativeDays + (includeAbsent ? left.absentDays : 0);
      if (rightNegativeDays !== leftNegativeDays) {
        return rightNegativeDays - leftNegativeDays;
      }

      return left.name.localeCompare(right.name, "ko-KR");
    });
}

export function buildCalendarWeeks(
  assembly: MemberActivityCalendarAssembly,
  member: MemberActivityCalendarMember
): CalendarWeek[] {
  if (!assembly.startDate || !assembly.endDate) {
    return [];
  }

  const stateByDate = new Map(
    member.dayStates.map((dayState) => [dayState.date, dayState])
  );
  const calendarStart = parseDateKey(assembly.startDate);
  const calendarEnd = parseDateKey(assembly.endDate);
  let gridStart = calendarStart;
  let gridEnd = calendarEnd;

  while (gridStart.getUTCDay() !== 0) {
    gridStart = addDays(gridStart, -1);
  }

  while (gridEnd.getUTCDay() !== 6) {
    gridEnd = addDays(gridEnd, 1);
  }

  const weeks: CalendarWeek[] = [];
  let cursor = gridStart;

  while (cursor.getTime() <= gridEnd.getTime()) {
    const days: CalendarCell[] = [];

    for (let offset = 0; offset < 7; offset += 1) {
      const current = addDays(cursor, offset);
      const currentKey = formatDateKey(current);
      const inRange =
        currentKey.localeCompare(assembly.startDate) >= 0 &&
        currentKey.localeCompare(assembly.endDate) <= 0;

      if (!inRange) {
        days.push({
          date: null,
          state: "empty",
          yesCount: 0,
          noCount: 0,
          abstainCount: 0,
          absentCount: 0,
          unknownCount: 0,
          totalRollCalls: 0
        });
        continue;
      }

      const knownState = stateByDate.get(currentKey);
      if (knownState) {
        days.push({
          date: currentKey,
          state: knownState.state,
          yesCount: knownState.yesCount,
          noCount: knownState.noCount,
          abstainCount: knownState.abstainCount,
          absentCount: knownState.absentCount,
          unknownCount: knownState.unknownCount,
          totalRollCalls: knownState.totalRollCalls
        });
        continue;
      }

      days.push({
        date: currentKey,
        state: "empty",
        yesCount: 0,
        noCount: 0,
        abstainCount: 0,
        absentCount: 0,
        unknownCount: 0,
        totalRollCalls: 0
      });
    }

    const firstDate = days.find((day) => day.date)?.date;
    weeks.push({
      label: firstDate ? `${Number(firstDate.slice(5, 7))}월` : "",
      days
    });
    cursor = addDays(cursor, 7);
  }

  return weeks;
}

export function buildMonthLabels(weeks: CalendarWeek[]): string[] {
  let previousLabel = "";

  return weeks.map((week, index) => {
    const firstOfMonth = week.days.find((day) =>
      day.date?.endsWith("-01")
    )?.date;
    const currentLabel =
      index === 0
        ? week.label
        : firstOfMonth
          ? `${Number(firstOfMonth.slice(5, 7))}월`
          : week.label && week.label !== previousLabel
            ? week.label
            : "";
    if (!currentLabel || currentLabel === previousLabel) {
      return "";
    }

    previousLabel = currentLabel;
    return currentLabel;
  });
}

export function buildStateByDate(
  _assembly: MemberActivityCalendarAssembly,
  member: MemberActivityCalendarMember
): Map<string, CalendarComparableState> {
  return new Map(
    member.dayStates.map((dayState) => [dayState.date, dayState.state])
  );
}

export function buildHeadToHeadSummary(
  assembly: MemberActivityCalendarAssembly,
  left: MemberActivityCalendarMember,
  right: MemberActivityCalendarMember,
  includeAbsent: boolean
): HeadToHeadSummary {
  return {
    leftNegativeDays: left.negativeDays,
    rightNegativeDays: right.negativeDays,
    leftAbsentDays: left.absentDays,
    rightAbsentDays: right.absentDays,
    leftCurrentStreak: getCurrentStreak(left, includeAbsent),
    rightCurrentStreak: getCurrentStreak(right, includeAbsent),
    leftLongestStreak: getLongestStreak(left, includeAbsent),
    rightLongestStreak: getLongestStreak(right, includeAbsent)
  };
}
