import type { Browser } from "playwright";
import type { Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  appUrl,
  createBrowserSession,
  ensureScreenshotRoot,
  launchBrowser,
  saveLocatorScreenshot,
  saveScreenshot,
  startUiServers,
  stopServer,
  viewportCases,
  writeScenarioManifest
} from "./support/ui-harness.js";

let browser: Browser;
let appServer: Server | undefined;
let dataServer: Server | undefined;
const scenarioManifest: Array<{ viewport: string; scenario: string; screenshot: string }> = [];

async function openHomeFlow(viewportName: string): Promise<void> {
  const { context, page, issues } = await createBrowserSession(browser, viewportCases.find((item) => item.name === viewportName)!);

  try {
    await page.goto(appUrl, { waitUntil: "networkidle" });
    await page.addStyleTag({
      content: `
        *,
        *::before,
        *::after {
          animation: none !important;
          transition: none !important;
          caret-color: transparent !important;
        }
      `
    });

    await page.getByRole("heading", { name: "국회 책임성 모니터" }).waitFor();
    await page.getByRole("heading", { name: "제22대 국회 의원 순위" }).waitFor();
    await page.getByText("제22대 국회 최근 12주 네거티브 추세").waitFor();
    expect(await page.getByRole("heading", { name: "제22대 국회 의원 순위" }).isVisible()).toBe(true);
    expect(await page.getByText("제22대 국회 최근 12주 네거티브 추세").isVisible()).toBe(true);
    expect(await page.getByRole("button", { name: "활동 캘린더 열기" }).isDisabled()).toBe(true);

    const leaderboardPrimaryLink = page.locator(".member-identity--small .member-identity__primary").first();
    const voteSourceLink = page.locator(".vote-card__source-link").first();
    const voteHighlightSummary = page.locator(".vote-card__highlight-summary").first();

    await Promise.all([
      leaderboardPrimaryLink.waitFor(),
      voteSourceLink.waitFor(),
      voteHighlightSummary.waitFor()
    ]);

    const leaderboardPrimaryHeight = await leaderboardPrimaryLink.evaluate(
      (element) => element.getBoundingClientRect().height
    );
    const voteSourceLinkHeight = await voteSourceLink.evaluate(
      (element) => element.getBoundingClientRect().height
    );
    const voteHighlightSummaryHeight = await voteHighlightSummary.evaluate(
      (element) => element.getBoundingClientRect().height
    );

    expect(leaderboardPrimaryHeight).toBeGreaterThanOrEqual(44);
    expect(voteSourceLinkHeight).toBeGreaterThanOrEqual(44);
    expect(voteHighlightSummaryHeight).toBeGreaterThanOrEqual(44);

    const homeScreenshot = await saveScreenshot(page, `${viewportName}/home.png`);
    scenarioManifest.push({ viewport: viewportName, scenario: "home-overview", screenshot: homeScreenshot });

    const searchField = page.getByRole("combobox", { name: "의원 검색" });
    await searchField.fill("박민");
    await searchField.press("Tab");
    await expect.poll(async () => page.getByRole("button", { name: "활동 캘린더 열기" }).isEnabled()).toBe(true);
    await page.getByRole("button", { name: "활동 캘린더 열기" }).click();

    await expect.poll(() => new URL(page.url()).hash).toBe("#calendar?member=M002");
    await page.getByRole("heading", { name: "의원 표결 활동 그래프" }).waitFor();
    await page.getByRole("heading", { name: "최근 표결 날짜 흐름" }).waitFor();
    await page.getByText("현재 소속 위원회", { exact: true }).waitFor();

    const backButton = page.locator(".activity-page__back");
    const helpButton = page.locator(".activity-page__help-button");
    await Promise.all([backButton.waitFor(), helpButton.waitFor()]);

    const [backButtonBounds, helpButtonBounds] = await Promise.all([
      backButton.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return { width: bounds.width, height: bounds.height };
      }),
      helpButton.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return { width: bounds.width, height: bounds.height };
      })
    ]);

    expect(backButtonBounds.width).toBeGreaterThanOrEqual(44);
    expect(backButtonBounds.height).toBeGreaterThanOrEqual(44);
    expect(helpButtonBounds.width).toBeGreaterThanOrEqual(44);
    expect(helpButtonBounds.height).toBeGreaterThanOrEqual(44);

    if (viewportName === "desktop") {
      expect(backButtonBounds.width).toBeGreaterThanOrEqual(48);
      expect(backButtonBounds.height).toBeGreaterThanOrEqual(48);
      expect(helpButtonBounds.width).toBeGreaterThanOrEqual(48);
      expect(helpButtonBounds.height).toBeGreaterThanOrEqual(48);
    }

    const committeeToggle = page.locator(".activity-committee-card__details-toggle").first();
    await committeeToggle.waitFor();

    const toggleHeight = await committeeToggle.evaluate((element) =>
      element.getBoundingClientRect().height
    );
    expect(toggleHeight).toBeGreaterThanOrEqual(44);

    await committeeToggle.click();

    const firstCommitteeRecord = page.locator(".activity-committee-card__record-link").first();
    await firstCommitteeRecord.waitFor();

    const committeeRecordLayout = await firstCommitteeRecord.evaluate((element) => {
      const title = element.querySelector(".activity-committee-card__record-title") as HTMLElement | null;
      const titleStyles = title ? window.getComputedStyle(title) : null;

      return {
        height: element.getBoundingClientRect().height,
        titleWhiteSpace: titleStyles?.whiteSpace ?? "",
        titleLineClamp: titleStyles?.getPropertyValue("-webkit-line-clamp") ?? ""
      };
    });

    expect(committeeRecordLayout.height).toBeGreaterThanOrEqual(44);
    expect(committeeRecordLayout.titleWhiteSpace).not.toBe("nowrap");
    expect(committeeRecordLayout.titleLineClamp).toBe("2");

    const calendarViewportState = await page
      .locator(".activity-drawer__main .contribution-calendar__viewport")
      .first()
      .evaluate((element) => {
        const viewport = element as HTMLDivElement;
        return {
          scrollLeft: viewport.scrollLeft,
          scrollWidth: viewport.scrollWidth,
          clientWidth: viewport.clientWidth
        };
      });

    if (calendarViewportState.scrollWidth > calendarViewportState.clientWidth) {
      expect(calendarViewportState.scrollLeft).toBeGreaterThan(0);
    } else {
      expect(calendarViewportState.scrollLeft).toBe(0);
    }

    const calendarScreenshot = await saveScreenshot(page, `${viewportName}/calendar-single.png`);
    scenarioManifest.push({
      viewport: viewportName,
      scenario: "home-search-to-single-calendar",
      screenshot: calendarScreenshot
    });

    const voteRecordSection = page.locator(".activity-vote-records").first();
    await voteRecordSection.scrollIntoViewIfNeeded();
    await voteRecordSection.waitFor();
    expect(await voteRecordSection.getByText("불참", { exact: true }).isVisible()).toBe(true);

    const voteRecordToggle = voteRecordSection.locator(".activity-vote-records__details-toggle");
    expect(await voteRecordToggle.count()).toBeGreaterThan(0);
    const voteRecordToggleHeight = await voteRecordToggle.first().evaluate((element) =>
      element.getBoundingClientRect().height
    );
    expect(voteRecordToggleHeight).toBeGreaterThanOrEqual(44);

    const voteRecordsScreenshot = await saveLocatorScreenshot(
      voteRecordSection,
      `${viewportName}/calendar-vote-records.png`
    );
    scenarioManifest.push({
      viewport: viewportName,
      scenario: "calendar-vote-records",
      screenshot: voteRecordsScreenshot
    });

    await page.getByRole("button", { name: "홈으로" }).click();
    await expect.poll(() => new URL(page.url()).hash).toBe("");
    await page.getByRole("heading", { name: "국회 책임성 모니터" }).waitFor();

    expect(issues).toEqual([]);
  } finally {
    await context.close();
  }
}

