import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
const manifestFixture = JSON.parse(readFileSync(resolve(fixturesDir, "manifest.json"), "utf8"));
const memberActivityCalendarFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, "member_activity_calendar.json"), "utf8")
);
const memberActivityCalendarMemberDetailFixtures = {
  M001: JSON.parse(
    readFileSync(resolve(fixturesDir, "member_activity_calendar_members/M001.json"), "utf8")
  ),
  M002: JSON.parse(
    readFileSync(resolve(fixturesDir, "member_activity_calendar_members/M002.json"), "utf8")
  )
};
const legacyManifestFixture = {
  ...manifestFixture,
  exports: {
    latestVotes: manifestFixture.exports.latestVotes
  }
};
let fetchMock: ReturnType<typeof vi.fn>;
let shareMock: ReturnType<typeof vi.fn>;
let clipboardWriteTextMock: ReturnType<typeof vi.fn>;

describe("web app", () => {
  beforeEach(() => {
    window.location.hash = "";
    fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/exports/latest_votes.json")) {
        return Promise.resolve(
          new Response(JSON.stringify(latestVotesFixture), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          })
        );
      }

      if (url.endsWith("/exports/accountability_summary.json")) {
        return Promise.resolve(
          new Response(JSON.stringify(accountabilitySummaryFixture), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          })
        );
      }

      if (url.endsWith("/exports/accountability_trends.json")) {
        return Promise.resolve(
          new Response(JSON.stringify(accountabilityTrendsFixture), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          })
        );
      }

      if (url.endsWith("/exports/member_activity_calendar.json")) {
        return Promise.resolve(
          new Response(JSON.stringify(memberActivityCalendarFixture), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          })
        );
      }

      if (url.endsWith("/exports/member_activity_calendar_members/M001.json")) {
        return Promise.resolve(
          new Response(JSON.stringify(memberActivityCalendarMemberDetailFixtures.M001), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          })
        );
      }

      if (url.endsWith("/exports/member_activity_calendar_members/M002.json")) {
        return Promise.resolve(
          new Response(JSON.stringify(memberActivityCalendarMemberDetailFixtures.M002), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          })
        );
      }

      if (url.endsWith("/manifests/latest.json")) {
        return Promise.resolve(
          new Response(JSON.stringify(manifestFixture), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          })
        );
      }

      return Promise.resolve(new Response("not found", { status: 404 }));
    });

    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("open", vi.fn());
    shareMock = vi.fn(async () => undefined);
    clipboardWriteTextMock = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", {
      ...window.navigator,
      share: shareMock,
      clipboard: {
        writeText: clipboardWriteTextMock
      }
    });
  });

  it("renders the Korean accountability leaderboard and keeps calendar data lazy", async () => {
    render(<App />);

    await screen.findByText("제22대 국회 의원 순위");
    expect(screen.queryByRole("button", { name: "활동 캘린더 보기" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "의원 검색" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "활동 캘린더 열기" })).toBeInTheDocument();
    expect(screen.getByText("제22대 국회 최근 12주 네거티브 추세")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "찬성" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "반대" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "기권" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "불참" })).toBeInTheDocument();
    expect(screen.queryByText("반대·기권·불참 기준 최근 4주 급상승 의원")).not.toBeInTheDocument();
    expect(screen.queryByText("제22대 국회 현재 반대·기권·불참 상위 10")).not.toBeInTheDocument();
    expect(screen.getByText(/최종 갱신/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "국회 책임성 모니터" })).toBeInTheDocument();
    expect(
      screen.getByText(
        /국회 표결 기록으로 의원 활동을 살펴보는 서비스입니다\./
      )
    ).toBeInTheDocument();
    expect(screen.queryByText("연속 반대·기권·불참 패턴을 contribution calendar로 봅니다.")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/exports/member_activity_calendar.json"))).toBe(false);
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes("/exports/member_activity_calendar_members/")
      )
    ).toBe(false);
    const leaderboardHeading = screen.getByRole("heading", {
      name: "제22대 국회 의원 순위"
    });
    const leaderboardPanel = leaderboardHeading.closest(".leaderboard-panel");
    expect(leaderboardPanel).not.toBeNull();
    expect(within(leaderboardPanel as HTMLElement).getByRole("link", { name: /박민/ })).toHaveAttribute(
      "href",
      "#calendar?member=M002"
    );
    expect(
      (leaderboardPanel as HTMLElement).querySelector(
        'img.member-identity__avatar[src="https://www.assembly.go.kr/static/portal/img/openassm/new/thumb/member-m002.jpg"]'
      )
    ).not.toBeNull();
  });


  it("opens the activity calendar page on demand without exposing an assembly selector", async () => {
    window.location.hash = "#calendar?member=M002";
    render(<App />);

    expect(await screen.findByRole("heading", { name: "의원 표결 활동 그래프" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "홈으로" })).toBeInTheDocument();
    expect(screen.getAllByText(/제22대 국회 기준/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("박민").length).toBeGreaterThan(0);
    expect(screen.getByRole("combobox", { name: "기준 의원 찾기" })).toBeInTheDocument();
    expect(
      screen.getByText("입력값을 지우고 다른 이름이나 정당을 입력하면 기준 의원을 바꿀 수 있습니다.")
    ).toBeInTheDocument();
    expect(screen.queryByText(/이 화면은 표결이 있었던 날짜를 하루 단위로 묶어 보여줍니다/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "설명 보기" }));
    expect(
      screen.getByText(/이 화면은 표결이 있었던 날짜를 하루 단위로 묶어 보여줍니다/)
    ).toBeInTheDocument();
    expect(screen.queryByDisplayValue("제22대 국회")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("제21대 국회")).not.toBeInTheDocument();
  });

  it("loads the selected member vote records lazily on the single-member view", async () => {
    window.location.hash = "#calendar?member=M002";
    render(<App />);

    expect(await screen.findByRole("heading", { name: "의원 표결 활동 그래프" })).toBeInTheDocument();
    expect(await screen.findByText("공영방송 지배구조 개선법안")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).includes("/exports/member_activity_calendar_members/M002.json")
      )
    ).toHaveLength(1);
  });

  it("opens the activity calendar scrolled to the latest dates by default", async () => {
    const originalScrollWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollWidth");
    const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");

    Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
      configurable: true,
      get() {
        if (this instanceof HTMLElement && this.classList.contains("contribution-calendar__viewport")) {
          return 960;
        }

        return originalScrollWidth?.get ? originalScrollWidth.get.call(this) : 0;
      }
    });

    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        if (this instanceof HTMLElement && this.classList.contains("contribution-calendar__viewport")) {
          return 320;
        }

        return originalClientWidth?.get ? originalClientWidth.get.call(this) : 0;
      }
    });

    try {
      window.location.hash = "#calendar?member=M002";
      render(<App />);
      await screen.findByRole("heading", { name: "의원 표결 활동 그래프" });

      await waitFor(() => {
        const viewport = document.querySelector(
          ".activity-drawer__main .contribution-calendar__viewport"
        ) as HTMLDivElement | null;
        expect(viewport).not.toBeNull();
        expect((viewport as HTMLDivElement).scrollLeft).toBe(640);
      });
    } finally {
      if (originalScrollWidth) {
        Object.defineProperty(HTMLElement.prototype, "scrollWidth", originalScrollWidth);
      } else {
        delete (HTMLElement.prototype as Partial<HTMLElement>).scrollWidth;
      }

      if (originalClientWidth) {
        Object.defineProperty(HTMLElement.prototype, "clientWidth", originalClientWidth);
      } else {
        delete (HTMLElement.prototype as Partial<HTMLElement>).clientWidth;
      }
    }
  });

  it("shows negative streaks and separated ranking counts with absent records included", async () => {
    window.location.hash = "#calendar?member=M002";
    render(<App />);
    await screen.findByRole("heading", { name: "의원 표결 활동 그래프" });

    expect(screen.getAllByText("현재 찬성 없이 이어진 날").length).toBeGreaterThan(0);
    expect(screen.getByText("반대 1일 · 기권 1일 · 불참 1일")).toBeInTheDocument();
    expect(screen.getByText("현재 소속 위원회")).toBeInTheDocument();
    expect(screen.getAllByText("법제사법위원회").length).toBeGreaterThan(0);
    expect(screen.getAllByText("예산결산특별위원회").length).toBeGreaterThan(0);
    expect(screen.getByText("현재 소속 위원회 표결 참여율이 낮습니다.")).toBeInTheDocument();
    expect(screen.getAllByText("활동 비율").length).toBeGreaterThan(0);
    expect(screen.getByText("위원회 반응도")).toBeInTheDocument();
    expect(screen.getByText("관심 높은 위원회")).toBeInTheDocument();
    expect(screen.getByText("무관심한 위원회")).toBeInTheDocument();
    expect(screen.getAllByText("소속 위원회").length).toBeGreaterThan(0);
    expect(screen.getByText("의안별 표결 기록")).toBeInTheDocument();
    expect(await screen.findByText("공영방송 지배구조 개선법안")).toBeInTheDocument();
    expect(await screen.findByText("예산 조정 동의안")).toBeInTheDocument();
    expect(screen.getByDisplayValue("박민 · 미래개혁당")).toBeInTheDocument();
  });

  it("updates the primary calendar member after clearing and entering a new name", async () => {
    window.location.hash = "#calendar?member=M002";
    render(<App />);
    await screen.findByRole("heading", { name: "의원 표결 활동 그래프" });

    const memberInput = screen.getByRole("combobox", { name: "기준 의원 찾기" });
    fireEvent.focus(memberInput);
    fireEvent.change(memberInput, { target: { value: "" } });
    fireEvent.change(memberInput, { target: { value: "김아라 · 미래개혁당" } });
    fireEvent.blur(memberInput);

    expect(memberInput).toHaveValue("김아라 · 미래개혁당");
    expect(screen.getByRole("link", { name: "김아라 미래개혁당" })).toHaveAttribute(
      "href",
      "#calendar?member=M001"
    );
  });

  it("shares the selected member calendar as a deep link when supported", async () => {
    window.location.hash = "#calendar?member=M002";
    render(<App />);
    await screen.findByRole("heading", { name: "의원 표결 활동 그래프" });

    fireEvent.click(screen.getByRole("button", { name: "공유하기" }));

    await waitFor(() => {
      expect(shareMock).toHaveBeenCalled();
    });
    expect(shareMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "박민 활동 캘린더",
        text: "제22대 국회 활동 캘린더 링크입니다.",
        url: expect.stringContaining("#calendar?member=M002")
      })
    );
  });

  it("switches to VS comparison and shows same-assembly comparison metrics", async () => {
    window.location.hash = "#calendar?member=M002";
    render(<App />);
    await screen.findByRole("heading", { name: "의원 표결 활동 그래프" });

    fireEvent.click(screen.getByRole("tab", { name: "VS 비교" }));

    expect(await screen.findByText("제22대 국회 두 의원 비교")).toBeInTheDocument();
    expect(screen.getByDisplayValue("김아라 · 미래개혁당")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "비교 의원 찾기" })).toBeInTheDocument();
    expect(screen.queryByText("서로 다른 선택")).not.toBeInTheDocument();
    expect(screen.getAllByText("찬성").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/일 더/).length).toBeGreaterThan(0);
    expect(screen.getByText("비율 비교")).toBeInTheDocument();
    expect(screen.getAllByText("박민").length).toBeGreaterThan(0);
    expect(screen.getAllByText("김아라").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "공유하기" })).not.toBeInTheDocument();
  });

  it("does not request member detail files when the page opens directly in compare mode", async () => {
    window.location.hash = "#calendar?member=M002&compare=M001&view=compare";
    render(<App />);

    expect(await screen.findByText("제22대 국회 두 의원 비교")).toBeInTheDocument();
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).includes("/exports/member_activity_calendar_members/")
        )
      ).toBe(false);
    });
  });

  it("keeps the calendar visible when member detail loading fails and recovers on retry", async () => {
    let detailRequestCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/exports/latest_votes.json")) {
          return Promise.resolve(
            new Response(JSON.stringify(latestVotesFixture), {
              status: 200,
              headers: { "Content-Type": "application/json" }
            })
          );
        }

        if (url.endsWith("/exports/accountability_summary.json")) {
          return Promise.resolve(
            new Response(JSON.stringify(accountabilitySummaryFixture), {
              status: 200,
              headers: { "Content-Type": "application/json" }
            })
          );
        }

        if (url.endsWith("/exports/accountability_trends.json")) {
          return Promise.resolve(
            new Response(JSON.stringify(accountabilityTrendsFixture), {
              status: 200,
              headers: { "Content-Type": "application/json" }
            })
          );
        }

        if (url.endsWith("/exports/member_activity_calendar.json")) {
          return Promise.resolve(
            new Response(JSON.stringify(memberActivityCalendarFixture), {
              status: 200,
              headers: { "Content-Type": "application/json" }
            })
          );
        }

        if (url.endsWith("/exports/member_activity_calendar_members/M002.json")) {
          detailRequestCount += 1;
          if (detailRequestCount === 1) {
            return Promise.resolve(new Response("boom", { status: 500 }));
          }

          return Promise.resolve(
            new Response(JSON.stringify(memberActivityCalendarMemberDetailFixtures.M002), {
              status: 200,
              headers: { "Content-Type": "application/json" }
            })
          );
        }

        if (url.endsWith("/manifests/latest.json")) {
          return Promise.resolve(
            new Response(JSON.stringify(manifestFixture), {
              status: 200,
              headers: { "Content-Type": "application/json" }
            })
          );
        }

        return Promise.resolve(new Response("not found", { status: 404 }));
      })
    );

    window.location.hash = "#calendar?member=M002";
    render(<App />);

    expect(await screen.findByRole("heading", { name: "의원 표결 활동 그래프" })).toBeInTheDocument();
    expect(screen.getByText("최근 표결 날짜 흐름")).toBeInTheDocument();

    const voteRecordSection = await screen.findByRole("region", { name: "의안별 표결 기록" });
    expect(
      within(voteRecordSection).getByText(/의안별 표결 기록을 불러오지 못했습니다/)
    ).toBeInTheDocument();

    fireEvent.click(within(voteRecordSection).getByRole("button", { name: "다시 시도" }));

    expect(await within(voteRecordSection).findByText("공영방송 지배구조 개선법안")).toBeInTheDocument();
    expect(detailRequestCount).toBe(2);
  });

  it("shows compact vote items without time or snapshot metadata", async () => {
    render(<App />);

    const voteTitle = await screen.findByText(/시민투명성법안/);
    const voteCard = voteTitle.closest(".vote-card");
    expect(voteCard).not.toBeNull();
    expect(screen.getAllByRole("link", { name: "공식 사이트" })).toHaveLength(2);
    expect(screen.queryByText(/표결 시각/)).not.toBeInTheDocument();
    expect(screen.queryByText(/갱신 시각/)).not.toBeInTheDocument();
    expect(screen.queryByText(/스냅샷/)).not.toBeInTheDocument();
    const dateGroupHeading = screen.getByRole("heading", { name: "2026년 3월 22일" });
    const dateGroup = dateGroupHeading.closest(".vote-carousel__group");
    expect(dateGroup).not.toBeNull();
    expect(
      within(dateGroup as HTMLElement).getByText("2건", { selector: ".vote-carousel__group-count" })
    ).toBeInTheDocument();
    expect(screen.getAllByText("반대 / 기권 / 불참")).toHaveLength(2);
    expect(screen.getByText("한창민")).toBeInTheDocument();
    expect(within(voteCard as HTMLElement).getByRole("link", { name: "박민" })).toHaveAttribute(
      "href",
      "#calendar?member=M002"
    );
    expect((voteCard as HTMLElement).querySelector(".vote-card__highlight")).not.toHaveAttribute("open");
  });

  it("shows absent counts without names when the absent list is unavailable", async () => {
    const unavailableLatestVotesFixture = {
      ...latestVotesFixture,
      items: latestVotesFixture.items.map((item: (typeof latestVotesFixture.items)[number], index: number) =>
        index === 0
          ? {
              ...item,
              counts: {
                ...item.counts,
                absent: 1
              },
              absentVotes: [],
              absentListStatus: "unavailable" as const
            }
          : item
      )
    };

    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/exports/latest_votes.json")) {
          return Promise.resolve(
            new Response(JSON.stringify(unavailableLatestVotesFixture), {
              status: 200,
              headers: { "Content-Type": "application/json" }
            })
          );
        }

        if (url.endsWith("/exports/accountability_summary.json")) {
          return Promise.resolve(
            new Response(JSON.stringify(accountabilitySummaryFixture), {
              status: 200,
              headers: { "Content-Type": "application/json" }
            })
          );
        }

        if (url.endsWith("/exports/accountability_trends.json")) {
          return Promise.resolve(
            new Response(JSON.stringify(accountabilityTrendsFixture), {
              status: 200,
              headers: { "Content-Type": "application/json" }
            })
          );
        }

        if (url.endsWith("/manifests/latest.json")) {
          return Promise.resolve(
            new Response(JSON.stringify(manifestFixture), {
              status: 200,
              headers: { "Content-Type": "application/json" }
            })
          );
        }

        return Promise.resolve(new Response("not found", { status: 404 }));
      })
    );

    render(<App />);

    const voteTitle = await screen.findByText(/예산 조정 동의안/);
    const voteCard = voteTitle.closest(".vote-card");
    expect(voteCard).not.toBeNull();

    fireEvent.click(within(voteCard as HTMLElement).getByText("반대 / 기권 / 불참"));

    expect(
      within(voteCard as HTMLElement).getByText(
        "불참 명단은 공식 총계와 개인별 공개 기록이 일치할 때만 표시합니다."
      )
    ).toBeInTheDocument();
  });

  it("shows a personal site button only inside the activity calendar page", async () => {
    window.location.hash = "#calendar?member=M001";

    render(<App />);

    await screen.findByRole("heading", { name: "의원 표결 활동 그래프" });
    expect(screen.getByRole("link", { name: "홈페이지" })).toHaveAttribute(
      "href",
      "https://blog.example.kr/kim-ara"
    );
  });

  it("keeps the home feed alive when legacy manifest or ranking export is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/exports/latest_votes.json")) {
          return Promise.resolve(
            new Response(JSON.stringify(latestVotesFixture), {
              status: 200,
              headers: { "Content-Type": "application/json" }
            })
          );
        }

        if (url.endsWith("/exports/accountability_summary.json")) {
          return Promise.resolve(new Response("not found", { status: 404 }));
        }

        if (url.endsWith("/exports/accountability_trends.json")) {
          return Promise.resolve(new Response("not found", { status: 404 }));
        }

        if (url.endsWith("/manifests/latest.json")) {
          return Promise.resolve(
            new Response(JSON.stringify(legacyManifestFixture), {
              status: 200,
              headers: { "Content-Type": "application/json" }
            })
          );
        }

        return Promise.resolve(new Response("not found", { status: 404 }));
      })
    );

    render(<App />);

    expect((await screen.findAllByText(/예산 조정 동의안/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/홈 화면 데이터를 불러오지 못했습니다/)).not.toBeInTheDocument();
    expect(screen.getAllByText("책임성 랭킹 데이터가 아직 준비되지 않았습니다.").length).toBeGreaterThan(0);
    expect(screen.getByText("상태 안내")).toBeInTheDocument();
  });
});
