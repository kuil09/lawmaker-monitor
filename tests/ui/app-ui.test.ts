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
const scenarioManifest: Array<{
  viewport: string;
  scenario: string;
  screenshot: string;
}> = [];

function getUnexpectedBrowserIssues(issues: string[]): string[] {
  return issues.filter((issue) => {
    if (
      issue ===
      "console:Failed to load resource: the server responded with a status of 404 (Not Found)"
    ) {
      return false;
    }

    return !issue.includes(
      "response:404 http://127.0.0.1:4174/exports/hexmap_static/index.json"
    );
  });
}

async function openHomeFlow(viewportName: string): Promise<void> {
  const { context, page, issues } = await createBrowserSession(
    browser,
    viewportCases.find((item) => item.name === viewportName)!
  );
  try {
    await page.goto(appUrl, { waitUntil: "networkidle" });
    await page
      .getByRole("heading", { name: "실시간 국회 공개 기록표결" })
      .waitFor();
    await page
      .getByRole("region", {
        name: "지역별 재임 누적 표결 불참률 분포",
        exact: true
      })
      .waitFor();
    expect(
      await page.getByRole("tab", { name: "표결 참여", exact: true }).count()
    ).toBe(1);
    const rankingButton = page
      .locator(".v3-rank-rail__list button")
      .filter({ hasText: "박민" });
    await rankingButton.waitFor();
    expect(
      await rankingButton.evaluate(
        (element) => element.getBoundingClientRect().height
      )
    ).toBeGreaterThanOrEqual(44);
    const homeScreenshot = await saveScreenshot(
      page,
      `${viewportName}/home.png`
    );
    scenarioManifest.push({
      viewport: viewportName,
      scenario: "home-overview",
      screenshot: homeScreenshot
    });
    await rankingButton.click();
    await expect
      .poll(() => new URL(page.url()).hash)
      .toMatch(/^#calendar\?member=/);
    await page
      .getByRole("heading", { name: "의원 공개기록", exact: true })
      .waitFor();
    await page.getByRole("heading", { name: "최근 표결 날짜 흐름" }).waitFor();
    await page
      .getByRole("region", { name: "최근 공식 표결 근거" })
      .getByRole("link", { name: "국회 원문" })
      .first()
      .waitFor();
    await page
      .getByRole("heading", { name: "확인된 참여", exact: true })
      .waitFor();
    await page
      .getByRole("heading", { name: "따져볼 기록", exact: true })
      .waitFor();
    await page
      .getByRole("heading", { name: "판단 보류", exact: true })
      .waitFor();
    expect(await page.locator(".member-evaluation").count()).toBeGreaterThan(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth
      )
    ).toBeLessThanOrEqual(1);
    const calendarScreenshot = await saveScreenshot(
      page,
      `${viewportName}/calendar-single.png`
    );
    scenarioManifest.push({
      viewport: viewportName,
      scenario: "home-to-single-calendar",
      screenshot: calendarScreenshot
    });
    await page
      .getByRole("link", { name: "국회 출석부 홈", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "실시간 국회 공개 기록표결" })
      .waitFor();
    expect(getUnexpectedBrowserIssues(issues)).toEqual([]);
  } finally {
    await context.close();
  }
}