async function openCompareFlow(viewportName: string): Promise<void> {
  const { context, page, issues } = await createBrowserSession(browser, viewportCases.find((item) => item.name === viewportName)!);

  try {
    await page.goto(`${appUrl}/#calendar?member=M002`, { waitUntil: "networkidle" });
    await page.addStyleTag({
      content: `
        *,
        *::before,
        *::after {
          animation: none !important;
          transition: none !important;
          caret-color: transparent !important;
        }
      `
    });

    await page.getByRole("heading", { name: "의원 표결 활동 그래프" }).waitFor();
    await page.getByRole("heading", { name: "최근 표결 날짜 흐름" }).waitFor();
    await page.getByRole("button", { name: "설명 보기" }).click();
    await page.getByText(/이 화면은 표결이 있었던 날짜를 하루 단위로 묶어 보여줍니다/).waitFor();

    const helpScreenshot = await saveScreenshot(page, `${viewportName}/calendar-help.png`);
    scenarioManifest.push({
      viewport: viewportName,
      scenario: "calendar-help",
      screenshot: helpScreenshot
    });

    const viewportLocator = page.locator(".activity-drawer__main .contribution-calendar__viewport").first();
    await viewportLocator.evaluate((element) => {
      const viewport = element as HTMLDivElement;
      viewport.scrollLeft = 0;
      viewport.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: 240,
          bubbles: true,
          cancelable: true
        })
      );
    });

    const horizontalScroll = await viewportLocator.evaluate((element) => {
      const viewport = element as HTMLDivElement;
      return {
        scrollLeft: viewport.scrollLeft,
        scrollWidth: viewport.scrollWidth,
        clientWidth: viewport.clientWidth
      };
    });
    if (horizontalScroll.scrollWidth > horizontalScroll.clientWidth) {
      expect(horizontalScroll.scrollLeft).toBeGreaterThan(0);
    } else {
      expect(horizontalScroll.scrollLeft).toBe(0);
    }

    await page.getByRole("tab", { name: "VS 비교" }).click();
    expect(await page.getByRole("tab", { name: "VS 비교" }).getAttribute("aria-selected")).toBe("true");

    const compareSearchField = page.getByRole("combobox", { name: "비교 의원 찾기" });
    await compareSearchField.fill("김아라");
    await compareSearchField.press("Tab");
    await expect.poll(() => compareSearchField.inputValue()).toContain("김아라");

    await page.getByLabel("비교 요약").waitFor();
    expect(await page.getByText("김아라").count()).toBeGreaterThan(0);
    expect(await page.getByText("박민").count()).toBeGreaterThan(0);

    const compareScreenshot = await saveScreenshot(page, `${viewportName}/calendar-compare.png`);
    scenarioManifest.push({
      viewport: viewportName,
      scenario: "calendar-compare",
      screenshot: compareScreenshot
    });

    await page.goto(`${appUrl}/#calendar?member=M002&compare=M001&view=compare`, {
      waitUntil: "networkidle"
    });
    await page.getByLabel("비교 요약").waitFor();
    expect(await page.getByRole("tab", { name: "VS 비교" }).getAttribute("aria-selected")).toBe("true");

    expect(issues).toEqual([]);
  } finally {
    await context.close();
  }
}

describe("UI flow coverage", () => {
  beforeAll(async () => {
    await ensureScreenshotRoot();
    const servers = await startUiServers();
    appServer = servers.appServer;
    dataServer = servers.dataServer;
    browser = await launchBrowser();
  });

  afterAll(async () => {
    await browser?.close();
    await stopServer(appServer);
    await stopServer(dataServer);
    await writeScenarioManifest(scenarioManifest);
  });

  for (const viewport of viewportCases) {
    it(`captures the home and single-member flow on ${viewport.name}`, async () => {
      await openHomeFlow(viewport.name);
    });

    it(`captures the help, scroll, and compare flow on ${viewport.name}`, async () => {
      await openCompareFlow(viewport.name);
    });
  }
});
