import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { BinocularsIcon } from "@phosphor-icons/react/dist/csr/Binoculars";
import { CurrencyKrwIcon } from "@phosphor-icons/react/dist/csr/CurrencyKrw";
import { InfoIcon } from "@phosphor-icons/react/dist/csr/Info";
import { ScalesIcon } from "@phosphor-icons/react/dist/csr/Scales";
import { TableIcon } from "@phosphor-icons/react/dist/csr/Table";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/csr/UsersThree";
import { useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis
} from "recharts";

import { V2NationalMap } from "./V2NationalMap.js";
import { buildWeeklyTrendChartData } from "../lib/charts.js";
import { convertThousandWonToEok } from "../lib/format.js";
import { getMetricModulatedColor, getPartyColor } from "../lib/geo-utils.js";

import type { DistributionMemberPoint } from "../lib/distribution.js";
import type { MapMetric } from "../lib/map-route.js";
import type {
  AccountabilitySummaryExport,
  AccountabilityTrendsExport,
  Manifest,
  MemberActivityCalendarExport,
  MemberAssetsIndexExport
} from "@lawmaker-monitor/schemas";

type ObservatoryLens = "attendance" | "voting" | "assets";

type ObservatoryPoint = {
  memberId: string;
  name: string;
  party: string;
  district: string;
  x: number;
  y: number;
  score: number;
  supportValue: number;
  basisValue: string;
};

type TrendPoint = {
  label: string;
  primary: number | null;
  secondary: number | null;
  tertiary: number | null;
};

type RankingRow = {
  memberId: string;
  name: string;
  party: string;
  score: number;
  supportValue: number;
  basisValue: string;
  section: "top" | "bottom";
};

type LensConfig = {
  key: ObservatoryLens;
  label: string;
  icon: typeof UsersThreeIcon;
  mapMetric: MapMetric;
  mapTitle: string;
  mapLegendMetric: string;
  scatterTitle: string;
  xLabel: string;
  yLabel: string;
  trendTitle: string;
  trendSeries: [string, string, string];
  rankingTitle: string;
  scoreLabel: string;
  supportLabel: string;
  basisLabel: string;
};

const LENS_CONFIGS: LensConfig[] = [
  {
    key: "attendance",
    label: "출석",
    icon: UsersThreeIcon,
    mapMetric: "absence",
    mapTitle: "지역별 출석률 분포",
    mapLegendMetric: "결석률",
    scatterTitle: "정당별 의원 분포",
    xLabel: "출석률",
    yLabel: "반대·기권 비중",
    trendTitle: "최근 12주 출석률 추이",
    trendSeries: ["최고", "전체 평균", "최저"],
    rankingTitle: "의원 출석률 상위 5 / 하위 5",
    scoreLabel: "평균 출석률",
    supportLabel: "반대·기권 비중",
    basisLabel: "출석 실적 기준"
  },
  {
    key: "voting",
    label: "표결 성향",
    icon: ScalesIcon,
    mapMetric: "negative",
    mapTitle: "지역별 반대·기권 분포",
    mapLegendMetric: "반대·기권률",
    scatterTitle: "의원별 찬성·이탈 분포",
    xLabel: "찬성 비중",
    yLabel: "반대·기권·불참",
    trendTitle: "최근 12주 표결 구성 추이",
    trendSeries: ["찬성", "반대", "불참"],
    rankingTitle: "찬성 비중 상위 5 / 하위 5",
    scoreLabel: "찬성 비중",
    supportLabel: "반대·기권·불참",
    basisLabel: "기록 표결"
  },
  {
    key: "assets",
    label: "재산",
    icon: CurrencyKrwIcon,
    mapMetric: "realEstate",
    mapTitle: "지역별 공개 부동산 분포",
    mapLegendMetric: "공개 부동산액",
    scatterTitle: "의원별 총재산·부동산 분포",
    xLabel: "총재산 (억원)",
    yLabel: "부동산 (억원)",
    trendTitle: "공개 재산 상위 구간 비교",
    trendSeries: ["총재산", "부동산", "증감"],
    rankingTitle: "공개 총재산 상위 5 / 하위 5",
    scoreLabel: "공개 총재산",
    supportLabel: "부동산 비중",
    basisLabel: "최근 공개일"
  }
];

