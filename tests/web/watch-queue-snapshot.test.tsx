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
    },
    {
      ...trendBase,
      memberId: "M003",
      name: "김부재",
      party: "무소속",
      previousWindowEligibleCount: 23,
      previousWindowNoCount: 0,
      previousWindowAbstainCount: 0,
      previousWindowAbsentCount: 0,
      currentWindowEligibleCount: 23,
      currentWindowNoCount: 0,
      currentWindowAbstainCount: 0,
      currentWindowAbsentCount: 23
    }
  ]
};

const unresolvedTrends: AccountabilityTrendsExport = {
  ...trends,
  movers: [
    {
      ...trendBase,
      memberId: "M004",
      name: "확인불가",
      party: "국민의힘",
      previousWindowEligibleCount: 23,
      previousWindowNoCount: 23,
      previousWindowAbstainCount: 0,
      previousWindowAbsentCount: 0,
      previousWindowUnresolvedCount: 0,
      currentWindowEligibleCount: 23,
      currentWindowNoCount: 0,
      currentWindowAbstainCount: 0,
      currentWindowAbsentCount: 0,
      currentWindowUnresolvedCount: 3
    }
  ]
};

describe("watch queue change language", () => {
  it("separates vote participation from yes, no, abstain, and absence", () => {
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
      screen.getAllByText("주된 표결 기록: 직전 반대 23건 → 최근 찬성 23건")
    ).toHaveLength(1);
    expect(
      screen.getAllByText("주된 표결 기록: 직전 찬성 23건 → 최근 반대 23건")
    ).toHaveLength(1);
    expect(screen.queryByText("HOT ISSUES")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "지금 주목할 변화" })
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("변화 기록")).toHaveLength(3);
    expect(
      screen.getAllByText(/찬성·반대·기권은 표결에 참여한 기록입니다/)
    ).toHaveLength(3);
    expect(
      screen.getAllByRole("table", { name: "직전과 최근 표결 기록 비교" })
    ).toHaveLength(3);
    expect(
      screen.getAllByRole("rowheader", { name: "표결 참여" })
    ).toHaveLength(3);
    expect(
      screen.getAllByRole("rowheader", { name: "표결 불참" })
    ).toHaveLength(3);
    expect(screen.queryByText(/높아졌습니다|낮아졌습니다/)).toBeNull();
    expect(screen.queryByText("개선 확인")).toBeNull();
    expect(screen.queryByText(/반대·기권·불참:/)).toBeNull();
    expect(screen.queryByText("직전 비중")).toBeNull();
    expect(screen.queryByText("최근 비중")).toBeNull();
    expect(
      screen
        .getByRole("heading", {
          name: "주된 표결 기록: 직전 찬성 23건 → 최근 불참 23건"
        })
        .closest("article")
    ).toHaveClass("is-absence-record");
  });

  it("does not infer a change when either comparison window is unresolved", () => {
    render(
      <WatchQueueSnapshot
        accountabilitySummary={null}
        accountabilityTrends={unresolvedTrends}
        billProposalActivity={null}
        loading={false}
        unavailable={false}
        onOpenMember={vi.fn()}
      />
    );

    expect(screen.queryByText("확인불가")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "전체 0건 중 0건 표시"
    );
  });
});
