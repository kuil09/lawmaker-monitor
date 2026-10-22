import { describe, expect, it } from "vitest";

import { aggregatePeriodMetrics } from "../../apps/web/src/lib/member-analysis.js";
import {
  buildHashForRoute,
  parseHashRoute
} from "../../apps/web/src/lib/route-state.js";

describe("member analysis period semantics", () => {
  it("weights participation by eligible votes rather than averaging monthly percentages", () => {
    const metrics = aggregatePeriodMetrics(
      [
        {
          month: "2026-01",
          metrics: {
            eligibleVotes: 1,
            participatedVotes: 1,
            unknownVotes: 0,
            participationRate: 1,
            proposals: 2,
            statements: 3
          }
        },
        {
          month: "2026-02",
          metrics: {
            eligibleVotes: 9,
            participatedVotes: 0,
            unknownVotes: 2,
            participationRate: 0,
            proposals: 5,
            statements: 7
          }
        }
      ],
      "2026-01",
      "2026-02"
    );
    expect(metrics).toMatchObject({
      participationRate: 0.1,
      eligibleVotes: 10,
      participatedVotes: 1,
      unknownVotes: 2,
      proposals: 7,
      statements: 10
    });
    expect(
      aggregatePeriodMetrics([], "2025-01", "2025-12").participationRate
    ).toBeNull();
  });
  it("retains a shareable member identity without falling through to another route", () => {
    const hash = buildHashForRoute({
      route: "analysis",
      memberId: "official-id:1"
    });
    expect(parseHashRoute(hash)).toEqual({
      route: "analysis",
      memberId: "official-id:1"
    });
  });
});
