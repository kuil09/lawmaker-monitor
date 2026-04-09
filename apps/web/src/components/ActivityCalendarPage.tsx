import {
  useEffect,
  useState,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent
} from "react";

import type {
  MemberActivityCalendarAssembly,
  MemberActivityCalendarExport,
  MemberActivityCalendarMember,
  MemberActivityCalendarMemberDetailExport,
  MemberActivityVoteRecord,
  MemberAssetsHistoryExport,
  MemberAssetsIndexExport,
  MemberAssetsIndexItem
} from "@lawmaker-monitor/schemas";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import {
  buildCalendarWeeks,
  buildHeadToHeadSummary,
  buildMonthLabels,
  getCurrentStreak,
  getMemberDayBreakdown,
  getLongestStreak,
  rankActivityMembers,
  type CalendarCell
} from "../lib/member-activity.js";
import { buildCalendarHref, type ActivityViewMode } from "../lib/calendar-route.js";
import { formatDate, formatNumber, formatVoteCodeLabel } from "../lib/format.js";
import { MemberIdentity } from "./MemberIdentity.js";
import { MemberSearchField } from "./MemberSearchField.js";

type ActivityCalendarPageProps = {
  activityCalendar: MemberActivityCalendarExport | null;
  loading: boolean;
  error: string | null;
  assemblyLabel?: string | null;
  initialMemberId?: string | null;
  initialCompareMemberId?: string | null;
  initialView?: ActivityViewMode;
  memberDetails: Record<string, MemberActivityCalendarMemberDetailExport | undefined>;
  memberDetailErrors: Record<string, string | null | undefined>;
  memberDetailLoading: Record<string, boolean | undefined>;
  memberAssetsIndex: MemberAssetsIndexExport | null;
  memberAssetsIndexError?: string | null;
  memberAssetHistories: Record<string, MemberAssetsHistoryExport | undefined>;
  memberAssetHistoryErrors: Record<string, string | null | undefined>;
  memberAssetHistoryLoading: Record<string, boolean | undefined>;
  onEnsureMemberDetail: (member: MemberActivityCalendarMember) => void | Promise<void>;
  onRetryMemberDetail: (member: MemberActivityCalendarMember) => void;
  onEnsureMemberAssetHistory: (member: MemberActivityCalendarMember) => void | Promise<void>;
  onRetryMemberAssetHistory: (member: MemberActivityCalendarMember) => void;
  onBack: () => void;
  onRetry: () => void;
};

const ACTIVITY_RATIO_CHART_HEIGHT = 220;
const INITIAL_VISIBLE_COMMITTEE_COUNT = 3;
const INITIAL_VISIBLE_VOTE_RECORDS_PER_GROUP = 2;

const weekdayLabels = ["일", "월", "화", "수", "목", "금", "토"];
const currentRunLabel = "현재 찬성 없이 이어진 날";
const longestRunLabel = "가장 길게 찬성 없이 이어진 날";
const runSummaryCopy =
  "이 화면은 표결이 있었던 날짜를 하루 단위로 묶어 보여줍니다. 같은 날 표결이 여러 건이면 그날의 대표 상태만 색으로 표시하고, 지금·최장 지표는 찬성이 나오기 전까지 이어진 날짜 수를 뜻합니다.";

type RatioDatum = {
  label: string;
  percent: number;
  color: string;
};

type RatioTickProps = {
  x?: number | string;
  y?: number | string;
  payload?: {
    value?: string;
  };
};

type CompareRatioDatum = {
  label: string;
  axisColor: string;
  leftPercent: number;
  rightPercent: number;
};

const compareRatioColors = {
  leftStroke: "#982d22",
  leftFill: "rgba(152, 45, 34, 0.18)",
  rightStroke: "#43657b",
  rightFill: "rgba(67, 101, 123, 0.18)"
};

const assetCategoryPalette = [
  "#9b3d2f",
  "#2f5d73",
  "#8b6a1e",
  "#4d6f38",
  "#704f92",
  "#8a4d63",
  "#006d77",
  "#7f5539"
] as const;

const assetCategoryPriority = [
  "건물",
  "토지",
  "예금",
  "증권",
  "채무",
  "부동산에 관한 규정이 준용되는 권리와 자동차·건설기계·선박 및 항공기",
  "정치자금법에 따른 정치자금의 수입 및 지출을 위한 예금계좌의 예금",
  "현금",
  "채권"
] as const;

const explicitRealEstateCategoryLabels = ["건물", "토지"] as const;
const mixedAssetCategoryLabels = [
  "부동산에 관한 규정이 준용되는 권리와 자동차·건설기계·선박 및 항공기"
] as const;

type AssetChartRow = {
  reportedAt: string;
  label: string;
  total: number;
  [categoryKey: string]: string | number;
};

type RealEstateFocusSummary = {
  buildingAmount: number;
  hasExplicitCategory: boolean;
  hasMixedCategory: boolean;
  landAmount: number;
  latestAmount: number;
  deltaAmount: number;
};

type AssetScopeMode = "familyIncluded" | "selfOnly";

type AssetHistorySnapshot = Pick<
  MemberAssetsHistoryExport,
  "series" | "categorySeries" | "latestSummary"
>;

function formatAssetAmount(value: number): string {
  return `${formatNumber(value)}천원`;
}

