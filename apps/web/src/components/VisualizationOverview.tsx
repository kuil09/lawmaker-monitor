import { ChartLineUpIcon } from "@phosphor-icons/react/dist/csr/ChartLineUp";
import { DatabaseIcon } from "@phosphor-icons/react/dist/csr/Database";
import { TableIcon } from "@phosphor-icons/react/dist/csr/Table";
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

type TrendWindow = 4 | 8 | 12;

const chartPalette = {
  yes: "#177245",
  no: "#34362e",
  abstain: "#c58512",
  absent: "#758195",
  partyLine: "#2457a6",
  grid: "#dfe5ec",
  axis: "#667085",
  stroke: "#344054"
};

const trendWindows: TrendWindow[] = [4, 8, 12];

type TooltipProps = {
  active?: boolean;
  payload?: ReadonlyArray<{
    payload?: Record<string, unknown>;
  }>;
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
      }
    | undefined;

  if (!active || !datum) {
    return null;
  }

  return (
    <div className="v3-chart-tooltip">
      <strong>{`${datum.weekStart} ~ ${datum.weekEnd}`}</strong>
      {datum.eligibleVoteCount > 0 ? (
        <dl>
          <div>
            <dt>찬성</dt>
            <dd>{formatNumber(datum.yesCount)}</dd>
          </div>
          <div>
            <dt>반대</dt>
            <dd>{formatNumber(datum.noCount)}</dd>
          </div>
          <div>
            <dt>기권</dt>
            <dd>{formatNumber(datum.abstainCount)}</dd>
          </div>
          <div>
            <dt>불참</dt>
            <dd>{formatNumber(datum.absentCount)}</dd>
          </div>
        </dl>
      ) : (
        <p>이 주에는 공개 기록표결이 없습니다.</p>
      )}
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

  return (
    <div className="v3-chart-tooltip">
      <strong>{`${datum.weekStart} ~ ${datum.weekEnd}`}</strong>
      {datum.opportunityCount > 0 ? (
        <dl>
          <div>
            <dt>기준 기회</dt>
            <dd>{formatNumber(datum.opportunityCount)}</dd>
          </div>
          <div>
            <dt>참여</dt>
            <dd>{formatNumber(datum.participationCount)}</dd>
          </div>
          <div>
            <dt>이탈</dt>
            <dd>{formatNumber(datum.defectionCount)}</dd>
          </div>
          <div>
            <dt>이탈률</dt>
            <dd>{formatPercent(datum.defectionRate ?? 0)}</dd>
          </div>
        </dl>
      ) : (
        <p>이 주에는 당 기준이 성립한 표결이 없습니다.</p>
      )}
    </div>
  );
}

