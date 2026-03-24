import { describe, expect, it } from "vitest";

import {
  buildCalendarWeeks,
  buildMonthLabels
} from "../../apps/web/src/lib/member-activity.js";

describe("member activity calendar helpers", () => {
  it("places month labels on the first visible week of each month", () => {
    const assembly = {
      assemblyNo: 22,
      label: "제22대 국회",
      startDate: "2026-07-29",
      endDate: "2026-08-12",
      votingDates: ["2026-07-31", "2026-08-05", "2026-08-12"],
      members: []
    };
    const member = {
      memberId: "M001",
      name: "김아라",
      party: "미래개혁당",
      photoUrl: null,
      officialProfileUrl: null,
      officialExternalUrl: null,
      currentNegativeStreak: 0,
      currentNegativeOrAbsentStreak: 0,
      longestNegativeStreak: 0,
      longestNegativeOrAbsentStreak: 0,
      negativeDays: 0,
      absentDays: 3,
      dayStates: [],
      voteRecordCount: 0,
      voteRecordsPath: "exports/member_activity_calendar_members/M001.json",
      voteRecords: []
    };

    const weeks = buildCalendarWeeks(assembly, member);
    const monthLabels = buildMonthLabels(weeks);

    expect(monthLabels).toEqual(["7월", "8월", ""]);
  });
});
