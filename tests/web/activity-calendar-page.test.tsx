import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ActivityCalendarPage } from "../../apps/web/src/components/ActivityCalendarPage.js";

vi.mock("recharts", () => {
  const MockChart = ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children);

  return {
    CartesianGrid: MockChart,
    Legend: MockChart,
    Line: MockChart,
    LineChart: MockChart,
    PolarAngleAxis: MockChart,
    PolarGrid: MockChart,
    PolarRadiusAxis: MockChart,
    Radar: MockChart,
    RadarChart: MockChart,
    ResponsiveContainer: MockChart,
    Tooltip: MockChart,
    XAxis: MockChart,
    YAxis: MockChart
  };
});

const fixturesDir = resolve(import.meta.dirname, "../fixtures/contracts");
const activityCalendarFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, "member_activity_calendar.json"), "utf8")
);

function renderActivityCalendarPage(
  overrides: Partial<React.ComponentProps<typeof ActivityCalendarPage>> = {}
) {
  return render(
    <ActivityCalendarPage
      activityCalendar={activityCalendarFixture}
      loading={false}
      error={null}
      memberDetails={{}}
      memberDetailErrors={{}}
      memberDetailLoading={{}}
      memberAssetsIndex={null}
      memberAssetsIndexError={null}
      memberAssetHistories={{}}
      memberAssetHistoryErrors={{}}
      memberAssetHistoryLoading={{}}
      onEnsureMemberDetail={vi.fn()}
      onRetryMemberDetail={vi.fn()}
      onEnsureMemberAssetHistory={vi.fn()}
      onRetryMemberAssetHistory={vi.fn()}
      onRetry={vi.fn()}
      {...overrides}
    />
  );
}

describe("activity calendar profile avatars", () => {
  it("renders the activity-card portrait in the single-member evidence dossier", async () => {
    const { container, getByText } = renderActivityCalendarPage({
      initialMemberId: "M001"
    });

    await waitFor(() => {
      expect(
        container.querySelector(
          ".member-evaluation__portrait .member-identity--activity-card.member-identity--large"
        )
      ).not.toBeNull();
    });

    expect(getByText("공개 기록으로 판단하는 김아라 의원")).toBeInTheDocument();
    expect(
      container.querySelector(
        ".member-evaluation__portrait .member-identity__avatar--activity-card"
      )
    ).not.toBeNull();
    expect(
      container.querySelectorAll(".member-identity__avatar--activity-card")
    ).toHaveLength(1);
  });

  it("applies the activity-card avatar variant to both compare-view member identities", async () => {
    const { container } = renderActivityCalendarPage({
      initialView: "compare",
      initialMemberId: "M001",
      initialCompareMemberId: "M002"
    });

    await waitFor(() => {
      expect(
        container.querySelectorAll(".activity-compare__column .member-identity")
      ).toHaveLength(2);
    });

    expect(
      container.querySelectorAll(
        ".activity-compare__column .member-identity--activity-card"
      )
    ).toHaveLength(2);
    expect(
      container.querySelectorAll(
        ".activity-compare__column .member-identity__avatar--activity-card"
      )
    ).toHaveLength(2);
  });

  it("does not rank a committee or show zero percent when its vote rows are unresolved", async () => {
    const activityCalendarWithUnknown = {
      ...activityCalendarFixture,
      assembly: {
        ...activityCalendarFixture.assembly,
        members: activityCalendarFixture.assembly.members.map(
          (member: { memberId: string }) =>
            member.memberId === "M001"
              ? {
                  ...member,
                  committeeSummaries: [
                    {
                      committeeName: "보건복지위원회",
                      eligibleRollCallCount: 34,
                      participatedRollCallCount: 0,
                      absentRollCallCount: 0,
                      unresolvedRollCallCount: 34,
                      participationRate: 0,
                      yesCount: 0,
                      noCount: 0,
                      abstainCount: 0,
                      isCurrentCommittee: true,
                      recentVoteRecords: []
                    }
                  ]
                }
              : member
        )
      }
    };
    const { getByRole } = renderActivityCalendarPage({
      activityCalendar: activityCalendarWithUnknown,
      initialMemberId: "M001"
    });

    const committeeRegion = await waitFor(() =>
      getByRole("region", {
        name: "위원회 소관 안건 본회의 확인된 표결 참여율"
      })
    );
    expect(
      within(committeeRegion).getByRole("heading", {
        name: "표결행 확인 부족"
      })
    ).toBeInTheDocument();
    expect(within(committeeRegion).getByText("산정 불가")).toBeInTheDocument();
    expect(
      within(committeeRegion).getByText(/확인 불가 34/)
    ).toBeInTheDocument();
    expect(within(committeeRegion).queryByText("0%")).toBeNull();
  });
});
