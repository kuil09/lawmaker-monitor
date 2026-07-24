import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TrendsPage } from "../../apps/web/src/components/TrendsPage.js";
import { VoteCarousel } from "../../apps/web/src/components/VoteCarousel.js";
import { VotesPage } from "../../apps/web/src/components/VotesPage.js";

import type {
  AccountabilityTrendsExport,
  LatestVotesExport
} from "@lawmaker-monitor/schemas";

const fixturesDir = resolve(process.cwd(), "tests/fixtures/contracts");
const latestVotesFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, "latest_votes.json"), "utf8")
) as LatestVotesExport;
const accountabilityTrendsFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, "accountability_trends.json"), "utf8")
) as AccountabilityTrendsExport;

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
    expect(screen.getAllByRole("link", { name: "공식 사이트" })).toHaveLength(
      2
    );

    fireEvent.change(
      screen.getByRole("searchbox", {
        name: "안건 검색"
      }),
      { target: { value: "예산" } }
    );

    expect(screen.getByText(/예산 조정 동의안/)).toBeInTheDocument();
    expect(screen.queryByText(/시민투명성법안/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "안건 검색" }), {
      target: { value: "" }
    });
    fireEvent.click(screen.getByRole("button", { name: /불참 있음/ }));

    expect(screen.getByText(/시민투명성법안/)).toBeInTheDocument();
    expect(screen.queryByText(/예산 조정 동의안/)).not.toBeInTheDocument();
    expect(
      screen.getByText(/전체 2건 중 현재 조건과 일치/)
    ).toBeInTheDocument();
  });

  it("keeps the selected trend window aligned with the data table", () => {
    render(
      <TrendsPage
        accountabilityTrends={accountabilityTrendsFixture}
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
});