async function openCompareFlow(viewportName: string): Promise<void> {
  const { context, page, issues } = await createBrowserSession(
    browser,
    viewportCases.find((item) => item.name === viewportName)!
  );

  try {
    await page.goto(`${appUrl}/#calendar?member=M002`, {
      waitUntil: "networkidle"
    });
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

    await page.getByRole("heading", { name: "의원 공개기록" }).waitFor();
    await page.getByRole("heading", { name: "최근 표결 날짜 흐름" }).waitFor();
    await page.getByRole("button", { name: "기록 기준 설명 보기" }).click();
    await page
      .getByText(/확인된 참여율은 의원 재임 기간에 공개된 기록표결/)
      .waitFor();

    const voteRecordSection = page.locator(".activity-vote-records").first();
    await voteRecordSection.scrollIntoViewIfNeeded();
    await voteRecordSection.waitFor();
    expect(
      await voteRecordSection.getByText("불참", { exact: true }).isVisible()
    ).toBe(true);

    const voteRecordToggle = voteRecordSection.locator(
      ".activity-vote-records__details-toggle"
    );
    expect(await voteRecordToggle.count()).toBeGreaterThan(0);
    const voteRecordToggleHeight = await voteRecordToggle
      .first()
      .evaluate((element) => element.getBoundingClientRect().height);
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

    const helpScreenshot = await saveScreenshot(
      page,
      `${viewportName}/calendar-help.png`
    );
    scenarioManifest.push({
      viewport: viewportName,
      scenario: "calendar-help",
      screenshot: helpScreenshot
    });

    const viewportLocator = page
      .locator(".activity-drawer__main .contribution-calendar__viewport")
      .first();
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

    await page.getByRole("tab", { name: "두 의원 비교" }).click();
    expect(
      await page
        .getByRole("tab", { name: "두 의원 비교" })
        .getAttribute("aria-selected")
    ).toBe("true");

    const compareSearchField = page.getByRole("combobox", {
      name: "비교 의원 찾기"
    });
    await compareSearchField.fill("김아라");
    await compareSearchField.press("Tab");
    await expect
      .poll(() => compareSearchField.inputValue())
      .toContain("김아라");

    await page
      .getByRole("region", { name: "비교 요약", exact: true })
      .waitFor();
    expect(await page.getByText("김아라").count()).toBeGreaterThan(0);
    expect(await page.getByText("박민").count()).toBeGreaterThan(0);

    const compareAvatarWidths = await page
      .locator(".activity-compare__column .member-identity__avatar")
      .evaluateAll((elements) =>
        elements.map((element) => element.getBoundingClientRect().width)
      );
    expect(compareAvatarWidths).toHaveLength(2);
    expect(compareAvatarWidths.every((width) => width <= 40)).toBe(true);

    const compareRatioLayout = await page
      .locator(".activity-ratio-card--compare")
      .evaluate((element) => {
        const card = element as HTMLElement;
        const legend = card.querySelector(
          ".activity-ratio-compare__legend"
        ) as HTMLElement | null;
        const legendItems = Array.from(
          card.querySelectorAll(".activity-ratio-compare__legend-item")
        ) as HTMLElement[];
        const table = card.querySelector(
          ".activity-ratio-compare__table"
        ) as HTMLElement | null;
        const headRow = card.querySelector(
          ".activity-ratio-compare__row--head"
        ) as HTMLElement | null;
        const firstDataRow = card.querySelector(
          ".activity-ratio-compare__row:not(.activity-ratio-compare__row--head)"
        ) as HTMLElement | null;
        const values = firstDataRow?.querySelector(
          ".activity-ratio-compare__values"
        ) as HTMLElement | null;
        const cells = Array.from(
          firstDataRow?.querySelectorAll(".activity-ratio-compare__cell") ?? []
        ) as HTMLElement[];
        const firstCellLabel = firstDataRow?.querySelector(
          ".activity-ratio-compare__cell-label"
        ) as HTMLElement | null;

        if (
          !legend ||
          !table ||
          !headRow ||
          !firstDataRow ||
          !values ||
          cells.length === 0
        ) {
          return null;
        }

        return {
          cardOverflow: card.scrollWidth - card.clientWidth,
          tableOverflow: table.scrollWidth - table.clientWidth,
          rowOverflow: firstDataRow.scrollWidth - firstDataRow.clientWidth,
          legendColumns: window
            .getComputedStyle(legend)
            .gridTemplateColumns.split(" ").length,
          valuesColumns: window
            .getComputedStyle(values)
            .gridTemplateColumns.split(" ").length,
          rowColumns: window
            .getComputedStyle(firstDataRow)
            .gridTemplateColumns.split(" ").length,
          headDisplay: window.getComputedStyle(headRow).display,
          firstCellLabelDisplay: firstCellLabel
            ? window.getComputedStyle(firstCellLabel).display
            : null,
          legendItemHeights: legendItems.map(
            (item) => item.getBoundingClientRect().height
          ),
          cellHeights: cells.map((cell) => cell.getBoundingClientRect().height)
        };
      });
    expect(compareRatioLayout).not.toBeNull();
    expect(compareRatioLayout?.cardOverflow ?? 99).toBeLessThanOrEqual(1);
    expect(compareRatioLayout?.tableOverflow ?? 99).toBeLessThanOrEqual(1);
    expect(compareRatioLayout?.rowOverflow ?? 99).toBeLessThanOrEqual(1);
    expect(
      (compareRatioLayout?.legendItemHeights ?? []).every(
        (height) => height >= 44
      )
    ).toBe(true);
    expect(
      (compareRatioLayout?.cellHeights ?? []).every((height) => height >= 44)
    ).toBe(true);

    if (viewportName === "mobile") {
      expect(compareRatioLayout?.legendColumns).toBe(1);
      expect(compareRatioLayout?.rowColumns).toBe(1);
      expect(compareRatioLayout?.valuesColumns).toBe(2);
      expect(compareRatioLayout?.headDisplay).toBe("none");
      expect(compareRatioLayout?.firstCellLabelDisplay).not.toBe("none");
    }

    const compareScreenshot = await saveScreenshot(
      page,
      `${viewportName}/calendar-compare.png`
    );
    scenarioManifest.push({
      viewport: viewportName,
      scenario: "calendar-compare",
      screenshot: compareScreenshot
    });

    await page.goto(
      `${appUrl}/#calendar?member=M002&compare=M001&view=compare`,
      {
        waitUntil: "networkidle"
      }
    );
    await page
      .getByRole("region", { name: "비교 요약", exact: true })
      .waitFor();
    expect(
      await page
        .getByRole("tab", { name: "두 의원 비교" })
        .getAttribute("aria-selected")
    ).toBe("true");

    expect(issues).toEqual([]);
  } finally {
    await context.close();
  }
}

