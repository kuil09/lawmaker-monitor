import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { V2GlobalNav } from "../../apps/web/src/v2/V2GlobalNav.js";
import { V2ObservatoryPage } from "../../apps/web/src/v2/V2ObservatoryPage.js";
import { buildDistributionMembers } from "../../apps/web/src/lib/distribution.js";
import { getScatterYDomain } from "../../apps/web/src/lib/scatter-domain.js";

vi.mock("../../apps/web/src/v2/V2NationalMap.js", () => ({
  V2NationalMap: () => (
    <div role="img" aria-label="전국 지역구 결석률 분포 지도" />
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
  it("caps percentage scatter domains at 100 without changing asset padding", () => {
    const productionBoundaryPoints = [
      {
        memberId: "low",
        name: "Low",
        party: "Independent",
        district: "District A",
        x: 99.245,
        y: 0.755,
        score: 99.245,
        supportValue: 0.755,
        basisValue: "1"
      },
      {
        memberId: "high",
        name: "High",
        party: "Independent",
        district: "District B",
        x: 0,
        y: 100,
        score: 0,
        supportValue: 100,
        basisValue: "1"
      }
    ];

    expect(getScatterYDomain(productionBoundaryPoints, true)).toEqual([0, 100]);
    expect(getScatterYDomain(productionBoundaryPoints, false)).toEqual([
      0, 112
    ]);
  });

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
    expect(
      screen.getByRole("region", { name: "지역별 결석률 분포" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "지역별 출석률 분포" })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "전국 지역구 결석률 분포 지도" })
    ).toBeInTheDocument();
    const mapLegend = screen.getByLabelText(
      "지도 범례: 색상은 정당을, 같은 정당색 안에서 진할수록 결석률이 높음을 나타냅니다. 회색은 자료 없음입니다."
    );
    expect(within(mapLegend).getByText("색상은 정당")).toBeInTheDocument();
    expect(
      within(mapLegend).getByText("진할수록 결석률 높음")
    ).toBeInTheDocument();
    expect(within(mapLegend).getByText("자료 없음")).toBeInTheDocument();
    expect(
      mapLegend.querySelectorAll(".v2-map-legend__ramp").length
    ).toBeGreaterThan(0);

    fireEvent.keyDown(attendanceTab, { key: "ArrowRight" });

    const votingTab = screen.getByRole("tab", { name: "표결 성향" });
    expect(votingTab).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(votingTab, { key: "End" });

    const assetsTab = screen.getByRole("tab", { name: "재산" });
    expect(assetsTab).toHaveAttribute("aria-selected", "true");
    const assetTrendHeading = screen.getByRole("heading", {
      name: "공개 순재산 상위 의원의 자산·부채"
    });
    const assetTrendCard = assetTrendHeading.closest("section");
    expect(assetTrendCard).not.toBeNull();
    expect(within(assetTrendCard!).getByText("의원 비교")).toBeInTheDocument();
    expect(
      within(assetTrendCard!).getByRole("img", {
        name: "공개 순재산 상위 의원의 자산·부채 대칭 로그 축 막대그래프"
      })
    ).toBeInTheDocument();
    expect(within(assetTrendCard!).getByText("부채")).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", {
        name: "총자산 대비 부채비율"
      })
    ).toBeInTheDocument();
    expect(
      within(assetTrendCard!).getByText(
        "금액 격차를 함께 보기 위해 대칭 로그 축을 사용합니다."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText("공개 재산 상위 구간 비교")).toBeNull();
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
      within(analysisRegion).getByRole("button", { name: "목록 보기" })
    );

    expect(
      screen.getByRole("table", { name: "표결 성향 분석 데이터" })
    ).toBeInTheDocument();
  });

  it("submits a selected member through the v2 navigation search", () => {
    const onSelectSearchMemberId = vi.fn();
    const onSubmitSearch = vi.fn();
    const onNavigate = vi.fn();

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
        onNavigate={onNavigate}
        onSelectSearchMemberId={onSelectSearchMemberId}
        onSubmitSearch={onSubmitSearch}
      />
    );

    const brandLink = screen.getByRole("link", {
      name: "국회 책임성 모니터 홈"
    });
    expect(brandLink.querySelector("svg")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "오늘의 변화" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(screen.getByRole("link", { name: "의원 찾기" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "지역 탐색" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "표결 기록" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "추세" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "지역 탐색" }));
    expect(onNavigate).toHaveBeenCalledWith("map");

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
        onNavigate={onNavigate}
        onSelectSearchMemberId={onSelectSearchMemberId}
        onSubmitSearch={onSubmitSearch}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "김예시 의원 활동 보기" })
    );
    expect(onSubmitSearch).toHaveBeenCalledTimes(1);
  });

  it("closes the mobile navigation with Escape and restores menu focus", () => {
    render(
      <V2GlobalNav
        route="distribution"
        assemblyLabel="제22대 국회"
        searchOptions={[]}
        selectedSearchMemberId={null}
        onHome={vi.fn()}
        onNavigate={vi.fn()}
        onSelectSearchMemberId={vi.fn()}
        onSubmitSearch={vi.fn()}
      />
    );

    const menuButton = screen.getByRole("button", { name: "메뉴 열기" });
    expect(screen.getByRole("link", { name: "의원 찾기" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    fireEvent.click(menuButton);
    expect(menuButton).toHaveAttribute("aria-expanded", "true");

    screen.getByRole("link", { name: "의원 찾기" }).focus();
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.getByRole("button", { name: "메뉴 열기" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    expect(menuButton).toHaveFocus();
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
      within(analysisRegion).getByRole("button", { name: "목록 보기" })
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

  it("opens member detail from names in the weekly insight and asset table", () => {
    const onOpenMember = vi.fn();

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
        onOpenMember={onOpenMember}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "재산" }));

    const insight = screen
      .getByRole("heading", { name: "이번 주 관찰" })
      .closest("aside");
    expect(insight).not.toBeNull();
    const insightLink = within(insight!).getByRole("link", {
      name: "박민 의원 상세 보기"
    });
    expect(insightLink).toHaveAttribute("href", "#calendar?member=M002");

    fireEvent.click(insightLink);
    expect(onOpenMember).toHaveBeenCalledWith("M002");

    const assetTrendCard = screen
      .getByRole("heading", {
        name: "공개 순재산 상위 의원의 자산·부채"
      })
      .closest("section");
    expect(assetTrendCard).not.toBeNull();
    fireEvent.click(
      within(assetTrendCard!).getByRole("button", { name: "표로 보기" })
    );

    fireEvent.click(
      within(assetTrendCard!).getByRole("link", {
        name: "김아라 의원 상세 보기"
      })
    );
    expect(onOpenMember).toHaveBeenCalledWith("M001");
  });
});
