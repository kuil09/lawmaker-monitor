import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "../../apps/web/src/App.js";

const fixturesDir = resolve(process.cwd(), "tests/fixtures/contracts");
const latestVotesFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, "latest_votes.json"), "utf8")
);
const accountabilitySummaryFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, "accountability_summary.json"), "utf8")
);
const accountabilityTrendsFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, "accountability_trends.json"), "utf8")
);
const manifestFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, "manifest.json"), "utf8")
);
const memberActivityCalendarFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, "member_activity_calendar.json"), "utf8")
);
const memberAssetsIndexFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, "member_assets_index.json"), "utf8")
);
const memberAssetsHistoryFixtures = {
  M001: JSON.parse(
    readFileSync(
      resolve(fixturesDir, "member_assets_history/M001.json"),
      "utf8"
    )
  ),
  M002: JSON.parse(
    readFileSync(
      resolve(fixturesDir, "member_assets_history/M002.json"),
      "utf8"
    )
  )
};

function buildFetchResponse(input: string | URL | Request): Response {
  const decodedUrl = decodeURIComponent(String(input));

  if (decodedUrl.endsWith("/exports/latest_votes.json")) {
    return new Response(JSON.stringify(latestVotesFixture), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  if (decodedUrl.endsWith("/exports/accountability_summary.json")) {
    return new Response(JSON.stringify(accountabilitySummaryFixture), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  if (decodedUrl.endsWith("/exports/accountability_trends.json")) {
    return new Response(JSON.stringify(accountabilityTrendsFixture), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  if (decodedUrl.endsWith("/manifests/latest.json")) {
    return new Response(JSON.stringify(manifestFixture), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  if (decodedUrl.endsWith("/exports/member_activity_calendar.json")) {
    return new Response(JSON.stringify(memberActivityCalendarFixture), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  if (decodedUrl.endsWith("/exports/member_assets_index.json")) {
    return new Response(JSON.stringify(memberAssetsIndexFixture), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  if (decodedUrl.endsWith("/exports/member_assets_history/M001.json")) {
    return new Response(JSON.stringify(memberAssetsHistoryFixtures.M001), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  if (decodedUrl.endsWith("/exports/member_assets_history/M002.json")) {
    return new Response(JSON.stringify(memberAssetsHistoryFixtures.M002), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  return new Response(null, { status: 404 });
}

describe("web app shell", () => {
  beforeEach(() => {
    window.location.hash = "";
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) =>
        Promise.resolve(buildFetchResponse(input))
      )
    );
  });

  it("renders the home shell and search affordances", async () => {
    render(<App />);

    await screen.findByText("의원 직접 검색");
    expect(
      screen.getByRole("button", { name: "활동 캘린더 열기" })
    ).toBeDisabled();
    expect(screen.getByText("국회 전체 분포 보기")).toBeInTheDocument();
  });

  it("navigates from the home shell into the lazy recent-votes route", async () => {
    render(<App />);

    fireEvent.click(await screen.findByText("최근 표결"));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /최신 본회의 표결/ })
      ).toBeInTheDocument();
    });
  });

  it("renders the party-line leaderboard mode on the home screen", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("tab", { name: "당내 이탈" }));

    expect(
      screen.getByText(
        "당 기준이 성립한 기록표결에서 실제 참여했을 때 얼마나 다른 표를 던졌는지 보여 줍니다. 불참은 이탈로 세지 않고 기회 대비 참여 여부만 따로 남깁니다."
      )
    ).toBeInTheDocument();
    expect(screen.getAllByText("당내 이탈도").length).toBeGreaterThan(0);
  });

  it("shows the party-line empty state on the trends route when no opportunities exist", async () => {
    render(<App />);

    fireEvent.click(await screen.findByText("출석 추이"));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", {
          level: 1,
          name: /출석과 당내 이탈 흐름/
        })
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText(/관측 창에 당 기준이 성립한 표결이 아직 없습니다\./)
    ).toBeInTheDocument();
  });
});