async function openDistributionFlow(viewportName: string): Promise<void> {
  const { context, page, issues } = await createBrowserSession(
    browser,
    viewportCases.find((item) => item.name === viewportName)!
  );

  try {
    await page.goto(`${appUrl}/#distribution?member=M002`, {
      waitUntil: "networkidle"
    });
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

    await page
      .getByRole("heading", { name: "제22대 국회 의원 분포" })
      .waitFor();
    await page.getByRole("combobox", { name: "분포에서 의원 찾기" }).waitFor();
    await page
      .getByRole("heading", {
        name: "위로 갈수록 반대·기권 비중이 낮고, 오른쪽으로 갈수록 재임 누적 표결 참여율이 높습니다."
      })
      .waitFor();
    await expect
      .poll(async () => page.locator(".distribution-focus").textContent())
      .toContain("부산 남구");
    await page
      .getByText(
        "정당 평균을 눌러 차트를 해당 정당만 남기는 강조 모드로 전환합니다."
      )
      .waitFor();
    await page.locator(".distribution-chart").scrollIntoViewIfNeeded();

    const layout = await page
      .locator(".distribution-page__layout")
      .evaluate((element) => {
        const layoutElement = element as HTMLElement;
        const focus = layoutElement.querySelector(
          ".distribution-focus"
        ) as HTMLElement | null;
        const chart = layoutElement.querySelector(
          ".distribution-chart"
        ) as HTMLElement | null;
        const metricGrid = layoutElement.querySelector(
          ".distribution-focus__metric-grid"
        ) as HTMLElement | null;
        const signalGrid = document.querySelector(
          ".distribution-signal-grid"
        ) as HTMLElement | null;

        if (!focus || !chart || !metricGrid || !signalGrid) {
          return null;
        }

        return {
          layoutOverflow: layoutElement.scrollWidth - layoutElement.clientWidth,
          chartOverflow: chart.scrollWidth - chart.clientWidth,
          focusOverflow: focus.scrollWidth - focus.clientWidth,
          layoutColumns: window
            .getComputedStyle(layoutElement)
            .gridTemplateColumns.split(" ").length,
          metricColumns: window
            .getComputedStyle(metricGrid)
            .gridTemplateColumns.split(" ").length,
          signalColumns: window
            .getComputedStyle(signalGrid)
            .gridTemplateColumns.split(" ").length
        };
      });

    expect(layout).not.toBeNull();
    expect(layout?.layoutOverflow ?? 99).toBeLessThanOrEqual(1);
    expect(layout?.chartOverflow ?? 99).toBeLessThanOrEqual(1);
    expect(layout?.focusOverflow ?? 99).toBeLessThanOrEqual(1);

    if (viewportName === "mobile" || viewportName === "tablet") {
      expect(layout?.layoutColumns).toBe(1);
      expect(layout?.signalColumns).toBe(1);
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
      expect(layout?.signalColumns).toBe(2);
    }

    const streakSignal = page
      .getByRole("button", { name: /김아라 미래개혁당/ })
      .first();
    await streakSignal.click();
    await expect
      .poll(() => new URL(page.url()).hash)
      .toBe("#distribution?member=M001");
    await expect
      .poll(async () => page.locator(".distribution-focus").textContent())
      .toContain("서울 중구");

    const distributionScreenshot = await saveScreenshot(
      page,
      `${viewportName}/distribution.png`
    );
    scenarioManifest.push({
      viewport: viewportName,
      scenario: "distribution-overview",
      screenshot: distributionScreenshot
    });
    const distributionChartScreenshot = await saveLocatorScreenshot(
      page.locator(".distribution-chart"),
      `${viewportName}/distribution-chart.png`
    );
    scenarioManifest.push({
      viewport: viewportName,
      scenario: "distribution-chart",
      screenshot: distributionChartScreenshot
    });

    expect(
      await page
        .getByRole("link", { name: "활동 캘린더 열기" })
        .getAttribute("href")
    ).toBe("#calendar?member=M001");
    expect(issues).toEqual([]);
  } finally {
    await context.close();
  }
}

