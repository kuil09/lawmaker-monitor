import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { V2GlobalNav } from "../../apps/web/src/v2/V2GlobalNav.js";
import { V2ObservatoryPage } from "../../apps/web/src/v2/V2ObservatoryPage.js";
import { buildDistributionMembers } from "../../apps/web/src/lib/distribution.js";

vi.mock("../../apps/web/src/v2/V2NationalMap.js", () => ({
  V2NationalMap: () => (
    <div role="img" aria-label="전국 지역구 출석 분포 지도" />
  )
}));

const fixturesDir = resolve(process.cwd(), "tests/fixtures/contracts");
const accountabilitySummary = JSON.parse(
  readFileSync(resolve(fixturesDir, "accountability_summary.json"), "utf8")
);
const accountabilityTrends = JSON.parse(
  readFileSync(resolve(fixturesDir, "accountability_trends.json"), "utf8")
);
const activityCalendar = JSON.parse(
  readFileSync(resolve(fixturesDir, "member_activity_calendar.json"), "utf8")
);
const memberAssetsIndex = JSON.parse(
  readFileSync(resolve(fixturesDir, "member_assets_index.json"), "utf8")
);
const manifest = JSON.parse(
  readFileSync(resolve(fixturesDir, "manifest.json"), "utf8")
);
const members = buildDistributionMembers(
  accountabilitySummary,
  activityCalendar
);

describe("v2 observatory", () => {
  it("supports arrow-key lens navigation and an accessible table alternative", () => {
    render(
      <V2ObservatoryPage
        assemblyLabel="제22대 국회"
        freshnessText="2026년 7월 24일"
        manifest={manifest}
        accountabilitySummary={accountabilitySummary}
        members={members}
        activityCalendar={activityCalendar}
        accountabilityTrends={accountabilityTrends}
        memberAssetsIndex={memberAssetsIndex}
        loading={false}
        errors={[]}
        onOpenMap={vi.fn()}
        onOpenDistribution={vi.fn()}
        onOpenMember={vi.fn()}
      />
    );

    const attendanceTab = screen.getByRole("tab", { name: "출석" });
    fireEvent.keyDown(attendanceTab, { key: "ArrowRight" });

    const votingTab = screen.getByRole("tab", { name: "표결 성향" });
    expect(votingTab).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(votingTab, { key: "End" });

    const assetsTab = screen.getByRole("tab", { name: "재산" });
    expect(assetsTab).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(assetsTab, { key: "Home" });

    expect(attendanceTab).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(attendanceTab, { key: "ArrowRight" });
    expect(
      screen.getByRole("heading", { name: "지역별 반대·기권 분포" })
    ).toBeInTheDocument();

    const analysisRegion = screen.getByRole("region", {
      name: "지역별 반대·기권 분포"
    });
    fireEvent.click(
      within(analysisRegion).getByRole("button", { name: "표로 보기" })
    );

    expect(
      screen.getByRole("table", { name: "표결 성향 분석 데이터" })
    ).toBeInTheDocument();
  });

  it("submits a selected member through the v2 navigation search", () => {
    const onSelectSearchMemberId = vi.fn();
    const onSubmitSearch = vi.fn();

    const { rerender } = render(
      <V2GlobalNav
        route="home"
        assemblyLabel="제22대 국회"
        searchOptions={[
          { id: "M001", label: "김예시 · 예시당" },
          { id: "M002", label: "이예시 · 다른당" }
        ]}
        selectedSearchMemberId={null}
        onHome={vi.fn()}
        onNavigate={vi.fn()}
        onSelectSearchMemberId={onSelectSearchMemberId}
        onSubmitSearch={onSubmitSearch}
      />
    );

    expect(
      screen
        .getByRole("link", { name: "국회 책임성 모니터 개요" })
        .querySelector("svg")
    ).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "의원 검색" }), {
      target: { value: "김예시 · 예시당" }
    });
    expect(onSelectSearchMemberId).toHaveBeenCalledWith("M001");

    rerender(
      <V2GlobalNav
        route="home"
        assemblyLabel="제22대 국회"
        memberName="김예시"
        searchOptions={[
          { id: "M001", label: "김예시 · 예시당" },
          { id: "M002", label: "이예시 · 다른당" }
        ]}
        selectedSearchMemberId="M001"
        onHome={vi.fn()}
        onNavigate={vi.fn()}
        onSelectSearchMemberId={onSelectSearchMemberId}
        onSubmitSearch={onSubmitSearch}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "김예시 의원 활동 보기" })
    );
    expect(onSubmitSearch).toHaveBeenCalledTimes(1);
  });

  it("converts thousand-won asset values to eok exactly once", () => {
    render(
      <V2ObservatoryPage
        assemblyLabel="제22대 국회"
        freshnessText="2026년 7월 24일"
        manifest={manifest}
        accountabilitySummary={accountabilitySummary}
        members={members}
        activityCalendar={activityCalendar}
        accountabilityTrends={accountabilityTrends}
        memberAssetsIndex={memberAssetsIndex}
        loading={false}
        errors={[]}
        onOpenMap={vi.fn()}
        onOpenDistribution={vi.fn()}
        onOpenMember={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "재산" }));
    const analysisRegion = screen.getByRole("region", {
      name: "지역별 공개 부동산 분포"
    });
    fireEvent.click(
      within(analysisRegion).getByRole("button", { name: "표로 보기" })
    );

    const table = screen.getByRole("table", { name: "재산 분석 데이터" });
    const memberButton = within(table).getByRole("button", { name: "김아라" });
    const memberRow = memberButton.closest("tr");
    const secondMemberButton = within(table).getByRole("button", {
      name: "박민"
    });
    const secondMemberRow = secondMemberButton.closest("tr");

    expect(memberRow).toHaveTextContent("8.2억");
    expect(memberRow).toHaveTextContent("5.1억");
    expect(secondMemberRow).toHaveTextContent("2.7억");
    expect(secondMemberRow).toHaveTextContent("3.2억");
  });
});
