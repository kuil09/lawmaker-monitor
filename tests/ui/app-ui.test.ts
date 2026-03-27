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
    await page.getByText("출석 집중 브리핑").waitFor();
    await page.getByText("최근 표결 주간 참여율").waitFor();
    await page.getByText("제22대 국회 최근 12주 참여·불참 추세").waitFor();
    expect(await page.getByRole("heading", { name: "제22대 국회 의원 순위" }).isVisible()).toBe(true);
    expect(await page.getByText("제22대 국회 최근 12주 참여·불참 추세").isVisible()).toBe(true);
    expect(await page.getByRole("button", { name: "활동 캘린더 열기" }).isDisabled()).toBe(true);
    await expect
      .poll(async () => page.getByRole("tab", { name: "불참" }).getAttribute("aria-selected"))
      .toBe("true");

    const searchLayout = await page.locator(".search-panel").evaluate((element) => {
      const panel = element as HTMLElement;
      const layout = panel.querySelector(".search-panel__layout") as HTMLElement | null;
      const form = panel.querySelector(".search-panel__form") as HTMLElement | null;
      const explore = panel.querySelector(".search-panel__explore") as HTMLElement | null;
      const exploreAction = panel.querySelector(".search-panel__explore-action") as HTMLElement | null;

      if (!layout || !form || !explore || !exploreAction) {
        return null;
      }

      return {
        panelOverflow: panel.scrollWidth - panel.clientWidth,
        layoutColumnCount: window.getComputedStyle(layout).gridTemplateColumns.split(" ").length,
        exploreActionInForm: form.contains(exploreAction),
        exploreButtonHeight: exploreAction.getBoundingClientRect().height
      };
    });

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
    const heroLayout = await page.locator(".hero-panel").evaluate((element) => {
      const panel = element as HTMLElement;
      const masthead = panel.querySelector(".hero-panel__masthead") as HTMLElement | null;
      const chips = panel.querySelector(".hero-panel__chips") as HTMLElement | null;
      const freshness = panel.querySelector(".freshness-indicator") as HTMLElement | null;
      const story = panel.querySelector(".hero-panel__story") as HTMLElement | null;
      const headline = panel.querySelector(".hero-panel__headline") as HTMLElement | null;
      const title = headline?.querySelector("h1") as HTMLElement | null;
      const lede = panel.querySelector(".hero-panel__lede") as HTMLElement | null;
      const copy = panel.querySelector(".hero-panel__copy") as HTMLElement | null;
      const aside = panel.querySelector(".hero-panel__aside") as HTMLElement | null;

      if (!masthead || !chips || !freshness || !story || !headline || !title || !lede || !copy || !aside) {
        return null;
      }

      const titleRect = title.getBoundingClientRect();
      const titleStyle = window.getComputedStyle(title);
      const titleLineHeight = Number.parseFloat(titleStyle.lineHeight);

      return {
        panelOverflow: panel.scrollWidth - panel.clientWidth,
        mastheadColumns: window.getComputedStyle(masthead).gridTemplateColumns.split(" ").length,
        chipsBottomToFreshnessTop: freshness.getBoundingClientRect().top - chips.getBoundingClientRect().bottom,
        ledeTopToTitleBottom: lede.getBoundingClientRect().top - titleRect.bottom,
        copyTopToHeadlineBottom: copy.getBoundingClientRect().top - headline.getBoundingClientRect().bottom,
        asideTopToStoryBottom: aside.getBoundingClientRect().top - story.getBoundingClientRect().bottom,
        titleLineCount:
          Number.isFinite(titleLineHeight) && titleLineHeight > 0
            ? titleRect.height / titleLineHeight
            : null
      };
    });
    const leaderboardLayout = await page.locator(".ranking-item").first().evaluate((element) => {
      const content = element.querySelector(".ranking-item__content") as HTMLElement | null;
      const stats = element.querySelector(".ranking-item__stats") as HTMLElement | null;
      const graph = element.querySelector(".ranking-item__graph") as HTMLElement | null;
      const meta = element.querySelector(".ranking-item__meta") as HTMLElement | null;
      const metaItems = Array.from(element.querySelectorAll(".ranking-item__meta-item")) as HTMLElement[];

      if (!content || !stats || !graph || !meta) {
        return null;
      }

      const contentRect = content.getBoundingClientRect();
      const graphRect = graph.getBoundingClientRect();
      const metaRect = meta.getBoundingClientRect();

      return {
        statsHeight: stats.getBoundingClientRect().height,
        graphOffsetLeft: graphRect.left - contentRect.left,
        metaOffsetLeft: metaRect.left - contentRect.left,
        metaColumnCount: window.getComputedStyle(meta).gridTemplateColumns.split(" ").length,
        contentColumnCount: window.getComputedStyle(content).gridTemplateColumns.split(" ").length,
        itemOverflow: element.scrollWidth - element.clientWidth,
        metaItemHeights: metaItems.map((metaItem) => metaItem.getBoundingClientRect().height)
      };
    });
    const voteCardLayout = await page.locator(".vote-card").first().evaluate((element) => {
      const actions = element.querySelector(".vote-card__actions") as HTMLElement | null;
      const sourceLink = element.querySelector(".vote-card__source-link") as HTMLElement | null;
      const stats = element.querySelector(".vote-card__stats") as HTMLElement | null;
      const highlightSummary = element.querySelector(
        ".vote-card__highlight-summary"
      ) as HTMLElement | null;
      const statCards = Array.from(element.querySelectorAll(".vote-card__stat")) as HTMLElement[];

      if (!actions || !sourceLink || !stats || !highlightSummary) {
        return null;
      }

      const sourceRect = sourceLink.getBoundingClientRect();

      return {
        cardOverflow: element.scrollWidth - element.clientWidth,
        actionOverflow: actions.scrollWidth - actions.clientWidth,
        sourceHeight: sourceRect.height,
        statsColumnCount: window.getComputedStyle(stats).gridTemplateColumns.split(" ").length,
        statHeights: statCards.map((statCard) => statCard.getBoundingClientRect().height),
        summaryHeight: highlightSummary.getBoundingClientRect().height
      };
    });

    await voteHighlightSummary.click();
    await expect
      .poll(async () =>
        page
          .locator(".vote-card__highlight")
          .first()
          .evaluate((element) => (element as HTMLDetailsElement).open)
      )
      .toBe(true);
    const voteCardDetailLayout = await page.locator(".vote-card").first().evaluate((element) => {
      const highlight = element.querySelector(".vote-card__highlight") as HTMLDetailsElement | null;
      const highlightBody = element.querySelector(".vote-card__highlight-body") as HTMLElement | null;

      return {
        isOpen: highlight?.open ?? false,
        bodyHeight: highlightBody?.getBoundingClientRect().height ?? 0
      };
    });
    await voteHighlightSummary.click();
    await expect
      .poll(async () =>
        page
          .locator(".vote-card__highlight")
          .first()
          .evaluate((element) => (element as HTMLDetailsElement).open)
      )
      .toBe(false);

    expect(leaderboardPrimaryHeight).toBeGreaterThanOrEqual(44);
    expect(voteSourceLinkHeight).toBeGreaterThanOrEqual(44);
    expect(voteHighlightSummaryHeight).toBeGreaterThanOrEqual(44);
    expect(heroLayout).not.toBeNull();
    expect(heroLayout?.panelOverflow ?? 99).toBeLessThanOrEqual(1);
    expect(heroLayout?.ledeTopToTitleBottom ?? -1).toBeGreaterThanOrEqual(0);
    expect(heroLayout?.copyTopToHeadlineBottom ?? -1).toBeGreaterThanOrEqual(0);
    expect(searchLayout).not.toBeNull();
    expect(searchLayout?.panelOverflow ?? 99).toBeLessThanOrEqual(1);
    expect(searchLayout?.exploreActionInForm).toBe(false);
    expect(searchLayout?.exploreButtonHeight ?? 0).toBeGreaterThanOrEqual(44);
    expect(leaderboardLayout).not.toBeNull();
    expect(leaderboardLayout?.statsHeight ?? 0).toBeGreaterThanOrEqual(44);
    expect(Math.abs(leaderboardLayout?.graphOffsetLeft ?? 99)).toBeLessThan(2);
    expect(Math.abs(leaderboardLayout?.metaOffsetLeft ?? 99)).toBeLessThan(2);
    expect(leaderboardLayout?.itemOverflow ?? 99).toBeLessThanOrEqual(1);
    expect((leaderboardLayout?.metaItemHeights ?? []).every((height) => height >= 32)).toBe(true);
    expect(voteCardLayout).not.toBeNull();
    expect(voteCardLayout?.cardOverflow ?? 99).toBeLessThanOrEqual(1);
    expect(voteCardLayout?.actionOverflow ?? 99).toBeLessThanOrEqual(1);
    expect(voteCardLayout?.sourceHeight ?? 0).toBeGreaterThanOrEqual(44);
    expect(voteCardLayout?.summaryHeight ?? 0).toBeGreaterThanOrEqual(44);
    expect((voteCardLayout?.statHeights ?? []).every((height) => height >= 44)).toBe(true);
    expect(voteCardDetailLayout?.isOpen).toBe(true);
    expect(voteCardDetailLayout?.bodyHeight ?? 0).toBeGreaterThan(0);

    if (viewportName === "mobile") {
      expect(heroLayout?.mastheadColumns).toBe(1);
      expect(heroLayout?.chipsBottomToFreshnessTop ?? -1).toBeGreaterThanOrEqual(0);
      expect(heroLayout?.asideTopToStoryBottom ?? -1).toBeGreaterThanOrEqual(0);
      expect(heroLayout?.titleLineCount ?? 99).toBeLessThanOrEqual(2.4);
      expect(searchLayout?.layoutColumnCount).toBe(1);
      expect(leaderboardLayout?.metaColumnCount).toBe(2);
      expect(leaderboardLayout?.contentColumnCount).toBe(1);
      expect(voteCardLayout?.statsColumnCount).toBe(2);
    } else {
      expect(searchLayout?.layoutColumnCount).toBe(2);
    }

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

    const singleAvatarWidth = await page
      .locator(".activity-drawer__member-header .member-identity__avatar")
      .first()
      .evaluate((element) => element.getBoundingClientRect().width);
    expect(singleAvatarWidth).toBeGreaterThanOrEqual(56);

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

    const memberHeaderLayout = await page.locator(".activity-drawer__member-header").evaluate((element) => {
      const header = element as HTMLElement;
      const identityRow = header.querySelector(".activity-drawer__identity-row") as HTMLElement | null;
      const actions = header.querySelector(".activity-page__member-actions") as HTMLElement | null;
      const context = header.querySelector(".activity-drawer__member-context") as HTMLElement | null;
      const memberships = header.querySelector(".activity-drawer__committee-memberships") as HTMLElement | null;
      const summary = header.querySelector(".activity-drawer__summary") as HTMLElement | null;
      const actionButtons = Array.from(
        header.querySelectorAll(".activity-page__member-actions .activity-page__action-button")
      ) as HTMLElement[];
      const summaryCards = Array.from(header.querySelectorAll(".activity-drawer__summary > div")) as HTMLElement[];

      if (!identityRow || !actions || !context || !memberships || !summary) {
        return null;
      }

      const actionsRect = actions.getBoundingClientRect();
      const membershipsRect = memberships.getBoundingClientRect();

      return {
        headerOverflow: header.scrollWidth - header.clientWidth,
        identityColumns: window.getComputedStyle(identityRow).gridTemplateColumns.split(" ").length,
        contextColumns: window.getComputedStyle(context).gridTemplateColumns.split(" ").length,
        summaryColumns: window.getComputedStyle(summary).gridTemplateColumns.split(" ").length,
        actionsBottomToMembershipsTop: membershipsRect.top - actionsRect.bottom,
        actionButtonHeights: actionButtons.map((button) => button.getBoundingClientRect().height),
        summaryCardHeights: summaryCards.map((card) => card.getBoundingClientRect().height)
      };
    });
    expect(memberHeaderLayout).not.toBeNull();
    expect(memberHeaderLayout?.headerOverflow ?? 99).toBeLessThanOrEqual(1);
    expect((memberHeaderLayout?.actionButtonHeights ?? []).every((height) => height >= 44)).toBe(true);
    expect((memberHeaderLayout?.summaryCardHeights ?? []).every((height) => height >= 60)).toBe(true);

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

    if (viewportName === "mobile") {
      expect(memberHeaderLayout?.identityColumns).toBe(1);
      expect(memberHeaderLayout?.contextColumns).toBe(1);
      expect(memberHeaderLayout?.summaryColumns).toBe(2);
      expect(memberHeaderLayout?.actionsBottomToMembershipsTop ?? -1).toBeGreaterThanOrEqual(0);
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

    const compareAvatarWidths = await page
      .locator(".activity-compare__column .member-identity__avatar")
      .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width));
    expect(compareAvatarWidths).toHaveLength(2);
    expect(compareAvatarWidths.every((width) => width <= 40)).toBe(true);

    const compareRatioLayout = await page
      .locator(".activity-ratio-card--compare")
      .evaluate((element) => {
        const card = element as HTMLElement;
        const legend = card.querySelector(".activity-ratio-compare__legend") as HTMLElement | null;
        const legendItems = Array.from(
          card.querySelectorAll(".activity-ratio-compare__legend-item")
        ) as HTMLElement[];
        const table = card.querySelector(".activity-ratio-compare__table") as HTMLElement | null;
        const headRow = card.querySelector(".activity-ratio-compare__row--head") as HTMLElement | null;
        const firstDataRow = card.querySelector(
          ".activity-ratio-compare__row:not(.activity-ratio-compare__row--head)"
        ) as HTMLElement | null;
        const values = firstDataRow?.querySelector(".activity-ratio-compare__values") as
          | HTMLElement
          | null;
        const cells = Array.from(firstDataRow?.querySelectorAll(".activity-ratio-compare__cell") ?? []) as
          HTMLElement[];
        const firstCellLabel = firstDataRow?.querySelector(
          ".activity-ratio-compare__cell-label"
        ) as HTMLElement | null;

        if (!legend || !table || !headRow || !firstDataRow || !values || cells.length === 0) {
          return null;
        }

        return {
          cardOverflow: card.scrollWidth - card.clientWidth,
          tableOverflow: table.scrollWidth - table.clientWidth,
          rowOverflow: firstDataRow.scrollWidth - firstDataRow.clientWidth,
          legendColumns: window.getComputedStyle(legend).gridTemplateColumns.split(" ").length,
          valuesColumns: window.getComputedStyle(values).gridTemplateColumns.split(" ").length,
          rowColumns: window.getComputedStyle(firstDataRow).gridTemplateColumns.split(" ").length,
          headDisplay: window.getComputedStyle(headRow).display,
          firstCellLabelDisplay: firstCellLabel ? window.getComputedStyle(firstCellLabel).display : null,
          legendItemHeights: legendItems.map((item) => item.getBoundingClientRect().height),
          cellHeights: cells.map((cell) => cell.getBoundingClientRect().height)
        };
      });
    expect(compareRatioLayout).not.toBeNull();
    expect(compareRatioLayout?.cardOverflow ?? 99).toBeLessThanOrEqual(1);
    expect(compareRatioLayout?.tableOverflow ?? 99).toBeLessThanOrEqual(1);
    expect(compareRatioLayout?.rowOverflow ?? 99).toBeLessThanOrEqual(1);
    expect((compareRatioLayout?.legendItemHeights ?? []).every((height) => height >= 44)).toBe(true);
    expect((compareRatioLayout?.cellHeights ?? []).every((height) => height >= 44)).toBe(true);

    if (viewportName === "mobile") {
      expect(compareRatioLayout?.legendColumns).toBe(1);
      expect(compareRatioLayout?.rowColumns).toBe(1);
      expect(compareRatioLayout?.valuesColumns).toBe(2);
      expect(compareRatioLayout?.headDisplay).toBe("none");
      expect(compareRatioLayout?.firstCellLabelDisplay).not.toBe("none");
    }

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

