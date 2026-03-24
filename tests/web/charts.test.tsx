import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { buildWeeklyTrendChartData } from "../../apps/web/src/lib/charts.js";

const fixturesDir = resolve(process.cwd(), "tests/fixtures/contracts");
const accountabilityTrendsFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, "accountability_trends.json"), "utf8")
);

describe("weekly trend chart data", () => {
  it("marks weeks without eligible votes as gaps instead of zero-percent drops", () => {
    const data = buildWeeklyTrendChartData(accountabilityTrendsFixture);
    const trailingWeek = data.at(-1);

    expect(trailingWeek).toMatchObject({
      weekStart: "2026-03-23",
      eligibleVoteCount: 0,
      yesShare: null,
      noShare: null,
      abstainShare: null,
      absentShare: null
    });
  });
});
