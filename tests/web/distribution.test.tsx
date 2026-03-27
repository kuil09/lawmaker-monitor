import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildDistributionChartDomain,
  buildDistributionMembers,
  buildDistributionPartySummaries,
  getDefaultDistributionMemberId
} from "../../apps/web/src/lib/distribution.js";

const fixturesDir = resolve(process.cwd(), "tests/fixtures/contracts");
const accountabilitySummaryFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, "accountability_summary.json"), "utf8")
);
const memberActivityCalendarFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, "member_activity_calendar.json"), "utf8")
);

describe("distribution helpers", () => {
  it("builds ranked distribution members from accountability and activity exports", () => {
    const members = buildDistributionMembers(
      accountabilitySummaryFixture,
      memberActivityCalendarFixture
    );

    expect(members).toHaveLength(2);
    expect(getDefaultDistributionMemberId(members)).toBe("M002");
    expect(members[0]).toMatchObject({
      memberId: "M002",
      negativeRate: 0.5,
      absentRate: 0.5,
      attendanceRate: 2 / 3,
      currentNegativeOrAbsentStreak: 3
    });
    expect(members[1]).toMatchObject({
      memberId: "M001",
      negativeRate: 0.5,
      absentRate: 0,
      attendanceRate: 1
    });
  });

  it("summarizes party averages for the distribution legend", () => {
    const members = buildDistributionMembers(
      accountabilitySummaryFixture,
      memberActivityCalendarFixture
    );
    const partySummaries = buildDistributionPartySummaries(members);

    expect(partySummaries).toHaveLength(1);
    expect(partySummaries[0]?.party).toBe("미래개혁당");
    expect(partySummaries[0]?.memberCount).toBe(2);
    expect(partySummaries[0]?.averageAttendanceRate).toBeCloseTo(5 / 6);
    expect(partySummaries[0]?.averageNegativeRate).toBeCloseTo(0.5);
    expect(partySummaries[0]?.averageAbsenceRate).toBeCloseTo(0.25);
    expect(partySummaries[0]?.topCurrentStreak).toBe(3);
  });

  it("builds padded chart domains from the observed member spread", () => {
    expect(buildDistributionChartDomain([66.7, 100])).toEqual([60, 100]);
    expect(buildDistributionChartDomain([48, 52, 53])).toEqual([45, 60]);
    expect(buildDistributionChartDomain([])).toEqual([0, 100]);
  });
});
