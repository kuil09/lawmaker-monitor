import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { MemberIdentity } from "./MemberIdentity.js";
import { buildCalendarHref } from "../lib/calendar-route.js";
import {
  buildPartyLineMoverChartData,
  buildPartyLineTrendChartData,
  buildWeeklyTrendChartData
} from "../lib/charts.js";
import { formatNumber, formatPercent } from "../lib/format.js";

import type { AccountabilityTrendsExport } from "@lawmaker-monitor/schemas";

type VisualizationOverviewProps = {
  accountabilityTrends: AccountabilityTrendsExport | null;
  assemblyLabel: string;
};

const chartPalette = {
  yes: "#2f8f4e",
  no: "#9f2d20",
  abstain: "#c4872f",
  absent: "#8f8880",
  partyLine: "#7b3128",
  grid: "rgba(80, 53, 32, 0.1)",
  axis: "rgba(41, 31, 22, 0.72)",
  stroke: "#5a5148"
};

type TooltipProps = {
  active?: boolean;
  payload?: ReadonlyArray<{
    value?: number | string;
    name?: string;
    color?: string;
    payload?: Record<string, unknown>;
  }>;
  label?: string;
};

function WeeklyTrendTooltipPanel({ active, payload }: TooltipProps) {
  const datum = payload?.[0]?.payload as
    | {
        weekStart: string;
        weekEnd: string;
        yesCount: number;
        noCount: number;
        abstainCount: number;
        absentCount: number;
        eligibleVoteCount: number;
        negativeRate: number;
      }
    | undefined;

  if (!active || !datum) {
    return null;
  }

  if (datum.eligibleVoteCount === 0) {
    return (
      <div className="chart-tooltip">
        <strong>{`${datum.weekStart} ~ ${datum.weekEnd}`}</strong>
        <p className="chart-tooltip__note">
          이 주에는 공개 기록표결이 없습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="chart-tooltip">
      <strong>{`${datum.weekStart} ~ ${datum.weekEnd}`}</strong>
      <ul>
        <li>
          <span
            className="chart-tooltip__dot"
            style={{ backgroundColor: chartPalette.yes }}
          />
          <span>찬성</span>
          <strong>{formatNumber(datum.yesCount)}</strong>
        </li>
        <li>
          <span
            className="chart-tooltip__dot"
            style={{ backgroundColor: chartPalette.no }}
          />
          <span>반대</span>
          <strong>{formatNumber(datum.noCount)}</strong>
        </li>
        <li>
          <span
            className="chart-tooltip__dot"
            style={{ backgroundColor: chartPalette.abstain }}
          />
          <span>기권</span>
          <strong>{formatNumber(datum.abstainCount)}</strong>
        </li>
        <li>
          <span
            className="chart-tooltip__dot"
            style={{ backgroundColor: chartPalette.absent }}
          />
          <span>불참</span>
          <strong>{formatNumber(datum.absentCount)}</strong>
        </li>
        <li>
          <span
            className="chart-tooltip__dot"
            style={{ backgroundColor: chartPalette.stroke }}
          />
          <span>분모</span>
          <strong>{formatNumber(datum.eligibleVoteCount)}</strong>
        </li>
      </ul>
      <p className="chart-tooltip__note">{`네거티브 비율 ${formatPercent(datum.negativeRate)}`}</p>
    </div>
  );
}

function PartyLineTooltipPanel({ active, payload }: TooltipProps) {
  const datum = payload?.[0]?.payload as
    | {
        weekStart: string;
        weekEnd: string;
        opportunityCount: number;
        participationCount: number;
        defectionCount: number;
        defectionRate: number | null;
      }
    | undefined;

  if (!active || !datum) {
    return null;
  }

  if (datum.opportunityCount === 0) {
    return (
      <div className="chart-tooltip">
        <strong>{`${datum.weekStart} ~ ${datum.weekEnd}`}</strong>
        <p className="chart-tooltip__note">
          이 주에는 당 기준이 성립한 표결이 없습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="chart-tooltip">
      <strong>{`${datum.weekStart} ~ ${datum.weekEnd}`}</strong>
      <ul>
        <li>
          <span
            className="chart-tooltip__dot"
            style={{ backgroundColor: chartPalette.partyLine }}
          />
          <span>이탈</span>
          <strong>{formatNumber(datum.defectionCount)}</strong>
        </li>
        <li>
          <span
            className="chart-tooltip__dot"
            style={{ backgroundColor: chartPalette.stroke }}
          />
          <span>참여</span>
          <strong>{formatNumber(datum.participationCount)}</strong>
        </li>
        <li>
          <span
            className="chart-tooltip__dot"
            style={{ backgroundColor: chartPalette.absent }}
          />
          <span>기준 기회</span>
          <strong>{formatNumber(datum.opportunityCount)}</strong>
        </li>
      </ul>
      <p className="chart-tooltip__note">
        {`이탈률 ${formatPercent(datum.defectionRate ?? 0)}`}
      </p>
    </div>
  );
}

export function VisualizationOverview({
  accountabilityTrends,
  assemblyLabel
}: VisualizationOverviewProps) {
  const [viewport, setViewport] = useState(() => ({
    isMobile: typeof window !== "undefined" && window.innerWidth < 760
  }));

  useEffect(() => {
    const syncViewport = () => {
      const isMobile = window.innerWidth < 760;
      setViewport({ isMobile });
    };

    syncViewport();
    window.addEventListener("resize", syncViewport);

    return () => {
      window.removeEventListener("resize", syncViewport);
    };
  }, []);

  const weeklyTrendData = buildWeeklyTrendChartData(accountabilityTrends);
  const partyLineTrendData = buildPartyLineTrendChartData(accountabilityTrends);
  const partyLineMovers = buildPartyLineMoverChartData(accountabilityTrends, 5);
  const trendWindowWeekCount =
    accountabilityTrends?.weeks.length ?? weeklyTrendData.length;
  const trendWindowPhrase =
    trendWindowWeekCount > 0 ? `최근 ${trendWindowWeekCount}주` : "최근 12주";

  const activeWeeks = weeklyTrendData.filter(
    (item) => item.eligibleVoteCount > 0
  );
  const latestActiveWeek = activeWeeks.at(-1) ?? null;
  const peakAbsentWeek = activeWeeks.reduce<typeof latestActiveWeek>(
    (currentPeak, week) => {
      if (!currentPeak) {
        return week;
      }

      const peakRate = currentPeak.absentCount / currentPeak.eligibleVoteCount;
      const nextRate = week.absentCount / week.eligibleVoteCount;
      return nextRate > peakRate ? week : currentPeak;
    },
    null
  );
  const latestParticipationRate = latestActiveWeek
    ? (latestActiveWeek.eligibleVoteCount - latestActiveWeek.absentCount) /
      latestActiveWeek.eligibleVoteCount
    : null;
  const latestAbsenceRate = latestActiveWeek
    ? latestActiveWeek.absentCount / latestActiveWeek.eligibleVoteCount
    : null;
  const peakAbsenceRate = peakAbsentWeek
    ? peakAbsentWeek.absentCount / peakAbsentWeek.eligibleVoteCount
    : null;
  const weeklyTrendCopy =
    activeWeeks.length > 0
      ? `${trendWindowPhrase} 관측 창에서 참여 대비 불참이 흔들린 주간을 먼저 찾고, 그 위에 반대·기권 레이어를 얹어 네거티브 구성이 어떻게 커졌는지 읽습니다.`
      : `${trendWindowPhrase} 관측 창의 주간 표결 흐름을 준비 중입니다.`;

  const activePartyLineWeeks = partyLineTrendData.filter(
    (item) => item.opportunityCount > 0
  );
  const latestPartyLineWeek = activePartyLineWeeks.at(-1) ?? null;
  const peakPartyLineWeek = activePartyLineWeeks.reduce<
    typeof latestPartyLineWeek
  >((currentPeak, week) => {
    if (!currentPeak) {
      return week;
    }

    return (week.defectionRate ?? 0) > (currentPeak.defectionRate ?? 0)
      ? week
      : currentPeak;
  }, null);
  const latestPartyLineSkippedCount = latestPartyLineWeek
    ? Math.max(
        latestPartyLineWeek.opportunityCount -
          latestPartyLineWeek.participationCount,
        0
      )
    : null;
  const partyLineCopy =
    activePartyLineWeeks.length > 0
      ? `${trendWindowPhrase} 동안 당 기준이 선명했던 표결만 모아 실제 참여한 표 가운데 다른 선택이 얼마나 늘었는지 추적합니다.`
      : `${trendWindowPhrase} 동안 당 기준이 성립한 표결을 아직 찾지 못했습니다.`;

  return (
    <section className="visualization-panel">
      <div className="visualization-panel__header">
        <div>
          <p className="section-label">핵심 차트</p>
          <h2>{`${assemblyLabel}의 출석과 당내 이탈 흐름을 함께 봅니다.`}</h2>
        </div>
      </div>

      <div className="visualization-stack">
        <article className="chart-card">
          <div className="chart-card__header">
            <div>
              <p className="chart-card__eyebrow">국회 전체 시계열</p>
              <h3>{`${assemblyLabel} ${trendWindowPhrase} 참여·불참 추세`}</h3>
              <p className="chart-card__copy">{weeklyTrendCopy}</p>
            </div>
            <div
              className="chart-card__summary-grid"
              aria-label="출석 추세 관측 정보"
            >
              <div className="chart-card__summary">
                <span>최근 주 참여율</span>
                <strong>
                  {latestParticipationRate !== null
                    ? formatPercent(latestParticipationRate)
                    : "대기 중"}
                </strong>
                <small>
                  {latestActiveWeek
                    ? `${latestActiveWeek.weekStart} ~ ${latestActiveWeek.weekEnd}`
                    : "실제 표결 대기 중"}
                </small>
              </div>
              <div className="chart-card__summary chart-card__summary--alert">
                <span>최근 주 불참</span>
                <strong>
                  {latestActiveWeek
                    ? `${formatNumber(latestActiveWeek.absentCount)}건`
                    : "대기 중"}
                </strong>
                <small>
                  {latestAbsenceRate !== null
                    ? `비중 ${formatPercent(latestAbsenceRate)}`
                    : "비중 집계 대기"}
                </small>
              </div>
              <div className="chart-card__summary">
                <span>최고 불참 비중</span>
                <strong>
                  {peakAbsenceRate !== null
                    ? formatPercent(peakAbsenceRate)
                    : "대기 중"}
                </strong>
                <small>
                  {peakAbsentWeek
                    ? `${peakAbsentWeek.weekStart} ~ ${peakAbsentWeek.weekEnd}`
                    : "실제 표결 대기 중"}
                </small>
              </div>
            </div>
          </div>

          {weeklyTrendData.some((item) => item.eligibleVoteCount > 0) ? (
            <>
              <div className="chart-card__chart chart-card__chart--trend">
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart
                    data={weeklyTrendData}
                    margin={{ top: 8, right: 4, bottom: 8, left: 4 }}
                  >
                    <CartesianGrid
                      stroke={chartPalette.grid}
                      vertical={false}
                    />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: chartPalette.axis, fontSize: 12 }}
                      tickFormatter={(value, index) =>
                        viewport.isMobile && index % 2 === 1
                          ? ""
                          : String(value)
                      }
                    />
                    <YAxis
                      tick={{ fill: chartPalette.axis, fontSize: 12 }}
                      tickFormatter={(value) => `${value}%`}
                      width={42}
                      domain={[0, 100]}
                    />
                    <Tooltip content={<WeeklyTrendTooltipPanel />} />
                    <Area
                      type="monotone"
                      dataKey="yesShare"
                      stackId="vote-share"
                      stroke={chartPalette.yes}
                      fill={chartPalette.yes}
                      fillOpacity={0.82}
                      strokeWidth={1.6}
                      connectNulls={false}
                      activeDot={{ r: 4 }}
                      name="찬성"
                    />
                    <Area
                      type="monotone"
                      dataKey="noShare"
                      stackId="vote-share"
                      stroke={chartPalette.no}
                      fill={chartPalette.no}
                      fillOpacity={0.78}
                      strokeWidth={1.6}
                      connectNulls={false}
                      activeDot={{ r: 4 }}
                      name="반대"
                    />
                    <Area
                      type="monotone"
                      dataKey="abstainShare"
                      stackId="vote-share"
                      stroke={chartPalette.abstain}
                      fill={chartPalette.abstain}
                      fillOpacity={0.8}
                      strokeWidth={1.6}
                      connectNulls={false}
                      activeDot={{ r: 4 }}
                      name="기권"
                    />
                    <Area
                      type="monotone"
                      dataKey="absentShare"
                      stackId="vote-share"
                      stroke={chartPalette.absent}
                      fill={chartPalette.absent}
                      fillOpacity={0.86}
                      strokeWidth={1.6}
                      connectNulls={false}
                      activeDot={{ r: 4 }}
                      name="불참"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="chart-legend">
                <span>
                  <i style={{ backgroundColor: chartPalette.yes }} />
                  찬성
                </span>
                <span>
                  <i style={{ backgroundColor: chartPalette.no }} />
                  반대
                </span>
                <span>
                  <i style={{ backgroundColor: chartPalette.abstain }} />
                  기권
                </span>
                <span>
                  <i style={{ backgroundColor: chartPalette.absent }} />
                  불참
                </span>
              </div>
              <p className="chart-card__footnote">
                표결이 없던 주간은 빈 구간으로 남겨 두어, 데이터 공백이 0%
                급락처럼 보이지 않게 했습니다.
              </p>
            </>
          ) : (
            <p className="chart-card__empty">{`${trendWindowPhrase} 관측 창에 공개 기록표결이 아직 없습니다.`}</p>
          )}
        </article>

        <article className="chart-card">
          <div className="chart-card__header">
            <div>
              <p className="chart-card__eyebrow">당 기준 추이</p>
              <h3>{`${assemblyLabel} ${trendWindowPhrase} 당내 이탈 추세`}</h3>
              <p className="chart-card__copy">{partyLineCopy}</p>
            </div>
            <div
              className="chart-card__summary-grid"
              aria-label="당내 이탈 추세 관측 정보"
            >
              <div className="chart-card__summary chart-card__summary--alert">
                <span>최근 주 이탈률</span>
                <strong>
                  {latestPartyLineWeek
                    ? formatPercent(latestPartyLineWeek.defectionRate ?? 0)
                    : "대기 중"}
                </strong>
                <small>
                  {latestPartyLineWeek
                    ? `${latestPartyLineWeek.weekStart} ~ ${latestPartyLineWeek.weekEnd}`
                    : "당 기준 형성 대기 중"}
                </small>
              </div>
              <div className="chart-card__summary">
                <span>최근 주 기준 기회</span>
                <strong>
                  {latestPartyLineWeek
                    ? `${formatNumber(latestPartyLineWeek.opportunityCount)}회`
                    : "대기 중"}
                </strong>
                <small>
                  {latestPartyLineWeek
                    ? `참여 ${formatNumber(latestPartyLineWeek.participationCount)}회 · 미참여 ${formatNumber(latestPartyLineSkippedCount ?? 0)}회`
                    : "당 기준 형성 대기 중"}
                </small>
              </div>
              <div className="chart-card__summary">
                <span>최고 이탈률</span>
                <strong>
                  {peakPartyLineWeek
                    ? formatPercent(peakPartyLineWeek.defectionRate ?? 0)
                    : "대기 중"}
                </strong>
                <small>
                  {peakPartyLineWeek
                    ? `${peakPartyLineWeek.weekStart} ~ ${peakPartyLineWeek.weekEnd}`
                    : "당 기준 형성 대기 중"}
                </small>
              </div>
            </div>
          </div>

          {partyLineTrendData.some((item) => item.opportunityCount > 0) ? (
            <>
              <div className="chart-card__chart chart-card__chart--trend">
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart
                    data={partyLineTrendData}
                    margin={{ top: 8, right: 4, bottom: 8, left: 4 }}
                  >
                    <CartesianGrid
                      stroke={chartPalette.grid}
                      vertical={false}
                    />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: chartPalette.axis, fontSize: 12 }}
                      tickFormatter={(value, index) =>
                        viewport.isMobile && index % 2 === 1
                          ? ""
                          : String(value)
                      }
                    />
                    <YAxis
                      tick={{ fill: chartPalette.axis, fontSize: 12 }}
                      tickFormatter={(value) =>
                        `${Math.round(Number(value) * 100)}%`
                      }
                      width={42}
                      domain={[0, 1]}
                    />
                    <Tooltip content={<PartyLineTooltipPanel />} />
                    <Line
                      type="monotone"
                      dataKey="defectionRate"
                      stroke={chartPalette.partyLine}
                      strokeWidth={2.4}
                      connectNulls={false}
                      dot={{
                        r: 3.4,
                        strokeWidth: 0,
                        fill: chartPalette.partyLine
                      }}
                      activeDot={{ r: 4.2 }}
                      name="당내 이탈률"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="chart-legend">
                <span>
                  <i style={{ backgroundColor: chartPalette.partyLine }} />
                  당내 이탈률
                </span>
              </div>
              <p className="chart-card__footnote">
                당 기준이 성립하지 않은 주간은 빈 구간으로 남겨, 정당 내부
                합의가 없던 시점을 0% 이탈로 오해하지 않게 했습니다.
              </p>

              <div className="chart-card__mover-block">
                <div className="chart-card__mover-head">
                  <p className="section-label">최근 4주 mover</p>
                  <h4>당내 이탈이 늘어난 의원</h4>
                </div>
                {partyLineMovers.length > 0 ? (
                  <ol className="chart-card__mover-list">
                    {partyLineMovers.map((mover) => (
                      <li
                        key={mover.memberId}
                        className="chart-card__mover-item"
                      >
                        <MemberIdentity
                          name={mover.name}
                          party={mover.party}
                          photoUrl={mover.photoUrl}
                          calendarHref={buildCalendarHref({
                            memberId: mover.memberId
                          })}
                          size="small"
                        />
                        <div className="chart-card__mover-stats">
                          <strong>
                            {`최근 ${formatPercent(mover.currentRate)} · 직전 ${formatPercent(mover.previousRate)}`}
                          </strong>
                          <span>
                            {`이탈 ${formatNumber(mover.currentDefectionCount)}회 / 참여 ${formatNumber(mover.currentParticipationCount)}회 / 기준 기회 ${formatNumber(mover.currentOpportunityCount)}회`}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="chart-card__empty">
                    최근 4주 대비 당내 이탈이 늘어난 의원이 아직 없습니다.
                  </p>
                )}
              </div>
            </>
          ) : (
            <p className="chart-card__empty">{`${trendWindowPhrase} 관측 창에 당 기준이 성립한 표결이 아직 없습니다.`}</p>
          )}
        </article>
      </div>
    </section>
  );
}
