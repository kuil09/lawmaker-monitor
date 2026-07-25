import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { BinocularsIcon } from "@phosphor-icons/react/dist/csr/Binoculars";
import { CurrencyKrwIcon } from "@phosphor-icons/react/dist/csr/CurrencyKrw";
import { InfoIcon } from "@phosphor-icons/react/dist/csr/Info";
import { ScalesIcon } from "@phosphor-icons/react/dist/csr/Scales";
import { TableIcon } from "@phosphor-icons/react/dist/csr/Table";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/csr/UsersThree";
import { useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
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
import { BillProposalActivitySection } from "../components/BillProposalActivitySection.js";
import { MemberDetailLink } from "../components/MemberDetailLink.js";
import { buildWeeklyTrendChartData } from "../lib/charts.js";
import { convertThousandWonToEok } from "../lib/format.js";
import { getPartyCssColor } from "../lib/geo-utils.js";
import { calculateDebtRatio } from "../lib/member-assets.js";
import {
  getPaddedAxisDomain,
  getScatterYDomain
} from "../lib/scatter-domain.js";

import type { DistributionMemberPoint } from "../lib/distribution.js";
import type { MapMetric } from "../lib/map-route.js";
import type {
  AccountabilitySummaryExport,
  AccountabilityTrendsExport,
  BillProposalActivityExport,
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
  supportValue: number | null;
  debtAmount?: number;
  basisValue: string;
};

type TrendPoint = {
  memberId?: string;
  label: string;
  primary: number | null;
  secondary: number | null;
  tertiary: number | null;
};

type RankingRow = {
  memberId: string;
  name: string;
  party: string;
  district: string;
  score: number;
  supportValue: number | null;
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
  trendKicker: string;
  trendTitle: string;
  trendSeries: [string, string, string];
  trendCategoryLabel: string;
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
    mapTitle: "지역별 결석률 분포",
    mapLegendMetric: "결석률",
    scatterTitle: "정당별 의원 분포",
    xLabel: "출석률",
    yLabel: "반대·기권 비중",
    trendKicker: "시간 흐름",
    trendTitle: "최근 12주 출석률 추이",
    trendSeries: ["최고", "전체 평균", "최저"],
    trendCategoryLabel: "기간",
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
    trendKicker: "시간 흐름",
    trendTitle: "최근 12주 표결 구성 추이",
    trendSeries: ["찬성", "반대", "불참"],
    trendCategoryLabel: "기간",
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
    scatterTitle: "의원별 순재산·부동산 분포",
    xLabel: "순재산 (억원)",
    yLabel: "부동산 (억원)",
    trendKicker: "의원 비교",
    trendTitle: "공개 순재산 상위 의원의 자산·부채",
    trendSeries: ["순재산", "부동산", "부채"],
    trendCategoryLabel: "의원",
    rankingTitle: "공개 순재산 상위 5 / 하위 5",
    scoreLabel: "공개 순재산",
    supportLabel: "총자산 대비 부채비율",
    basisLabel: "최근 공개일"
  }
];

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
    .slice(0, 6)
    .reverse()
    .map((member) => ({
      memberId: member.memberId,
      label: member.name,
      primary: toEok(member.latestTotal),
      secondary: toEok(member.latestRealEstateTotal),
      tertiary:
        member.latestDebtTotal == null ? null : toEok(member.latestDebtTotal)
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

  return members.flatMap((member): ObservatoryPoint[] => {
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
    const debtAmount =
      asset.latestDebtTotal == null ? undefined : toEok(asset.latestDebtTotal);
    const debtRatio =
      asset.latestDebtTotal == null
        ? null
        : calculateDebtRatio(asset.latestTotal, asset.latestDebtTotal);
    return [
      {
        memberId: member.memberId,
        name: member.name,
        party: member.party,
        district,
        x: total,
        y: realEstate,
        score: total,
        supportValue: debtRatio == null ? null : debtRatio * 100,
        debtAmount,
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

function ScatterTooltipContent({
  active,
  payload,
  config,
  onOpenMember
}: {
  active?: boolean;
  payload?: Array<{ payload?: ObservatoryPoint }>;
  config: LensConfig;
  onOpenMember: (memberId: string) => void;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) {
    return null;
  }

  const formatValue = config.key === "assets" ? formatEok : formatPercentValue;
  const xLabel = config.xLabel.replace(/\s+\([^)]*\)$/, "");
  const yLabel = config.yLabel.replace(/\s+\([^)]*\)$/, "");

  return (
    <div className="v2-chart-tooltip">
      <MemberDetailLink
        memberId={point.memberId}
        name={point.name}
        onNavigate={onOpenMember}
      />
      <span>{`${point.party} · ${point.district}`}</span>
      <span>
        {`${xLabel} ${formatValue(point.x)} · ${yLabel} ${formatValue(point.y)}`}
      </span>
      {config.key === "assets" ? (
        <span>
          {point.debtAmount == null
            ? "부채 자료 준비 중"
            : `부채 ${formatEok(point.debtAmount)} · 부채비율 ${
                point.supportValue == null
                  ? "산정 불가"
                  : formatPercentValue(point.supportValue)
              }`}
        </span>
      ) : null}
    </div>
  );
}

function AssetComparisonTooltipContent({
  active,
  payload,
  config,
  onOpenMember
}: {
  active?: boolean;
  payload?: Array<{
    dataKey?: string | number;
    name?: string | number;
    value?: number | string | Array<number | string>;
    payload?: TrendPoint;
  }>;
  config: LensConfig;
  onOpenMember: (memberId: string) => void;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point?.memberId) {
    return null;
  }

  return (
    <div className="v2-chart-tooltip v2-chart-tooltip--asset">
      <MemberDetailLink
        memberId={point.memberId}
        name={point.label}
        onNavigate={onOpenMember}
      />
      {payload?.map((entry) => {
        const rawValue = Array.isArray(entry.value)
          ? entry.value[0]
          : entry.value;
        const seriesName =
          typeof entry.name === "string"
            ? entry.name
            : config.trendSeries[
                entry.dataKey === "primary"
                  ? 0
                  : entry.dataKey === "secondary"
                    ? 1
                    : 2
              ];

        return (
          <span key={String(entry.dataKey)}>
            {`${seriesName} ${formatEok(Number(rawValue ?? 0))}`}
          </span>
        );
      })}
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
  billProposalActivity: BillProposalActivityExport | null;
  billProposalActivityLoading: boolean;
  billProposalActivityError: string | null;
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
  billProposalActivity,
  billProposalActivityLoading,
  billProposalActivityError,
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
      points
        .filter((point) => point.supportValue != null)
        .sort(
          (left, right) =>
            (right.supportValue ?? Number.NEGATIVE_INFINITY) -
            (left.supportValue ?? Number.NEGATIVE_INFINITY)
        )[0] ?? null,
    [points]
  );
  const xDomain = useMemo(() => getPaddedAxisDomain(points, "x"), [points]);
  const resolvedXDomain =
    activeLens === "assets" ? xDomain : ([0, 100] as [number, number]);
  const resolvedYDomain = useMemo(
    () => getScatterYDomain(points, activeLens !== "assets"),
    [activeLens, points]
  );
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
        : "오른쪽으로 갈수록 순재산이 크고, 위로 갈수록 부동산 공개액이 큽니다. 부채는 비교 카드와 근거 목록에서 함께 확인합니다.";

  return (
    <main className="v2-observatory" id="v2-main-content">
      <header className="v2-observatory__hero">
        <div>
          <p className="v2-observatory__eyebrow">
            시민을 위한 {assemblyLabel} 공식 기록
          </p>
          <h1 className="v2-observatory__title" tabIndex={-1}>
            국회 움직임 탐색기
          </h1>
          <p className="v2-observatory__intro">
            지역, 의원, 표결 근거를 한 화면에서 비교하고 원문까지 확인하세요.
          </p>
        </div>

        <div
          className="v2-lens-tabs"
          role="tablist"
          aria-label="관찰 지표 선택"
        >
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

        <p className="v2-observatory__freshness">
          <span>공식 기록 기준</span>
          <strong>{freshnessText}</strong>
        </p>
      </header>

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
        <aside className="v3-rank-rail" aria-labelledby="v3-rank-rail-title">
          <div className="v3-rank-rail__heading">
            <p className="v2-card-kicker">빠른 비교</p>
            <h2 id="v3-rank-rail-title">{config.scoreLabel}</h2>
            <span>상위 공개 기록</span>
          </div>
          <ol className="v3-rank-rail__list">
            {rankingRows
              .filter((row) => row.section === "top")
              .map((row, index) => (
                <li key={row.memberId}>
                  <span className="v3-rank-rail__rank">{index + 1}</span>
                  <button
                    type="button"
                    onClick={() => onOpenMember(row.memberId)}
                  >
                    <span>
                      <strong>{row.name}</strong>
                      <small>{`${row.party} · ${row.district}`}</small>
                    </span>
                    <em>
                      {activeLens === "assets"
                        ? formatEok(row.score)
                        : formatPercentValue(row.score)}
                    </em>
                  </button>
                </li>
              ))}
          </ol>
          <button
            type="button"
            className="v3-rank-rail__all"
            onClick={onOpenDistribution}
          >
            전체 의원 비교
            <ArrowRightIcon size={16} />
          </button>
        </aside>

        <section
          className="v2-analysis-card"
          aria-labelledby="v2-analysis-title"
        >
          <div className="v2-card-heading">
            <div>
              <p className="v2-card-kicker">전국 지역 탐색</p>
              <h2 id="v2-analysis-title">{config.mapTitle}</h2>
            </div>
            <button
              type="button"
              className="v2-button v2-button--quiet"
              aria-pressed={showPrimaryTable}
              onClick={() => setShowPrimaryTable((current) => !current)}
            >
              <TableIcon size={18} />
              {showPrimaryTable ? "지도 보기" : "목록 보기"}
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
                    <th scope="col">지역구·비례</th>
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
                      <td>{point.district}</td>
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
                  aria-label={`지도 범례: 색상으로 정당을 구분합니다. 같은 정당색 안에서는 진할수록 ${config.mapLegendMetric}이 높습니다. 회색은 자료 없음입니다.`}
                >
                  <div className="v2-map-legend__header">
                    <span className="v2-map-legend__title">
                      색상으로 정당 구분
                    </span>
                    <span className="v2-map-legend__missing">
                      <i aria-hidden="true" />
                      자료 없음
                    </span>
                  </div>
                  <span className="v2-map-legend__metric">
                    같은 색에서 진할수록 {config.mapLegendMetric} 높음
                  </span>
                  <div className="v2-map-legend__axis">
                    <span>옅음</span>
                    <i
                      className="v2-map-legend__intensity"
                      aria-hidden="true"
                    />
                    <span>진함</span>
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
                {activeLens === "assets" ? (
                  <>
                    <MemberDetailLink
                      memberId={highestSupportPoint.memberId}
                      name={highestSupportPoint.name}
                      onNavigate={onOpenMember}
                    />
                    {` 의원이 현재 비교군에서 총자산 대비 부채비율이 가장 높습니다.`}
                  </>
                ) : (
                  <>
                    <MemberDetailLink
                      memberId={lowestPoint.memberId}
                      name={lowestPoint.name}
                      onNavigate={onOpenMember}
                    />
                    {` 의원은 ${config.scoreLabel}이 가장 낮고, `}
                    <MemberDetailLink
                      memberId={highestSupportPoint.memberId}
                      name={highestSupportPoint.name}
                      onNavigate={onOpenMember}
                    />
                    {` 의원은 ${config.supportLabel}이 가장 높습니다.`}
                  </>
                )}
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
              식별자로 연결합니다. 재산의 부채비율은 공개 채무를 순재산과 채무의
              합으로 나눠 계산하며, 분모가 0원 이하인 경우 산정하지 않습니다.
              값이 없는 항목은 순위와 평균에서 제외합니다.
            </p>
          ) : null}
        </aside>

        <section className="v3-scatter-card" aria-labelledby="v3-scatter-title">
          <div className="v2-card-heading">
            <div>
              <p className="v2-card-kicker">의원 비교</p>
              <h2 id="v3-scatter-title">{config.scatterTitle}</h2>
            </div>
            <p className="v3-scatter-card__axis">
              세로 {config.yLabel} · 가로 {config.xLabel}
            </p>
          </div>
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
              <CartesianGrid stroke="#e2e7ec" strokeDasharray="2 2" />
              <XAxis
                type="number"
                dataKey="x"
                domain={resolvedXDomain}
                scale={activeLens === "assets" ? "symlog" : "auto"}
                tick={{ fontSize: 11, fill: "#66717d" }}
                tickFormatter={(value: number) =>
                  activeLens === "assets"
                    ? `${Math.round(value)}`
                    : `${Math.round(value)}%`
                }
                label={{
                  value: config.xLabel,
                  position: "insideBottom",
                  offset: -14,
                  fill: "#66717d",
                  fontSize: 11
                }}
              />
              <YAxis
                type="number"
                dataKey="y"
                domain={resolvedYDomain}
                scale={activeLens === "assets" ? "symlog" : "auto"}
                width={42}
                tick={{ fontSize: 11, fill: "#66717d" }}
                tickFormatter={(value: number) =>
                  activeLens === "assets"
                    ? `${Math.round(value)}`
                    : `${Math.round(value)}%`
                }
              />
              <ZAxis range={[45, 45]} />
              <Tooltip
                cursor={{ strokeDasharray: "3 3" }}
                wrapperStyle={{ pointerEvents: "auto" }}
                content={
                  <ScatterTooltipContent
                    config={config}
                    onOpenMember={onOpenMember}
                  />
                }
              />
              <Scatter data={points}>
                {points.map((point) => (
                  <Cell
                    key={point.memberId}
                    fill={getPartyCssColor(point.party)}
                    fillOpacity={0.82}
                  />
                ))}
              </Scatter>
            </ScatterChart>
          </div>
          <div className="v2-party-legend">
            {[...new Set(points.map((point) => point.party))].map((party) => (
              <span key={party}>
                <i
                  style={{ backgroundColor: getPartyCssColor(party) }}
                  aria-hidden="true"
                />
                {party}
              </span>
            ))}
          </div>
        </section>

        <section className="v2-trend-card" aria-labelledby="v2-trend-title">
          <div className="v2-card-heading">
            <div>
              <p className="v2-card-kicker">{config.trendKicker}</p>
              <h2 id="v2-trend-title">{config.trendTitle}</h2>
            </div>
            <button
              type="button"
              className="v2-button v2-button--quiet"
              aria-pressed={showTrendTable}
              onClick={() => setShowTrendTable((current) => !current)}
            >
              <TableIcon size={18} />
              <span className="v2-button__label">
                {showTrendTable ? "차트 보기" : "표로 보기"}
              </span>
            </button>
          </div>
          <div
            className="v2-trend-legend"
            aria-label={
              activeLens === "assets" ? "재산 비교 범례" : "추세 범례"
            }
          >
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
          {activeLens === "assets" ? (
            <p className="v2-trend-scale-note">
              금액 격차를 함께 보기 위해 대칭 로그 축을 사용합니다.
            </p>
          ) : null}

          {showTrendTable ? (
            <div className="v2-data-table-wrap">
              <table className="v2-data-table">
                <caption>{config.trendTitle}</caption>
                <thead>
                  <tr>
                    <th scope="col">{config.trendCategoryLabel}</th>
                    <th scope="col">{config.trendSeries[0]}</th>
                    <th scope="col">{config.trendSeries[1]}</th>
                    <th scope="col">{config.trendSeries[2]}</th>
                  </tr>
                </thead>
                <tbody>
                  {trendData.map((point) => (
                    <tr key={point.label}>
                      <th scope="row">
                        {point.memberId ? (
                          <MemberDetailLink
                            memberId={point.memberId}
                            name={point.label}
                            onNavigate={onOpenMember}
                          />
                        ) : (
                          point.label
                        )}
                      </th>
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
              className={`v2-trend-chart${
                activeLens === "assets" ? " v2-trend-chart--comparison" : ""
              }`}
              role="img"
              aria-label={
                activeLens === "assets"
                  ? `${config.trendTitle} 대칭 로그 축 막대그래프`
                  : config.trendTitle
              }
            >
              {activeLens === "assets" ? (
                <BarChart
                  responsive
                  style={{ width: "100%", height: "100%" }}
                  data={trendData}
                  layout="vertical"
                  margin={{ top: 8, right: 12, bottom: 8, left: 0 }}
                  barCategoryGap="18%"
                >
                  <CartesianGrid stroke="#e3e4e6" horizontal={false} />
                  <XAxis
                    type="number"
                    scale="symlog"
                    domain={["auto", "auto"]}
                    tick={{ fontSize: 11, fill: "#676a70" }}
                    tickFormatter={(value: number) => `${Math.round(value)}억`}
                    tickLine={false}
                    minTickGap={30}
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={48}
                    tick={{ fontSize: 11, fill: "#676a70" }}
                    tickLine={false}
                  />
                  <Tooltip
                    wrapperStyle={{ pointerEvents: "auto" }}
                    content={
                      <AssetComparisonTooltipContent
                        config={config}
                        onOpenMember={onOpenMember}
                      />
                    }
                  />
                  <Bar
                    dataKey="secondary"
                    name={config.trendSeries[1]}
                    fill="#397b5d"
                    radius={[3, 3, 0, 0]}
                  />
                  <Bar
                    dataKey="primary"
                    name={config.trendSeries[0]}
                    fill="#4a7ed7"
                    radius={[3, 3, 0, 0]}
                  />
                  <Bar
                    dataKey="tertiary"
                    name={config.trendSeries[2]}
                    fill="#c33a45"
                    radius={[3, 3, 0, 0]}
                  />
                </BarChart>
              ) : (
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
                    tickFormatter={(value: number) => `${Math.round(value)}%`}
                    tickLine={false}
                  />
                  <Tooltip
                    formatter={(value) => {
                      const rawValue = Array.isArray(value) ? value[0] : value;
                      return formatPercentValue(Number(rawValue ?? 0));
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
              )}
              {latestTrendPoint && activeLens !== "assets" ? (
                <div className="v2-trend-values" aria-hidden="true">
                  <strong className="v2-trend-values__primary">
                    {latestTrendPoint.primary == null
                      ? "—"
                      : formatPercentValue(latestTrendPoint.primary)}
                  </strong>
                  <strong className="v2-trend-values__secondary">
                    {latestTrendPoint.secondary == null
                      ? "—"
                      : formatPercentValue(latestTrendPoint.secondary)}
                  </strong>
                  <strong className="v2-trend-values__tertiary">
                    {latestTrendPoint.tertiary == null
                      ? "—"
                      : formatPercentValue(latestTrendPoint.tertiary)}
                  </strong>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="v2-empty-state" role="status">
              {activeLens === "assets"
                ? "공개 재산 데이터가 발행되면 이곳에서 의원별 금액을 비교할 수 있습니다."
                : "추세 데이터가 발행되면 이곳에서 변화 폭을 비교할 수 있습니다."}
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
                  <th scope="col">지역구·비례</th>
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
                        style={{
                          backgroundColor: getPartyCssColor(row.party)
                        }}
                        aria-hidden="true"
                      />
                      {row.party}
                    </td>
                    <td>{row.district}</td>
                    <td>
                      {activeLens === "assets"
                        ? formatEok(row.score)
                        : formatPercentValue(row.score)}
                    </td>
                    <td>{row.basisValue}</td>
                    <td>
                      {row.supportValue == null
                        ? "자료 없음"
                        : formatPercentValue(row.supportValue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <BillProposalActivitySection
        data={billProposalActivity}
        loading={billProposalActivityLoading}
        error={billProposalActivityError}
        onOpenMember={onOpenMember}
      />
    </main>
  );
}
