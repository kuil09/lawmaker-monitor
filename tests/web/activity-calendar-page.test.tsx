import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, waitFor } from "@testing-library/react";
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
      assemblyLabel={activityCalendarFixture.assemblyLabel}
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
      onBack={vi.fn()}
      onRetry={vi.fn()}
      {...overrides}
    />
  );
}

describe("activity calendar profile avatars", () => {
  it("applies the activity-card avatar variant to the single-view header profile", async () => {
    const { container } = renderActivityCalendarPage({
      initialMemberId: "M001"
    });

    await waitFor(() => {
      expect(
        container.querySelector(
          ".activity-drawer__member-primary .member-identity--activity-card.member-identity--large"
        )
      ).not.toBeNull();
    });

    expect(
      container.querySelector(
        ".activity-drawer__member-primary .member-identity__avatar--activity-card"
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
});
