import React from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VoteMinutesOpinionPanel } from "../../apps/web/src/components/VoteMinutesOpinionPanel.js";
import {
  loadMemberStatementSummaries,
  loadMemberStatementSummariesIndex
} from "../../apps/web/src/lib/data.js";
import votes from "../fixtures/contracts/latest_votes.json";

import type { LatestVoteItem } from "@lawmaker-monitor/schemas";

const vote = votes.items[0] as LatestVoteItem;
const coverage = {
  updatedAt: "2026-10-22T21:36:41Z",
  transcriptDocuments: 1901,
  summarizedDocuments: 165,
  remainingDocuments: 1736
};
afterEach(() => vi.unstubAllGlobals());

describe("minutes evidence availability", () => {
  it("discloses processing coverage without interpreting missing links as no speeches", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => coverage
      })
    );
    render(<VoteMinutesOpinionPanel vote={vote} opinion={null} />);
    expect(
      await screen.findByText(
        /본문 추출 1,901건 중 요약 완료 165건 · 미완료 1,736건/
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(/발언이 없었다는 뜻은 아닙니다/)
    ).toBeInTheDocument();
    expect(screen.queryByText("연결 대기")).not.toBeInTheDocument();
  });

  it("shows a request failure separately from an empty match", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 404 }));
    render(
      <VoteMinutesOpinionPanel vote={vote} opinion={null} error="HTTP 503" />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("HTTP 503");
    expect(
      screen.queryByText(/현재 공개 자료에서 연결된 발언을 찾지/)
    ).not.toBeInTheDocument();
  });

  it("revalidates speech indexes and requests details with a publication generation", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 404 });
    vi.stubGlobal("fetch", fetchMock);
    await loadMemberStatementSummariesIndex();
    await loadMemberStatementSummaries(
      "exports/member_statement_summaries/M001.json",
      "generation-2"
    );
    expect(fetchMock.mock.calls[0]![1]).toEqual({ cache: "no-cache" });
    expect(
      new URL(fetchMock.mock.calls[1]![0]).searchParams.get("generation")
    ).toBe("generation-2");
    expect(() =>
      loadMemberStatementSummaries("https://example.test/private.json")
    ).toThrow("Invalid member statement");
  });
});
