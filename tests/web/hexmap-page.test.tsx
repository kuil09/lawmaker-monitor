import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HexmapPage } from "../../apps/web/src/components/HexmapPage.js";

const fixturesDir = resolve(process.cwd(), "tests/fixtures/contracts");
const accountabilitySummaryFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, "accountability_summary.json"), "utf8")
);
const memberAssetsIndexFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, "member_assets_index.json"), "utf8")
);

function renderPage(
  overrides: Partial<React.ComponentProps<typeof HexmapPage>> = {}
) {
  const props: React.ComponentProps<typeof HexmapPage> = {
    manifest: null,
    accountabilitySummary: accountabilitySummaryFixture,
    memberAssetsIndex: memberAssetsIndexFixture,
    memberAssetsIndexError: null,
    assemblyLabel: "제22대 국회",
    initialProvince: null,
    initialDistrict: null,
    initialMetric: "absence",
    onNavigateToMember: vi.fn(),
    onChangeRoute: vi.fn(),
    ...overrides
  };

  render(<HexmapPage {...props} />);
  return props;
}

describe("HexmapPage", () => {
  it("renders the evidence-ledger region, metric, member, and detail structure", async () => {
    const props = renderPage();

    expect(
      screen.getByRole("heading", { name: "지역별 국회 기록 탐색" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "서울 (1)" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(
      screen.getByRole("tab", { name: "결석률 본회의 기준" })
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: /김아라/ })).toBeInTheDocument();
    expect(
      screen.getByRole("complementary", { name: "선택한 의원의 기록" })
    ).toHaveTextContent("김아라");
    expect(screen.queryByText("deck.gl 지역 탐색")).not.toBeInTheDocument();
    expect(document.querySelector("canvas")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(props.onChangeRoute).toHaveBeenCalledWith({
        district: null,
        province: "서울",
        metric: "absence"
      });
    });
  });

  it("switches regions and exposes a canonical member detail entry point", async () => {
    const onNavigateToMember = vi.fn();
    const onChangeRoute = vi.fn();
    renderPage({ onNavigateToMember, onChangeRoute });

    fireEvent.click(screen.getByRole("button", { name: "부산 (1)" }));

    expect(
      screen.getByRole("heading", { name: "부산 (1석)" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /박민/ })).toBeInTheDocument();
    expect(screen.getAllByText("남구").length).toBeGreaterThan(0);
    expect(screen.getAllByText("50.0%").length).toBeGreaterThan(0);

    const detailLink = screen.getByRole("link", {
      name: "박민 의원 상세 보기"
    });
    expect(detailLink).toHaveAttribute("href", "#calendar?member=M002");
    fireEvent.click(detailLink);
    expect(onNavigateToMember).toHaveBeenCalledWith("M002");
    expect(onChangeRoute).toHaveBeenCalledWith({
      district: null,
      province: "부산",
      metric: "absence"
    });
  });

  it("keeps route state aligned when the active metric changes", async () => {
    const onChangeRoute = vi.fn();
    renderPage({ initialProvince: "부산", onChangeRoute });

    fireEvent.click(
      screen.getByRole("tab", { name: "부동산 신고액 최근 신고 기준" })
    );

    expect(
      screen.getByRole("tab", { name: "부동산 신고액 최근 신고 기준" })
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByText("3.2억원").length).toBeGreaterThan(0);
    expect(onChangeRoute).toHaveBeenCalledWith({
      district: null,
      province: "부산",
      metric: "realEstate"
    });
  });

  it("promotes a legacy district route to the matching province", async () => {
    const onChangeRoute = vi.fn();
    renderPage({
      initialDistrict: "부산 남구",
      initialProvince: null,
      onChangeRoute
    });

    expect(
      screen.getByRole("heading", { name: "부산 (1석)" })
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(onChangeRoute).toHaveBeenCalledWith({
        district: null,
        province: "부산",
        metric: "absence"
      });
    });
  });

  it("switches to the national province summary and returns through a province tile", () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "시·도 요약" }));

    expect(
      screen.getByRole("heading", { name: "시·도별 결석률 분포" })
    ).toBeInTheDocument();
    expect(screen.getByLabelText("시·도별 결석률 비교")).toBeInTheDocument();
    expect(
      screen.getByRole("complementary", { name: "선택한 지역의 요약" })
    ).toHaveTextContent("서울");
    expect(screen.getByText(/전국 상대 순위/)).toBeInTheDocument();

    const busanSummaryButton = screen
      .getByLabelText("시·도별 결석률 비교")
      .querySelector<HTMLButtonElement>('button[data-province="부산"]');
    expect(busanSummaryButton).not.toBeNull();
    fireEvent.click(busanSummaryButton!);

    expect(
      screen.getByRole("heading", { name: "부산 (1석)" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "의원 배치" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("filters member cards without discarding the selected region", () => {
    renderPage();

    const search = screen.getByRole("searchbox", { name: "의원 검색" });
    fireEvent.change(search, { target: { value: "없는 의원" } });

    expect(
      screen.getByText("검색 조건에 맞는 의원이 없습니다.")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "서울 (1석)" })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "검색 초기화" }));
    expect(screen.getByRole("button", { name: /김아라/ })).toBeInTheDocument();
  });

  it("renders a stable loading state while accountability data is unavailable", () => {
    renderPage({ accountabilitySummary: null });

    expect(screen.getByRole("status")).toHaveTextContent(
      "지역별 국회 기록을 준비하고 있습니다."
    );
    expect(
      screen.queryByRole("heading", { name: "지역별 국회 기록 탐색" })
    ).not.toBeInTheDocument();
  });
});