async function openDistributionFlow(viewportName: string): Promise<void> {
  const { context, page, issues } = await createBrowserSession(browser, viewportCases.find((item) => item.name === viewportName)!);

  try {
    await page.goto(`${appUrl}/#distribution?member=M002`, { waitUntil: "networkidle" });
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

    await page.getByRole("heading", { name: "제22대 국회 의원 분포" }).waitFor();
    await page.getByRole("combobox", { name: "분포에서 의원 찾기" }).waitFor();
    await expect
      .poll(async () => page.locator(".distribution-focus__district").textContent())
      .toBe("부산 남구");
    await page.getByText("정당 평균을 눌러 차트를 해당 정당만 남기는 강조 모드로 전환합니다.").waitFor();

    const layout = await page.locator(".distribution-page__layout").evaluate((element) => {
      const layoutElement = element as HTMLElement;
      const focus = layoutElement.querySelector(".distribution-focus") as HTMLElement | null;
      const chart = layoutElement.querySelector(".distribution-chart") as HTMLElement | null;
      const metricGrid = layoutElement.querySelector(".distribution-focus__metric-grid") as HTMLElement | null;

      if (!focus || !chart || !metricGrid) {
        return null;
      }

      return {
        layoutOverflow: layoutElement.scrollWidth - layoutElement.clientWidth,
        chartOverflow: chart.scrollWidth - chart.clientWidth,
        focusOverflow: focus.scrollWidth - focus.clientWidth,
        layoutColumns: window.getComputedStyle(layoutElement).gridTemplateColumns.split(" ").length,
        metricColumns: window.getComputedStyle(metricGrid).gridTemplateColumns.split(" ").length
      };
    });

    expect(layout).not.toBeNull();
    expect(layout?.layoutOverflow ?? 99).toBeLessThanOrEqual(1);
    expect(layout?.chartOverflow ?? 99).toBeLessThanOrEqual(1);
    expect(layout?.focusOverflow ?? 99).toBeLessThanOrEqual(1);

    if (viewportName === "mobile" || viewportName === "tablet") {
      expect(layout?.layoutColumns).toBe(1);
    }

    if (viewportName === "mobile") {
      expect(layout?.metricColumns).toBe(1);
    }

    if (viewportName === "tablet") {
      expect(layout?.metricColumns).toBe(2);
    }

    if (viewportName === "desktop") {
      expect(layout?.layoutColumns).toBe(2);
      expect(layout?.metricColumns).toBe(2);
    }

    const streakSignal = page.getByRole("button", { name: /김아라 미래개혁당/ }).first();
    await streakSignal.click();
    await expect.poll(() => new URL(page.url()).hash).toBe("#distribution?member=M001");
    await expect
      .poll(async () => page.locator(".distribution-focus__district").textContent())
      .toBe("서울 중구");

    const distributionScreenshot = await saveScreenshot(page, `${viewportName}/distribution.png`);
    scenarioManifest.push({
      viewport: viewportName,
      scenario: "distribution-overview",
      screenshot: distributionScreenshot
    });

    expect(await page.getByRole("link", { name: "활동 캘린더 열기" }).getAttribute("href")).toBe(
      "#calendar?member=M001"
    );
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

    it(`captures the distribution flow on ${viewport.name}`, async () => {
      await openDistributionFlow(viewport.name);
    });
  }
});
