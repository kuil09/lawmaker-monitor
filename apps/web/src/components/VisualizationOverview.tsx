import { useEffect, useState } from "react";

import type { AccountabilityTrendsExport } from "@lawmaker-monitor/schemas";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { buildWeeklyTrendChartData } from "../lib/charts.js";
import { formatNumber, formatPercent } from "../lib/format.js";

type VisualizationOverviewProps = {
  accountabilityTrends: AccountabilityTrendsExport | null;
  assemblyLabel: string;
};

const chartPalette = {
  yes: "#2f8f4e",
  no: "#9f2d20",
  abstain: "#c4872f",
  absent: "#8f8880",
  grid: "rgba(80, 53, 32, 0.1)",
  axis: "rgba(41, 31, 22, 0.72)",
  stroke: "#5a5148",
  muted: "rgba(41, 31, 22, 0.18)"
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
        <p className="chart-tooltip__note">이 주에는 공개 기록표결이 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="chart-tooltip">
      <strong>{`${datum.weekStart} ~ ${datum.weekEnd}`}</strong>
      <ul>
        <li>
          <span className="chart-tooltip__dot" style={{ backgroundColor: chartPalette.yes }} />
          <span>찬성</span>
          <strong>{formatNumber(datum.yesCount)}</strong>
        </li>
        <li>
          <span className="chart-tooltip__dot" style={{ backgroundColor: chartPalette.no }} />
          <span>반대</span>
          <strong>{formatNumber(datum.noCount)}</strong>
        </li>
        <li>
          <span className="chart-tooltip__dot" style={{ backgroundColor: chartPalette.abstain }} />
          <span>기권</span>
          <strong>{formatNumber(datum.abstainCount)}</strong>
        </li>
        <li>
          <span className="chart-tooltip__dot" style={{ backgroundColor: chartPalette.absent }} />
          <span>불참</span>
          <strong>{formatNumber(datum.absentCount)}</strong>
        </li>
        <li>
          <span className="chart-tooltip__dot" style={{ backgroundColor: chartPalette.stroke }} />
          <span>분모</span>
          <strong>{formatNumber(datum.eligibleVoteCount)}</strong>
        </li>
      </ul>
      <p className="chart-tooltip__note">{`네거티브 비율 ${formatPercent(datum.negativeRate)}`}</p>
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
  const trendWindowWeekCount = accountabilityTrends?.weeks.length ?? weeklyTrendData.length;
  const activeWeekCount = weeklyTrendData.filter((item) => item.eligibleVoteCount > 0).length;
  const trendWindowPhrase = trendWindowWeekCount > 0 ? `최근 ${trendWindowWeekCount}주` : "최근 12주";
  const weeklyTrendCopy =
    activeWeekCount > 0
      ? `${trendWindowPhrase} 관측 창을 주마다 100% 누적 영역으로 나눠, 실제 표결이 있었던 ${activeWeekCount}주에서 찬성 대비 반대·기권·불참 비중이 어디서 커졌는지 읽습니다.`
      : `${trendWindowPhrase} 관측 창의 주간 표결 흐름을 준비 중입니다.`;
  const activeWeekLabel =
    accountabilityTrends == null ? "대기 중" : activeWeekCount > 0 ? `${activeWeekCount}주` : "없음";

  return (
    <section className="visualization-panel">
      <div className="visualization-panel__header">
        <div>
          <p className="section-label">핵심 차트</p>
          <h2>{`${assemblyLabel}의 최근 표결 흐름을 먼저 봅니다.`}</h2>
        </div>
      </div>

      <div className="visualization-stack">
        <article className="chart-card">
          <div className="chart-card__header">
            <div>
              <p className="chart-card__eyebrow">국회 전체 시계열</p>
              <h3>{`${assemblyLabel} ${trendWindowPhrase} 네거티브 추세`}</h3>
              <p className="chart-card__copy">{weeklyTrendCopy}</p>
            </div>
            <div className="chart-card__summary" aria-label="추세 관측 정보">
              <span>실제 표결 주간</span>
              <strong>{activeWeekLabel}</strong>
            </div>
          </div>

          {weeklyTrendData.some((item) => item.eligibleVoteCount > 0) ? (
            <>
              <div className="chart-card__chart chart-card__chart--trend">
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={weeklyTrendData} margin={{ top: 8, right: 4, bottom: 8, left: 4 }}>
                    <CartesianGrid stroke={chartPalette.grid} vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: chartPalette.axis, fontSize: 12 }}
                      tickFormatter={(value, index) =>
                        viewport.isMobile && index % 2 === 1 ? "" : String(value)
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
                <span><i style={{ backgroundColor: chartPalette.yes }} />찬성</span>
                <span><i style={{ backgroundColor: chartPalette.no }} />반대</span>
                <span><i style={{ backgroundColor: chartPalette.abstain }} />기권</span>
                <span><i style={{ backgroundColor: chartPalette.absent }} />불참</span>
              </div>
              <p className="chart-card__footnote">
                표결이 없던 주간은 빈 구간으로 남겨 두어, 데이터 공백이 0% 급락처럼 보이지 않게 했습니다.
              </p>
            </>
          ) : (
            <p className="chart-card__empty">{`${trendWindowPhrase} 관측 창에 공개 기록표결이 아직 없습니다.`}</p>
          )}
        </article>
      </div>
    </section>
  );
}