export function VisualizationOverview({
  accountabilityTrends,
  assemblyLabel
}: VisualizationOverviewProps) {
  const [trendWindow, setTrendWindow] = useState<TrendWindow>(12);
  const [showTables, setShowTables] = useState(false);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 760
  );

  useEffect(() => {
    const syncViewport = () => {
      setIsMobile(window.innerWidth < 760);
    };

    syncViewport();
    window.addEventListener("resize", syncViewport);

    return () => {
      window.removeEventListener("resize", syncViewport);
    };
  }, []);

  const weeklyTrendData =
    buildWeeklyTrendChartData(accountabilityTrends).slice(-trendWindow);
  const partyLineTrendData =
    buildPartyLineTrendChartData(accountabilityTrends).slice(-trendWindow);
  const partyLineMovers = buildPartyLineMoverChartData(accountabilityTrends, 5);
  const visibleWeekCount = Math.max(
    weeklyTrendData.length,
    partyLineTrendData.length
  );
  const trendWindowPhrase =
    visibleWeekCount > 0
      ? `최근 ${visibleWeekCount}주`
      : `최근 ${trendWindow}주`;

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

  return (
    <section
      className="v3-trend-dashboard"
      aria-labelledby="trend-dashboard-heading"
    >
      <div className="v3-trend-toolbar">
        <div>
          <p className="v3-kicker">EVIDENCE DASHBOARD</p>
          <h2 id="trend-dashboard-heading">{`${assemblyLabel} 주간 관측 대시보드`}</h2>
          <p>동일한 기간 조건으로 참여 구성과 당내 이탈을 함께 비교합니다.</p>
        </div>

        <div className="v3-trend-toolbar__controls">
          <fieldset className="v3-window-selector">
            <legend>관측 기간</legend>
            <div>
              {trendWindows.map((windowSize) => (
                <button
                  key={windowSize}
                  type="button"
                  aria-pressed={trendWindow === windowSize}
                  onClick={() => setTrendWindow(windowSize)}
                >
                  {`${windowSize}주`}
                </button>
              ))}
            </div>
          </fieldset>
          <button
            type="button"
            className="v3-table-toggle"
            aria-pressed={showTables}
            onClick={() => setShowTables((current) => !current)}
          >
            <TableIcon size={18} weight="bold" aria-hidden="true" />
            {showTables ? "표 닫기" : "표로 보기"}
          </button>
        </div>
      </div>

      <dl className="v3-metric-strip" aria-label="현재 추세 요약">
        <div>
          <dt>최근 참여율</dt>
          <dd>
            {latestParticipationRate !== null
              ? formatPercent(latestParticipationRate)
              : "—"}
          </dd>
          <small>
            {latestActiveWeek
              ? `${latestActiveWeek.weekStart} 시작 주`
              : "표결 대기"}
          </small>
        </div>
        <div className="v3-metric-strip__alert">
          <dt>최근 불참률</dt>
          <dd>
            {latestAbsenceRate !== null
              ? formatPercent(latestAbsenceRate)
              : "—"}
          </dd>
          <small>
            {latestActiveWeek
              ? `${formatNumber(latestActiveWeek.absentCount)}건`
              : "표결 대기"}
          </small>
        </div>
        <div>
          <dt>최근 당내 이탈률</dt>
          <dd>
            {latestPartyLineWeek
              ? formatPercent(latestPartyLineWeek.defectionRate ?? 0)
              : "—"}
          </dd>
          <small>
            {latestPartyLineWeek
              ? `이탈 ${formatNumber(latestPartyLineWeek.defectionCount)}회`
              : "당 기준 대기"}
          </small>
        </div>
        <div>
          <dt>관측 주간</dt>
          <dd>{`${activeWeeks.length}/${visibleWeekCount || trendWindow}`}</dd>
          <small>표결이 있던 주 / 범위</small>
        </div>
      </dl>

      <div className="v3-trend-grid">
        <article className="v3-evidence-panel">
          <header className="v3-evidence-panel__header">
            <div>
              <p className="v3-kicker">01 · PARTICIPATION</p>
              <h3>주간 참여 구성</h3>
              <p>찬성·반대·기권·불참이 전체 공개 기록에서 차지한 비중입니다.</p>
            </div>
            <span>{trendWindowPhrase}</span>
          </header>

          {activeWeeks.length > 0 ? (
            <>
              <div className="v3-chart-layout">
                <div>
                  <div
                    className="v3-chart"
                    role="img"
                    aria-label={`${trendWindowPhrase} 찬성, 반대, 기권, 불참 비중 누적 영역 차트`}
                  >
                    <ResponsiveContainer width="100%" height={300}>
                      <AreaChart
                        data={weeklyTrendData}
                        margin={{ top: 12, right: 8, bottom: 4, left: 0 }}
                      >
                        <CartesianGrid
                          stroke={chartPalette.grid}
                          vertical={false}
                        />
                        <XAxis
                          dataKey="label"
                          tick={{ fill: chartPalette.axis, fontSize: 12 }}
                          tickFormatter={(value, index) =>
                            isMobile && index % 2 === 1 ? "" : String(value)
                          }
                          tickLine={false}
                          axisLine={{ stroke: chartPalette.grid }}
                        />
                        <YAxis
                          tick={{ fill: chartPalette.axis, fontSize: 12 }}
                          tickFormatter={(value) => `${value}%`}
                          tickLine={false}
                          axisLine={false}
                          width={40}
                          domain={[0, 100]}
                        />
                        <Tooltip content={<WeeklyTrendTooltipPanel />} />
                        <Area
                          type="monotone"
                          dataKey="yesShare"
                          stackId="vote-share"
                          stroke={chartPalette.yes}
                          fill={chartPalette.yes}
                          fillOpacity={0.84}
                          strokeWidth={1.5}
                          connectNulls={false}
                          name="찬성"
                        />
                        <Area
                          type="monotone"
                          dataKey="noShare"
                          stackId="vote-share"
                          stroke={chartPalette.no}
                          fill={chartPalette.no}
                          fillOpacity={0.82}
                          strokeWidth={1.5}
                          connectNulls={false}
                          name="반대"
                        />
                        <Area
                          type="monotone"
                          dataKey="abstainShare"
                          stackId="vote-share"
                          stroke={chartPalette.abstain}
                          fill={chartPalette.abstain}
                          fillOpacity={0.82}
                          strokeWidth={1.5}
                          connectNulls={false}
                          name="기권"
                        />
                        <Area
                          type="monotone"
                          dataKey="absentShare"
                          stackId="vote-share"
                          stroke={chartPalette.absent}
                          fill={chartPalette.absent}
                          fillOpacity={0.86}
                          strokeWidth={1.5}
                          connectNulls={false}
                          name="불참"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="v3-chart-legend" aria-label="차트 범례">
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
                </div>

                <aside
                  className="v3-insight-rail"
                  aria-label="참여 추세 핵심 근거"
                >
                  <div>
                    <span>최고 불참 비중</span>
                    <strong>
                      {peakAbsenceRate !== null
                        ? formatPercent(peakAbsenceRate)
                        : "—"}
                    </strong>
                    <small>
                      {peakAbsentWeek
                        ? `${peakAbsentWeek.weekStart} 시작 주`
                        : "관측 대기"}
                    </small>
                  </div>
                  <div>
                    <span>최근 참여 건수</span>
                    <strong>
                      {latestActiveWeek
                        ? formatNumber(
                            latestActiveWeek.eligibleVoteCount -
                              latestActiveWeek.absentCount
                          )
                        : "—"}
                    </strong>
                    <small>전체 eligible 기록 기준</small>
                  </div>
                  <p>
                    빈 주간은 선으로 연결하지 않아 미관측을 0%로 오해하지 않게
                    합니다.
                  </p>
                </aside>
              </div>

              {showTables ? (
                <div className="v3-data-table-wrap">
                  <table className="v3-data-table">
                    <caption>{`${trendWindowPhrase} 주간 참여 구성 원자료`}</caption>
                    <thead>
                      <tr>
                        <th scope="col">주간</th>
                        <th scope="col">찬성</th>
                        <th scope="col">반대</th>
                        <th scope="col">기권</th>
                        <th scope="col">불참</th>
                        <th scope="col">분모</th>
                      </tr>
                    </thead>
                    <tbody>
                      {weeklyTrendData.map((week) => (
                        <tr key={week.weekStart}>
                          <th scope="row">{week.weekStart}</th>
                          <td>{formatNumber(week.yesCount)}</td>
                          <td>{formatNumber(week.noCount)}</td>
                          <td>{formatNumber(week.abstainCount)}</td>
                          <td>{formatNumber(week.absentCount)}</td>
                          <td>
                            {week.eligibleVoteCount > 0
                              ? formatNumber(week.eligibleVoteCount)
                              : "미관측"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          ) : (
            <p className="v3-empty-state">{`${trendWindowPhrase} 관측 창에 공개 기록표결이 아직 없습니다.`}</p>
          )}
        </article>

        <article className="v3-evidence-panel">
          <header className="v3-evidence-panel__header">
            <div>
              <p className="v3-kicker">02 · PARTY-LINE</p>
              <h3>당내 이탈 추이</h3>
              <p>
                당 기준이 성립하고 의원이 실제 참여한 표결에서 다른 선택을 한
                비율입니다.
              </p>
            </div>
            <span>{trendWindowPhrase}</span>
          </header>

          {activePartyLineWeeks.length > 0 ? (
            <>
              <div className="v3-chart-layout">
                <div>
                  <div
                    className="v3-chart"
                    role="img"
                    aria-label={`${trendWindowPhrase} 당내 이탈률 선 차트`}
                  >
                    <ResponsiveContainer width="100%" height={270}>
                      <LineChart
                        data={partyLineTrendData}
                        margin={{ top: 12, right: 8, bottom: 4, left: 0 }}
                      >
                        <CartesianGrid
                          stroke={chartPalette.grid}
                          vertical={false}
                        />
                        <XAxis
                          dataKey="label"
                          tick={{ fill: chartPalette.axis, fontSize: 12 }}
                          tickFormatter={(value, index) =>
                            isMobile && index % 2 === 1 ? "" : String(value)
                          }
                          tickLine={false}
                          axisLine={{ stroke: chartPalette.grid }}
                        />
                        <YAxis
                          tick={{ fill: chartPalette.axis, fontSize: 12 }}
                          tickFormatter={(value) =>
                            `${Math.round(Number(value) * 100)}%`
                          }
                          tickLine={false}
                          axisLine={false}
                          width={40}
                          domain={[0, 1]}
                        />
                        <Tooltip content={<PartyLineTooltipPanel />} />
                        <Line
                          type="monotone"
                          dataKey="defectionRate"
                          stroke={chartPalette.partyLine}
                          strokeWidth={2.5}
                          connectNulls={false}
                          dot={{
                            r: 3.5,
                            strokeWidth: 2,
                            stroke: "#ffffff",
                            fill: chartPalette.partyLine
                          }}
                          activeDot={{ r: 5 }}
                          name="당내 이탈률"
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="v3-chart-legend" aria-label="차트 범례">
                    <span>
                      <i style={{ backgroundColor: chartPalette.partyLine }} />
                      당내 이탈률
                    </span>
                  </div>
                </div>

                <aside
                  className="v3-insight-rail"
                  aria-label="당내 이탈 핵심 근거"
                >
                  <div>
                    <span>최고 이탈률</span>
                    <strong>
                      {peakPartyLineWeek
                        ? formatPercent(peakPartyLineWeek.defectionRate ?? 0)
                        : "—"}
                    </strong>
                    <small>
                      {peakPartyLineWeek
                        ? `${peakPartyLineWeek.weekStart} 시작 주`
                        : "관측 대기"}
                    </small>
                  </div>
                  <div>
                    <span>최근 기준 기회</span>
                    <strong>
                      {latestPartyLineWeek
                        ? formatNumber(latestPartyLineWeek.opportunityCount)
                        : "—"}
                    </strong>
                    <small>
                      {latestPartyLineWeek
                        ? `참여 ${formatNumber(latestPartyLineWeek.participationCount)}회`
                        : "당 기준 대기"}
                    </small>
                  </div>
                  <p>
                    당 기준이 없는 주간은 이탈률 0%가 아닌 미관측으로
                    처리합니다.
                  </p>
                </aside>
              </div>

              {showTables ? (
                <div className="v3-data-table-wrap">
                  <table className="v3-data-table">
                    <caption>{`${trendWindowPhrase} 당내 이탈 집계 원자료`}</caption>
                    <thead>
                      <tr>
                        <th scope="col">주간</th>
                        <th scope="col">기준 기회</th>
                        <th scope="col">참여</th>
                        <th scope="col">이탈</th>
                        <th scope="col">이탈률</th>
                      </tr>
                    </thead>
                    <tbody>
                      {partyLineTrendData.map((week) => (
                        <tr key={week.weekStart}>
                          <th scope="row">{week.weekStart}</th>
                          <td>{formatNumber(week.opportunityCount)}</td>
                          <td>{formatNumber(week.participationCount)}</td>
                          <td>{formatNumber(week.defectionCount)}</td>
                          <td>
                            {week.defectionRate === null
                              ? "미관측"
                              : formatPercent(week.defectionRate)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              <section
                className="v3-mover-section"
                aria-labelledby="mover-heading"
              >
                <div className="v3-mover-section__heading">
                  <div>
                    <p className="v3-kicker">RECENT MOVERS</p>
                    <h4 id="mover-heading">최근 4주 이탈률이 늘어난 의원</h4>
                  </div>
                  <span>{`${partyLineMovers.length}명`}</span>
                </div>

                {partyLineMovers.length > 0 ? (
                  <ol className="v3-mover-list">
                    {partyLineMovers.map((mover) => (
                      <li key={mover.memberId}>
                        <MemberIdentity
                          name={mover.name}
                          party={mover.party}
                          photoUrl={mover.photoUrl}
                          calendarHref={buildCalendarHref({
                            memberId: mover.memberId
                          })}
                          size="small"
                        />
                        <div>
                          <strong>{`${formatPercent(mover.previousRate)} → ${formatPercent(mover.currentRate)}`}</strong>
                          <span>
                            {`이탈 ${formatNumber(mover.currentDefectionCount)}회 · 참여 ${formatNumber(mover.currentParticipationCount)}회`}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="v3-empty-state">
                    최근 4주 대비 당내 이탈이 늘어난 의원이 아직 없습니다.
                  </p>
                )}
              </section>
            </>
          ) : (
            <p className="v3-empty-state">{`${trendWindowPhrase} 관측 창에 당 기준이 성립한 표결이 아직 없습니다.`}</p>
          )}
        </article>
      </div>

      <div className="v3-source-line">
        <DatabaseIcon size={19} weight="bold" aria-hidden="true" />
        <div>
          <strong>집계 근거</strong>
          <p>
            공개 기록표결의 주간 스냅샷을 사용하며, 화면의 요약·차트·표는 동일한
            데이터 범위에 반응합니다.
          </p>
        </div>
        <ChartLineUpIcon size={22} weight="bold" aria-hidden="true" />
      </div>
    </section>
  );
}
