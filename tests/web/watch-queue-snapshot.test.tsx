import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WatchQueueSnapshot } from "../../apps/web/src/components/WatchQueueSnapshot.js";

import type { AccountabilityTrendsExport } from "@lawmaker-monitor/schemas";

const trendBase = {
  photoUrl: null,
  officialProfileUrl: null,
  profile: null,
  previousWindowPartyLineOpportunityCount: 0,
  previousWindowPartyLineParticipationCount: 0,
  previousWindowPartyLineDefectionCount: 0,
  currentWindowPartyLineOpportunityCount: 0,
  currentWindowPartyLineParticipationCount: 0,
  currentWindowPartyLineDefectionCount: 0
};

const trends: AccountabilityTrendsExport = {
  generatedAt: "2026-07-29T00:00:00.000Z",
  assemblyNo: 22,
  assemblyLabel: "제22대 국회",
  weekStartsOn: "monday",
  weeks: [],
  movers: [
    {
      ...trendBase,
      memberId: "M001",
      name: "유주병",
      party: "더불어민주당",
      previousWindowEligibleCount: 23,
      previousWindowNoCount: 23,
      previousWindowAbstainCount: 0,
      previousWindowAbsentCount: 0,
      currentWindowEligibleCount: 23,
      currentWindowNoCount: 0,
      currentWindowAbstainCount: 0,
      currentWindowAbsentCount: 0
    },
    {
      ...trendBase,
      memberId: "M002",
      name: "이성권",
      party: "국민의힘",
      previousWindowEligibleCount: 23,
      previousWindowNoCount: 0,
      previousWindowAbstainCount: 0,
      previousWindowAbsentCount: 0,
      currentWindowEligibleCount: 23,
      currentWindowNoCount: 23,
      currentWindowAbstainCount: 0,
      currentWindowAbsentCount: 0
    }
  ]
};

describe("watch queue change language", () => {
  it("states before-and-after vote counts without judging the direction", () => {
    render(
      <WatchQueueSnapshot
        accountabilitySummary={null}
        accountabilityTrends={trends}
        billProposalActivity={null}
        loading={false}
        unavailable={false}
        onOpenMember={vi.fn()}
      />
    );

    expect(
      screen.getAllByText("반대·기권·불참: 직전 23/23건 → 최근 0/23건")
    ).toHaveLength(2);
    expect(
      screen.getAllByText("반대·기권·불참: 직전 0/23건 → 최근 23/23건")
    ).toHaveLength(2);
    expect(screen.getAllByText("변화 기록")).toHaveLength(2);
    expect(screen.queryByText(/높아졌습니다|낮아졌습니다/)).toBeNull();
    expect(screen.queryByText("개선 확인")).toBeNull();
    expect(
      screen.getAllByText(/변화 방향 자체를 긍정·부정으로 판정하지 않습니다/)
    ).toHaveLength(2);
  });
});