const v2Routes = [
  {
    id: "home",
    hash: "",
    heading: "실시간 국회 공개 기록표결"
  },
  {
    id: "calendar",
    hash: "#calendar",
    heading: "의원 공개기록"
  },
  {
    id: "distribution",
    hash: "#distribution",
    heading: "제22대 국회 의원 분포"
  },
  {
    id: "map",
    hash: "#map",
    heading: "지역별 국회 기록 탐색"
  },
  {
    id: "votes",
    hash: "#votes",
    heading: "제22대 국회 쟁점·표결 대조"
  },
  {
    id: "trends",
    hash: "#trends",
    heading: "변화 전후 책임 원장"
  }
] as const;

async function openV2RouteFlow(viewportName: string): Promise<void> {
  const { context, page, issues } = await createBrowserSession(
    browser,
    viewportCases.find((item) => item.name === viewportName)!
  );

  try {
    for (const route of v2Routes) {
      const issueStart = issues.length;
      await page.goto(`${appUrl}/${route.hash}`, {
        waitUntil: "networkidle"
      });
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
      await page.getByRole("heading", { name: route.heading }).waitFor();

      await expect
        .poll(async () =>
          page.evaluate(
            () =>
              document.documentElement.scrollWidth -
              document.documentElement.clientWidth
          )
        )
        .toBeLessThanOrEqual(1);

      if (route.id === "home") {
        expect(new URL(page.url()).searchParams.has("ui")).toBe(false);
        await page
          .getByRole("region", { name: "지역별 재임 누적 표결 불참률 분포" })
          .waitFor();
        await expect
          .poll(async () => page.locator("[data-district-label]").count())
          .toBeGreaterThan(0);

        const mapLayout = await page
          .locator(".v2-map-panel")
          .evaluate((element) => {
            const legend = element.querySelector(
              ".v2-national-map__severity-legend"
            ) as HTMLElement | null;
            const mapDistricts = Array.from(
              element.querySelectorAll("[data-district-label]")
            ) as SVGPathElement[];

            if (!legend || mapDistricts.length === 0) {
              return null;
            }

            const legendRect = legend.getBoundingClientRect();
            const districtRects = mapDistricts.map((district) =>
              district.getBoundingClientRect()
            );
            const districtBounds = {
              left: Math.min(...districtRects.map((rect) => rect.left)),
              top: Math.min(...districtRects.map((rect) => rect.top)),
              right: Math.max(...districtRects.map((rect) => rect.right)),
              bottom: Math.max(...districtRects.map((rect) => rect.bottom))
            };
            const overlapWidth = Math.max(
              0,
              Math.min(legendRect.right, districtBounds.right) -
                Math.max(legendRect.left, districtBounds.left)
            );
            const overlapHeight = Math.max(
              0,
              Math.min(legendRect.bottom, districtBounds.bottom) -
                Math.max(legendRect.top, districtBounds.top)
            );

            return {
              legendPosition: window.getComputedStyle(legend).position,
              overlapArea: overlapWidth * overlapHeight
            };
          });

        expect(mapLayout).not.toBeNull();
        expect(mapLayout?.legendPosition).toBe("static");
        expect(mapLayout?.overlapArea).toBe(0);

        const trendHeadingLayout = await page
          .locator(".v2-trend-card .v2-card-heading")
          .evaluate((element) => {
            const title = element.querySelector("h2") as HTMLElement | null;
            const button = element.querySelector(
              ".v2-button--quiet"
            ) as HTMLElement | null;
            const buttonLabel = element.querySelector(
              ".v2-button__label"
            ) as HTMLElement | null;

            if (!title || !button || !buttonLabel) {
              return null;
            }

            const titleStyle = window.getComputedStyle(title);
            const labelStyle = window.getComputedStyle(buttonLabel);
            const titleLineHeight = Number.parseFloat(titleStyle.lineHeight);
            const labelLineHeight = Number.parseFloat(labelStyle.lineHeight);

            return {
              buttonHeight: button.getBoundingClientRect().height,
              buttonOverflow: button.scrollWidth - button.clientWidth,
              buttonWhiteSpace: window.getComputedStyle(button).whiteSpace,
              labelLineCount:
                Number.isFinite(labelLineHeight) && labelLineHeight > 0
                  ? buttonLabel.getBoundingClientRect().height / labelLineHeight
                  : null,
              titleLineCount:
                Number.isFinite(titleLineHeight) && titleLineHeight > 0
                  ? title.getBoundingClientRect().height / titleLineHeight
                  : null
            };
          });

        expect(trendHeadingLayout).not.toBeNull();
        expect(trendHeadingLayout?.buttonOverflow ?? 99).toBeLessThanOrEqual(1);
        expect(trendHeadingLayout?.buttonWhiteSpace).toBe("nowrap");
        expect(trendHeadingLayout?.labelLineCount ?? 99).toBeLessThanOrEqual(
          1.1
        );
        expect(trendHeadingLayout?.titleLineCount ?? 99).toBeLessThanOrEqual(
          2.1
        );
        if (viewportName === "mobile") {
          expect(trendHeadingLayout?.buttonHeight ?? 0).toBeGreaterThanOrEqual(
            44
          );
        }

        const scatterPoint = page
          .locator(".v3-scatter-card .recharts-scatter-symbol")
          .first();
        await scatterPoint.hover();
        const scatterTooltip = page.locator(
          ".v3-scatter-card .v2-chart-tooltip"
        );
        await scatterTooltip.waitFor();
        const scatterTooltipText = await scatterTooltip.textContent();
        expect(scatterTooltipText).toContain("표결 참여율");
        expect(scatterTooltipText).toContain("반대·기권 비중");
        expect(scatterTooltipText).not.toContain("가로");
        expect(scatterTooltipText).not.toContain("세로");
        const scatterMemberLink = scatterTooltip.locator(
          "a.member-detail-link"
        );
        expect(await scatterMemberLink.count()).toBe(1);
        expect(await scatterMemberLink.getAttribute("href")).toMatch(
          /^#calendar\?member=/
        );

        await page.getByRole("tab", { name: "재산" }).click();
        const assetComparisonCard = page.locator(".v2-trend-card");
        expect(
          await assetComparisonCard.locator(".v2-card-kicker").textContent()
        ).toBe("의원 비교");
        expect(await assetComparisonCard.locator("h2").textContent()).toBe(
          "공개 순재산 상위 의원의 자산·부채"
        );
        expect(await assetComparisonCard.textContent()).toContain("부채");
        expect(
          await page.locator(".v2-ranking-table thead").textContent()
        ).toContain("총자산 대비 부채비율");
        expect(
          await assetComparisonCard
            .locator(".v2-trend-scale-note")
            .textContent()
        ).toContain("대칭 로그 축");
        const renderedAssetBars = await assetComparisonCard
          .locator(".recharts-bar-rectangle")
          .count();
        expect(renderedAssetBars).toBeGreaterThan(0);
        expect(renderedAssetBars).toBeLessThanOrEqual(18);
        expect(
          await assetComparisonCard.locator(".recharts-line").count()
        ).toBe(0);
        expect(await assetComparisonCard.textContent()).not.toContain(
          "시간 흐름"
        );
      }

      if (route.id === "map") {
        await expect
          .poll(async () => page.locator(".ledger-region-tabs button").count())
          .toBeGreaterThanOrEqual(2);
        const busanRegionButton = page
          .locator(".ledger-region-tabs button")
          .filter({ hasText: "부산" });
        await busanRegionButton.click();
        const regionalMemberList = page.locator(".ledger-district-board");
        await regionalMemberList.waitFor();
        await expect
          .poll(async () =>
            regionalMemberList.locator(".ledger-member-card").count()
          )
          .toBeGreaterThan(0);
        await expect.poll(async () => page.locator("canvas").count()).toBe(0);
        const firstRegionalMember = regionalMemberList
          .locator(".ledger-member-card")
          .first();
        await firstRegionalMember.click();
        expect(
          await page.locator(".ledger-evidence-panel").textContent()
        ).toContain("선택한 의원의 기록");

        await page.getByRole("button", { name: "시·도 요약" }).click();
        const provinceMatrix = page.locator(".ledger-province-matrix");
        await provinceMatrix.waitFor();
        expect(
          await provinceMatrix.locator("button").count()
        ).toBeGreaterThanOrEqual(2);
        const renderedSeverities = await provinceMatrix
          .locator("button")
          .evaluateAll((buttons) => [
            ...new Set(
              buttons.map((button) => button.getAttribute("data-severity"))
            )
          ]);
        expect(renderedSeverities.length).toBeGreaterThanOrEqual(2);
        const summaryScreenshot = await saveScreenshot(
          page,
          `${viewportName}/v2-map-summary.png`
        );
        scenarioManifest.push({
          viewport: viewportName,
          scenario: "v2-map-summary",
          screenshot: summaryScreenshot
        });
        await provinceMatrix.locator('button[data-province="부산"]').click();
        await expect
          .poll(async () =>
            page.locator(".ledger-primary__header h2").textContent()
          )
          .toContain("부산");
      }

      if (route.id === "votes") {
        const cards = page.locator(".issue-comparison__grid article");
        await cards.first().waitFor();
        const renderedVoteCount = await cards.count();
        expect(renderedVoteCount).toBeGreaterThan(0);
        expect(renderedVoteCount).toBeLessThanOrEqual(3);
        expect(await cards.first().getByRole("link").count()).toBeGreaterThan(
          0
        );
      }

      const screenshot = await saveScreenshot(
        page,
        `${viewportName}/v2-${route.id}.png`
      );
      scenarioManifest.push({
        viewport: viewportName,
        scenario: `v2-${route.id}`,
        screenshot
      });
      const unexpectedRouteIssues = getUnexpectedBrowserIssues(
        issues.slice(issueStart)
      );
      expect(
        unexpectedRouteIssues,
        `Unexpected browser issues on the V2 ${route.id} route`
      ).toEqual([]);
    }

    await page.goto(`${appUrl}/?ui=v1`, {
      waitUntil: "networkidle"
    });
    await page
      .getByRole("heading", { name: "실시간 국회 공개 기록표결" })
      .waitFor();
    expect(new URL(page.url()).searchParams.has("ui")).toBe(false);
  } finally {
    await context.close();
  }
}

