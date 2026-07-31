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
  V2NationalMap: ({ metric }: { metric: string }) => {
    const metricLabel =
      metric === "absence"
        ? "결석률"
        : metric === "negative"
          ? "반대·기권률"
          : "공개 부동산액";
    return (
      <div role="region" aria-label={`전국 지역구 ${metricLabel} 카토그램`}>
        <div
          aria-label={`${metricLabel} 비교 단계. 실제 값과 전국 순위를 함께 확인할 수 있습니다.`}
        >
          <span>1 낮음 · 전국 하위 50%</span>
          <span>2 보통 · 전국 50–75백분위</span>
          <span>3 주의 · 전국 상위 25%</span>
          <span>4 높음 · 전국 상위 10%</span>
          <span>자료 없음</span>
        </div>
      </div>
    );
  }
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
const billProposalActivity = JSON.parse(
  readFileSync(resolve(fixturesDir, "bill_proposal_activity.json"), "utf8")
);
const manifest = JSON.parse(
  readFileSync(resolve(fixturesDir, "manifest.json"), "utf8")
);
const members = buildDistributionMembers(
  accountabilitySummary,
  activityCalendar
);
const membersWithProportionalRepresentative = [
  ...members,
  {
    ...members[0]!,
    memberId: "M003",
    name: "이수",
    party: "시민녹색당",
    district: "비례대표",
    photoUrl: null
  }
];

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
        members={membersWithProportionalRepresentative}
        activityCalendar={activityCalendar}
        accountabilityTrends={accountabilityTrends}
        memberAssetsIndex={memberAssetsIndex}
        billProposalActivity={billProposalActivity}
        billProposalActivityLoading={false}
        billProposalActivityError={null}
        loading={false}
        errors={[]}
        onOpenMap={vi.fn()}
        onOpenDistribution={vi.fn()}
        onOpenMember={vi.fn()}
      />
    );

    const watchQueueHeading = screen.getByRole("heading", {
      name: "국회 출석부"
    });
    const explorerHeading = screen.getByRole("heading", {
      name: "전국 지표 탐색"
    });
    expect(
      watchQueueHeading.compareDocumentPosition(explorerHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      screen.getByText(
        "선택한 지표에 따라 아래 지도·의원 분포·추세·근거 목록이 함께 바뀝니다."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tablist", { name: "전국 지표 탐색 선택" })
    ).toBeInTheDocument();

    const attendanceTab = screen.getByRole("tab", { name: "출석" });
    const observatoryPanel = screen.getByRole("tabpanel");
    expect(attendanceTab).toHaveAttribute(
      "aria-controls",
      "v2-observatory-panel"
    );
    expect(observatoryPanel).toHaveAttribute(
      "aria-labelledby",
      "v2-lens-tab-attendance"
    );
    expect(
      screen.getByRole("region", { name: "지역별 결석률 분포" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "지역별 출석률 분포" })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", {
        name: "전국 지역구 결석률 카토그램"
      })
    ).toBeInTheDocument();
    const mapLegend = screen.getByLabelText(
      "결석률 비교 단계. 실제 값과 전국 순위를 함께 확인할 수 있습니다."
    );
    expect(
      within(mapLegend).getByText("1 낮음 · 전국 하위 50%")
    ).toBeInTheDocument();
    expect(
      within(mapLegend).getByText("2 보통 · 전국 50–75백분위")
    ).toBeInTheDocument();
    expect(
      within(mapLegend).getByText("3 주의 · 전국 상위 25%")
    ).toBeInTheDocument();
    expect(
      within(mapLegend).getByText("4 높음 · 전국 상위 10%")
    ).toBeInTheDocument();
    expect(within(mapLegend).getByText("자료 없음")).toBeInTheDocument();
    expect(
      screen.queryByText("색이 진할수록 결석률 높음")
    ).not.toBeInTheDocument();
    const proportionalComparison = screen
      .getByRole("heading", {
        name: "출석 · 비례대표 의원 비교"
      })
      .closest("section");
    expect(proportionalComparison).not.toBeNull();
    expect(
      within(proportionalComparison!).getByText(
        /시·도 경계에 속하지 않아 지도에 배치되지 않는/
      )
    ).toBeInTheDocument();
    expect(
      within(proportionalComparison!).getByRole("link", {
        name: "이수 의원 상세 보기"
      })
    ).toHaveAttribute("href", "#calendar?member=M003");

    fireEvent.keyDown(attendanceTab, { key: "ArrowRight" });

    const votingTab = screen.getByRole("tab", { name: "표결 성향" });
    expect(votingTab).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("heading", {
        name: "표결 성향 · 비례대표 의원 비교"
      })
    ).toBeInTheDocument();
    expect(observatoryPanel).toHaveAttribute(
      "aria-labelledby",
      "v2-lens-tab-voting"
    );
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

  it("compares support share with party-line defection and explains the sample", () => {
    const votingMembers = members.map((member, index) => ({
      ...member,
      partyLineOpportunityCount: index === 0 ? 24 : 0,
      partyLineParticipationCount: index === 0 ? 20 : 0,
      partyLineDefectionCount: index === 0 ? 3 : 0,
      partyLineDefectionRate: index === 0 ? 0.15 : 0
    }));

    render(
      <V2ObservatoryPage
        assemblyLabel="제22대 국회"
        freshnessText="2026년 7월 24일"
        manifest={manifest}
        accountabilitySummary={accountabilitySummary}
        members={votingMembers}
        activityCalendar={activityCalendar}
        accountabilityTrends={accountabilityTrends}
        memberAssetsIndex={memberAssetsIndex}
        billProposalActivity={billProposalActivity}
        billProposalActivityLoading={false}
        billProposalActivityError={null}
        loading={false}
        errors={[]}
        onOpenMap={vi.fn()}
        onOpenDistribution={vi.fn()}
        onOpenMember={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "표결 성향" }));

    const scatterCard = screen
      .getByRole("heading", { name: "의원별 찬성·이탈 분포" })
      .closest("section");
    expect(scatterCard).not.toBeNull();
    expect(
      within(scatterCard!).getByText("세로 당내 이탈률 · 가로 찬성 비중")
    ).toBeInTheDocument();
    expect(scatterCard).toHaveTextContent(
      "점 크기는 당 기준이 형성된 표결의 참여 건수입니다."
    );
    expect(scatterCard).toHaveTextContent(
      "참여 표본이 없는 1명은 제외했습니다."
    );
    expect(
      within(scatterCard!).getByRole("img", {
        name: "1명 의원의 의원별 찬성·이탈 분포"
      })
    ).toBeInTheDocument();

    const analysisRegion = screen.getByRole("region", {
      name: "지역별 반대·기권 분포"
    });
    fireEvent.click(
      within(analysisRegion).getByRole("button", { name: "목록 보기" })
    );
    const table = screen.getByRole("table", {
      name: "표결 성향 분석 데이터"
    });
    expect(
      within(table).getByRole("columnheader", { name: "당내 이탈률" })
    ).toBeInTheDocument();
    expect(within(table).getByText("15.0%")).toBeInTheDocument();
    expect(within(table).getAllByRole("row")).toHaveLength(2);
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
      name: "국회 출석부 홈"
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
        billProposalActivity={billProposalActivity}
        billProposalActivityLoading={false}
        billProposalActivityError={null}
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

  it("omits the weekly insight card and opens member detail from the asset table", () => {
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
        billProposalActivity={billProposalActivity}
        billProposalActivityLoading={false}
        billProposalActivityError={null}
        loading={false}
        errors={[]}
        onOpenMap={vi.fn()}
        onOpenDistribution={vi.fn()}
        onOpenMember={onOpenMember}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "재산" }));

    expect(
      screen.queryByRole("heading", { name: "이번 주 관찰" })
    ).not.toBeInTheDocument();

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

  it("shows reverse-aggregated bill activity and links table names to member detail", () => {
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
        billProposalActivity={billProposalActivity}
        billProposalActivityLoading={false}
        billProposalActivityError={null}
        loading={false}
        errors={[]}
        onOpenMap={vi.fn()}
        onOpenDistribution={vi.fn()}
        onOpenMember={onOpenMember}
      />
    );

    const section = screen
      .getByRole("heading", { name: "의원별 법안 발의 참여 실적" })
      .closest("section");
    expect(section).not.toBeNull();
    expect(within(section!).getByText("집계 법안")).toBeInTheDocument();
    expect(within(section!).getByText("처리결과 공개")).toBeInTheDocument();
    expect(within(section!).getByText("원안·수정 가결")).toBeInTheDocument();
    expect(within(section!).getByText("대안반영폐기")).toBeInTheDocument();
    expect(within(section!).getByText("2건")).toBeInTheDocument();
    expect(within(section!).getAllByText("1건")).toHaveLength(2);
    expect(
      within(section!).getByRole("img", {
        name: "전체 법안 참여 상위 12명의 대표발의와 공동발의 참여 누적 막대그래프"
      })
    ).toBeInTheDocument();

    fireEvent.click(
      within(section!).getByRole("button", { name: "전체 표 보기" })
    );
    const memberLink = within(section!).getByRole("link", {
      name: "이수 의원 상세 보기"
    });
    expect(memberLink).toHaveAttribute("href", "#calendar?member=M003");
    expect(
      within(section!).getByRole("columnheader", { name: "결과 확인" })
    ).toBeInTheDocument();
    expect(
      within(section!).getByRole("columnheader", { name: "가결 비중" })
    ).toBeInTheDocument();
    const passedMemberLink = within(section!).getByRole("link", {
      name: "김아라 의원 상세 보기"
    });
    const passedMemberRow = passedMemberLink.closest("tr");
    expect(passedMemberRow).not.toBeNull();
    expect(within(passedMemberRow!).getByText("100.0%")).toBeInTheDocument();
    fireEvent.click(memberLink);
    expect(onOpenMember).toHaveBeenCalledWith("M003");
  });
});
