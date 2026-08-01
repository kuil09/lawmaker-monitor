import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { CurrencyKrwIcon } from "@phosphor-icons/react/dist/csr/CurrencyKrw";
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
import {
  ProportionalMemberComparison,
  type ProportionalComparisonItem
} from "../components/ProportionalMemberComparison.js";
import { WatchQueueSnapshot } from "../components/WatchQueueSnapshot.js";
import { buildWeeklyTrendChartData } from "../lib/charts.js";
import { convertThousandWonToEok, formatShortDate } from "../lib/format.js";
import { getPartyCssColor } from "../lib/geo-utils.js";
import { calculateDebtRatio } from "../lib/member-assets.js";
import {
  getPaddedAxisDomain,
  getScatterYDomain
} from "../lib/scatter-domain.js";
import { spreadPercentageScatterPoints } from "../lib/scatter-overlap.js";

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
  photoUrl: string | null;
  x: number;
  y: number;
  score: number;
  supportValue: number | null;
  debtAmount?: number;
  pointWeight: number;
  partyLineOpportunityCount?: number;
  partyLineParticipationCount?: number;
  partyLineDefectionCount?: number;
  basisValue: string;
};

type ObservatoryPlotPoint = ObservatoryPoint & {
  plotX: number;
  plotY: number;
  overlapCount: number;
  plotAdjusted: boolean;
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
    scatterTitle: "의원별 찬성·이탈 분포",
    xLabel: "찬성 비중",
    yLabel: "당내 이탈률",
    trendKicker: "시간 흐름",
    trendTitle: "최근 12주 표결 구성 추이",
    trendSeries: ["찬성", "반대", "불참"],
    trendCategoryLabel: "기간",
    rankingTitle: "찬성 비중 상위 5 / 하위 5",
    scoreLabel: "찬성 비중",
    supportLabel: "당내 이탈률",
    basisLabel: "당 기준 표결"
  },
  {
    key: "assets",
    label: "재산",
    icon: CurrencyKrwIcon,
    mapMetric: "realEstate",
    mapTitle: "지역별 공개 부동산 분포",
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
          photoUrl: member.photoUrl ?? null,
          x: member.attendanceRate * 100,
          y: member.negativeRate * 100,
          score: member.attendanceRate * 100,
          supportValue: member.negativeRate * 100,
          pointWeight: 1,
          basisValue: `${member.attendedDays}일`
        }
      ];
    }

    if (lens === "voting") {
      if (member.partyLineParticipationCount === 0) {
        return [];
      }

      return [
        {
          memberId: member.memberId,
          name: member.name,
          party: member.party,
          district,
          photoUrl: member.photoUrl ?? null,
          x: member.yesRate * 100,
          y: member.partyLineDefectionRate * 100,
          score: member.yesRate * 100,
          supportValue: member.partyLineDefectionRate * 100,
          pointWeight: member.partyLineParticipationCount,
          partyLineOpportunityCount: member.partyLineOpportunityCount,
          partyLineParticipationCount: member.partyLineParticipationCount,
          partyLineDefectionCount: member.partyLineDefectionCount,
          basisValue: `${member.partyLineParticipationCount}건`
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
        photoUrl: member.photoUrl ?? null,
        x: total,
        y: realEstate,
        score: total,
        supportValue: debtRatio == null ? null : debtRatio * 100,
        debtAmount,
        pointWeight: 1,
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
  payload?: Array<{ payload?: ObservatoryPlotPoint }>;
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
      {point.overlapCount > 1 ? (
        <span>{`동일 좌표 ${point.overlapCount}명 · 점 위치를 펼쳐 표시`}</span>
      ) : null}
      {config.key === "voting" ? (
        <span>
          {`당 기준 표결 ${point.partyLineParticipationCount ?? 0}건 · 이탈 ${
            point.partyLineDefectionCount ?? 0
          }건`}
        </span>
      ) : null}
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
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const config =
    LENS_CONFIGS.find((candidate) => candidate.key === activeLens) ??
    LENS_CONFIGS[0]!;
  const points = useMemo(
    () => buildPoints(activeLens, members, memberAssetsIndex),
    [activeLens, memberAssetsIndex, members]
  );
  const rankingRows = useMemo(() => buildRankingRows(points), [points]);
  const regionalPoints = useMemo(
    () => points.filter((point) => point.district !== "비례대표"),
    [points]
  );
  const proportionalPoints = useMemo(
    () => points.filter((point) => point.district === "비례대표"),
    [points]
  );
  const proportionalComparisonItems = useMemo<ProportionalComparisonItem[]>(
    () =>
      proportionalPoints.map((point) => ({
        memberId: point.memberId,
        name: point.name,
        party: point.party,
        photoUrl: point.photoUrl,
        primaryLabel: config.scoreLabel,
        primaryValue:
          activeLens === "assets"
            ? formatEok(point.score)
            : formatPercentValue(point.score),
        secondaryLabel: config.supportLabel,
        secondaryValue:
          point.supportValue == null
            ? "자료 없음"
            : formatPercentValue(point.supportValue),
        basisValue: `${config.basisLabel} ${point.basisValue}`,
        sortValue: point.score
      })),
    [activeLens, config, proportionalPoints]
  );
  const trendData = useMemo(() => {
    if (activeLens === "attendance") {
      return buildAttendanceTrend(activityCalendar);
    }
    if (activeLens === "voting") {
      return buildVotingTrend(accountabilityTrends);
    }
    return buildAssetTrend(memberAssetsIndex);
  }, [accountabilityTrends, activeLens, activityCalendar, memberAssetsIndex]);
  const resolvedXDomain = useMemo<[number, number]>(
    () =>
      activeLens === "assets" ? getPaddedAxisDomain(points, "x") : [0, 100],
    [activeLens, points]
  );
  const resolvedYDomain = useMemo(
    () => getScatterYDomain(points, activeLens !== "assets"),
    [activeLens, points]
  );
  const plotPoints = useMemo<ObservatoryPlotPoint[]>(
    () =>
      activeLens === "assets"
        ? points.map((point) => ({
            ...point,
            plotX: point.x,
            plotY: point.y,
            overlapCount: 1,
            plotAdjusted: false
          }))
        : spreadPercentageScatterPoints(points, {
            xDomain: resolvedXDomain,
            yDomain: resolvedYDomain
          }),
    [activeLens, points, resolvedXDomain, resolvedYDomain]
  );
  const excludedVotingPointCount =
    activeLens === "voting" ? members.length - points.length : 0;
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

  return (
    <main className="v2-observatory" id="v2-main-content">
      <header className="v2-observatory__hero">
        <div>
          <p className="v2-observatory__eyebrow">
            국회 출석부 · {assemblyLabel} 공식 기록
          </p>
          <h1 className="v2-observatory__title" tabIndex={-1}>
            실시간 국회 출석부
          </h1>
          <p className="v2-observatory__intro">
            최근 발언·의안·표결의 변화와 행위 부재를 근거 단위로 비교하고
            원문까지 확인하세요.
          </p>
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

      <WatchQueueSnapshot
        accountabilitySummary={accountabilitySummary}
        accountabilityTrends={accountabilityTrends}
        billProposalActivity={billProposalActivity}
        loading={loading || billProposalActivityLoading}
        unavailable={errors.length > 0 || Boolean(billProposalActivityError)}
        onOpenMember={onOpenMember}
      />

      <section
        className="v2-observatory-explorer"
        aria-labelledby="v2-observatory-explorer-title"
      >
        <header className="v2-observatory-explorer__header">
          <div className="v2-observatory-explorer__copy">
            <p className="v2-card-kicker">전국 기록 비교</p>
            <h2 id="v2-observatory-explorer-title">전국 지표 탐색</h2>
            <span>
              선택한 지표에 따라 아래 지도·의원 분포·추세·근거 목록이 함께
              바뀝니다.
            </span>
          </div>

          <div
            className="v2-lens-tabs"
            role="tablist"
            aria-label="전국 지표 탐색 선택"
          >
            {LENS_CONFIGS.map((lens, index) => {
              const Icon = lens.icon;
              const selected = lens.key === activeLens;
              return (
                <button
                  id={`v2-lens-tab-${lens.key}`}
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
        </header>

        <div
          id="v2-observatory-panel"
          role="tabpanel"
          aria-labelledby={`v2-lens-tab-${activeLens}`}
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
                    {regionalPoints.map((point) => (
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
                    onOpenMember={onOpenMember}
                  />
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

          <section
            className="v3-scatter-card"
            aria-labelledby="v3-scatter-title"
          >
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
                  dataKey="plotX"
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
                  dataKey="plotY"
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
                <ZAxis
                  dataKey="pointWeight"
                  range={activeLens === "voting" ? [42, 84] : [45, 45]}
                />
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
                <Scatter data={plotPoints}>
                  {plotPoints.map((point) => (
                    <Cell
                      key={point.memberId}
                      fill={getPartyCssColor(point.party)}
                      fillOpacity={0.82}
                      stroke="#ffffff"
                      strokeWidth={0.8}
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
            {activeLens === "voting" ? (
              <p className="v3-scatter-card__note">
                점 크기는 당 기준이 형성된 표결의 참여 건수입니다.
                {excludedVotingPointCount > 0
                  ? ` 참여 표본이 없는 ${excludedVotingPointCount}명은 제외했습니다.`
                  : ""}
              </p>
            ) : null}
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
                      tickFormatter={(value: number) =>
                        `${Math.round(value)}억`
                      }
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
                      fill="#575148"
                      radius={[3, 3, 0, 0]}
                    />
                    <Bar
                      dataKey="primary"
                      name={config.trendSeries[0]}
                      fill="#95622d"
                      radius={[3, 3, 0, 0]}
                    />
                    <Bar
                      dataKey="tertiary"
                      name={config.trendSeries[2]}
                      fill="#5b6c00"
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
                        const rawValue = Array.isArray(value)
                          ? value[0]
                          : value;
                        return formatPercentValue(Number(rawValue ?? 0));
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="secondary"
                      name={config.trendSeries[1]}
                      stroke="#575148"
                      strokeWidth={2}
                      dot={{ r: 2.5 }}
                      connectNulls
                    />
                    <Line
                      type="monotone"
                      dataKey="primary"
                      name={config.trendSeries[0]}
                      stroke="#95622d"
                      strokeWidth={2}
                      dot={{ r: 2.5 }}
                      connectNulls
                    />
                    <Line
                      type="monotone"
                      dataKey="tertiary"
                      name={config.trendSeries[2]}
                      stroke="#5b6c00"
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

          <section
            className="v2-ranking-card"
            aria-labelledby="v2-ranking-title"
          >
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
        <ProportionalMemberComparison
          headingId="v2-proportional-comparison-title"
          kicker="지역 밖 전국 비교군"
          title={`${config.label} · 비례대표 의원 비교`}
          description="시·도 경계에 속하지 않아 지도에 배치되지 않는 비례대표 의원을 같은 기준으로 따로 비교합니다."
          comparisonNote="순서는 현재 지표의 공개값이 높은 순이며, 값의 높고 낮음 자체를 의정활동의 우수·미흡으로 판정하지 않습니다."
          items={proportionalComparisonItems}
          onOpenMember={onOpenMember}
        />
      </section>
      <BillProposalActivitySection
        data={billProposalActivity}
        loading={billProposalActivityLoading}
        error={billProposalActivityError}
        onOpenMember={onOpenMember}
      />
    </main>
  );
}