const PARTY_COLORS: Record<string, string> = {};

function getPartyHex(party: string): string {
  if (PARTY_COLORS[party]) {
    return PARTY_COLORS[party]!;
  }

  const [red, green, blue] = getPartyColor(party);
  const value = `rgb(${red} ${green} ${blue})`;
  PARTY_COLORS[party] = value;
  return value;
}

function getMapLegendRamp(party: string): string {
  const stops = [0, 0.5, 1].map((value) => {
    const [red, green, blue, alpha] = getMetricModulatedColor(party, value);
    return `rgba(${red}, ${green}, ${blue}, ${alpha / 255})`;
  });
  return `linear-gradient(90deg, ${stops[0]} 0%, ${stops[1]} 50%, ${stops[2]} 100%)`;
}

function formatPercentValue(value: number): string {
  return `${value.toFixed(1)}%`;
}

function toEok(value: number | null | undefined): number {
  return value == null ? 0 : convertThousandWonToEok(value);
}

function formatEok(value: number): string {
  return `${new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: value >= 100 ? 0 : 1
  }).format(value)}억`;
}

function getWeekKey(dateValue: string): string {
  const date = new Date(`${dateValue}T00:00:00Z`);
  const day = date.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function formatShortDate(dateValue: string): string {
  const [, month, day] = dateValue.split("-");
  return `${Number(month)}/${Number(day)}`;
}

function buildAttendanceTrend(
  calendar: MemberActivityCalendarExport | null
): TrendPoint[] {
  if (!calendar) {
    return [];
  }

  const memberWeeks = new Map<
    string,
    Map<string, { attended: number; total: number }>
  >();

  for (const member of calendar.assembly.members) {
    const weeks = new Map<string, { attended: number; total: number }>();
    for (const day of member.dayStates) {
      const weekKey = getWeekKey(day.date);
      const current = weeks.get(weekKey) ?? { attended: 0, total: 0 };
      current.total += 1;
      if (day.state !== "absent") {
        current.attended += 1;
      }
      weeks.set(weekKey, current);
    }
    memberWeeks.set(member.memberId, weeks);
  }

  const weekKeys = [
    ...new Set([...memberWeeks.values()].flatMap((weeks) => [...weeks.keys()]))
  ]
    .sort()
    .slice(-12);

  return weekKeys.map((weekKey) => {
    const rates = [...memberWeeks.values()].flatMap((weeks) => {
      const week = weeks.get(weekKey);
      return week && week.total > 0 ? [(week.attended / week.total) * 100] : [];
    });

    if (rates.length === 0) {
      return {
        label: formatShortDate(weekKey),
        primary: null,
        secondary: null,
        tertiary: null
      };
    }

    return {
      label: formatShortDate(weekKey),
      primary: Math.max(...rates),
      secondary: rates.reduce((sum, value) => sum + value, 0) / rates.length,
      tertiary: Math.min(...rates)
    };
  });
}

function buildVotingTrend(
  trends: AccountabilityTrendsExport | null
): TrendPoint[] {
  return buildWeeklyTrendChartData(trends)
    .slice(-12)
    .map((point) => ({
      label: point.label,
      primary: point.yesShare,
      secondary: point.noShare,
      tertiary: point.absentShare
    }));
}

function buildAssetTrend(assets: MemberAssetsIndexExport | null): TrendPoint[] {
  return [...(assets?.members ?? [])]
    .sort((left, right) => right.latestTotal - left.latestTotal)
    .slice(0, 12)
    .reverse()
    .map((member) => ({
      label: member.name,
      primary: toEok(member.latestTotal),
      secondary: toEok(member.latestRealEstateTotal),
      tertiary: toEok(Math.abs(member.totalDelta))
    }));
}

function buildPoints(
  lens: ObservatoryLens,
  members: DistributionMemberPoint[],
  assets: MemberAssetsIndexExport | null
): ObservatoryPoint[] {
  const assetByMemberId = new Map(
    (assets?.members ?? []).map((member) => [member.memberId, member])
  );

  return members.flatMap((member) => {
    const district = member.district ?? "비례대표";
    if (lens === "attendance") {
      return [
        {
          memberId: member.memberId,
          name: member.name,
          party: member.party,
          district,
          x: member.attendanceRate * 100,
          y: member.negativeRate * 100,
          score: member.attendanceRate * 100,
          supportValue: member.negativeRate * 100,
          basisValue: `${member.attendedDays}일`
        }
      ];
    }

    if (lens === "voting") {
      return [
        {
          memberId: member.memberId,
          name: member.name,
          party: member.party,
          district,
          x: member.yesRate * 100,
          y: member.disruptionRate * 100,
          score: member.yesRate * 100,
          supportValue: member.disruptionRate * 100,
          basisValue: `${member.totalRecordedVotes}건`
        }
      ];
    }

    const asset = assetByMemberId.get(member.memberId);
    if (!asset) {
      return [];
    }

    const total = toEok(asset.latestTotal);
    const realEstate = toEok(asset.latestRealEstateTotal);
    return [
      {
        memberId: member.memberId,
        name: member.name,
        party: member.party,
        district,
        x: total,
        y: realEstate,
        score: total,
        supportValue: total > 0 ? (realEstate / total) * 100 : 0,
        basisValue: asset.latestDisclosureDate.slice(0, 10)
      }
    ];
  });
}

function buildRankingRows(points: ObservatoryPoint[]): RankingRow[] {
  const sorted = [...points].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.name.localeCompare(right.name, "ko-KR");
  });
  const top = sorted.slice(0, 5).map((point) => ({
    ...point,
    section: "top" as const
  }));
  const topIds = new Set(top.map((point) => point.memberId));
  const bottom = sorted
    .slice(-5)
    .filter((point) => !topIds.has(point.memberId))
    .reverse()
    .map((point) => ({ ...point, section: "bottom" as const }));
  return [...top, ...bottom];
}

