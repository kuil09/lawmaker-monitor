import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TrendsPage } from "../../apps/web/src/components/TrendsPage.js";
import { VoteCarousel } from "../../apps/web/src/components/VoteCarousel.js";
import { PlenaryChamberVoteMap } from "../../apps/web/src/components/PlenaryChamberVoteMap.js";
import { VotesPage } from "../../apps/web/src/components/VotesPage.js";

import type {
  AccountabilitySummaryExport,
  AccountabilityTrendsExport,
  BillProposalActivityExport,
  LatestVotesExport
} from "@lawmaker-monitor/schemas";

const fixturesDir = resolve(process.cwd(), "tests/fixtures/contracts");
const latestVotesFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, "latest_votes.json"), "utf8")
) as LatestVotesExport;
const accountabilityTrendsFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, "accountability_trends.json"), "utf8")
) as AccountabilityTrendsExport;
const accountabilitySummaryFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, "accountability_summary.json"), "utf8")
) as AccountabilitySummaryExport;
const billProposalActivityFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, "bill_proposal_activity.json"), "utf8")
) as BillProposalActivityExport;

describe("evidence exploration pages", () => {
  it("filters vote records while preserving official evidence links", () => {
    render(
      <VotesPage
        latestVotes={latestVotesFixture}
        loading={false}
        unavailable={false}
        assemblyLabel="제22대 국회"
      />
    );

    expect(
      screen.getByRole("heading", { name: "표결 기록 탐색" })
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: "선택 표결 공식 원문" })
    ).toHaveLength(2);

    const archiveHeading = screen.getByRole("heading", {
      name: "표결 기록 탐색"
    });
    const archive = archiveHeading.closest("section");
    expect(archive).not.toBeNull();
    fireEvent.change(
      within(archive as HTMLElement).getByRole("searchbox", {
        name: "기록 검색"
      }),
      { target: { value: "예산" } }
    );

    expect(
      within(archive as HTMLElement).getByRole("heading", {
        name: "예산 조정 동의안"
      })
    ).toBeInTheDocument();
    expect(
      within(archive as HTMLElement).queryByRole("heading", {
        name: "시민투명성법안"
      })
    ).not.toBeInTheDocument();

    fireEvent.change(
      within(archive as HTMLElement).getByRole("searchbox", {
        name: "기록 검색"
      }),
      { target: { value: "" } }
    );
    fireEvent.click(
      within(archive as HTMLElement).getByRole("button", {
        name: /불참 있음/
      })
    );

    expect(
      within(archive as HTMLElement).getByRole("heading", {
        name: "시민투명성법안"
      })
    ).toBeInTheDocument();
    expect(
      within(archive as HTMLElement).queryByRole("heading", {
        name: "예산 조정 동의안"
      })
    ).not.toBeInTheDocument();
    expect(
      within(archive as HTMLElement).getByText(/전체 2건 중 일치/)
    ).toBeInTheDocument();
    expect(
      within(archive as HTMLElement).getByLabelText(
        /시민투명성법안 본회의장 좌석 시각화/
      )
    ).toBeInTheDocument();
  });

  it("keeps the selected trend window aligned with the data table", () => {
    render(
      <TrendsPage
        accountabilityTrends={accountabilityTrendsFixture}
        accountabilitySummary={null}
        assemblyLabel="제22대 국회"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "표로 보기" }));
    expect(
      screen.getByRole("table", {
        name: "최근 12주 주간 참여 구성 원자료"
      })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "4주" }));
    expect(
      screen.getByRole("table", {
        name: "최근 4주 주간 참여 구성 원자료"
      })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/관측 창에 당 기준이 성립한 표결이 아직 없습니다\./)
    ).toBeInTheDocument();
  });

  it("renders the complete member activity docket and filters by status", () => {
    render(
      <TrendsPage
        accountabilityTrends={accountabilityTrendsFixture}
        accountabilitySummary={accountabilitySummaryFixture}
        billProposalActivity={billProposalActivityFixture}
        assemblyLabel="제22대 국회"
      />
    );

    const board = screen.getByTestId("change-docket-board");
    expect(within(board).getAllByRole("listitem")).toHaveLength(3);
    expect(
      document.querySelector(".change-docket__result-count")
    ).toHaveTextContent("전체 3명 중 3명 표시");
    expect(screen.getAllByRole("link", { name: /김아라/ })).not.toHaveLength(0);

    fireEvent.click(
      screen.getByRole("button", {
        name: "불참 기록 1"
      })
    );

    expect(within(board).getAllByRole("listitem")).toHaveLength(1);
    expect(
      within(board).getByRole("link", { name: /박민/ })
    ).toBeInTheDocument();
    expect(
      within(board).queryByRole("link", { name: /김아라/ })
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "전체 의원 3"
      })
    );
    fireEvent.change(
      screen.getByRole("searchbox", {
        name: "의원·정당·지역구 검색"
      }),
      { target: { value: "비례대표" } }
    );

    expect(within(board).getAllByRole("listitem")).toHaveLength(1);
    expect(
      within(board).getByRole("link", { name: /이수/ })
    ).toBeInTheDocument();
  });

  it("reveals long vote histories in bounded pages", () => {
    const paginationItems = Array.from({ length: 25 }, (_, index) => ({
      ...latestVotesFixture.items[0],
      rollCallId: `roll-call-page-${index + 1}`,
      billName: `페이지 표결 ${index + 1}`,
      voteDatetime: new Date(
        Date.parse("2026-03-22T11:40:00+09:00") - index * 60_000
      ).toISOString()
    }));

    render(<VoteCarousel items={paginationItems} />);

    expect(screen.getByText(/페이지 표결 20$/)).toBeInTheDocument();
    expect(screen.queryByText(/페이지 표결 21$/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "다음 5건 보기" })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "다음 5건 보기" }));

    expect(screen.getByText(/페이지 표결 25$/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /다음 \d+건 보기/ })
    ).not.toBeInTheDocument();
  });

  it("opens a public-choice seating map with affirmative choices included", () => {
    render(
      <VoteCarousel
        items={[latestVotesFixture.items[0]]}
        memberDirectory={accountabilitySummaryFixture.items}
      />
    );

    const summary = screen
      .getByText("명단·회의록 근거")
      .closest("summary") as HTMLElement;
    const details = summary.closest("details") as HTMLDetailsElement;
    fireEvent.click(summary);
    fireEvent(details, new Event("toggle", { bubbles: true }));

    expect(
      screen.getByRole("heading", { name: "공개 선택 배치도" })
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /찬성/ })).toBeInTheDocument();
    expect(
      screen.getByRole("searchbox", { name: "의원 검색" })
    ).toBeInTheDocument();
  });

  it("offers a mobile-first member roster instead of relying on the seat map", () => {
    render(
      <PlenaryChamberVoteMap
        items={[latestVotesFixture.items[1]]}
        members={accountabilitySummaryFixture.items}
        loading={false}
        unavailable={false}
      />
    );

    const roster = screen.getByRole("region", {
      name: "의원별 표결 명단"
    });
    expect(within(roster).getAllByRole("listitem")).toHaveLength(3);
    expect(
      within(roster).getByRole("button", { name: /김아라/ })
    ).toBeInTheDocument();
    expect(
      within(roster).getByRole("button", { name: /박민/ })
    ).toBeInTheDocument();

    fireEvent.click(within(roster).getByRole("button", { name: /김아라/ }));

    expect(
      screen.getByRole("link", { name: "의원 공개 기록 열기" })
    ).toHaveAttribute("href", "#calendar?member=M001");
  });
});
