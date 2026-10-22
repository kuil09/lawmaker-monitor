import { describe, expect, it, vi } from "vitest";

import indexFixture from "../fixtures/contracts/member_analysis/index.json";
import detailFixture from "../fixtures/contracts/member_analysis/M001.json";
import {
  loadMemberAnalysisIndex,
  loadMemberAnalysisDetail
} from "../../apps/web/src/lib/data.js";

import { aggregatePeriodMetrics } from "../../apps/web/src/lib/member-analysis.js";
import {
  buildHashForRoute,
  parseHashRoute
} from "../../apps/web/src/lib/route-state.js";

describe("member analysis period semantics", () => {
  it("revalidates the directory and versions detail requests to avoid mixing cached builds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => indexFixture
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => detailFixture
      });
    vi.stubGlobal("fetch", fetchMock);
    await loadMemberAnalysisIndex();
    await loadMemberAnalysisDetail(
      "exports/member_analysis/M001.json",
      indexFixture.generatedAt
    );
    expect(fetchMock.mock.calls[0]?.[1]).toEqual({ cache: "no-cache" });
    expect(
      new URL(fetchMock.mock.calls[1]![0]).searchParams.get("generation")
    ).toBe(indexFixture.generatedAt);
    expect(() =>
      loadMemberAnalysisDetail("exports/member_analysis/../../private.json")
    ).toThrow("Invalid member analysis path");
  });
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
