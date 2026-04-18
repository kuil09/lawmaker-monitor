import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildPartyLineMoverChartData,
  buildPartyLineTrendChartData,
  buildWeeklyTrendChartData
} from "../../apps/web/src/lib/charts.js";

import type { AccountabilityTrendsExport } from "@lawmaker-monitor/schemas";

const fixturesDir = resolve(process.cwd(), "tests/fixtures/contracts");
const accountabilityTrendsFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, "accountability_trends.json"), "utf8")
);

describe("weekly trend chart data", () => {
  it("marks weeks without eligible votes as gaps instead of zero-percent drops", () => {
    const data = buildWeeklyTrendChartData(accountabilityTrendsFixture);
    const lastGapWeek = data.findLast(
      (week) => week.eligibleVoteCount === 0
    );

    expect(lastGapWeek).toMatchObject({
      weekStart: "2026-03-09",
      eligibleVoteCount: 0,
      yesShare: null,
      noShare: null,
      abstainShare: null,
      absentShare: null
    });
  });

  it("marks weeks without party-line opportunities as gaps", () => {
    const trends: AccountabilityTrendsExport = {
      generatedAt: "2026-03-22T11:45:00+09:00",
      snapshotId: "snapshot-20260322-114500",
      assemblyNo: 22,
      assemblyLabel: "제22대 국회",
      weeks: [
        {
          weekStart: "2026-03-10",
          weekEnd: "2026-03-16",
          yesCount: 10,
          noCount: 2,
          abstainCount: 1,
          absentCount: 0,
          eligibleVoteCount: 13,
          partyLineOpportunityCount: 0,
          partyLineParticipationCount: 0,
          partyLineDefectionCount: 0
        },
        {
          weekStart: "2026-03-17",
          weekEnd: "2026-03-23",
          yesCount: 12,
          noCount: 2,
          abstainCount: 1,
          absentCount: 1,
          eligibleVoteCount: 16,
          partyLineOpportunityCount: 4,
          partyLineParticipationCount: 3,
          partyLineDefectionCount: 1
        },
        {
          weekStart: "2026-03-24",
          weekEnd: "2026-03-30",
          yesCount: 8,
          noCount: 0,
          abstainCount: 0,
          absentCount: 2,
          eligibleVoteCount: 10,
          partyLineOpportunityCount: 2,
          partyLineParticipationCount: 0,
          partyLineDefectionCount: 0
        }
      ],
      movers: []
    };

    const data = buildPartyLineTrendChartData(trends);

    expect(data[0]).toMatchObject({
      weekStart: "2026-03-10",
      defectionRate: null
    });
    expect(data[1]).toMatchObject({
      weekStart: "2026-03-17",
      defectionRate: 1 / 3
    });
    expect(data[2]).toMatchObject({
      weekStart: "2026-03-24",
      defectionRate: 0
    });
  });

  it("builds party-line movers from the recent windows", () => {
    const trends: AccountabilityTrendsExport = {
      generatedAt: "2026-03-22T11:45:00+09:00",
      snapshotId: "snapshot-20260322-114500",
      assemblyNo: 22,
      assemblyLabel: "제22대 국회",
      weeks: [],
      movers: [
        {
          memberId: "M001",
          name: "김아라",
          party: "미래개혁당",
          photoUrl: null,
          officialProfileUrl: null,
          previousWindowEligibleCount: 8,
          previousWindowNoCount: 1,
          previousWindowAbstainCount: 0,
          previousWindowAbsentCount: 0,
          previousWindowPartyLineOpportunityCount: 4,
          previousWindowPartyLineParticipationCount: 4,
          previousWindowPartyLineDefectionCount: 0,
          currentWindowEligibleCount: 8,
          currentWindowNoCount: 1,
          currentWindowAbstainCount: 1,
          currentWindowAbsentCount: 0,
          currentWindowPartyLineOpportunityCount: 4,
          currentWindowPartyLineParticipationCount: 4,
          currentWindowPartyLineDefectionCount: 2
        },
        {
          memberId: "M002",
          name: "박민",
          party: "미래개혁당",
          photoUrl: null,
          officialProfileUrl: null,
          previousWindowEligibleCount: 8,
          previousWindowNoCount: 0,
          previousWindowAbstainCount: 0,
          previousWindowAbsentCount: 0,
          previousWindowPartyLineOpportunityCount: 3,
          previousWindowPartyLineParticipationCount: 3,
          previousWindowPartyLineDefectionCount: 1,
          currentWindowEligibleCount: 8,
          currentWindowNoCount: 0,
          currentWindowAbstainCount: 0,
          currentWindowAbsentCount: 0,
          currentWindowPartyLineOpportunityCount: 3,
          currentWindowPartyLineParticipationCount: 3,
          currentWindowPartyLineDefectionCount: 1
        }
      ]
    };

    const movers = buildPartyLineMoverChartData(trends);

    expect(movers).toHaveLength(1);
    expect(movers[0]).toMatchObject({
      memberId: "M001",
      previousRate: 0,
      currentRate: 0.5,
      deltaRate: 0.5
    });
  });
});