function getAxisDomain(points: ObservatoryPoint[], key: "x" | "y") {
  if (points.length === 0) {
    return [0, 100] as [number, number];
  }

  const values = points.map((point) => point[key]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = Math.max((max - min) * 0.12, 2);
  return [Math.max(0, Math.floor(min - padding)), Math.ceil(max + padding)] as [
    number,
    number
  ];
}

function ScatterTooltipContent({
  active,
  payload,
  lens
}: {
  active?: boolean;
  payload?: Array<{ payload?: ObservatoryPoint }>;
  lens: ObservatoryLens;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) {
    return null;
  }

  return (
    <div className="v2-chart-tooltip">
      <strong>{point.name}</strong>
      <span>{`${point.party} · ${point.district}`}</span>
      <span>
        {lens === "assets"
          ? `총재산 ${formatEok(point.x)} · 부동산 ${formatEok(point.y)}`
          : `가로 ${formatPercentValue(point.x)} · 세로 ${formatPercentValue(point.y)}`}
      </span>
    </div>
  );
}

type V2ObservatoryPageProps = {
  assemblyLabel: string;
  freshnessText: string;
  manifest: Manifest | null;
  accountabilitySummary: AccountabilitySummaryExport | null;
  members: DistributionMemberPoint[];
  activityCalendar: MemberActivityCalendarExport | null;
  accountabilityTrends: AccountabilityTrendsExport | null;
  memberAssetsIndex: MemberAssetsIndexExport | null;
  loading: boolean;
  errors: string[];
  onOpenMap: (metric: MapMetric) => void;
  onOpenDistribution: () => void;
  onOpenMember: (memberId: string) => void;
};

export function V2ObservatoryPage({
  assemblyLabel,
  freshnessText,
  manifest,
  accountabilitySummary,
  members,
  activityCalendar,
  accountabilityTrends,
  memberAssetsIndex,
  loading,
  errors,
  onOpenMap,
  onOpenDistribution,
  onOpenMember
}: V2ObservatoryPageProps) {
  const [activeLens, setActiveLens] = useState<ObservatoryLens>("attendance");
  const [showPrimaryTable, setShowPrimaryTable] = useState(false);
  const [showTrendTable, setShowTrendTable] = useState(false);
  const [showMethod, setShowMethod] = useState(false);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const config =
    LENS_CONFIGS.find((candidate) => candidate.key === activeLens) ??
    LENS_CONFIGS[0]!;
  const points = useMemo(
    () => buildPoints(activeLens, members, memberAssetsIndex),
    [activeLens, memberAssetsIndex, members]
  );
  const rankingRows = useMemo(() => buildRankingRows(points), [points]);
  const mapLegendParties = useMemo(() => {
    const parties = [...new Set(points.map((point) => point.party))];
    return parties.length > 0
      ? parties.slice(0, 7)
      : ["국민의힘", "더불어민주당", "무소속"];
  }, [points]);
  const trendData = useMemo(() => {
    if (activeLens === "attendance") {
      return buildAttendanceTrend(activityCalendar);
    }
    if (activeLens === "voting") {
      return buildVotingTrend(accountabilityTrends);
    }
    return buildAssetTrend(memberAssetsIndex);
  }, [accountabilityTrends, activeLens, activityCalendar, memberAssetsIndex]);
  const lowestPoint = useMemo(
    () =>
      [...points].sort((left, right) => left.score - right.score)[0] ?? null,
    [points]
  );
  const highestSupportPoint = useMemo(
    () =>
      [...points].sort(
        (left, right) => right.supportValue - left.supportValue
      )[0] ?? null,
    [points]
  );
  const xDomain = useMemo(() => getAxisDomain(points, "x"), [points]);
  const yDomain = useMemo(() => getAxisDomain(points, "y"), [points]);
  const resolvedXDomain =
    activeLens === "assets" ? xDomain : ([0, 100] as [number, number]);
  const resolvedYDomain = yDomain;
  const latestTrendPoint = trendData[trendData.length - 1] ?? null;

  function selectLens(lens: ObservatoryLens, focus = false) {
    setActiveLens(lens);
    setShowPrimaryTable(false);
    setShowTrendTable(false);
    if (focus) {
      const index = LENS_CONFIGS.findIndex((item) => item.key === lens);
      tabRefs.current[index]?.focus();
    }
  }

  function handleTabKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number
  ) {
    let nextIndex = index;
    if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % LENS_CONFIGS.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + LENS_CONFIGS.length) % LENS_CONFIGS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = LENS_CONFIGS.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    selectLens(LENS_CONFIGS[nextIndex]!.key, true);
  }

  const insightTitle =
    activeLens === "attendance"
      ? "위로 갈수록 반대·기권 비중이 높고, 오른쪽으로 갈수록 출석률이 높습니다."
      : activeLens === "voting"
        ? "오른쪽으로 갈수록 찬성 비중이 높고, 위로 갈수록 이탈 표결이 많습니다."
        : "오른쪽으로 갈수록 총재산이 크고, 위로 갈수록 부동산 공개액이 큽니다.";

  return (
    <main className="v2-observatory" id="v2-main-content">
      <header className="v2-observatory__hero">
        <div>
          <p className="v2-observatory__eyebrow">
            {assemblyLabel} 데이터 데스크
          </p>
          <h1 className="v2-observatory__title" tabIndex={-1}>
            지금 국회에서 무엇이 보이나요?
          </h1>
        </div>
        <p className="v2-observatory__freshness">
          <span>공식 기록 기준</span>
          <strong>{freshnessText}</strong>
        </p>
      </header>

      <div className="v2-lens-tabs" role="tablist" aria-label="관찰 지표 선택">
        {LENS_CONFIGS.map((lens, index) => {
          const Icon = lens.icon;
          const selected = lens.key === activeLens;
          return (
            <button
              key={lens.key}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls="v2-observatory-panel"
              tabIndex={selected ? 0 : -1}
              className={selected ? "is-active" : undefined}
              onClick={() => selectLens(lens.key)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
            >
              <Icon size={20} weight={selected ? "fill" : "regular"} />
              <span>{lens.label}</span>
            </button>
          );
        })}
      </div>

      {errors.length > 0 ? (
        <div className="v2-status-stack" role="alert">
          {errors.map((error) => (
            <p key={error}>{error}</p>
          ))}
        </div>
      ) : null}

      <div
        id="v2-observatory-panel"
        role="tabpanel"
        aria-label={`${config.label} 관찰`}
        className="v2-observatory__grid"
      >
        <section
          className="v2-analysis-card"
          aria-labelledby="v2-analysis-title"
        >
          <div className="v2-card-heading">
            <div>
              <p className="v2-card-kicker">전국 · 의원 연결 분석</p>
              <h2 id="v2-analysis-title">{config.mapTitle}</h2>
            </div>
            <button
              type="button"
              className="v2-button v2-button--quiet"
              aria-pressed={showPrimaryTable}
              onClick={() => setShowPrimaryTable((current) => !current)}
            >
              <TableIcon size={18} />
              {showPrimaryTable ? "시각화 보기" : "표로 보기"}
            </button>
          </div>

          {loading && points.length === 0 ? (
            <div
              className="v2-analysis-loading"
              role="status"
              aria-live="polite"
            >
              <span className="v2-map-state__pulse" aria-hidden="true" />
              <strong>공식 기록을 연결하고 있습니다.</strong>
              <span>의원, 표결, 지역 데이터를 교차 확인하는 중입니다.</span>
            </div>
          ) : showPrimaryTable ? (
            <div className="v2-data-table-wrap">
              <table className="v2-data-table">
                <caption>{`${config.label} 분석 데이터`}</caption>
                <thead>
                  <tr>
                    <th scope="col">의원</th>
                    <th scope="col">정당</th>
                    <th scope="col">{config.xLabel}</th>
                    <th scope="col">{config.yLabel}</th>
                  </tr>
                </thead>
                <tbody>
                  {points.map((point) => (
                    <tr key={point.memberId}>
                      <th scope="row">
                        <button
                          type="button"
                          onClick={() => onOpenMember(point.memberId)}
                        >
                          {point.name}
                        </button>
                      </th>
                      <td>{point.party}</td>
                      <td>
                        {activeLens === "assets"
                          ? formatEok(point.x)
                          : formatPercentValue(point.x)}
                      </td>
                      <td>
                        {activeLens === "assets"
                          ? formatEok(point.y)
                          : formatPercentValue(point.y)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="v2-analysis-visuals">
              <div className="v2-map-panel">
                <V2NationalMap
                  manifest={manifest}
                  accountabilitySummary={accountabilitySummary}
                  memberAssetsIndex={memberAssetsIndex}
                  metric={config.mapMetric}
                />
                <div
                  className="v2-map-legend"
                  aria-label={`지도 범례: 색상은 정당을, 같은 정당색 안에서 진할수록 ${config.mapLegendMetric}이 높음을 나타냅니다. 회색은 자료 없음입니다.`}
                >
                  <div className="v2-map-legend__header">
                    <span className="v2-map-legend__title">색상은 정당</span>
                    <span className="v2-map-legend__missing">
                      <i aria-hidden="true" />
                      자료 없음
                    </span>
                  </div>
                  <span className="v2-map-legend__metric">
                    진할수록 {config.mapLegendMetric} 높음
                  </span>
                  <div className="v2-map-legend__axis">
                    <span>낮음</span>
                    <span className="v2-map-legend__scale" aria-hidden="true">
                      {mapLegendParties.map((party) => (
                        <i
                          key={party}
                          className="v2-map-legend__ramp"
                          style={{ background: getMapLegendRamp(party) }}
                        />
                      ))}
                    </span>
                    <span>높음</span>
                  </div>
                </div>
                <button
                  type="button"
                  className="v2-map-detail-link"
                  onClick={() => onOpenMap(config.mapMetric)}
                >
                  전국 상세 지도 열기
                  <ArrowRightIcon size={16} />
                </button>
              </div>

              <div className="v2-scatter-panel">
                <h3>{config.scatterTitle}</h3>
                <p>
                  세로축: {config.yLabel} / 가로축: {config.xLabel}
                </p>
                <div
                  className="v2-chart-frame"
                  role="img"
                  aria-label={`${points.length}명 의원의 ${config.scatterTitle}`}
                >
                  <ScatterChart
                    responsive
                    style={{ width: "100%", height: "100%" }}
                    margin={{ top: 16, right: 12, bottom: 24, left: 0 }}
                  >
                    <CartesianGrid stroke="#e2e4e7" strokeDasharray="2 2" />
                    <XAxis
                      type="number"
                      dataKey="x"
                      domain={resolvedXDomain}
                      tick={{ fontSize: 11, fill: "#62666c" }}
                      tickFormatter={(value: number) =>
                        activeLens === "assets"
                          ? `${Math.round(value)}`
                          : `${Math.round(value)}%`
                      }
                      label={{
                        value: config.xLabel,
                        position: "insideBottom",
                        offset: -14,
                        fill: "#62666c",
                        fontSize: 11
                      }}
                    />
                    <YAxis
                      type="number"
                      dataKey="y"
                      domain={resolvedYDomain}
                      width={42}
                      tick={{ fontSize: 11, fill: "#62666c" }}
                      tickFormatter={(value: number) =>
                        activeLens === "assets"
                          ? `${Math.round(value)}`
                          : `${Math.round(value)}%`
                      }
                    />
                    <ZAxis range={[45, 45]} />
                    <Tooltip
                      cursor={{ strokeDasharray: "3 3" }}
                      content={<ScatterTooltipContent lens={activeLens} />}
                    />
                    <Scatter data={points}>
                      {points.map((point) => (
                        <Cell
                          key={point.memberId}
                          fill={getPartyHex(point.party)}
                          fillOpacity={0.82}
                        />
                      ))}
                    </Scatter>
                  </ScatterChart>
                </div>
                <div className="v2-party-legend">
                  {[...new Set(points.map((point) => point.party))]
                    .slice(0, 6)
                    .map((party) => (
                      <span key={party}>
                        <i
                          style={{ backgroundColor: getPartyHex(party) }}
                          aria-hidden="true"
                        />
                        {party}
                      </span>
                    ))}
                </div>
              </div>
            </div>
          )}
        </section>

        <aside className="v2-insight-card" aria-labelledby="v2-insight-title">
          <div className="v2-insight-card__heading">
            <BinocularsIcon size={23} weight="duotone" />
            <h2 id="v2-insight-title">이번 주 관찰</h2>
          </div>
          <p className="v2-insight-card__lead">{insightTitle}</p>
          <dl className="v2-insight-card__stats">
            <div>
              <dt>대상 의원</dt>
              <dd>{points.length}명</dd>
            </div>
            <div>
              <dt>관찰 범위</dt>
              <dd>
                {trendData.length > 0
                  ? `최근 ${trendData.length}구간`
                  : "현재 공개분"}
              </dd>
            </div>
          </dl>

          {lowestPoint && highestSupportPoint ? (
            <div className="v2-insight-note">
              <InfoIcon size={18} />
              <p>
                {activeLens === "assets"
                  ? `${highestSupportPoint.name} 의원이 현재 비교군에서 부동산 비중이 가장 높습니다.`
                  : `${lowestPoint.name} 의원은 ${config.scoreLabel}이 가장 낮고, ${highestSupportPoint.name} 의원은 ${config.supportLabel}이 가장 높습니다.`}
              </p>
            </div>
          ) : null}

          <button
            type="button"
            className="v2-button v2-button--primary"
            onClick={onOpenDistribution}
          >
            근거 의원 보기
            <ArrowRightIcon size={19} />
          </button>

          <button
            type="button"
            className="v2-method-toggle"
            aria-expanded={showMethod}
            aria-controls="v2-method-copy"
            onClick={() => setShowMethod((current) => !current)}
          >
            관찰 기준 자세히 보기
          </button>
          {showMethod ? (
            <p id="v2-method-copy" className="v2-method-copy">
              공개 기록표결, 의원 활동 캘린더, 정기 재산공개를 동일 의원
              식별자로 연결합니다. 값이 없는 항목은 순위와 평균에서 제외합니다.
            </p>
          ) : null}
        </aside>

        <section className="v2-trend-card" aria-labelledby="v2-trend-title">
          <div className="v2-card-heading">
            <div>
              <p className="v2-card-kicker">시간 흐름</p>
              <h2 id="v2-trend-title">{config.trendTitle}</h2>
            </div>
            <button
              type="button"
              className="v2-button v2-button--quiet"
              aria-pressed={showTrendTable}
              onClick={() => setShowTrendTable((current) => !current)}
            >
              <TableIcon size={18} />
              {showTrendTable ? "차트 보기" : "표로 보기"}
            </button>
          </div>
          <div className="v2-trend-legend" aria-label="추세 범례">
            <span>
              <i className="v2-dot v2-dot--green" aria-hidden="true" />
              {config.trendSeries[1]}
            </span>
            <span>
              <i className="v2-dot v2-dot--blue" aria-hidden="true" />
              {config.trendSeries[0]}
            </span>
            <span>
              <i className="v2-dot v2-dot--red" aria-hidden="true" />
              {config.trendSeries[2]}
            </span>
          </div>

          {showTrendTable ? (
            <div className="v2-data-table-wrap">
              <table className="v2-data-table">
                <caption>{config.trendTitle}</caption>
                <thead>
                  <tr>
                    <th scope="col">구간</th>
                    <th scope="col">{config.trendSeries[0]}</th>
                    <th scope="col">{config.trendSeries[1]}</th>
                    <th scope="col">{config.trendSeries[2]}</th>
                  </tr>
                </thead>
                <tbody>
                  {trendData.map((point) => (
                    <tr key={point.label}>
                      <th scope="row">{point.label}</th>
                      {[point.primary, point.secondary, point.tertiary].map(
                        (value, index) => (
                          <td key={`${point.label}-${index}`}>
                            {value == null
                              ? "—"
                              : activeLens === "assets"
                                ? formatEok(value)
                                : formatPercentValue(value)}
                          </td>
                        )
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : trendData.length > 0 ? (
            <div
              className="v2-trend-chart"
              role="img"
              aria-label={config.trendTitle}
            >
              <LineChart
                responsive
                style={{ width: "100%", height: "100%" }}
                data={trendData}
                margin={{ top: 18, right: 16, bottom: 4, left: 0 }}
              >
                <CartesianGrid stroke="#e3e4e6" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "#676a70" }}
                  tickLine={false}
                />
                <YAxis
                  width={42}
                  tick={{ fontSize: 11, fill: "#676a70" }}
                  tickFormatter={(value: number) =>
                    activeLens === "assets"
                      ? `${Math.round(value)}억`
                      : `${Math.round(value)}%`
                  }
                  tickLine={false}
                />
                <Tooltip
                  formatter={(value) => {
                    const rawValue = Array.isArray(value) ? value[0] : value;
                    const numericValue = Number(rawValue ?? 0);
                    return activeLens === "assets"
                      ? formatEok(numericValue)
                      : formatPercentValue(numericValue);
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="secondary"
                  name={config.trendSeries[1]}
                  stroke="#397b5d"
                  strokeWidth={2}
                  dot={{ r: 2.5 }}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="primary"
                  name={config.trendSeries[0]}
                  stroke="#4a7ed7"
                  strokeWidth={2}
                  dot={{ r: 2.5 }}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="tertiary"
                  name={config.trendSeries[2]}
                  stroke="#c33a45"
                  strokeWidth={2}
                  dot={{ r: 2.5 }}
                  connectNulls
                />
              </LineChart>
              {latestTrendPoint ? (
                <div className="v2-trend-values" aria-hidden="true">
                  <strong className="v2-trend-values__primary">
                    {latestTrendPoint.primary == null
                      ? "—"
                      : activeLens === "assets"
                        ? formatEok(latestTrendPoint.primary)
                        : formatPercentValue(latestTrendPoint.primary)}
                  </strong>
                  <strong className="v2-trend-values__secondary">
                    {latestTrendPoint.secondary == null
                      ? "—"
                      : activeLens === "assets"
                        ? formatEok(latestTrendPoint.secondary)
                        : formatPercentValue(latestTrendPoint.secondary)}
                  </strong>
                  <strong className="v2-trend-values__tertiary">
                    {latestTrendPoint.tertiary == null
                      ? "—"
                      : activeLens === "assets"
                        ? formatEok(latestTrendPoint.tertiary)
                        : formatPercentValue(latestTrendPoint.tertiary)}
                  </strong>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="v2-empty-state" role="status">
              추세 데이터가 발행되면 이곳에서 변화 폭을 비교할 수 있습니다.
            </div>
          )}
        </section>

        <section className="v2-ranking-card" aria-labelledby="v2-ranking-title">
          <div className="v2-card-heading">
            <div>
              <p className="v2-card-kicker">근거 목록</p>
              <h2 id="v2-ranking-title">{config.rankingTitle}</h2>
            </div>
          </div>
          <div className="v2-ranking-table-wrap">
            <table className="v2-ranking-table">
              <thead>
                <tr>
                  <th scope="col">순위</th>
                  <th scope="col">의원</th>
                  <th scope="col">정당</th>
                  <th scope="col">{config.scoreLabel}</th>
                  <th scope="col">{config.basisLabel}</th>
                  <th scope="col">{config.supportLabel}</th>
                </tr>
              </thead>
              <tbody>
                {rankingRows.map((row, index) => (
                  <tr
                    key={row.memberId}
                    className={
                      row.section === "bottom" &&
                      rankingRows[index - 1]?.section === "top"
                        ? "v2-ranking-table__section-start"
                        : undefined
                    }
                  >
                    <td>
                      {row.section === "top"
                        ? index + 1
                        : Math.max(1, points.length - (index - 5))}
                    </td>
                    <th scope="row">
                      <button
                        type="button"
                        onClick={() => onOpenMember(row.memberId)}
                      >
                        {row.name}
                      </button>
                    </th>
                    <td>
                      <span
                        className="v2-party-dot"
                        style={{ backgroundColor: getPartyHex(row.party) }}
                        aria-hidden="true"
                      />
                      {row.party}
                    </td>
                    <td>
                      {activeLens === "assets"
                        ? formatEok(row.score)
                        : formatPercentValue(row.score)}
                    </td>
                    <td>{row.basisValue}</td>
                    <td>{formatPercentValue(row.supportValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