function formatAssetDelta(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value)}천원`;
}

function formatAssetAxisLabel(value: string): string {
  return value.slice(2).replaceAll("-", ".");
}

function describeFamilyGap(value: number): string {
  if (value > 0) {
    return "가족 명의 순재산이 총액에 더해졌습니다.";
  }

  if (value < 0) {
    return "가족 명의 순채무가 총액을 낮추고 있습니다.";
  }

  return "본인만과 가족 포함 총액이 같습니다.";
}

function resolveAssetHistorySnapshot(
  history: MemberAssetsHistoryExport | null,
  scopeMode: AssetScopeMode
): AssetHistorySnapshot | null {
  if (!history) {
    return null;
  }

  if (scopeMode === "selfOnly" && history.selfOnly) {
    return history.selfOnly;
  }

  return {
    series: history.series,
    categorySeries: history.categorySeries,
    latestSummary: history.latestSummary
  };
}

function sortAssetCategorySeries(
  history: AssetHistorySnapshot | null
): AssetHistorySnapshot["categorySeries"] {
  if (!history) {
    return [];
  }

  return [...history.categorySeries].sort((left, right) => {
    const leftPriority = assetCategoryPriority.findIndex((value) => value === left.categoryLabel);
    const rightPriority = assetCategoryPriority.findIndex((value) => value === right.categoryLabel);
    const normalizedLeft = leftPriority === -1 ? 99 : leftPriority;
    const normalizedRight = rightPriority === -1 ? 99 : rightPriority;

    if (normalizedLeft !== normalizedRight) {
      return normalizedLeft - normalizedRight;
    }

    return left.categoryLabel.localeCompare(right.categoryLabel, "ko-KR");
  });
}

function buildAssetChartRows(
  history: AssetHistorySnapshot | null,
  visibleCategoryKeys: string[]
): AssetChartRow[] {
  if (!history) {
    return [];
  }

  const categoryLookup = new Map(
    history.categorySeries
      .filter((series) => visibleCategoryKeys.includes(series.categoryKey))
      .map((series) => [series.categoryKey, new Map(series.points.map((point) => [point.reportedAt, point.currentAmount]))] as const)
  );

  return history.series.map((point) => {
    const row: AssetChartRow = {
      reportedAt: point.reportedAt,
      label: formatAssetAxisLabel(point.reportedAt),
      total: point.currentAmount
    };

    for (const categoryKey of visibleCategoryKeys) {
      row[categoryKey] = categoryLookup.get(categoryKey)?.get(point.reportedAt) ?? 0;
    }

    return row;
  });
}

function getCategoryAmountAtDate(
  history: AssetHistorySnapshot | null,
  categoryLabel: string,
  reportedAt: string
): number {
  if (!history) {
    return 0;
  }

  const series = history.categorySeries.find((entry) => entry.categoryLabel === categoryLabel);
  return series?.points.find((point) => point.reportedAt === reportedAt)?.currentAmount ?? 0;
}

function buildRealEstateFocusSummary(
  history: AssetHistorySnapshot | null
): RealEstateFocusSummary | null {
  if (!history || history.series.length === 0) {
    return null;
  }

  const firstReportedAt = history.series[0]?.reportedAt;
  const latestReportedAt = history.latestSummary.reportedAt;

  if (!firstReportedAt || !latestReportedAt) {
    return null;
  }

  const buildingAmount = getCategoryAmountAtDate(history, "건물", latestReportedAt);
  const landAmount = getCategoryAmountAtDate(history, "토지", latestReportedAt);
  const latestAmount = buildingAmount + landAmount;
  const firstAmount = explicitRealEstateCategoryLabels.reduce(
    (sum, categoryLabel) => sum + getCategoryAmountAtDate(history, categoryLabel, firstReportedAt),
    0
  );

  return {
    buildingAmount,
    hasExplicitCategory: history.categorySeries.some((series) =>
      explicitRealEstateCategoryLabels.includes(
        series.categoryLabel as (typeof explicitRealEstateCategoryLabels)[number]
      )
    ),
    hasMixedCategory: history.categorySeries.some((series) =>
      mixedAssetCategoryLabels.includes(
        series.categoryLabel as (typeof mixedAssetCategoryLabels)[number]
      )
    ),
    landAmount,
    latestAmount,
    deltaAmount: latestAmount - firstAmount
  };
}

function buildRatioData(member: MemberActivityCalendarMember): RatioDatum[] {
  const breakdown = getMemberDayBreakdown(member);
  const total =
    breakdown.yesDays +
    breakdown.noDays +
    breakdown.abstainDays +
    breakdown.absentDays;

  const toPercent = (value: number): number => (total === 0 ? 0 : Math.round((value / total) * 100));

  return [
    { label: "찬성", percent: toPercent(breakdown.yesDays), color: "var(--vote-yes)" },
    { label: "반대", percent: toPercent(breakdown.noDays), color: "var(--vote-no)" },
    { label: "기권", percent: toPercent(breakdown.abstainDays), color: "var(--vote-abstain)" },
    { label: "불참", percent: toPercent(breakdown.absentDays), color: "var(--vote-absent)" }
  ];
}

function renderRatioAxisTick({ x = 0, y = 0, payload }: RatioTickProps) {
  const label = payload?.value ?? "";
  const color = {
    찬성: "var(--vote-yes)",
    반대: "var(--vote-no)",
    기권: "var(--vote-abstain)",
    불참: "var(--vote-absent)"
  }[label] ?? "var(--ink-muted)";

  return (
    <text
      x={Number(x)}
      y={Number(y)}
      dy={4}
      textAnchor="middle"
      fill={color}
      fontSize="12"
      fontWeight="700"
    >
      {label}
    </text>
  );
}

type CompareMetricPreference = "higher" | "lower";
type CompareMetricWinner = "left" | "right" | "tie";

type CompareMetricCardData = {
  leftValue: number;
  rightValue: number;
  summaryText: string;
  detailText: string;
  winner: CompareMetricWinner;
  badgeText: string;
};

function hasBatchim(value: string): boolean {
  const trimmed = value.trim();
  const lastCharacter = trimmed.charAt(trimmed.length - 1);

  if (!lastCharacter) {
    return false;
  }

  const codePoint = lastCharacter.charCodeAt(0);

  if (codePoint < 0xac00 || codePoint > 0xd7a3) {
    return false;
  }

  return (codePoint - 0xac00) % 28 !== 0;
}

function withSubjectParticle(value: string): string {
  return `${value}${hasBatchim(value) ? "이" : "가"}`;
}

function formatCompareMetricSubject(label: string): string {
  if (label === currentRunLabel) {
    return "찬성 없이 이어진 날";
  }

  if (label === longestRunLabel) {
    return "가장 길게 찬성 없이 이어진 날";
  }

  if (label === "반대") {
    return "반대한 날";
  }

  if (label === "기권") {
    return "기권한 날";
  }

  if (label === "불참") {
    return "불참한 날";
  }

  if (label === "찬성") {
    return "찬성한 날";
  }

  return label;
}

function formatCompareMetricBadgeText(difference: number): string {
  return difference === 0 ? "동률" : `차이 ${formatNumber(difference)}일`;
}

function buildCompareMetricCard(
  label: string,
  leftMember: MemberActivityCalendarMember,
  rightMember: MemberActivityCalendarMember,
  leftValue: number,
  rightValue: number,
  preference: CompareMetricPreference
): CompareMetricCardData {
  const subject = formatCompareMetricSubject(label);
  const difference = Math.abs(leftValue - rightValue);
  const detailText = `${leftMember.name} ${formatNumber(leftValue)}일 · ${rightMember.name} ${formatNumber(rightValue)}일`;

  if (leftValue === rightValue) {
    return {
      leftValue,
      rightValue,
      summaryText: `${subject}이 같습니다.`,
      detailText,
      winner: "tie",
      badgeText: formatCompareMetricBadgeText(0)
    };
  }

  const winner =
    preference === "higher"
      ? leftValue > rightValue
        ? leftMember
        : rightMember
      : leftValue < rightValue
        ? leftMember
        : rightMember;
  const winnerSide: CompareMetricWinner =
    winner.memberId === leftMember.memberId ? "left" : "right";

  return {
    leftValue,
    rightValue,
    summaryText:
      label === longestRunLabel
        ? `${withSubjectParticle(winner.name)} ${subject}이 ${formatNumber(difference)}일 더 깁니다.`
        : `${withSubjectParticle(winner.name)} ${subject}이 ${formatNumber(difference)}일 더 ${preference === "higher" ? "많습니다" : "적습니다"}.`,
    detailText,
    winner: winnerSide,
    badgeText: formatCompareMetricBadgeText(difference)
  };
}

function getMemberById(
  assembly: MemberActivityCalendarAssembly | null,
  memberId: string | null
): MemberActivityCalendarMember | null {
  if (!assembly || !memberId) {
    return null;
  }

  return assembly.members.find((member) => member.memberId === memberId) ?? null;
}

function getCalendarCellLabel(cell: CalendarCell): string {
  if (!cell.date) {
    return "표시되지 않는 날짜";
  }

  if (cell.state === "empty") {
    return `${cell.date} · 표결 없음`;
  }

  const parts = [
    `${cell.date}`,
    `총 ${cell.totalRollCalls}건`,
    `찬성 ${cell.yesCount}건`,
    `반대 ${cell.noCount}건`,
    `기권 ${cell.abstainCount}건`,
    `불참 ${cell.absentCount}건`
  ];

  if (cell.unknownCount > 0) {
    parts.push(`미확인 ${cell.unknownCount}건`);
  }

  switch (cell.state) {
    case "absent":
      return `${parts.join(" · ")} · 대표 상태: 불참`;
    case "no":
      return `${parts.join(" · ")} · 대표 상태: 반대`;
    case "abstain":
      return `${parts.join(" · ")} · 대표 상태: 기권`;
    case "yes":
      return `${parts.join(" · ")} · 대표 상태: 찬성`;
    case "unknown":
      return `${parts.join(" · ")} · 대표 상태: 미확인`;
    default:
      return `${cell.date} · 표결 없음`;
  }
}

function ExternalSiteLink({ url }: { url?: string | null }) {
  if (!url) {
    return null;
  }

  return (
    <a
      className="activity-page__action-button activity-page__external-link"
      href={url}
      target="_blank"
      rel="noreferrer"
      aria-label="홈페이지"
      title="홈페이지"
    >
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle
          cx="10"
          cy="10"
          r="6.7"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
        />
        <path
          d="M3.9 10h12.2M10 3.3c1.7 1.6 2.8 4.1 2.8 6.7s-1.1 5.1-2.8 6.7c-1.7-1.6-2.8-4.1-2.8-6.7s1.1-5.1 2.8-6.7Z"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.4"
        />
      </svg>
      <span>홈페이지</span>
    </a>
  );
}

type MemberAssetSectionProps = {
  indexEntry: MemberAssetsIndexItem | null;
  indexError?: string | null;
  history: MemberAssetsHistoryExport | null;
  loading: boolean;
  error?: string | null;
  onRetry?: (() => void) | null;
};

function MemberAssetSection({
  indexEntry,
  indexError,
  history,
  loading,
  error,
  onRetry
}: MemberAssetSectionProps) {
  const [assetScopeMode, setAssetScopeMode] = useState<AssetScopeMode>("familyIncluded");
  const activeHistory = resolveAssetHistorySnapshot(history, assetScopeMode);
  const orderedCategorySeries = sortAssetCategorySeries(activeHistory);
  const realEstateFocus = buildRealEstateFocusSummary(activeHistory);
  const familyGapLatest =
    history?.selfOnly != null
      ? history.latestSummary.currentAmount - history.selfOnly.latestSummary.currentAmount
      : null;
  const activeFirstPoint = activeHistory?.series[0] ?? null;
  const activeLatestTotal = activeHistory?.latestSummary.currentAmount ?? indexEntry?.latestTotal ?? 0;
  const activeTotalDelta =
    activeHistory && activeFirstPoint
      ? activeHistory.latestSummary.currentAmount - activeFirstPoint.currentAmount
      : indexEntry?.totalDelta ?? 0;
  const activeScopeLabel = assetScopeMode === "selfOnly" ? "본인만" : "가족 포함";
  const defaultCategoryKeys = orderedCategorySeries.slice(0, 4).map((series) => series.categoryKey);
  const orderedCategorySignature = orderedCategorySeries
    .map((series) => `${series.categoryKey}:${series.points.length}`)
    .join("|");
  const [visibleCategoryKeys, setVisibleCategoryKeys] = useState<string[]>(defaultCategoryKeys);
  const [showAllCategories, setShowAllCategories] = useState(false);

  useEffect(() => {
    const nextDefaultKeys = orderedCategorySeries.slice(0, 4).map((series) => series.categoryKey);
    setVisibleCategoryKeys((current) => {
      const retained = current.filter((categoryKey) =>
        orderedCategorySeries.some((series) => series.categoryKey === categoryKey)
      );

      return retained.length > 0 ? retained : nextDefaultKeys;
    });
    setShowAllCategories(false);
  }, [history?.memberId, orderedCategorySignature]);

  useEffect(() => {
    setAssetScopeMode("familyIncluded");
  }, [history?.memberId]);

  if (indexError && !indexEntry) {
    return (
      <section className="activity-asset-card" aria-label="재산 공개 정보">
        <div className="activity-drawer__section-head">
          <div>
            <p className="section-label">재산 공개</p>
            <h3>데이터를 불러오지 못했습니다</h3>
          </div>
        </div>
        <p className="activity-drawer__empty">{indexError}</p>
      </section>
    );
  }

  if (!indexEntry) {
    return (
      <section className="activity-asset-card" aria-label="재산 공개 정보">
        <div className="activity-drawer__section-head">
          <div>
            <p className="section-label">재산 공개</p>
            <h3>현직 22대 기준 재산 공개 이력이 없습니다</h3>
          </div>
          <p>현재 선택한 의원에 대해 공개된 재산 변동 문서를 아직 찾지 못했습니다.</p>
        </div>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="activity-asset-card" aria-label="재산 공개 정보">
        <div className="activity-drawer__section-head">
          <div>
            <p className="section-label">재산 공개</p>
            <h3>재산 변동 이력을 불러오는 중입니다</h3>
          </div>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="activity-asset-card" aria-label="재산 공개 정보">
        <div className="activity-drawer__section-head">
          <div>
            <p className="section-label">재산 공개</p>
            <h3>재산 변동 이력을 불러오지 못했습니다</h3>
          </div>
        </div>
        <div className="activity-drawer__empty">
          <p>{error}</p>
          {onRetry ? (
            <button type="button" onClick={onRetry}>
              다시 시도
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  if (!history || history.series.length === 0) {
    return (
      <section className="activity-asset-card" aria-label="재산 공개 정보">
        <div className="activity-drawer__section-head">
          <div>
            <p className="section-label">재산 공개</p>
            <h3>재산 변동 이력이 아직 없습니다</h3>
          </div>
        </div>
      </section>
    );
  }

  const chartRows = buildAssetChartRows(activeHistory, visibleCategoryKeys);
  const visibleSeries = orderedCategorySeries.filter((series) =>
    visibleCategoryKeys.includes(series.categoryKey)
  );
  const extraSeries = orderedCategorySeries.slice(4);

  return (
    <section className="activity-asset-card" aria-label="재산 공개 정보">
      <div className="activity-drawer__section-head">
        <div>
          <p className="section-label">재산 공개</p>
          <h3>22대 국회 재산 변동 흐름</h3>
        </div>
        <p>
          총재산을 기본선으로 두고, 주요 카테고리 소계를 겹쳐 볼 수 있습니다. 부동산 포커스는
          건물과 토지만 따로 집계합니다. 단위는 천원입니다.
        </p>
      </div>

      {history?.selfOnly ? (
        <div className="activity-asset-scope" aria-label="공개 범위 비교">
          <div className="activity-asset-scope__head">
            <div>
              <p className="section-label">공개 범위 비교</p>
              <h4>본인만과 가족 포함 기준을 나눠 볼 수 있습니다</h4>
            </div>
            <div className="activity-asset-toggle-group" aria-label="재산 공개 범위">
              <button
                type="button"
                className={
                  assetScopeMode === "familyIncluded"
                    ? "activity-asset-toggle is-active"
                    : "activity-asset-toggle"
                }
                onClick={() => setAssetScopeMode("familyIncluded")}
              >
                가족 포함
              </button>
              <button
                type="button"
                className={
                  assetScopeMode === "selfOnly"
                    ? "activity-asset-toggle is-active"
                    : "activity-asset-toggle"
                }
                onClick={() => setAssetScopeMode("selfOnly")}
              >
                본인만
              </button>
            </div>
          </div>

          <dl className="activity-asset-scope__summary">
            <div>
              <dt>현재 보기</dt>
              <dd>{activeScopeLabel}</dd>
            </div>
            <div>
              <dt>본인 외 가족분</dt>
              <dd>{formatAssetDelta(familyGapLatest ?? 0)}</dd>
            </div>
            <div>
              <dt>차이 읽는 법</dt>
              <dd className="activity-asset-scope__text">{describeFamilyGap(familyGapLatest ?? 0)}</dd>
            </div>
          </dl>

          <p className="activity-asset-scope__note">
            본인만은 관계가 <code>본인</code>으로 파싱된 항목만 더한 값입니다. 차이의 절대값이
            클수록 가족 포함 여부가 총액을 크게 바꾸므로, 가족 명의 자산·채무 구성을 더 살펴볼
            필요가 있습니다.
          </p>
        </div>
      ) : null}

      {realEstateFocus && (realEstateFocus.hasExplicitCategory || realEstateFocus.hasMixedCategory) ? (
        <div className="activity-asset-focus" aria-label="부동산 포커스">
          <div className="activity-asset-focus__head">
            <div>
              <p className="section-label">부동산 포커스</p>
              <h4>건물과 토지를 따로 읽을 수 있게 묶었습니다</h4>
            </div>
            <p>
              {realEstateFocus.hasMixedCategory
                ? "혼합 자산군은 자동차 등 다른 자산이 함께 묶일 수 있어 부동산 합계에서 제외했습니다."
                : "건물과 토지는 최신 공개 시점 기준으로 따로 합산했습니다."}
            </p>
          </div>

          <dl className="activity-asset-focus__summary">
            <div>
              <dt>부동산 합계</dt>
              <dd>{formatAssetAmount(realEstateFocus.latestAmount)}</dd>
            </div>
            <div>
              <dt>22대 부동산 증감</dt>
              <dd>{formatAssetDelta(realEstateFocus.deltaAmount)}</dd>
            </div>
            <div>
              <dt>건물</dt>
              <dd>{formatAssetAmount(realEstateFocus.buildingAmount)}</dd>
            </div>
            <div>
              <dt>토지</dt>
              <dd>{formatAssetAmount(realEstateFocus.landAmount)}</dd>
            </div>
          </dl>
        </div>
      ) : null}

      <dl className="activity-asset-summary">
        <div>
          <dt>최신 총재산</dt>
          <dd>{formatAssetAmount(activeLatestTotal)}</dd>
        </div>
        <div>
          <dt>22대 누적 증감</dt>
          <dd>{formatAssetDelta(activeTotalDelta)}</dd>
        </div>
        <div>
          <dt>첫 공개일</dt>
          <dd>{formatDate(indexEntry.firstDisclosureDate)}</dd>
        </div>
        <div>
          <dt>최신 공개일</dt>
          <dd>{formatDate(indexEntry.latestDisclosureDate)}</dd>
        </div>
      </dl>

      <div className="activity-asset-chart">
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={chartRows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="rgba(35, 49, 58, 0.08)" strokeDasharray="4 4" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12, fill: "var(--ink-muted)" }}
            />
            <YAxis
              tickFormatter={(value) => `${Math.round(Number(value) / 1000)}M`}
              tickLine={false}
              axisLine={false}
              width={52}
              tick={{ fontSize: 12, fill: "var(--ink-muted)" }}
            />
            <Tooltip
              formatter={(value, name) => {
                const amount = Array.isArray(value) ? Number(value[0] ?? 0) : Number(value ?? 0);
                const seriesKey = String(name ?? "");

                return [
                  formatAssetAmount(amount),
                  seriesKey === "total"
                    ? `총재산 (${activeScopeLabel})`
                    : orderedCategorySeries.find((series) => series.categoryKey === seriesKey)
                        ?.categoryLabel ?? seriesKey
                ] as [string, string];
              }}
              labelFormatter={(value) => `공개일 ${value}`}
            />
            <Legend
              formatter={(value) =>
                value === "total"
                  ? `총재산 (${activeScopeLabel})`
                  : orderedCategorySeries.find((series) => series.categoryKey === value)?.categoryLabel ?? value
              }
            />
            <Line
              type="monotone"
              dataKey="total"
              name="total"
              stroke="#972d20"
              strokeWidth={3}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
            {visibleSeries.map((series, index) => (
              <Line
                key={series.categoryKey}
                type="monotone"
                dataKey={series.categoryKey}
                name={series.categoryKey}
                stroke={assetCategoryPalette[index % assetCategoryPalette.length]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {orderedCategorySeries.length > 0 ? (
        <div className="activity-asset-toggles">
          <div className="activity-asset-toggle-group" aria-label="주요 재산 카테고리">
            {orderedCategorySeries.slice(0, 4).map((series) => {
              const isActive = visibleCategoryKeys.includes(series.categoryKey);
              return (
                <button
                  key={series.categoryKey}
                  type="button"
                  className={isActive ? "activity-asset-toggle is-active" : "activity-asset-toggle"}
                  onClick={() =>
                    setVisibleCategoryKeys((current) =>
                      current.includes(series.categoryKey)
                        ? current.filter((value) => value !== series.categoryKey)
                        : [...current, series.categoryKey]
                    )
                  }
                >
                  {series.categoryLabel}
                </button>
              );
            })}
          </div>

          {extraSeries.length > 0 ? (
            <div className="activity-asset-extra">
              <button
                type="button"
                className="activity-asset-extra-toggle"
                onClick={() => setShowAllCategories((current) => !current)}
              >
                {showAllCategories ? "나머지 카테고리 접기" : "나머지 카테고리 보기"}
              </button>

              {showAllCategories ? (
                <div className="activity-asset-toggle-group" aria-label="추가 재산 카테고리">
                  {extraSeries.map((series) => {
                    const isActive = visibleCategoryKeys.includes(series.categoryKey);
                    return (
                      <button
                        key={series.categoryKey}
                        type="button"
                        className={isActive ? "activity-asset-toggle is-active" : "activity-asset-toggle"}
                        onClick={() =>
                          setVisibleCategoryKeys((current) =>
                            current.includes(series.categoryKey)
                              ? current.filter((value) => value !== series.categoryKey)
                              : [...current, series.categoryKey]
                          )
                        }
                      >
                        {series.categoryLabel}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ActivityRatioChart({
  member
}: {
  member: MemberActivityCalendarMember;
}) {
  const data = buildRatioData(member);

  return (
    <section className="activity-ratio-card" aria-label="활동 비율">
      <div className="activity-ratio-card__header">
        <h4>활동 비율</h4>
        <p>캘린더 날짜 기준 비율</p>
      </div>
      <div className="activity-ratio-card__body">
        <div className="activity-ratio-card__chart">
          <ResponsiveContainer width="100%" height={ACTIVITY_RATIO_CHART_HEIGHT}>
            <RadarChart data={data} outerRadius="72%">
              <PolarGrid stroke="rgba(23, 20, 17, 0.12)" />
              <PolarAngleAxis dataKey="label" tick={renderRatioAxisTick} />
              <PolarRadiusAxis
                axisLine={false}
                tickLine={false}
                tick={false}
                domain={[0, 100]}
              />
              <Radar
                dataKey="percent"
                stroke="var(--accent)"
                fill="rgba(152, 45, 34, 0.2)"
                fillOpacity={1}
                strokeWidth={2}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>
        <ul className="activity-ratio-card__list">
          {data.map((item) => (
            <li key={item.label}>
              <span className="activity-ratio-card__label">
                <i style={{ background: item.color }} />
                {item.label}
              </span>
              <strong>{`${formatNumber(item.percent)}%`}</strong>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function ActivityCompareRatioChart({
  leftMember,
  rightMember
}: {
  leftMember: MemberActivityCalendarMember;
  rightMember: MemberActivityCalendarMember;
}) {
  const leftData = buildRatioData(leftMember);
  const rightData = buildRatioData(rightMember);
  const compareData: CompareRatioDatum[] = leftData.map((item, index) => ({
    label: item.label,
    axisColor: item.color,
    leftPercent: item.percent,
    rightPercent: rightData[index]?.percent ?? 0
  }));

  return (
    <section className="activity-ratio-card activity-ratio-card--compare" aria-label="비율 비교">
      <div className="activity-ratio-card__header">
        <h4>비율 비교</h4>
        <p>캘린더 날짜 기준 비율</p>
      </div>
      <div className="activity-ratio-compare__legend">
        <div className="activity-ratio-compare__legend-item activity-ratio-compare__legend-item--left">
          <span className="activity-ratio-compare__legend-kicker">기준 의원</span>
          <strong className="activity-ratio-compare__legend-name">
            <i style={{ background: compareRatioColors.leftStroke }} />
            <span>{leftMember.name}</span>
          </strong>
        </div>
        <div className="activity-ratio-compare__legend-item activity-ratio-compare__legend-item--right">
          <span className="activity-ratio-compare__legend-kicker">비교 의원</span>
          <strong className="activity-ratio-compare__legend-name">
            <i style={{ background: compareRatioColors.rightStroke }} />
            <span>{rightMember.name}</span>
          </strong>
        </div>
      </div>
      <div className="activity-ratio-card__body activity-ratio-card__body--compare">
        <div className="activity-ratio-card__chart">
          <ResponsiveContainer width="100%" height={ACTIVITY_RATIO_CHART_HEIGHT}>
            <RadarChart data={compareData} outerRadius="72%">
              <PolarGrid stroke="rgba(23, 20, 17, 0.12)" />
              <PolarAngleAxis dataKey="label" tick={renderRatioAxisTick} />
              <PolarRadiusAxis
                axisLine={false}
                tickLine={false}
                tick={false}
                domain={[0, 100]}
              />
              <Radar
                dataKey="leftPercent"
                stroke={compareRatioColors.leftStroke}
                fill={compareRatioColors.leftFill}
                fillOpacity={1}
                strokeWidth={2}
              />
              <Radar
                dataKey="rightPercent"
                stroke={compareRatioColors.rightStroke}
                fill={compareRatioColors.rightFill}
                fillOpacity={1}
                strokeWidth={2}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>
        <div className="activity-ratio-compare__table" role="table" aria-label="비율 비교 표">
          <div className="activity-ratio-compare__row activity-ratio-compare__row--head" role="row">
            <span className="activity-ratio-compare__metric-header" role="columnheader">
              항목
            </span>
            <div className="activity-ratio-compare__values activity-ratio-compare__values--head">
              <span role="columnheader">{leftMember.name}</span>
              <span role="columnheader">{rightMember.name}</span>
            </div>
          </div>
          {compareData.map((item) => (
            <div key={item.label} className="activity-ratio-compare__row" role="row">
              <span className="activity-ratio-card__label activity-ratio-compare__metric" role="rowheader">
                <i style={{ background: item.axisColor }} />
                {item.label}
              </span>
              <div className="activity-ratio-compare__values">
                <div
                  className="activity-ratio-compare__cell activity-ratio-compare__cell--left"
                  role="cell"
                >
                  <span className="activity-ratio-compare__cell-label">
                    기준
                    <span className="sr-only">{` ${leftMember.name}`}</span>
                  </span>
                  <strong>{`${formatNumber(item.leftPercent)}%`}</strong>
                </div>
                <div
                  className="activity-ratio-compare__cell activity-ratio-compare__cell--right"
                  role="cell"
                >
                  <span className="activity-ratio-compare__cell-label">
                    비교
                    <span className="sr-only">{` ${rightMember.name}`}</span>
                  </span>
                  <strong>{`${formatNumber(item.rightPercent)}%`}</strong>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ActivityVoteRecordSections({
  records,
  recordCount,
  loading,
  error,
  onRetry
}: {
  records: MemberActivityVoteRecord[];
  recordCount: number;
  loading: boolean;
  error: string | null;
  onRetry: (() => void) | null;
}) {
  const resolvedRecordCount = Math.max(recordCount, records.length);
  const isPendingRemoteLoad = resolvedRecordCount > records.length && !loading && !error;
  const groupedRecordDefinitions: Array<{
    voteCode: MemberActivityVoteRecord["voteCode"];
    label: string;
    records: MemberActivityVoteRecord[];
  }> = [
    {
      voteCode: "yes",
      label: "찬성",
      records: records.filter((record) => record.voteCode === "yes")
    },
    {
      voteCode: "no",
      label: "반대",
      records: records.filter((record) => record.voteCode === "no")
    },
    {
      voteCode: "abstain",
      label: "기권",
      records: records.filter((record) => record.voteCode === "abstain")
    },
    {
      voteCode: "absent",
      label: "불참",
      records: records.filter((record) => record.voteCode === "absent")
    }
  ];
  const groupedRecords: Array<{
    voteCode: MemberActivityVoteRecord["voteCode"];
    label: string;
    records: MemberActivityVoteRecord[];
    previewRecords: MemberActivityVoteRecord[];
    hiddenRecords: MemberActivityVoteRecord[];
  }> = groupedRecordDefinitions
    .map((group) => ({
      ...group,
      previewRecords: group.records.slice(0, INITIAL_VISIBLE_VOTE_RECORDS_PER_GROUP),
      hiddenRecords: group.records.slice(INITIAL_VISIBLE_VOTE_RECORDS_PER_GROUP)
    }))
    .filter((group) => group.records.length > 0);
  const hasCollapsedGroups = groupedRecords.some((group) => group.hiddenRecords.length > 0);

  if (resolvedRecordCount === 0 && !loading && !error) {
    return null;
  }

  return (
    <section className="activity-vote-records" aria-label="의안별 표결 기록">
      <div className="activity-vote-records__header">
        <h4>의안별 표결 기록</h4>
        <p>
          {hasCollapsedGroups
            ? `해당 의원의 찬성·반대·기권·불참 의안을 최근 순으로 묶고, 각 그룹은 최근 ${formatNumber(INITIAL_VISIBLE_VOTE_RECORDS_PER_GROUP)}건만 먼저 보여줍니다. 총 ${formatNumber(resolvedRecordCount)}건`
            : `해당 의원의 찬성·반대·기권·불참 의안을 최근 순으로 봅니다. 총 ${formatNumber(resolvedRecordCount)}건`}
        </p>
      </div>
      {loading || isPendingRemoteLoad ? (
        <p className="activity-drawer__empty">전체 표결 기록을 불러오는 중입니다…</p>
      ) : null}
      {!loading && !isPendingRemoteLoad && error ? (
        <div className="activity-drawer__empty">
          <p>{error}</p>
          {onRetry ? (
            <button type="button" onClick={onRetry}>
              다시 시도
            </button>
          ) : null}
        </div>
      ) : null}
      {!loading && !isPendingRemoteLoad && !error && groupedRecords.length === 0 ? (
        <p className="activity-drawer__empty">표시할 찬성·반대·기권·불참 기록이 없습니다.</p>
      ) : null}
      {!loading && !isPendingRemoteLoad && !error && groupedRecords.length > 0 ? (
        <div className="activity-vote-records__groups">
          {groupedRecords.map((group) => (
            <section
              key={group.label}
              className={`activity-vote-records__group activity-vote-records__group--${group.voteCode}`}
              aria-label={`${group.label} 의안`}
            >
              <div className="activity-vote-records__group-header">
                <div className="activity-vote-records__group-copy">
                  <h5>{group.label}</h5>
                  {group.hiddenRecords.length > 0 ? (
                    <p>{`최근 ${formatNumber(group.previewRecords.length)}건만 먼저 표시합니다.`}</p>
                  ) : null}
                </div>
                <span className="activity-vote-records__count">
                  {`${formatNumber(group.records.length)}건`}
                </span>
              </div>
              <ul className="activity-vote-records__list">
                {group.previewRecords.map((record) => {
                  const content = (
                    <>
                      <span className="activity-vote-records__meta">
                        {record.committeeName
                          ? `${formatDate(record.voteDatetime)} · ${record.committeeName}`
                          : formatDate(record.voteDatetime)}
                      </span>
                      <strong>{record.billName}</strong>
                    </>
                  );

                  return (
                    <li key={`${group.label}:${record.rollCallId}`}>
                      {record.officialSourceUrl ? (
                        <a
                          href={record.officialSourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="activity-vote-records__item"
                        >
                          {content}
                        </a>
                      ) : (
                        <div className="activity-vote-records__item">{content}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
              {group.hiddenRecords.length > 0 ? (
                <details className="activity-vote-records__details">
                  <summary className="activity-vote-records__details-toggle">
                    {`나머지 ${formatNumber(group.hiddenRecords.length)}건 보기`}
                  </summary>
                  <ul className="activity-vote-records__list activity-vote-records__list--nested">
                    {group.hiddenRecords.map((record) => {
                      const content = (
                        <>
                          <span className="activity-vote-records__meta">
                            {record.committeeName
                              ? `${formatDate(record.voteDatetime)} · ${record.committeeName}`
                              : formatDate(record.voteDatetime)}
                          </span>
                          <strong>{record.billName}</strong>
                        </>
                      );

                      return (
                        <li key={`${group.label}:${record.rollCallId}`}>
                          {record.officialSourceUrl ? (
                            <a
                              href={record.officialSourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="activity-vote-records__item"
                            >
                              {content}
                            </a>
                          ) : (
                            <div className="activity-vote-records__item">{content}</div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </details>
              ) : null}
            </section>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function buildCommitteeCompositionStyle(
  value: number,
  total: number,
  colorVariable: string
): { width: string; background: string } {
  const width = total === 0 ? 0 : (value / total) * 100;
  return {
    width: `${width}%`,
    background: `var(${colorVariable})`
  };
}

function ActivityCommitteeSections({
  member
}: {
  member: MemberActivityCalendarMember;
}) {
  const committeeSummaries = (member.committeeSummaries ?? []).filter(
    (summary) => summary.eligibleRollCallCount >= 5
  );
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  if (committeeSummaries.length === 0) {
    return null;
  }

  const mostResponsiveCommittees = [...committeeSummaries].sort((left, right) => {
    if (right.participationRate !== left.participationRate) {
      return right.participationRate - left.participationRate;
    }

    if (right.eligibleRollCallCount !== left.eligibleRollCallCount) {
      return right.eligibleRollCallCount - left.eligibleRollCallCount;
    }

    return left.committeeName.localeCompare(right.committeeName, "ko-KR");
  });
  const leastResponsiveCommittees = [...committeeSummaries].sort((left, right) => {
    if (left.participationRate !== right.participationRate) {
      return left.participationRate - right.participationRate;
    }

    if (right.eligibleRollCallCount !== left.eligibleRollCallCount) {
      return right.eligibleRollCallCount - left.eligibleRollCallCount;
    }

    return left.committeeName.localeCompare(right.committeeName, "ko-KR");
  });

  const sections = [
    {
      id: "most-responsive",
      title: "관심 높은 위원회",
      description: "참여율 높은 순",
      summaries: mostResponsiveCommittees
    },
    {
      id: "least-responsive",
      title: "무관심한 위원회",
      description: "참여율 낮은 순",
      summaries: leastResponsiveCommittees
    }
  ];
  const visibleCommitteeCount = Math.min(
    INITIAL_VISIBLE_COMMITTEE_COUNT,
    committeeSummaries.length
  );

  return (
    <section className="activity-committee-sections" aria-label="위원회 반응도">
      <div className="activity-committee-sections__header">
        <h4>위원회 반응도</h4>
        <p>
          {`대상 표결 5건 이상 위원회 ${formatNumber(committeeSummaries.length)}곳 중 상위·하위 ${formatNumber(visibleCommitteeCount)}곳만 먼저 보여주고, 나머지는 필요할 때 펼칩니다.`}
        </p>
      </div>
      <div className="activity-committee-sections__groups">
        {sections.map((section) => {
          const isExpanded = expandedSections[section.id] ?? false;
          const visibleSummaries = isExpanded
            ? section.summaries
            : section.summaries.slice(0, INITIAL_VISIBLE_COMMITTEE_COUNT);
          const hiddenCount = Math.max(section.summaries.length - visibleSummaries.length, 0);
          const listId = `activity-committee-list-${section.id}`;

          return (
            <section
              key={section.id}
              className="activity-committee-sections__group"
              aria-label={section.title}
            >
              <div className="activity-committee-sections__group-header">
                <div className="activity-committee-sections__group-copy">
                  <h5>{section.title}</h5>
                  <p>{section.description}</p>
                </div>
                <span className="activity-committee-sections__count">
                  {`${formatNumber(visibleSummaries.length)} / ${formatNumber(section.summaries.length)}곳`}
                </span>
              </div>
              <ul id={listId} className="activity-committee-sections__list">
                {visibleSummaries.map((summary) => {
                  const participatedCount =
                    summary.yesCount + summary.noCount + summary.abstainCount;

                  return (
                    <li key={`${section.title}:${summary.committeeName}`}>
                      <article className="activity-committee-card">
                        <div className="activity-committee-card__header">
                          <div className="activity-committee-card__title-row">
                            <h6>{summary.committeeName}</h6>
                            {summary.isCurrentCommittee ? (
                              <span className="activity-committee-card__badge">소속 위원회</span>
                            ) : null}
                          </div>
                          <strong>{`${formatNumber(Math.round(summary.participationRate * 100))}%`}</strong>
                        </div>
                        <p className="activity-committee-card__meta">
                          {`참여 ${formatNumber(summary.participatedRollCallCount)} / 대상 ${formatNumber(summary.eligibleRollCallCount)} · 불참 ${formatNumber(summary.absentRollCallCount)}`}
                        </p>
                        <div className="activity-committee-card__bar" aria-hidden="true">
                          <span
                            style={buildCommitteeCompositionStyle(
                              summary.yesCount,
                              participatedCount,
                              "--vote-yes"
                            )}
                          />
                          <span
                            style={buildCommitteeCompositionStyle(
                              summary.noCount,
                              participatedCount,
                              "--vote-no"
                            )}
                          />
                          <span
                            style={buildCommitteeCompositionStyle(
                              summary.abstainCount,
                              participatedCount,
                              "--vote-abstain"
                            )}
                          />
                        </div>
                        {summary.recentVoteRecords.length > 0 ? (
                          <details className="activity-committee-card__details">
                            <summary className="activity-committee-card__details-toggle">
                              {`최근 대표 의안 ${formatNumber(summary.recentVoteRecords.length)}건 보기`}
                            </summary>
                            <ul className="activity-committee-card__records">
                              {summary.recentVoteRecords.map((record) => {
                                const recordDateLabel = formatDate(record.voteDatetime);
                                const detailLabel = formatVoteCodeLabel(record.voteCode);
                                const recordContent = (
                                  <>
                                    <span className="activity-committee-card__record-copy">
                                      <span className="activity-committee-card__record-meta">
                                        {recordDateLabel}
                                      </span>
                                      <strong className="activity-committee-card__record-title">
                                        {record.billName}
                                      </strong>
                                    </span>
                                    <em>{detailLabel}</em>
                                  </>
                                );

                                return (
                                  <li key={`${summary.committeeName}:${record.rollCallId}`}>
                                    {record.officialSourceUrl ? (
                                      <a
                                        href={record.officialSourceUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="activity-committee-card__record-link"
                                      >
                                        {recordContent}
                                      </a>
                                    ) : (
                                      <div className="activity-committee-card__record-link">
                                        {recordContent}
                                      </div>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          </details>
                        ) : null}
                      </article>
                    </li>
                  );
                })}
              </ul>
              {section.summaries.length > INITIAL_VISIBLE_COMMITTEE_COUNT ? (
                <button
                  type="button"
                  className="activity-committee-sections__toggle"
                  aria-controls={listId}
                  aria-expanded={isExpanded}
                  onClick={() =>
                    setExpandedSections((current) => ({
                      ...current,
                      [section.id]: !isExpanded
                    }))
                  }
                >
                  {isExpanded
                    ? `처음 ${formatNumber(visibleCommitteeCount)}곳만 보기`
                    : `나머지 ${formatNumber(hiddenCount)}곳 더 보기`}
                </button>
              ) : null}
            </section>
          );
        })}
      </div>
    </section>
  );
}

function ContributionCalendar({
  assembly,
  member,
  compact = false
}: {
  assembly: MemberActivityCalendarAssembly;
  member: MemberActivityCalendarMember;
  compact?: boolean;
}) {
  const weeks = buildCalendarWeeks(assembly, member);
  const monthLabels = buildMonthLabels(weeks);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startClientX: number;
    startScrollLeft: number;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const className = [
    "contribution-calendar",
    compact ? "contribution-calendar--compact" : ""
  ]
    .filter(Boolean)
    .join(" ");

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return undefined;
    }

    const scrollToLatest = () => {
      viewport.scrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    };

    scrollToLatest();
    const frame = window.requestAnimationFrame(scrollToLatest);

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [assembly.assemblyNo, member.memberId, weeks.length]);

  function stopDragging(pointerId?: number): void {
    const viewport = viewportRef.current;
    const dragState = dragStateRef.current;
    if (!dragState) {
      return;
    }

    if (
      viewport &&
      typeof viewport.releasePointerCapture === "function" &&
      pointerId !== undefined &&
      viewport.hasPointerCapture(pointerId)
    ) {
      viewport.releasePointerCapture(pointerId);
    }

    dragStateRef.current = null;
    setIsDragging(false);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.pointerType !== "mouse" || event.button !== 0) {
      return;
    }

    const viewport = viewportRef.current;
    if (!viewport || viewport.scrollWidth <= viewport.clientWidth) {
      return;
    }

    dragStateRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startScrollLeft: viewport.scrollLeft
    };
    if (typeof viewport.setPointerCapture === "function") {
      viewport.setPointerCapture(event.pointerId);
    }
    setIsDragging(true);
    event.preventDefault();
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const viewport = viewportRef.current;
    const dragState = dragStateRef.current;
    if (!viewport || !dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    viewport.scrollLeft =
      dragState.startScrollLeft - (event.clientX - dragState.startClientX);
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    stopDragging(event.pointerId);
  }

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>): void {
    const viewport = viewportRef.current;
    if (!viewport || viewport.scrollWidth <= viewport.clientWidth) {
      return;
    }

    const horizontalDelta =
      Math.abs(event.deltaX) > 0 ? event.deltaX : Math.abs(event.deltaY) > 0 ? event.deltaY : 0;
    if (horizontalDelta === 0) {
      return;
    }

    viewport.scrollLeft += horizontalDelta;
    event.preventDefault();
  }

  return (
    <div className={className}>
      <div className="contribution-calendar__legend" aria-label="대표 상태 범례">
        <ul className="contribution-calendar__legend-list">
          {[
            { state: "yes", label: "찬성" },
            { state: "no", label: "반대" },
            { state: "abstain", label: "기권" },
            { state: "absent", label: "불참" },
            { state: "empty", label: "표결 없음" }
          ].map((item) => (
            <li key={item.label} className="contribution-calendar__legend-chip">
              <i
                className={`contribution-calendar__legend-swatch contribution-calendar__legend-swatch--${item.state}`}
                aria-hidden="true"
              />
              <span>{item.label}</span>
            </li>
          ))}
        </ul>
        <p className="contribution-calendar__legend-note">
          {compact ? "가로 스크롤로 최근 날짜를 확인합니다." : "좌우로 스크롤해 최근 날짜까지 확인합니다."}
        </p>
      </div>
      <div
        ref={viewportRef}
        className={
          isDragging
            ? "contribution-calendar__viewport contribution-calendar__viewport--dragging"
            : "contribution-calendar__viewport"
        }
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
      >
        <div className="contribution-calendar__content">
          <div className="contribution-calendar__months" aria-hidden="true">
            <span className="contribution-calendar__month-spacer" />
            <div className="contribution-calendar__month-track">
              {monthLabels.map((label, index) => (
                <span key={`${assembly.assemblyNo}:${index}`} className="contribution-calendar__month">
                  {label}
                </span>
              ))}
            </div>
          </div>
          <div className="contribution-calendar__body">
            <div className="contribution-calendar__weekdays" aria-hidden="true">
              {weekdayLabels.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
            <div className="contribution-calendar__weeks">
              {weeks.map((week, index) => (
                <div key={`${assembly.assemblyNo}:${index}`} className="contribution-calendar__week">
                  {week.days.map((cell, dayIndex) => (
                    <span
                      key={`${assembly.assemblyNo}:${index}:${dayIndex}:${cell.date ?? "empty"}`}
                      className={`contribution-calendar__cell contribution-calendar__cell--${cell.state}`}
                      title={getCalendarCellLabel(cell)}
                      aria-label={getCalendarCellLabel(cell)}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ActivityCalendarPage({
  activityCalendar,
  loading,
  error,
  assemblyLabel,
  initialMemberId,
  initialCompareMemberId,
  initialView = "single",
  memberDetails,
  memberDetailErrors,
  memberDetailLoading,
  memberAssetsIndex,
  memberAssetsIndexError,
  memberAssetHistories,
  memberAssetHistoryErrors,
  memberAssetHistoryLoading,
  onEnsureMemberDetail,
  onRetryMemberDetail,
  onEnsureMemberAssetHistory,
  onRetryMemberAssetHistory,
  onBack,
  onRetry
}: ActivityCalendarPageProps) {
  const [activeView, setActiveView] = useState<ActivityViewMode>(initialView);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [compareMemberId, setCompareMemberId] = useState<string | null>(null);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const hasInitializedSelectedMemberRef = useRef(false);
  const lastAppliedRouteMemberIdRef = useRef<string | null | undefined>(undefined);

  const selectedAssembly = activityCalendar?.assembly ?? null;
  const rankedMembers = selectedAssembly ? rankActivityMembers(selectedAssembly, true) : [];
  const compareCandidates = rankedMembers.filter((member) => member.memberId !== selectedMemberId);
  const memberOptions = rankedMembers.map((member) => ({
    id: member.memberId,
    label: `${member.name} · ${member.party}`
  }));
  const compareOptions = compareCandidates.map((member) => ({
    id: member.memberId,
    label: `${member.name} · ${member.party}`
  }));

  useEffect(() => {
    setActiveView(initialView);
  }, [initialView]);

  useEffect(() => {
    if (!selectedAssembly || rankedMembers.length === 0) {
      setSelectedMemberId(null);
      hasInitializedSelectedMemberRef.current = false;
      lastAppliedRouteMemberIdRef.current = undefined;
      return;
    }

    const routeMemberId =
      initialMemberId && rankedMembers.some((member) => member.memberId === initialMemberId)
        ? initialMemberId
        : null;
    const routeChanged = routeMemberId !== lastAppliedRouteMemberIdRef.current;

    if (!hasInitializedSelectedMemberRef.current || routeChanged) {
      hasInitializedSelectedMemberRef.current = true;
      lastAppliedRouteMemberIdRef.current = routeMemberId;

      setSelectedMemberId((currentSelectedId) => {
        if (routeMemberId) {
          return routeMemberId;
        }

        if (
          currentSelectedId &&
          rankedMembers.some((member) => member.memberId === currentSelectedId)
        ) {
          return currentSelectedId;
        }

        return rankedMembers[0]?.memberId ?? null;
      });
      return;
    }

    setSelectedMemberId((currentSelectedId) => {
      if (currentSelectedId === null) {
        return null;
      }

      if (
        currentSelectedId &&
        rankedMembers.some((member) => member.memberId === currentSelectedId)
      ) {
        return currentSelectedId;
      }

      return routeMemberId ?? rankedMembers[0]?.memberId ?? null;
    });
  }, [initialMemberId, rankedMembers, selectedAssembly]);

  const selectedMember = getMemberById(selectedAssembly, selectedMemberId);
  const selectedMemberDetail = selectedMember ? memberDetails[selectedMember.memberId] ?? null : null;
  const selectedMemberDetailError = selectedMember
    ? memberDetailErrors[selectedMember.memberId] ?? null
    : null;
  const selectedMemberDetailLoading = selectedMember
    ? Boolean(memberDetailLoading[selectedMember.memberId])
    : false;
  const selectedMemberAssetIndex = selectedMember
    ? memberAssetsIndex?.members.find((entry) => entry.memberId === selectedMember.memberId) ?? null
    : null;
  const selectedMemberAssetHistory = selectedMember
    ? memberAssetHistories[selectedMember.memberId] ?? null
    : null;
  const selectedMemberAssetHistoryError = selectedMember
    ? memberAssetHistoryErrors[selectedMember.memberId] ?? null
    : null;
  const selectedMemberAssetHistoryLoading = selectedMember
    ? Boolean(memberAssetHistoryLoading[selectedMember.memberId])
    : false;
  const compareMember = getMemberById(selectedAssembly, compareMemberId);
  const comparisonSummary =
    selectedAssembly && selectedMember && compareMember
      ? buildHeadToHeadSummary(selectedAssembly, selectedMember, compareMember, true)
      : null;
  const selectedBreakdown = selectedMember ? getMemberDayBreakdown(selectedMember) : null;
  const compareBreakdown = compareMember ? getMemberDayBreakdown(compareMember) : null;
  const compareMetrics =
    selectedMember && compareMember && selectedBreakdown && compareBreakdown && comparisonSummary
      ? [
          buildCompareMetricCard(
            currentRunLabel,
            selectedMember,
            compareMember,
            comparisonSummary.leftCurrentStreak,
            comparisonSummary.rightCurrentStreak,
            "higher"
          ),
          buildCompareMetricCard(
            longestRunLabel,
            selectedMember,
            compareMember,
            comparisonSummary.leftLongestStreak,
            comparisonSummary.rightLongestStreak,
            "higher"
          ),
          buildCompareMetricCard(
            "반대",
            selectedMember,
            compareMember,
            selectedBreakdown.noDays,
            compareBreakdown.noDays,
            "higher"
          ),
          buildCompareMetricCard(
            "기권",
            selectedMember,
            compareMember,
            selectedBreakdown.abstainDays,
            compareBreakdown.abstainDays,
            "higher"
          ),
          buildCompareMetricCard(
            "불참",
            selectedMember,
            compareMember,
            selectedBreakdown.absentDays,
            compareBreakdown.absentDays,
            "higher"
          ),
          buildCompareMetricCard(
            "찬성",
            selectedMember,
            compareMember,
            selectedBreakdown.yesDays,
            compareBreakdown.yesDays,
            "lower"
          )
        ]
      : [];

  useEffect(() => {
    if (!selectedAssembly || !selectedMember) {
      setCompareMemberId(null);
      return;
    }

    const availableCompareMembers = selectedAssembly.members.filter(
      (member) => member.memberId !== selectedMember.memberId
    );

    if (availableCompareMembers.length === 0) {
      setCompareMemberId(null);
      return;
    }

    const preferredCompareId =
      initialCompareMemberId &&
      initialCompareMemberId !== selectedMember.memberId &&
      availableCompareMembers.some((member) => member.memberId === initialCompareMemberId)
        ? initialCompareMemberId
        : null;

    setCompareMemberId((currentCompareId) => {
      if (preferredCompareId && currentCompareId !== preferredCompareId) {
        return preferredCompareId;
      }

      if (
        currentCompareId &&
        currentCompareId !== selectedMember.memberId &&
        availableCompareMembers.some((member) => member.memberId === currentCompareId)
      ) {
        return currentCompareId;
      }

      return null;
    });
  }, [initialCompareMemberId, selectedAssembly, selectedMember]);

  useEffect(() => {
    if (activeView !== "single" || !selectedMember) {
      return;
    }

    if (selectedMemberDetail || selectedMemberDetailLoading || selectedMemberDetailError) {
      return;
    }

    void onEnsureMemberDetail(selectedMember);
  }, [
    activeView,
    selectedMember,
    selectedMemberDetail,
    selectedMemberDetailError,
    selectedMemberDetailLoading,
    onEnsureMemberDetail
  ]);

  useEffect(() => {
    if (activeView !== "single" || !selectedMember || !selectedMemberAssetIndex) {
      return;
    }

    if (
      selectedMemberAssetHistory ||
      selectedMemberAssetHistoryLoading ||
      selectedMemberAssetHistoryError
    ) {
      return;
    }

    void onEnsureMemberAssetHistory(selectedMember);
  }, [
    activeView,
    selectedMember,
    selectedMemberAssetIndex,
    selectedMemberAssetHistory,
    selectedMemberAssetHistoryError,
    selectedMemberAssetHistoryLoading,
    onEnsureMemberAssetHistory
  ]);

  function buildShareUrl(): string | null {
    if (!selectedMember || activeView !== "single") {
      return null;
    }

    const hash = buildCalendarHref({
      memberId: selectedMember.memberId,
      view: "single"
    });

    if (typeof window === "undefined") {
      return hash;
    }

    const url = new URL(window.location.href);
    url.hash = hash.slice(1);
    return url.toString();
  }

  async function handleShare(): Promise<void> {
    const shareUrl = buildShareUrl();
    if (!selectedAssembly || !selectedMember || !shareUrl) {
      return;
    }

    setIsSharing(true);
    setShareError(null);
    setShareNotice(null);

    try {
      const title = `${selectedMember.name} 활동 캘린더`;
      const text = `${selectedAssembly.label} 활동 캘린더 링크입니다.`;

      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({
          title,
          text,
          url: shareUrl
        });
        return;
      }

      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        setShareNotice("현재 화면 링크를 복사했습니다.");
        return;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      setShareError("공유 링크를 준비하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setIsSharing(false);
    }
  }

  return (
    <section className="activity-page" aria-labelledby="activity-page-title">
      <header className="activity-page__masthead">
        <div>
          <p className="section-label">활동 캘린더</p>
          <h1 id="activity-page-title">의원 표결 활동 그래프</h1>
          <p className="activity-page__copy">
            {`${assemblyLabel ?? selectedAssembly?.label ?? "최신 국회"} 기준 개인 보기와 VS 비교`}
          </p>
        </div>
        <div className="activity-page__actions">
          <button
            type="button"
            className="activity-page__action-button activity-page__back"
            onClick={onBack}
            aria-label="홈으로"
            title="홈으로"
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path
                d="M3.9 9.1 10 4.2l6.1 4.9v6.2a1 1 0 0 1-1 1h-2.9v-4.7H7.8v4.7H4.9a1 1 0 0 1-1-1Z"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.7"
              />
            </svg>
          </button>
        </div>
      </header>

      <section className="activity-page__panel">
        <header className="activity-drawer__header">
          <div>
            <h2>{`${assemblyLabel ?? selectedAssembly?.label ?? "최신 국회"} 기준`}</h2>
          </div>
          <button
            type="button"
            className="activity-page__help-button"
            aria-label={isHelpOpen ? "설명 닫기" : "설명 보기"}
            aria-expanded={isHelpOpen}
            onClick={() => setIsHelpOpen((current) => !current)}
          >
            ?
          </button>
        </header>

        {isHelpOpen ? (
          <p className="activity-page__panel-copy activity-page__panel-copy--help">
            {runSummaryCopy}
          </p>
        ) : null}

        <div className="activity-drawer__tabs" role="tablist" aria-label="활동 분석 보기">
          <button
            type="button"
            role="tab"
            aria-selected={activeView === "single"}
            className={activeView === "single" ? "activity-drawer__tab is-active" : "activity-drawer__tab"}
            onClick={() => setActiveView("single")}
          >
            개인 분석
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeView === "compare"}
            className={activeView === "compare" ? "activity-drawer__tab is-active" : "activity-drawer__tab"}
            onClick={() => setActiveView("compare")}
          >
            VS 비교
          </button>
        </div>

        <div className="activity-drawer__toolbar">
          <MemberSearchField
            label="기준 의원 찾기"
            options={memberOptions}
            selectedId={selectedMemberId}
            onSelect={setSelectedMemberId}
            placeholder="다른 의원 이름 또는 정당을 입력하세요"
            className="activity-drawer__field activity-drawer__field--wide"
            disabled={memberOptions.length === 0}
          />
        </div>
        <p className="activity-drawer__toolbar-hint">
          입력값을 지우고 다른 이름이나 정당을 입력하면 기준 의원을 바꿀 수 있습니다.
        </p>

        {shareError ? <p className="error-banner">{shareError}</p> : null}
        {shareNotice ? <p className="info-banner">{shareNotice}</p> : null}

        {loading ? (
          <p className="activity-drawer__empty">활동 캘린더 데이터를 불러오는 중입니다…</p>
        ) : null}

        {!loading && error ? (
          <div className="activity-drawer__empty">
            <p>{error}</p>
            <button type="button" onClick={onRetry}>
              다시 시도
            </button>
          </div>
        ) : null}

        {!loading && !error && !selectedAssembly ? (
          <p className="activity-drawer__empty">활동 캘린더 데이터가 아직 발행되지 않았습니다.</p>
        ) : null}

        {!loading && !error && selectedAssembly ? (
          <div className="activity-drawer__content">
            <div className="activity-drawer__main activity-drawer__main--full">
              {activeView === "single" && selectedMember && selectedBreakdown ? (
                <>
                  <div className="activity-drawer__member-header">
                    <div className="activity-drawer__member-primary">
                      <div className="activity-drawer__identity-row">
                        <MemberIdentity
                          name={selectedMember.name}
                          party={selectedMember.party}
                          photoUrl={selectedMember.photoUrl}
                          calendarHref={buildCalendarHref({ memberId: selectedMember.memberId })}
                          size="large"
                        />
                        <div className="activity-page__member-actions">
                          <ExternalSiteLink url={selectedMember.officialExternalUrl} />
                          <button
                            type="button"
                            className="activity-page__action-button activity-page__share"
                            onClick={handleShare}
                            disabled={isSharing || !selectedAssembly || !selectedMember}
                            aria-label={isSharing ? "링크 준비 중" : "공유하기"}
                            title={isSharing ? "링크 준비 중" : "공유하기"}
                          >
                            <svg viewBox="0 0 20 20" aria-hidden="true">
                              <path
                                d="M8.1 6.3H6.6a2.8 2.8 0 0 0 0 5.5h1.5M11.9 6.3h1.5a2.8 2.8 0 1 1 0 5.5h-1.5M7.4 10h5.2"
                                fill="none"
                                stroke="currentColor"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth="1.7"
                              />
                            </svg>
                            <span>{isSharing ? "링크 준비 중" : "공유하기"}</span>
                          </button>
                        </div>
                      </div>
                      <p className="activity-drawer__member-copy">
                        {`반대 ${formatNumber(selectedBreakdown.noDays)}일 · 기권 ${formatNumber(selectedBreakdown.abstainDays)}일 · 불참 ${formatNumber(selectedBreakdown.absentDays)}일`}
                      </p>
                      <div className="activity-drawer__member-context">
                        <div className="activity-drawer__committee-memberships">
                          <strong>현재 소속 위원회</strong>
                          {selectedMember.committeeMemberships?.length ? (
                            <div className="activity-drawer__committee-chips">
                              {selectedMember.committeeMemberships.map((committeeName) => (
                                <span
                                  key={`${selectedMember.memberId}:${committeeName}`}
                                  className="activity-drawer__committee-chip"
                                >
                                  {committeeName}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <p className="activity-drawer__committee-fallback">위원회 소속 미확인</p>
                          )}
                        </div>
                        {selectedMember.homeCommitteeAlerts?.length ? (
                          <div className="activity-drawer__committee-alerts" aria-label="소속 위원회 주의">
                            {selectedMember.homeCommitteeAlerts.map((alert) => (
                              <div
                                key={`${selectedMember.memberId}:${alert.committeeName}`}
                                className="activity-drawer__committee-alert"
                              >
                                <strong>{alert.message}</strong>
                                <p>
                                  {`${alert.committeeName} 참여율 ${formatNumber(
                                    Math.round(alert.participationRate * 100)
                                  )}% (참여 ${formatNumber(alert.participatedRollCallCount)} / 대상 ${formatNumber(
                                    alert.eligibleRollCallCount
                                  )})`}
                                </p>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <dl className="activity-drawer__summary">
                      <div>
                        <dt>{currentRunLabel}</dt>
                        <dd>{formatNumber(getCurrentStreak(selectedMember, true))}</dd>
                      </div>
                      <div>
                        <dt>{longestRunLabel}</dt>
                        <dd>{formatNumber(getLongestStreak(selectedMember, true))}</dd>
                      </div>
                      <div>
                        <dt>반대한 날</dt>
                        <dd>{formatNumber(selectedBreakdown.noDays)}</dd>
                      </div>
                      <div>
                        <dt>불참한 날</dt>
                        <dd>{formatNumber(selectedBreakdown.absentDays)}</dd>
                      </div>
                    </dl>
                  </div>
                  <section className="activity-drawer__calendar-card" aria-label="활동 캘린더 요약">
                    <div className="activity-drawer__section-head">
                      <div>
                        <p className="section-label">대표 상태 캘린더</p>
                        <h3>최근 표결 날짜 흐름</h3>
                      </div>
                      <p>
                        최근 표결일을 하루 단위로 묶고, 같은 날 여러 표결이 있으면 대표 상태만 남겨 비교합니다.
                      </p>
                    </div>
                    <ContributionCalendar assembly={selectedAssembly} member={selectedMember} />
                  </section>
                  <ActivityRatioChart member={selectedMember} />
                  <MemberAssetSection
                    indexEntry={selectedMemberAssetIndex}
                    indexError={memberAssetsIndexError}
                    history={selectedMemberAssetHistory}
                    loading={selectedMemberAssetHistoryLoading}
                    error={selectedMemberAssetHistoryError}
                    onRetry={
                      selectedMember
                        ? () => onRetryMemberAssetHistory(selectedMember)
                        : null
                    }
                  />
                  <ActivityCommitteeSections member={selectedMember} />
                  <ActivityVoteRecordSections
                    records={selectedMemberDetail?.voteRecords ?? selectedMember.voteRecords ?? []}
                    recordCount={selectedMember.voteRecordCount}
                    loading={selectedMemberDetailLoading}
                    error={selectedMemberDetailError}
                    onRetry={
                      selectedMember
                        ? () => onRetryMemberDetail(selectedMember)
                        : null
                    }
                  />
                </>
              ) : null}

              {activeView === "compare" && selectedMember ? (
                <div className="activity-compare">
                  <header className="activity-compare__header">
                    <div>
                      <p className="section-label">같은 대수 기준 비교</p>
                      <h3>{`${selectedAssembly.label} 두 의원 비교`}</h3>
                    </div>
                  </header>

                  {compareCandidates.length > 0 ? (
                    <MemberSearchField
                      label="비교 의원 찾기"
                      options={compareOptions}
                      selectedId={compareMemberId}
                      onSelect={setCompareMemberId}
                      placeholder="비교할 의원 이름 또는 정당을 입력하세요"
                      className="activity-drawer__field activity-drawer__field--wide"
                      disabled={compareOptions.length === 0}
                    />
                  ) : null}

                  {compareMember ? (
                    <>
                      <section className="activity-compare__summary" aria-label="비교 요약">
                        {compareMetrics.map((metric, index) => (
                          <article
                            key={`${index}:${metric.summaryText}:${metric.detailText}`}
                            className={`activity-compare__summary-card activity-compare__summary-card--${metric.winner}`}
                          >
                            <p className="activity-compare__summary-kicker">{metric.badgeText}</p>
                            <p className="activity-compare__summary-copy">{metric.summaryText}</p>
                            <p className="activity-compare__summary-note">{metric.detailText}</p>
                          </article>
                        ))}
                      </section>

                      <div className="activity-compare__grid">
                        <section className="activity-compare__column">
                          <MemberIdentity
                            name={selectedMember.name}
                            party={selectedMember.party}
                            photoUrl={selectedMember.photoUrl}
                            calendarHref={buildCalendarHref({ memberId: selectedMember.memberId })}
                          />
                          <ExternalSiteLink url={selectedMember.officialExternalUrl} />
                          <ContributionCalendar
                            assembly={selectedAssembly}
                            member={selectedMember}
                            compact
                          />
                        </section>
                        <section className="activity-compare__column">
                          <MemberIdentity
                            name={compareMember.name}
                            party={compareMember.party}
                            photoUrl={compareMember.photoUrl}
                            calendarHref={buildCalendarHref({ memberId: compareMember.memberId })}
                          />
                          <ExternalSiteLink url={compareMember.officialExternalUrl} />
                          <ContributionCalendar
                            assembly={selectedAssembly}
                            member={compareMember}
                            compact
                          />
                        </section>
                      </div>

                      <ActivityCompareRatioChart
                        leftMember={selectedMember}
                        rightMember={compareMember}
                      />
                    </>
                  ) : (
                    <p className="activity-drawer__empty">같은 대수 안에서 비교할 의원을 선택해 주세요.</p>
                  )}
                </div>
              ) : null}

              {!selectedMember ? (
                <p className="activity-drawer__empty">표시할 의원을 선택해 주세요.</p>
              ) : null}
            </div>
          </div>
        ) : null}

      </section>

    </section>
  );
}
