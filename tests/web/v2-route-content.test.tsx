import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { V2RouteContent } from "../../apps/web/src/v2/V2RouteContent.js";

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

describe("v2 evidence routes", () => {
  beforeEach(() => {
    window.location.hash = "";
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) =>
        Promise.resolve(buildFetchResponse(input))
      )
    );
  });

  it("renders the recent-votes evidence route without a legacy shell", async () => {
    window.location.hash = "#votes";
    render(<V2RouteContent />);

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /쟁점·표결 대조/ })
      ).toBeInTheDocument();
    });
  });

  it("shows the party-line empty state on the trends route when no opportunities exist", async () => {
    window.location.hash = "#trends";
    render(<V2RouteContent />);

    await waitFor(() => {
      expect(
        screen.getByRole("heading", {
          level: 1,
          name: /변화 전후 책임 원장/
        })
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText(/관측 창에 당 기준이 성립한 표결이 아직 없습니다\./)
    ).toBeInTheDocument();
  });
});