async function openMemberAnalysisFlow(viewportName: string): Promise<void> {
  const { context, page, issues } = await createBrowserSession(
    browser,
    viewportCases.find((item) => item.name === viewportName)!
  );
  try {
    await page.goto(`${appUrl}/#analysis?member=M001`, {
      waitUntil: "networkidle"
    });
    await page.getByRole("heading", { name: "의원 이력·활동 분석" }).waitFor();
    for (const name of [
      "경력에서 활동으로",
      "이력과 활동 연표",
      "역할 변화 전후 90일",
      "조건이 가까운 의원과 먼 의원",
      "정당을 가로지르는 표결 관계",
      "재산 신고와 공적 역할",
      "관심사의 흐름과 근거 기록"
    ]) {
      await page.getByRole("heading", { name, exact: true }).waitFor();
    }
    await page
      .locator(".condition-extreme")
      .filter({ hasText: "가장 먼 조건" })
      .getByRole("button", { name: /이수/ })
      .click();
    await expect
      .poll(() => page.locator(".condition-selection").innerText())
      .toContain("이수");
    await page
      .getByText("같은 위원회 의원의 활동 수치 보기", { exact: true })
      .click();
    await expect
      .poll(() => page.locator(".analysis-career-claims").innerText())
      .toContain("전) 서울병원 의사");
    await page
      .getByRole("button", { name: "경력 기간을 연표에서 보기", exact: true })
      .click();
    await expect
      .poll(() => page.getByLabel("분석 시작 월", { exact: true }).inputValue())
      .toBe("2010-01");
    await expect
      .poll(() =>
        page.locator(".analysis-event-period.is-biography").innerText()
      )
      .toContain("2010~2012");
    await expect
      .poll(() =>
        page
          .getByRole("table", { name: "참여 가능한 표결 수를 반영한 비교" })
          .innerText()
      )
      .toContain("자료 없음");
    await page
      .getByRole("button", { name: "활동 수록 전체 기간", exact: true })
      .click();
    await page
      .getByLabel("기준 이력", { exact: true })
      .selectOption("party-change-2026");
    await expect
      .poll(() =>
        page.locator("#analysis-transitions").locator("..").innerText()
      )
      .toContain("사이의 4일은 비교에서 제외");
    await page
      .getByLabel("기준 이력", { exact: true })
      .selectOption("committee-2026");
    await page.getByLabel("의제", { exact: true }).selectOption("보건·복지");
    await page
      .getByLabel("소속 비교 기준", { exact: true })
      .selectOption("verified_period");
    await expect
      .poll(() =>
        page.locator("#analysis-coalitions").locator("..").innerText()
      )
      .toContain("당시 소속 확인 0건");
    await page
      .getByLabel("소속 비교 기준", { exact: true })
      .selectOption("current_roster");
    await expect
      .poll(() => page.locator(".analysis-evidence-list").innerText())
      .toContain("지역 의료 접근성 개선");
    await page.getByText("월별 수치 표", { exact: true }).click();
    const countTable = page.getByRole("table", {
      name: "선택한 기간·의제·활동의 월별 건수"
    });
    await expect.poll(() => countTable.innerText()).toContain("2026-03");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth
        )
      )
      .toBeLessThanOrEqual(1);
    await page
      .getByRole("heading", { name: "의원 이력·활동 분석" })
      .scrollIntoViewIfNeeded();
    const screenshot = await saveScreenshot(
      page,
      `${viewportName}/member-analysis.png`
    );
    scenarioManifest.push({
      viewport: viewportName,
      scenario: "member-analysis",
      screenshot
    });
    await page
      .getByLabel("약력에서 찾은 경력", { exact: true })
      .selectOption("law");
    await page
      .locator(".analysis-directory")
      .getByRole("button", { name: /박민/ })
      .click();
    await expect
      .poll(() => page.locator(".analysis-member-heading").innerText())
      .toContain("박민");
    await expect
      .poll(() => page.locator(".analysis-career-claims").innerText())
      .toContain("공익 변호사");
    expect(getUnexpectedBrowserIssues(issues)).toEqual([]);
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
    it(`explores member history analysis on ${viewport.name}`, async () => {
      await openMemberAnalysisFlow(viewport.name);
    });
    it(`captures the home and single-member flow on ${viewport.name}`, async () => {
      await openHomeFlow(viewport.name);
    });

    it(`captures the help, scroll, and compare flow on ${viewport.name}`, async () => {
      await openCompareFlow(viewport.name);
    });

    it(`captures the distribution flow on ${viewport.name}`, async () => {
      await openDistributionFlow(viewport.name);
    });

    it(`captures all rebuilt V2 routes on ${viewport.name}`, async () => {
      await openV2RouteFlow(viewport.name);
    });
  }
});
