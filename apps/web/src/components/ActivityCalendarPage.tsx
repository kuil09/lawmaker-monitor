import { BuildingsIcon } from "@phosphor-icons/react/dist/csr/Buildings";
import { GlobeSimpleIcon } from "@phosphor-icons/react/dist/csr/GlobeSimple";
import { MinusIcon } from "@phosphor-icons/react/dist/csr/Minus";
import { MountainsIcon } from "@phosphor-icons/react/dist/csr/Mountains";
import { QuestionIcon } from "@phosphor-icons/react/dist/csr/Question";
import { TrendDownIcon } from "@phosphor-icons/react/dist/csr/TrendDown";
import { TrendUpIcon } from "@phosphor-icons/react/dist/csr/TrendUp";
import {
  useEffect,
  useRef,
  useMemo,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent
} from "react";
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

import { MemberDetailLink } from "./MemberDetailLink.js";
import { MemberEvaluationDossier } from "./MemberEvaluationDossier.js";
import { MemberIdentity } from "./MemberIdentity.js";
import { MemberSearchField } from "./MemberSearchField.js";
import { MemberSponsorshipAccount } from "./MemberSponsorshipAccount.js";
import { MemberStatementSummarySection } from "./MemberStatementSummarySection.js";
import {
  assetCategoryPalette,
  buildAssetChartRows,
  buildAssetCompareChartRows,
  buildAssetCompositionItems,
  describeFamilyGap,
  sortAssetCategorySeries
} from "../lib/activity-asset-charts.js";
import {
  buildCalendarHref,
  type ActivityViewMode
} from "../lib/calendar-route.js";
import { loadMemberSponsorshipAccounts } from "../lib/data.js";
import {
  formatAssetEok,
  formatAssetEokAxis,
  formatAssetEokDelta,
  formatAssetEokMagnitude,
  formatDate,
  formatNumber,
  formatPercent,
  formatVoteCodeLabel
} from "../lib/format.js";
import {
  buildCalendarWeeks,
  buildHeadToHeadSummary,
  buildMonthLabels,
  getMemberDayBreakdown,
  rankActivityMembers,
  type CalendarCell
} from "../lib/member-activity.js";
import { formatMemberAffiliation } from "../lib/member-affiliation.js";
import {
  buildDebtFocusSummary,
  buildRealEstateFocusSummary,
  getFamilyGapLatest,
  resolveAssetHistorySnapshot,
  type AssetScopeMode,
  type DebtRatioStatus
} from "../lib/member-assets.js";
import { buildMemberShareData } from "../lib/member-share.js";

import type {
  AccountabilitySummaryExport,
  AccountabilityTrendsExport,
  BillProposalActivityExport,
  MemberActivityCalendarAssembly,
  MemberActivityCalendarExport,
  MemberActivityCalendarMember,
  MemberActivityCalendarMemberDetailExport,
  MemberActivityVoteRecord,
  MemberAssetsHistoryExport,
  MemberAssetsIndexExport,
  MemberAssetsIndexItem,
  MemberSponsorshipAccountsExport
} from "@lawmaker-monitor/schemas";

type ActivityCalendarPageProps = {
  activityCalendar: MemberActivityCalendarExport | null;
  loading: boolean;
  error: string | null;
  initialMemberId?: string | null;
  initialCompareMemberId?: string | null;
  initialView?: ActivityViewMode;
  accountabilitySummary?: AccountabilitySummaryExport | null;
  accountabilityTrends?: AccountabilityTrendsExport | null;
  billProposalActivity?: BillProposalActivityExport | null;
  billProposalActivityLoaded?: boolean;
  billProposalActivityError?: string | null;
  memberDetails: Record<
    string,
    MemberActivityCalendarMemberDetailExport | undefined
  >;
  memberDetailErrors: Record<string, string | null | undefined>;
  memberDetailLoading: Record<string, boolean | undefined>;
  memberAssetsIndex: MemberAssetsIndexExport | null;
  memberAssetsIndexError?: string | null;
  memberAssetHistories: Record<string, MemberAssetsHistoryExport | undefined>;
  memberAssetHistoryErrors: Record<string, string | null | undefined>;
  memberAssetHistoryLoading: Record<string, boolean | undefined>;
  onEnsureMemberDetail: (
    member: MemberActivityCalendarMember
  ) => void | Promise<void>;
  onRetryMemberDetail: (member: MemberActivityCalendarMember) => void;
  onEnsureMemberAssetHistory: (
    member: MemberActivityCalendarMember
  ) => void | Promise<void>;
  onRetryMemberAssetHistory: (member: MemberActivityCalendarMember) => void;
  onRetry: () => void;
};

const ACTIVITY_RATIO_CHART_HEIGHT = 220;
const INITIAL_VISIBLE_COMMITTEE_COUNT = 3;
const INITIAL_VISIBLE_VOTE_RECORDS_PER_GROUP = 2;

const weekdayLabels = ["일", "월", "화", "수", "목", "금", "토"];
const currentRunLabel = "현재 찬성 없이 이어진 날";
const longestRunLabel = "가장 길게 찬성 없이 이어진 날";
const runSummaryCopy =
  "참여율은 의원 재임 기간에 공개된 기록표결을 기준으로 계산합니다. 찬성·반대·기권은 참여로, 불참은 별도로 표시합니다. 정당 비교는 공식 당론이 아니라 같은 정당 참여 의원 다수와의 차이입니다.";

function describeDebtRatioStatus(status: DebtRatioStatus): string {
  switch (status) {
    case "none":
      return "공개 채무 없음";
    case "below-half":
      return "총자산의 절반 미만";
    case "half-or-more":
      return "총자산의 절반 이상";
    case "assets-exceeded":
      return "채무가 총자산 이상";
    case "unavailable":
      return "비율 산정 불가";
  }
}

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
  leftStroke: "#5b6c00",
  leftFill: "rgba(91, 108, 0, 0.18)",
  rightStroke: "#575148",
  rightFill: "rgba(87, 81, 72, 0.18)"
};

const formatAssetAmount = formatAssetEok;
const formatAssetDelta = formatAssetEokDelta;
const formatAssetMagnitude = formatAssetEokMagnitude;

type AssetTrendDirection = "up" | "down" | "flat";

function getAssetTrendDirection(value: number): AssetTrendDirection {
  if (value > 0) {
    return "up";
  }

  if (value < 0) {
    return "down";
  }

  return "flat";
}

function AssetTrendValue({ value }: { value: number }) {
  const direction = getAssetTrendDirection(value);
  const TrendIcon =
    direction === "up"
      ? TrendUpIcon
      : direction === "down"
        ? TrendDownIcon
        : MinusIcon;

  return (
    <span className={`activity-asset-trend activity-asset-trend--${direction}`}>
      <TrendIcon
        className="activity-asset-trend__arrow"
        aria-hidden="true"
        size={16}
        weight="bold"
      />
      <span>{formatAssetMagnitude(value)}</span>
    </span>
  );
}

type AssetGlyphKind = "building" | "land";

function AssetGlyph({ kind }: { kind: AssetGlyphKind }) {
  const GlyphIcon = kind === "building" ? BuildingsIcon : MountainsIcon;
  return <GlyphIcon aria-hidden="true" size={20} weight="regular" />;
}

function AssetMetricLabel({
  label,
  icons
}: {
  label: string;
  icons: AssetGlyphKind[];
}) {
  return (
    <span className="activity-asset-label">
      <span className="activity-asset-label__icons" aria-hidden="true">
        {icons.map((icon, index) => (
          <span key={`${icon}:${index}`} className="activity-asset-label__icon">
            <AssetGlyph kind={icon} />
          </span>
        ))}
      </span>
      <span>{label}</span>
    </span>
  );
}

function buildRatioData(member: MemberActivityCalendarMember): RatioDatum[] {
  const breakdown = getMemberDayBreakdown(member);
  const total =
    breakdown.yesDays +
    breakdown.noDays +
    breakdown.abstainDays +
    breakdown.absentDays;

  const toPercent = (value: number): number =>
    total === 0 ? 0 : Math.round((value / total) * 100);

  return [
    {
      label: "찬성",
      percent: toPercent(breakdown.yesDays),
      color: "var(--vote-yes)"
    },
    {
      label: "반대",
      percent: toPercent(breakdown.noDays),
      color: "var(--vote-no)"
    },
    {
      label: "기권",
      percent: toPercent(breakdown.abstainDays),
      color: "var(--vote-abstain)"
    },
    {
      label: "불참",
      percent: toPercent(breakdown.absentDays),
      color: "var(--vote-absent)"
    }
  ];
}

function renderRatioAxisTick({ x = 0, y = 0, payload }: RatioTickProps) {
  const label = payload?.value ?? "";
  const color =
    {
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

type NumericComparisonMode = "higher" | "absolute";

function resolveNumericComparison(
  leftMember: MemberActivityCalendarMember,
  rightMember: MemberActivityCalendarMember,
  leftValue: number,
  rightValue: number,
  mode: NumericComparisonMode = "higher"
): {
  winner: CompareMetricWinner;
  winnerMember: MemberActivityCalendarMember | null;
  difference: number;
} {
  const comparableLeft = mode === "absolute" ? Math.abs(leftValue) : leftValue;
  const comparableRight =
    mode === "absolute" ? Math.abs(rightValue) : rightValue;

  if (comparableLeft === comparableRight) {
    return {
      winner: "tie",
      winnerMember: null,
      difference: 0
    };
  }

  const winnerMember =
    comparableLeft > comparableRight ? leftMember : rightMember;

  return {
    winner: winnerMember.memberId === leftMember.memberId ? "left" : "right",
    winnerMember,
    difference: Math.abs(comparableLeft - comparableRight)
  };
}

type MemberAssetCompareSectionProps = {
  leftMember: MemberActivityCalendarMember;
  rightMember: MemberActivityCalendarMember;
  leftIndexEntry: MemberAssetsIndexItem | null;
  rightIndexEntry: MemberAssetsIndexItem | null;
  leftHistory: MemberAssetsHistoryExport | null;
  rightHistory: MemberAssetsHistoryExport | null;
  leftLoading: boolean;
  rightLoading: boolean;
  leftError?: string | null;
  rightError?: string | null;
  onRetryLeft?: (() => void) | null;
  onRetryRight?: (() => void) | null;
};

function MemberAssetCompareTooltip({
  active,
  label,
  payload,
  leftMember,
  rightMember
}: {
  active?: boolean;
  label?: string | number;
  payload?: Array<{
    dataKey?: string | number;
    value?: number | string | Array<number | string>;
  }>;
  leftMember: MemberActivityCalendarMember;
  rightMember: MemberActivityCalendarMember;
}) {
  if (!active || !payload?.length) {
    return null;
  }

  return (
    <div className="chart-tooltip activity-asset-chart__tooltip">
      <strong>{`공개일 ${String(label ?? "")}`}</strong>
      <ul>
        {payload.map((entry) => {
          const member =
            entry.dataKey === "leftTotal" ? leftMember : rightMember;
          const rawValue = Array.isArray(entry.value)
            ? entry.value[0]
            : entry.value;

          return (
            <li key={`${member.memberId}:${String(entry.dataKey)}`}>
              <MemberDetailLink memberId={member.memberId} name={member.name} />
              <strong>{formatAssetAmount(Number(rawValue ?? 0))}</strong>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function MemberAssetCompareSection({
  leftMember,
  rightMember,
  leftIndexEntry,
  rightIndexEntry,
  leftHistory,
  rightHistory,
  leftLoading,
  rightLoading,
  leftError,
  rightError,
  onRetryLeft,
  onRetryRight
}: MemberAssetCompareSectionProps) {
  const leftReady = Boolean(
    leftIndexEntry && leftHistory && leftHistory.series.length > 0
  );
  const rightReady = Boolean(
    rightIndexEntry && rightHistory && rightHistory.series.length > 0
  );

  if (
    !leftIndexEntry &&
    !rightIndexEntry &&
    !leftLoading &&
    !rightLoading &&
    !leftError &&
    !rightError
  ) {
    return null;
  }

  const leftFamilyGap = getFamilyGapLatest(leftHistory) ?? 0;
  const rightFamilyGap = getFamilyGapLatest(rightHistory) ?? 0;
  const leftRealEstate = buildRealEstateFocusSummary(
    resolveAssetHistorySnapshot(leftHistory, "familyIncluded")
  );
  const rightRealEstate = buildRealEstateFocusSummary(
    resolveAssetHistorySnapshot(rightHistory, "familyIncluded")
  );
  const leftDebt = buildDebtFocusSummary(leftHistory, "familyIncluded");
  const rightDebt = buildDebtFocusSummary(rightHistory, "familyIncluded");
  const leftLatestTotal =
    leftHistory?.latestSummary.currentAmount ??
    leftIndexEntry?.latestTotal ??
    0;
  const rightLatestTotal =
    rightHistory?.latestSummary.currentAmount ??
    rightIndexEntry?.latestTotal ??
    0;
  const leftFirstPoint = leftHistory?.series[0] ?? null;
  const rightFirstPoint = rightHistory?.series[0] ?? null;
  const leftTotalDelta =
    leftHistory && leftFirstPoint
      ? leftHistory.latestSummary.currentAmount - leftFirstPoint.currentAmount
      : (leftIndexEntry?.totalDelta ?? 0);
  const rightTotalDelta =
    rightHistory && rightFirstPoint
      ? rightHistory.latestSummary.currentAmount - rightFirstPoint.currentAmount
      : (rightIndexEntry?.totalDelta ?? 0);
  const chartRows =
    leftReady && rightReady
      ? buildAssetCompareChartRows(leftHistory, rightHistory)
      : [];
  const supportsFamilyGap = Boolean(
    leftHistory?.selfOnly && rightHistory?.selfOnly
  );

  const latestTotalResolution = resolveNumericComparison(
    leftMember,
    rightMember,
    leftLatestTotal,
    rightLatestTotal
  );
  const realEstateResolution = resolveNumericComparison(
    leftMember,
    rightMember,
    leftRealEstate?.latestAmount ?? 0,
    rightRealEstate?.latestAmount ?? 0
  );
  const deltaResolution = resolveNumericComparison(
    leftMember,
    rightMember,
    leftTotalDelta,
    rightTotalDelta
  );
  const familyGapResolution = supportsFamilyGap
    ? resolveNumericComparison(
        leftMember,
        rightMember,
        leftFamilyGap,
        rightFamilyGap,
        "absolute"
      )
    : null;
  const debtAmountResolution =
    leftDebt && rightDebt
      ? resolveNumericComparison(
          leftMember,
          rightMember,
          leftDebt.debtAmount,
          rightDebt.debtAmount
        )
      : null;
  const debtRatioResolution =
    leftDebt?.debtRatio != null && rightDebt?.debtRatio != null
      ? resolveNumericComparison(
          leftMember,
          rightMember,
          leftDebt.debtRatio,
          rightDebt.debtRatio
        )
      : null;

  const comparisonCards =
    leftReady && rightReady
      ? [
          {
            winner: latestTotalResolution.winner,
            badgeText:
              latestTotalResolution.winner === "tie"
                ? "동률"
                : `차이 ${formatAssetMagnitude(latestTotalResolution.difference)}`,
            summaryText:
              latestTotalResolution.winner === "tie"
                ? "최신 순재산이 같습니다."
                : `${withSubjectParticle(latestTotalResolution.winnerMember?.name ?? "")} 최신 순재산이 ${formatAssetMagnitude(latestTotalResolution.difference)} 더 많습니다.`,
            detailText: `${leftMember.name} ${formatAssetAmount(leftLatestTotal)} · ${rightMember.name} ${formatAssetAmount(rightLatestTotal)}`
          },
          {
            winner: realEstateResolution.winner,
            badgeText:
              realEstateResolution.winner === "tie"
                ? "동률"
                : `차이 ${formatAssetMagnitude(realEstateResolution.difference)}`,
            summaryText:
              realEstateResolution.winner === "tie"
                ? "부동산 규모가 같습니다."
                : `${withSubjectParticle(realEstateResolution.winnerMember?.name ?? "")} 부동산 규모가 ${formatAssetMagnitude(realEstateResolution.difference)} 더 큽니다.`,
            detailText: `${leftMember.name} ${formatAssetAmount(leftRealEstate?.latestAmount ?? 0)} · ${rightMember.name} ${formatAssetAmount(rightRealEstate?.latestAmount ?? 0)}`
          },
          {
            winner: deltaResolution.winner,
            badgeText:
              deltaResolution.winner === "tie"
                ? "동률"
                : `차이 ${formatAssetMagnitude(deltaResolution.difference)}`,
            summaryText:
              deltaResolution.winner === "tie"
                ? "22대 누적 증감이 같습니다."
                : `${withSubjectParticle(deltaResolution.winnerMember?.name ?? "")} 22대 누적 증감폭이 ${formatAssetMagnitude(deltaResolution.difference)} 더 큽니다.`,
            detailText: `${leftMember.name} ${formatAssetDelta(leftTotalDelta)} · ${rightMember.name} ${formatAssetDelta(rightTotalDelta)}`
          },
          ...(debtAmountResolution && leftDebt && rightDebt
            ? [
                {
                  winner: debtAmountResolution.winner,
                  badgeText:
                    debtAmountResolution.winner === "tie"
                      ? "동률"
                      : `차이 ${formatAssetMagnitude(debtAmountResolution.difference)}`,
                  summaryText:
                    debtAmountResolution.winner === "tie"
                      ? "공개 채무가 같습니다."
                      : `${withSubjectParticle(debtAmountResolution.winnerMember?.name ?? "")} 공개 채무가 ${formatAssetMagnitude(debtAmountResolution.difference)} 더 많습니다.`,
                  detailText: `${leftMember.name} ${formatAssetAmount(leftDebt.debtAmount)} · ${rightMember.name} ${formatAssetAmount(rightDebt.debtAmount)}`
                }
              ]
            : []),
          ...(debtRatioResolution &&
          leftDebt?.debtRatio != null &&
          rightDebt?.debtRatio != null
            ? [
                {
                  winner: debtRatioResolution.winner,
                  badgeText:
                    debtRatioResolution.winner === "tie"
                      ? "동률"
                      : `차이 ${(debtRatioResolution.difference * 100).toFixed(1)}%p`,
                  summaryText:
                    debtRatioResolution.winner === "tie"
                      ? "총자산 대비 부채비율이 같습니다."
                      : `${withSubjectParticle(debtRatioResolution.winnerMember?.name ?? "")} 총자산 대비 부채비율이 ${(debtRatioResolution.difference * 100).toFixed(1)}%p 더 높습니다.`,
                  detailText: `${leftMember.name} ${formatPercent(leftDebt.debtRatio)} · ${rightMember.name} ${formatPercent(rightDebt.debtRatio)}`
                }
              ]
            : []),
          ...(familyGapResolution
            ? [
                {
                  winner: familyGapResolution.winner,
                  badgeText:
                    familyGapResolution.winner === "tie"
                      ? "동률"
                      : `차이 ${formatAssetMagnitude(familyGapResolution.difference)}`,
                  summaryText:
                    familyGapResolution.winner === "tie"
                      ? "가족 차이가 같습니다."
                      : `${withSubjectParticle(familyGapResolution.winnerMember?.name ?? "")} 공개 범위 괴리가 ${formatAssetMagnitude(familyGapResolution.difference)} 더 큽니다.`,
                  detailText: `${leftMember.name} ${formatAssetDelta(leftFamilyGap)} · ${rightMember.name} ${formatAssetDelta(rightFamilyGap)}`
                }
              ]
            : [])
        ]
      : [];

  return (
    <section className="activity-asset-compare" aria-label="재산 비교">
      <div className="activity-drawer__section-head">
        <div>
          <p className="section-label">재산 VS</p>
          <h3>재산 공개 기준 비교</h3>
        </div>
        <p>
          최신 순재산과 부동산, 공개 채무와 부채비율, 22대 누적 증감, 가족 포함
          여부에 따른 괴리를 함께 봅니다.
        </p>
      </div>

      {comparisonCards.length > 0 ? (
        <section
          className="activity-compare__summary"
          aria-label="재산 비교 요약"
        >
          {comparisonCards.map((metric, index) => (
            <article
              key={`${index}:${metric.summaryText}:${metric.detailText}`}
              className={`activity-compare__summary-card activity-compare__summary-card--${metric.winner}`}
            >
              <p className="activity-compare__summary-kicker">
                {metric.badgeText}
              </p>
              <p className="activity-compare__summary-copy">
                {metric.summaryText}
              </p>
              <p className="activity-compare__summary-note">
                {metric.detailText}
              </p>
            </article>
          ))}
        </section>
      ) : (
        <p className="activity-drawer__empty">
          {leftLoading || rightLoading
            ? "비교용 재산 공개 이력을 불러오는 중입니다."
            : "두 의원의 재산 공개 이력을 모두 확인한 뒤 비교를 보여줍니다."}
        </p>
      )}

      <div className="activity-asset-compare__grid">
        {[
          {
            member: leftMember,
            indexEntry: leftIndexEntry,
            history: leftHistory,
            loading: leftLoading,
            error: leftError,
            onRetry: onRetryLeft,
            realEstate: leftRealEstate,
            latestTotal: leftLatestTotal,
            totalDelta: leftTotalDelta,
            familyGap: leftFamilyGap,
            debt: leftDebt
          },
          {
            member: rightMember,
            indexEntry: rightIndexEntry,
            history: rightHistory,
            loading: rightLoading,
            error: rightError,
            onRetry: onRetryRight,
            realEstate: rightRealEstate,
            latestTotal: rightLatestTotal,
            totalDelta: rightTotalDelta,
            familyGap: rightFamilyGap,
            debt: rightDebt
          }
        ].map((entry) => (
          <article
            key={entry.member.memberId}
            className="activity-asset-compare__panel"
          >
            <div className="activity-asset-compare__panel-head">
              <div>
                <h4>
                  <MemberDetailLink
                    memberId={entry.member.memberId}
                    name={entry.member.name}
                  />
                </h4>
                <p>
                  {formatMemberAffiliation(
                    entry.member.party,
                    entry.indexEntry?.district
                  )}
                </p>
              </div>
            </div>

            {!entry.indexEntry ? (
              <p className="activity-drawer__empty">
                현직 22대 기준 재산 공개 이력이 없습니다.
              </p>
            ) : entry.loading && !entry.history ? (
              <p className="activity-drawer__empty">
                재산 공개 이력을 불러오는 중입니다.
              </p>
            ) : entry.error ? (
              <div className="activity-drawer__empty">
                <p>{entry.error}</p>
                {entry.onRetry ? (
                  <button type="button" onClick={entry.onRetry}>
                    다시 시도
                  </button>
                ) : null}
              </div>
            ) : !entry.history ? (
              <p className="activity-drawer__empty">
                비교할 재산 공개 이력이 아직 없습니다.
              </p>
            ) : (
              <dl className="activity-asset-compare__facts">
                <div>
                  <dt>최신 순재산</dt>
                  <dd>{formatAssetAmount(entry.latestTotal)}</dd>
                </div>
                <div>
                  <dt>22대 누적 증감</dt>
                  <dd>
                    <AssetTrendValue value={entry.totalDelta} />
                  </dd>
                </div>
                <div>
                  <dt>
                    <AssetMetricLabel
                      label="부동산"
                      icons={["building", "land"]}
                    />
                  </dt>
                  <dd>
                    {formatAssetAmount(entry.realEstate?.latestAmount ?? 0)}
                  </dd>
                </div>
                <div>
                  <dt>가족 차이</dt>
                  <dd>
                    <AssetTrendValue value={entry.familyGap} />
                  </dd>
                </div>
                <div>
                  <dt>공개 채무</dt>
                  <dd>
                    {entry.debt
                      ? formatAssetAmount(entry.debt.debtAmount)
                      : "자료 없음"}
                  </dd>
                </div>
                <div>
                  <dt>부채비율</dt>
                  <dd>
                    {entry.debt?.debtRatio == null
                      ? "산정 불가"
                      : formatPercent(entry.debt.debtRatio)}
                  </dd>
                </div>
              </dl>
            )}
          </article>
        ))}
      </div>

      {chartRows.length > 0 ? (
        <div className="activity-asset-chart">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart
              data={chartRows}
              margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
            >
              <CartesianGrid
                stroke="rgba(35, 49, 58, 0.08)"
                strokeDasharray="4 4"
              />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 12, fill: "var(--ink-muted)" }}
              />
              <YAxis
                tickFormatter={(value) => formatAssetEokAxis(Number(value))}
                tickLine={false}
                axisLine={false}
                width={52}
                tick={{ fontSize: 12, fill: "var(--ink-muted)" }}
              />
              <Tooltip
                wrapperStyle={{ pointerEvents: "auto" }}
                content={
                  <MemberAssetCompareTooltip
                    leftMember={leftMember}
                    rightMember={rightMember}
                  />
                }
              />
              <Legend
                formatter={(value) => {
                  const member =
                    value === "leftTotal" ? leftMember : rightMember;
                  return (
                    <MemberDetailLink
                      memberId={member.memberId}
                      name={member.name}
                    />
                  );
                }}
              />
              <Line
                type="monotone"
                dataKey="leftTotal"
                name="leftTotal"
                stroke={compareRatioColors.leftStroke}
                strokeWidth={3}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="rightTotal"
                name="rightTotal"
                stroke={compareRatioColors.rightStroke}
                strokeWidth={3}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </section>
  );
}

function getMemberById(
  assembly: MemberActivityCalendarAssembly | null,
  memberId: string | null
): MemberActivityCalendarMember | null {
  if (!assembly || !memberId) {
    return null;
  }

  return (
    assembly.members.find((member) => member.memberId === memberId) ?? null
  );
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
      <GlobeSimpleIcon aria-hidden="true" size={19} weight="regular" />
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
  const [assetScopeMode, setAssetScopeMode] =
    useState<AssetScopeMode>("familyIncluded");
  const activeHistory = resolveAssetHistorySnapshot(history, assetScopeMode);
  const orderedCategorySeries = useMemo(
    () => sortAssetCategorySeries(activeHistory),
    [activeHistory]
  );
  const realEstateFocus = buildRealEstateFocusSummary(activeHistory);
  const debtFocus = buildDebtFocusSummary(history, assetScopeMode);
  const familyGapLatest = getFamilyGapLatest(history);
  const familyIncludedTotal =
    history?.latestSummary.currentAmount ?? indexEntry?.latestTotal ?? 0;
  const selfOnlyTotal = history?.selfOnly?.latestSummary.currentAmount ?? null;
  const activeFirstPoint = activeHistory?.series[0] ?? null;
  const activeLatestTotal =
    activeHistory?.latestSummary.currentAmount ?? indexEntry?.latestTotal ?? 0;
  const activeTotalDelta =
    activeHistory && activeFirstPoint
      ? activeHistory.latestSummary.currentAmount -
        activeFirstPoint.currentAmount
      : (indexEntry?.totalDelta ?? 0);
  const activeScopeLabel =
    assetScopeMode === "selfOnly" ? "본인만" : "가족 포함";
  const assetCompositionItems = buildAssetCompositionItems(
    activeHistory,
    orderedCategorySeries
  );
  const defaultCategoryKeys = orderedCategorySeries
    .slice(0, 4)
    .map((series) => series.categoryKey);
  const [visibleCategoryKeys, setVisibleCategoryKeys] =
    useState<string[]>(defaultCategoryKeys);
  const [showAllCategories, setShowAllCategories] = useState(false);

  useEffect(() => {
    const nextDefaultKeys = orderedCategorySeries
      .slice(0, 4)
      .map((series) => series.categoryKey);
    setVisibleCategoryKeys((current) => {
      const retained = current.filter((categoryKey) =>
        orderedCategorySeries.some(
          (series) => series.categoryKey === categoryKey
        )
      );

      return retained.length > 0 ? retained : nextDefaultKeys;
    });
    setShowAllCategories(false);
  }, [history?.memberId, orderedCategorySeries]);

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
          <p>
            현재 선택한 의원에 대해 공개된 재산 변동 문서를 아직 찾지
            못했습니다.
          </p>
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
          순재산을 기본선으로 두고, 부동산과 채무를 함께 비교합니다. 부채비율은
          공개 채무를 순재산과 채무의 합으로 나눠 계산합니다. 화면 표시는
          억원입니다.
        </p>
      </div>

      {history?.selfOnly ? (
        <div className="activity-asset-scope" aria-label="공개 범위 비교">
          <div className="activity-asset-scope__head">
            <div>
              <p className="section-label">공개 범위 비교</p>
              <h4>가족 포함과 본인만 기준을 함께 봅니다</h4>
            </div>
          </div>

          <dl className="activity-asset-scope__summary">
            <div>
              <dt>가족 포함</dt>
              <dd>{formatAssetAmount(familyIncludedTotal)}</dd>
            </div>
            <div>
              <dt>본인만</dt>
              <dd>
                {selfOnlyTotal == null
                  ? "미공개"
                  : formatAssetAmount(selfOnlyTotal)}
              </dd>
            </div>
            <div>
              <dt>가족 차이</dt>
              <dd>
                <AssetTrendValue value={familyGapLatest ?? 0} />
              </dd>
            </div>
          </dl>

          <p className="activity-asset-scope__note">
            {describeFamilyGap(familyGapLatest ?? 0)} 괴리가 클수록 가족 명의
            자산·채무가 총액을 더 크게 바꾸므로 추가 확인 포인트가 됩니다.
          </p>
        </div>
      ) : null}

      {history?.selfOnly ? (
        <div
          className="activity-asset-visual-scope"
          aria-label="재산 표시 범위"
        >
          <div className="activity-asset-visual-scope__copy">
            <p className="section-label">표시 기준</p>
            <h4>아래 포커스와 그래프를 {activeScopeLabel} 기준으로 봅니다</h4>
            <p>
              선택이 최신 순재산, 부동산 포커스, 부채 현황, 카테고리 추이에 함께
              반영됩니다.
            </p>
          </div>
          <div
            className="activity-asset-toggle-group"
            aria-label="재산 공개 범위"
          >
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
      ) : null}

      {realEstateFocus &&
      (realEstateFocus.hasExplicitCategory ||
        realEstateFocus.hasMixedCategory) ? (
        <div className="activity-asset-focus" aria-label="부동산 포커스">
          <div className="activity-asset-focus__head">
            <div>
              <p className="section-label">부동산 포커스</p>
              <h4>건물과 토지를 중심으로 봅니다</h4>
            </div>
          </div>

          <dl className="activity-asset-focus__summary">
            <div>
              <dt>
                <AssetMetricLabel
                  label="부동산 합계"
                  icons={["building", "land"]}
                />
              </dt>
              <dd>{formatAssetAmount(realEstateFocus.latestAmount)}</dd>
            </div>
            <div>
              <dt>증감</dt>
              <dd>
                <AssetTrendValue value={realEstateFocus.deltaAmount} />
              </dd>
            </div>
            <div>
              <dt>
                <AssetMetricLabel label="건물" icons={["building"]} />
              </dt>
              <dd>{formatAssetAmount(realEstateFocus.buildingAmount)}</dd>
            </div>
            <div>
              <dt>
                <AssetMetricLabel label="토지" icons={["land"]} />
              </dt>
              <dd>{formatAssetAmount(realEstateFocus.landAmount)}</dd>
            </div>
          </dl>
        </div>
      ) : null}

      {debtFocus ? (
        <div className="activity-asset-debt" aria-label="부채 현황">
          <div className="activity-asset-debt__head">
            <div>
              <p className="section-label">부채 현황</p>
              <h4>공개 자산과 채무를 함께 봅니다</h4>
            </div>
            <span
              className={`activity-asset-debt__status is-${debtFocus.status}`}
            >
              {describeDebtRatioStatus(debtFocus.status)}
            </span>
          </div>

          <dl className="activity-asset-debt__summary">
            <div>
              <dt>공개 채무</dt>
              <dd>{formatAssetAmount(debtFocus.debtAmount)}</dd>
            </div>
            <div>
              <dt>총자산 추정</dt>
              <dd>{formatAssetAmount(debtFocus.grossAssetAmount)}</dd>
            </div>
            <div>
              <dt>부채비율</dt>
              <dd>
                {debtFocus.debtRatio == null
                  ? "산정 불가"
                  : formatPercent(debtFocus.debtRatio)}
              </dd>
            </div>
            <div>
              <dt>순재산</dt>
              <dd>{formatAssetAmount(debtFocus.netAssetAmount)}</dd>
            </div>
          </dl>

          <p className="activity-asset-debt__note">
            {debtFocus.debtRatio == null
              ? "순재산과 채무의 합이 0원 이하라 부채비율을 계산하지 않습니다."
              : "부채비율 = 공개 채무 ÷ (공개 순재산 + 공개 채무). 100% 이상이면 채무가 공개 총자산 이상이라는 뜻입니다."}
          </p>
        </div>
      ) : null}

      <dl className="activity-asset-summary">
        <div>
          <dt>최신 순재산</dt>
          <dd>{formatAssetAmount(activeLatestTotal)}</dd>
        </div>
        <div>
          <dt>22대 누적 증감</dt>
          <dd>
            <AssetTrendValue value={activeTotalDelta} />
          </dd>
        </div>
      </dl>

      {assetCompositionItems.length > 0 ? (
        <div className="activity-asset-composition">
          <div className="activity-asset-composition__head">
            <div>
              <p className="section-label">공개 항목 구성</p>
              <h4>{activeScopeLabel} 기준 최신 공개 금액</h4>
            </div>
            <p>
              채무를 포함한 카테고리별 표시 비중입니다. 순재산 산식의 구성비와는
              다릅니다.
            </p>
          </div>

          <ol className="activity-asset-composition__list">
            {assetCompositionItems.map((item) => (
              <li
                key={item.categoryKey}
                className="activity-asset-composition__item"
              >
                <div className="activity-asset-composition__item-head">
                  <div className="activity-asset-composition__item-label">
                    <span
                      className="activity-asset-composition__swatch"
                      style={{ backgroundColor: item.color }}
                      aria-hidden="true"
                    />
                    <strong>{item.categoryLabel}</strong>
                  </div>
                  <span className="activity-asset-composition__item-share">
                    {formatPercent(item.share)}
                  </span>
                </div>
                <div
                  className="activity-asset-composition__bar"
                  aria-hidden="true"
                >
                  <span
                    className="activity-asset-composition__fill"
                    style={{
                      width: `${Math.max(item.share * 100, 6)}%`,
                      backgroundColor: item.color
                    }}
                  />
                </div>
                <p className="activity-asset-composition__item-amount">
                  {formatAssetAmount(item.amount)}
                </p>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <div className="activity-asset-chart">
        <ResponsiveContainer width="100%" height={280}>
          <LineChart
            data={chartRows}
            margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
          >
            <CartesianGrid
              stroke="rgba(35, 49, 58, 0.08)"
              strokeDasharray="4 4"
            />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12, fill: "var(--ink-muted)" }}
            />
            <YAxis
              tickFormatter={(value) => formatAssetEokAxis(Number(value))}
              tickLine={false}
              axisLine={false}
              width={52}
              tick={{ fontSize: 12, fill: "var(--ink-muted)" }}
            />
            <Tooltip
              formatter={(value, name) => {
                const amount = Array.isArray(value)
                  ? Number(value[0] ?? 0)
                  : Number(value ?? 0);
                const seriesKey = String(name ?? "");

                return [
                  formatAssetAmount(amount),
                  seriesKey === "total"
                    ? `순재산 (${activeScopeLabel})`
                    : (orderedCategorySeries.find(
                        (series) => series.categoryKey === seriesKey
                      )?.categoryLabel ?? seriesKey)
                ] as [string, string];
              }}
              labelFormatter={(value) => `공개일 ${value}`}
            />
            <Legend
              formatter={(value) =>
                value === "total"
                  ? `순재산 (${activeScopeLabel})`
                  : (orderedCategorySeries.find(
                      (series) => series.categoryKey === value
                    )?.categoryLabel ?? value)
              }
            />
            <Line
              type="monotone"
              dataKey="total"
              name="total"
              stroke="#4b5a00"
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
                stroke={
                  assetCategoryPalette[index % assetCategoryPalette.length]
                }
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
          <div
            className="activity-asset-toggle-group"
            aria-label="주요 재산 카테고리"
          >
            {orderedCategorySeries.slice(0, 4).map((series) => {
              const isActive = visibleCategoryKeys.includes(series.categoryKey);
              return (
                <button
                  key={series.categoryKey}
                  type="button"
                  className={
                    isActive
                      ? "activity-asset-toggle is-active"
                      : "activity-asset-toggle"
                  }
                  onClick={() =>
                    setVisibleCategoryKeys((current) =>
                      current.includes(series.categoryKey)
                        ? current.filter(
                            (value) => value !== series.categoryKey
                          )
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
                {showAllCategories
                  ? "나머지 카테고리 접기"
                  : "나머지 카테고리 보기"}
              </button>

              {showAllCategories ? (
                <div
                  className="activity-asset-toggle-group"
                  aria-label="추가 재산 카테고리"
                >
                  {extraSeries.map((series) => {
                    const isActive = visibleCategoryKeys.includes(
                      series.categoryKey
                    );
                    return (
                      <button
                        key={series.categoryKey}
                        type="button"
                        className={
                          isActive
                            ? "activity-asset-toggle is-active"
                            : "activity-asset-toggle"
                        }
                        onClick={() =>
                          setVisibleCategoryKeys((current) =>
                            current.includes(series.categoryKey)
                              ? current.filter(
                                  (value) => value !== series.categoryKey
                                )
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
          <ResponsiveContainer
            width="100%"
            height={ACTIVITY_RATIO_CHART_HEIGHT}
          >
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
                fill="rgba(91, 108, 0, 0.2)"
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
    <section
      className="activity-ratio-card activity-ratio-card--compare"
      aria-label="비율 비교"
    >
      <div className="activity-ratio-card__header">
        <h4>비율 비교</h4>
        <p>캘린더 날짜 기준 비율</p>
      </div>
      <div className="activity-ratio-compare__legend">
        <div className="activity-ratio-compare__legend-item activity-ratio-compare__legend-item--left">
          <span className="activity-ratio-compare__legend-kicker">
            기준 의원
          </span>
          <strong className="activity-ratio-compare__legend-name">
            <i style={{ background: compareRatioColors.leftStroke }} />
            <span>{leftMember.name}</span>
          </strong>
        </div>
        <div className="activity-ratio-compare__legend-item activity-ratio-compare__legend-item--right">
          <span className="activity-ratio-compare__legend-kicker">
            비교 의원
          </span>
          <strong className="activity-ratio-compare__legend-name">
            <i style={{ background: compareRatioColors.rightStroke }} />
            <span>{rightMember.name}</span>
          </strong>
        </div>
      </div>
      <div className="activity-ratio-card__body activity-ratio-card__body--compare">
        <div className="activity-ratio-card__chart">
          <ResponsiveContainer
            width="100%"
            height={ACTIVITY_RATIO_CHART_HEIGHT}
          >
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
        <div
          className="activity-ratio-compare__table"
          role="table"
          aria-label="비율 비교 표"
        >
          <div
            className="activity-ratio-compare__row activity-ratio-compare__row--head"
            role="row"
          >
            <span
              className="activity-ratio-compare__metric-header"
              role="columnheader"
            >
              항목
            </span>
            <div className="activity-ratio-compare__values activity-ratio-compare__values--head">
              <span role="columnheader">{leftMember.name}</span>
              <span role="columnheader">{rightMember.name}</span>
            </div>
          </div>
          {compareData.map((item) => (
            <div
              key={item.label}
              className="activity-ratio-compare__row"
              role="row"
            >
              <span
                className="activity-ratio-card__label activity-ratio-compare__metric"
                role="rowheader"
              >
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
  const isPendingRemoteLoad =
    resolvedRecordCount > records.length && !loading && !error;
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
      previewRecords: group.records.slice(
        0,
        INITIAL_VISIBLE_VOTE_RECORDS_PER_GROUP
      ),
      hiddenRecords: group.records.slice(INITIAL_VISIBLE_VOTE_RECORDS_PER_GROUP)
    }))
    .filter((group) => group.records.length > 0);
  const hasCollapsedGroups = groupedRecords.some(
    (group) => group.hiddenRecords.length > 0
  );

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
        <p className="activity-drawer__empty">
          전체 표결 기록을 불러오는 중입니다…
        </p>
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
      {!loading &&
      !isPendingRemoteLoad &&
      !error &&
      groupedRecords.length === 0 ? (
        <p className="activity-drawer__empty">
          표시할 찬성·반대·기권·불참 기록이 없습니다.
        </p>
      ) : null}
      {!loading &&
      !isPendingRemoteLoad &&
      !error &&
      groupedRecords.length > 0 ? (
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
                        <div className="activity-vote-records__item">
                          {content}
                        </div>
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
                            <div className="activity-vote-records__item">
                              {content}
                            </div>
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
  const [expandedSections, setExpandedSections] = useState<
    Record<string, boolean>
  >({});

  if (committeeSummaries.length === 0) {
    return null;
  }

  const mostResponsiveCommittees = [...committeeSummaries].sort(
    (left, right) => {
      if (right.participationRate !== left.participationRate) {
        return right.participationRate - left.participationRate;
      }

      if (right.eligibleRollCallCount !== left.eligibleRollCallCount) {
        return right.eligibleRollCallCount - left.eligibleRollCallCount;
      }

      return left.committeeName.localeCompare(right.committeeName, "ko-KR");
    }
  );
  const leastResponsiveCommittees = [...committeeSummaries].sort(
    (left, right) => {
      if (left.participationRate !== right.participationRate) {
        return left.participationRate - right.participationRate;
      }

      if (right.eligibleRollCallCount !== left.eligibleRollCallCount) {
        return right.eligibleRollCallCount - left.eligibleRollCallCount;
      }

      return left.committeeName.localeCompare(right.committeeName, "ko-KR");
    }
  );

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
          const hiddenCount = Math.max(
            section.summaries.length - visibleSummaries.length,
            0
          );
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
                              <span className="activity-committee-card__badge">
                                소속 위원회
                              </span>
                            ) : null}
                          </div>
                          <strong>{`${formatNumber(Math.round(summary.participationRate * 100))}%`}</strong>
                        </div>
                        <p className="activity-committee-card__meta">
                          {`참여 ${formatNumber(summary.participatedRollCallCount)} / 대상 ${formatNumber(summary.eligibleRollCallCount)} · 불참 ${formatNumber(summary.absentRollCallCount)}`}
                        </p>
                        <div
                          className="activity-committee-card__bar"
                          aria-hidden="true"
                        >
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
                                const recordDateLabel = formatDate(
                                  record.voteDatetime
                                );
                                const detailLabel = formatVoteCodeLabel(
                                  record.voteCode
                                );
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
                                  <li
                                    key={`${summary.committeeName}:${record.rollCallId}`}
                                  >
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
      viewport.scrollLeft = Math.max(
        0,
        viewport.scrollWidth - viewport.clientWidth
      );
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
      Math.abs(event.deltaX) > 0
        ? event.deltaX
        : Math.abs(event.deltaY) > 0
          ? event.deltaY
          : 0;
    if (horizontalDelta === 0) {
      return;
    }

    viewport.scrollLeft += horizontalDelta;
    event.preventDefault();
  }

  return (
    <div className={className}>
      <div
        className="contribution-calendar__legend"
        aria-label="대표 상태 범례"
      >
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
          {compact
            ? "가로 스크롤로 최근 날짜를 확인합니다."
            : "좌우로 스크롤해 최근 날짜까지 확인합니다."}
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
                <span
                  key={`${assembly.assemblyNo}:${index}`}
                  className="contribution-calendar__month"
                >
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
                <div
                  key={`${assembly.assemblyNo}:${index}`}
                  className="contribution-calendar__week"
                >
                  {week.days.map((cell, dayIndex) => (
                    <span
                      key={`${assembly.assemblyNo}:${index}:${dayIndex}:${cell.date ?? "empty"}`}
                      className={`contribution-calendar__cell contribution-calendar__cell--${cell.state}`}
                      role="img"
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
  initialMemberId,
  initialCompareMemberId,
  initialView = "single",
  accountabilitySummary = null,
  accountabilityTrends = null,
  billProposalActivity = null,
  billProposalActivityLoaded = false,
  billProposalActivityError = null,
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
  onRetry
}: ActivityCalendarPageProps) {
  const [activeView, setActiveView] = useState<ActivityViewMode>(initialView);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [compareMemberId, setCompareMemberId] = useState<string | null>(null);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [sponsorshipAccounts, setSponsorshipAccounts] = useState<
    MemberSponsorshipAccountsExport | null | undefined
  >(undefined);
  const [sponsorshipAccountsError, setSponsorshipAccountsError] = useState<
    string | null
  >(null);
  const [sponsorshipAccountsLoadAttempt, setSponsorshipAccountsLoadAttempt] =
    useState(0);
  const hasInitializedSelectedMemberRef = useRef(false);
  const lastAppliedRouteMemberIdRef = useRef<string | null | undefined>(
    undefined
  );

  const selectedAssembly = activityCalendar?.assembly ?? null;
  const rankedMembers = useMemo(
    () => (selectedAssembly ? rankActivityMembers(selectedAssembly, true) : []),
    [selectedAssembly]
  );
  const compareCandidates = rankedMembers.filter(
    (member) => member.memberId !== selectedMemberId
  );
  const districtByMemberId = useMemo(() => {
    const districts = new Map<string, string>();

    for (const member of memberAssetsIndex?.members ?? []) {
      const district = member.district?.trim();
      if (district) {
        districts.set(member.memberId, district);
      }
    }

    for (const member of billProposalActivity?.items ?? []) {
      const district = member.district?.trim();
      if (district) {
        districts.set(member.memberId, district);
      }
    }

    for (const member of accountabilitySummary?.items ?? []) {
      const district = member.district?.trim();
      if (district) {
        districts.set(member.memberId, district);
      }
    }

    return districts;
  }, [accountabilitySummary, billProposalActivity, memberAssetsIndex]);
  const formatMemberOptionLabel = (member: MemberActivityCalendarMember) => {
    const district = districtByMemberId.get(member.memberId);
    const affiliation = district
      ? formatMemberAffiliation(member.party, district)
      : `${member.party} · 지역 정보 미확인`;

    return `${member.name} · ${affiliation}`;
  };
  const compareOptions = compareCandidates.map((member) => ({
    id: member.memberId,
    label: formatMemberOptionLabel(member)
  }));

  useEffect(() => {
    let active = true;

    setSponsorshipAccounts(undefined);
    setSponsorshipAccountsError(null);
    void loadMemberSponsorshipAccounts()
      .then((payload) => {
        if (active) {
          setSponsorshipAccounts(payload);
        }
      })
      .catch(() => {
        if (active) {
          setSponsorshipAccounts(null);
          setSponsorshipAccountsError(
            "공식 후원 링크를 불러오지 못했습니다. 잠시 후 다시 확인해 주세요."
          );
        }
      });

    return () => {
      active = false;
    };
  }, [sponsorshipAccountsLoadAttempt]);

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
      initialMemberId &&
      rankedMembers.some((member) => member.memberId === initialMemberId)
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
  const selectedAccountabilityItem = selectedMember
    ? (accountabilitySummary?.items.find(
        (entry) => entry.memberId === selectedMember.memberId
      ) ?? null)
    : null;
  const selectedAccountabilityMover = selectedMember
    ? (accountabilityTrends?.movers.find(
        (entry) => entry.memberId === selectedMember.memberId
      ) ?? null)
    : null;
  const selectedBillProposalActivity = selectedMember
    ? (billProposalActivity?.items.find(
        (entry) => entry.memberId === selectedMember.memberId
      ) ?? null)
    : null;
  const selectedDistrict = selectedMember
    ? districtByMemberId.get(selectedMember.memberId)
    : undefined;
  const selectedMemberDetail = selectedMember
    ? (memberDetails[selectedMember.memberId] ?? null)
    : null;
  const selectedMemberDetailError = selectedMember
    ? (memberDetailErrors[selectedMember.memberId] ?? null)
    : null;
  const selectedMemberDetailLoading = selectedMember
    ? Boolean(memberDetailLoading[selectedMember.memberId])
    : false;
  const selectedMemberAssetIndex = selectedMember
    ? (memberAssetsIndex?.members.find(
        (entry) => entry.memberId === selectedMember.memberId
      ) ?? null)
    : null;
  const selectedMemberAssetHistory = selectedMember
    ? (memberAssetHistories[selectedMember.memberId] ?? null)
    : null;
  const selectedMemberAssetHistoryError = selectedMember
    ? (memberAssetHistoryErrors[selectedMember.memberId] ?? null)
    : null;
  const selectedMemberAssetHistoryLoading = selectedMember
    ? Boolean(memberAssetHistoryLoading[selectedMember.memberId])
    : false;
  const selectedSponsorshipAccount = useMemo(() => {
    if (!selectedMember || !sponsorshipAccounts) {
      return null;
    }

    const memberAccounts = sponsorshipAccounts.accounts.filter(
      (account) => account.memberId === selectedMember.memberId
    );
    return (
      memberAccounts.find((account) => account.status === "verified") ??
      memberAccounts.find((account) => account.status === "unverified") ??
      memberAccounts.find((account) => account.status === "superseded") ??
      null
    );
  }, [selectedMember, sponsorshipAccounts]);
  const compareMember = getMemberById(selectedAssembly, compareMemberId);
  const compareDistrict = compareMember
    ? districtByMemberId.get(compareMember.memberId)
    : undefined;
  const compareMemberAssetIndex = compareMember
    ? (memberAssetsIndex?.members.find(
        (entry) => entry.memberId === compareMember.memberId
      ) ?? null)
    : null;
  const compareMemberAssetHistory = compareMember
    ? (memberAssetHistories[compareMember.memberId] ?? null)
    : null;
  const compareMemberAssetHistoryError = compareMember
    ? (memberAssetHistoryErrors[compareMember.memberId] ?? null)
    : null;
  const compareMemberAssetHistoryLoading = compareMember
    ? Boolean(memberAssetHistoryLoading[compareMember.memberId])
    : false;
  const comparisonSummary =
    selectedAssembly && selectedMember && compareMember
      ? buildHeadToHeadSummary(selectedMember, compareMember, true)
      : null;
  const selectedBreakdown = selectedMember
    ? getMemberDayBreakdown(selectedMember)
    : null;
  const compareBreakdown = compareMember
    ? getMemberDayBreakdown(compareMember)
    : null;
  const compareMetrics =
    selectedMember &&
    compareMember &&
    selectedBreakdown &&
    compareBreakdown &&
    comparisonSummary
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
      availableCompareMembers.some(
        (member) => member.memberId === initialCompareMemberId
      )
        ? initialCompareMemberId
        : null;

    setCompareMemberId((currentCompareId) => {
      if (preferredCompareId && currentCompareId !== preferredCompareId) {
        return preferredCompareId;
      }

      if (
        currentCompareId &&
        currentCompareId !== selectedMember.memberId &&
        availableCompareMembers.some(
          (member) => member.memberId === currentCompareId
        )
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

    if (
      selectedMemberDetail ||
      selectedMemberDetailLoading ||
      selectedMemberDetailError
    ) {
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
    const targets = [
      selectedMember && selectedMemberAssetIndex
        ? {
            member: selectedMember,
            history: selectedMemberAssetHistory,
            loading: selectedMemberAssetHistoryLoading,
            error: selectedMemberAssetHistoryError
          }
        : null,
      activeView === "compare" && compareMember && compareMemberAssetIndex
        ? {
            member: compareMember,
            history: compareMemberAssetHistory,
            loading: compareMemberAssetHistoryLoading,
            error: compareMemberAssetHistoryError
          }
        : null
    ].filter(Boolean) as Array<{
      member: MemberActivityCalendarMember;
      history: MemberAssetsHistoryExport | null;
      loading: boolean;
      error: string | null;
    }>;

    for (const target of targets) {
      if (target.history || target.loading || target.error) {
        continue;
      }

      void onEnsureMemberAssetHistory(target.member);
    }
  }, [
    activeView,
    selectedMember,
    selectedMemberAssetIndex,
    selectedMemberAssetHistory,
    selectedMemberAssetHistoryError,
    selectedMemberAssetHistoryLoading,
    compareMember,
    compareMemberAssetIndex,
    compareMemberAssetHistory,
    compareMemberAssetHistoryError,
    compareMemberAssetHistoryLoading,
    onEnsureMemberAssetHistory
  ]);

  async function handleShare(): Promise<void> {
    if (!selectedAssembly || !selectedMember || activeView !== "single") {
      return;
    }
    const shareData = buildMemberShareData({
      memberId: selectedMember.memberId,
      name: selectedMember.name,
      party: selectedMember.party,
      district: selectedDistrict
    });
    const shareUrl = shareData.url;
    if (!shareUrl) {
      return;
    }

    setIsSharing(true);
    setShareError(null);
    setShareNotice(null);

    try {
      if (
        typeof navigator !== "undefined" &&
        typeof navigator.share === "function"
      ) {
        await navigator.share(shareData);
        return;
      }

      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        setShareNotice("의원 공개기록 링크를 복사했습니다.");
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
      <h1 id="activity-page-title" className="sr-only">
        의원 공개기록
      </h1>
      <section className="activity-page__panel">
        <div className="activity-page__modebar">
          <div
            className="activity-drawer__tabs"
            role="tablist"
            aria-label="의원 기록 보기"
          >
            <button
              type="button"
              role="tab"
              id="activity-single-tab"
              aria-controls="activity-analysis-panel"
              aria-selected={activeView === "single"}
              className={
                activeView === "single"
                  ? "activity-drawer__tab is-active"
                  : "activity-drawer__tab"
              }
              onClick={() => setActiveView("single")}
            >
              공개기록
            </button>
            <button
              type="button"
              role="tab"
              id="activity-compare-tab"
              aria-controls="activity-analysis-panel"
              aria-selected={activeView === "compare"}
              className={
                activeView === "compare"
                  ? "activity-drawer__tab is-active"
                  : "activity-drawer__tab"
              }
              onClick={() => setActiveView("compare")}
            >
              두 의원 비교
            </button>
          </div>
          <button
            type="button"
            className="activity-page__help-button"
            aria-label={
              isHelpOpen ? "기록 기준 설명 닫기" : "기록 기준 설명 보기"
            }
            aria-expanded={isHelpOpen}
            onClick={() => setIsHelpOpen((current) => !current)}
          >
            <QuestionIcon aria-hidden="true" size={19} weight="bold" />
          </button>
        </div>

        {isHelpOpen ? (
          <p className="activity-page__panel-copy activity-page__panel-copy--help">
            {runSummaryCopy}
          </p>
        ) : null}

        {shareError ? <p className="error-banner">{shareError}</p> : null}
        {shareNotice ? <p className="info-banner">{shareNotice}</p> : null}

        {loading ? (
          <p className="activity-drawer__empty">
            활동 캘린더 데이터를 불러오는 중입니다…
          </p>
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
          <p className="activity-drawer__empty">
            활동 캘린더 데이터가 아직 발행되지 않았습니다.
          </p>
        ) : null}

        {!loading && !error && selectedAssembly ? (
          <div className="activity-drawer__content">
            <div
              id="activity-analysis-panel"
              className="activity-drawer__main activity-drawer__main--full"
              role="tabpanel"
              aria-labelledby={
                activeView === "single"
                  ? "activity-single-tab"
                  : "activity-compare-tab"
              }
            >
              {activeView === "single" && selectedMember ? (
                <>
                  <MemberEvaluationDossier
                    assembly={selectedAssembly}
                    member={selectedMember}
                    accountabilityItem={selectedAccountabilityItem}
                    accountabilityMover={selectedAccountabilityMover}
                    accountabilityTrends={accountabilityTrends}
                    billItem={selectedBillProposalActivity}
                    billOutcomeDataAvailable={Boolean(
                      billProposalActivity?.outcomeDataAvailable
                    )}
                    billDataLoaded={billProposalActivityLoaded}
                    billDataError={billProposalActivityError}
                    assetIndex={selectedMemberAssetIndex}
                    assetHistory={selectedMemberAssetHistory}
                    assetHistoryLoading={selectedMemberAssetHistoryLoading}
                    assetHistoryError={selectedMemberAssetHistoryError}
                    voteRecords={
                      selectedMemberDetail?.voteRecords ??
                      selectedMember.voteRecords ??
                      []
                    }
                    voteRecordCount={selectedMember.voteRecordCount}
                    voteRecordsLoading={selectedMemberDetailLoading}
                    voteRecordsError={selectedMemberDetailError}
                    resolvedDistrict={selectedDistrict}
                    officialUrl={
                      selectedMember.officialExternalUrl ??
                      selectedMember.officialProfileUrl
                    }
                    onShare={() => void handleShare()}
                    shareState={
                      isSharing
                        ? "working"
                        : shareError
                          ? "error"
                          : shareNotice
                            ? "done"
                            : "idle"
                    }
                  />
                  <section
                    id="member-calendar"
                    className="activity-drawer__calendar-card"
                    aria-label="활동 캘린더 요약"
                  >
                    <div className="activity-drawer__section-head">
                      <div>
                        <p className="section-label">대표 상태 캘린더</p>
                        <h3>최근 표결 날짜 흐름</h3>
                      </div>
                      <p>
                        최근 표결일을 하루 단위로 묶고, 같은 날 여러 표결이
                        있으면 대표 상태만 남겨 비교합니다.
                      </p>
                    </div>
                    <ContributionCalendar
                      assembly={selectedAssembly}
                      member={selectedMember}
                    />
                  </section>
                  <ActivityRatioChart member={selectedMember} />
                  <div id="member-assets">
                    <MemberAssetSection
                      indexEntry={selectedMemberAssetIndex}
                      indexError={memberAssetsIndexError}
                      history={selectedMemberAssetHistory}
                      loading={selectedMemberAssetHistoryLoading}
                      error={selectedMemberAssetHistoryError}
                      onRetry={() => onRetryMemberAssetHistory(selectedMember)}
                    />
                  </div>
                  <div id="member-statements">
                    <MemberStatementSummarySection
                      memberId={selectedMember.memberId}
                    />
                  </div>
                  <div id="member-committees">
                    <ActivityCommitteeSections member={selectedMember} />
                  </div>
                  <div id="member-votes">
                    <ActivityVoteRecordSections
                      records={
                        selectedMemberDetail?.voteRecords ??
                        selectedMember.voteRecords ??
                        []
                      }
                      recordCount={selectedMember.voteRecordCount}
                      loading={selectedMemberDetailLoading}
                      error={selectedMemberDetailError}
                      onRetry={() => onRetryMemberDetail(selectedMember)}
                    />
                  </div>
                  <section
                    id="member-support"
                    className="activity-drawer__support-section"
                    aria-label={`${selectedMember.name} 의원 공식 후원 경로`}
                  >
                    <MemberSponsorshipAccount
                      account={selectedSponsorshipAccount}
                      memberName={selectedMember.name}
                      loading={sponsorshipAccounts === undefined}
                      error={sponsorshipAccountsError}
                      onRetry={() =>
                        setSponsorshipAccountsLoadAttempt(
                          (current) => current + 1
                        )
                      }
                    />
                  </section>
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
                      <section
                        className="activity-compare__summary"
                        aria-label="비교 요약"
                      >
                        {compareMetrics.map((metric, index) => (
                          <article
                            key={`${index}:${metric.summaryText}:${metric.detailText}`}
                            className={`activity-compare__summary-card activity-compare__summary-card--${metric.winner}`}
                          >
                            <p className="activity-compare__summary-kicker">
                              {metric.badgeText}
                            </p>
                            <p className="activity-compare__summary-copy">
                              {metric.summaryText}
                            </p>
                            <p className="activity-compare__summary-note">
                              {metric.detailText}
                            </p>
                          </article>
                        ))}
                      </section>

                      <div className="activity-compare__grid">
                        <section className="activity-compare__column">
                          <MemberIdentity
                            name={selectedMember.name}
                            party={selectedMember.party}
                            district={selectedDistrict}
                            photoUrl={selectedMember.photoUrl}
                            calendarHref={buildCalendarHref({
                              memberId: selectedMember.memberId
                            })}
                            avatarVariant="activity-card"
                          />
                          <ExternalSiteLink
                            url={selectedMember.officialExternalUrl}
                          />
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
                            district={compareDistrict}
                            photoUrl={compareMember.photoUrl}
                            calendarHref={buildCalendarHref({
                              memberId: compareMember.memberId
                            })}
                            avatarVariant="activity-card"
                          />
                          <ExternalSiteLink
                            url={compareMember.officialExternalUrl}
                          />
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
                      <MemberAssetCompareSection
                        leftMember={selectedMember}
                        rightMember={compareMember}
                        leftIndexEntry={selectedMemberAssetIndex}
                        rightIndexEntry={compareMemberAssetIndex}
                        leftHistory={selectedMemberAssetHistory}
                        rightHistory={compareMemberAssetHistory}
                        leftLoading={selectedMemberAssetHistoryLoading}
                        rightLoading={compareMemberAssetHistoryLoading}
                        leftError={selectedMemberAssetHistoryError}
                        rightError={compareMemberAssetHistoryError}
                        onRetryLeft={() =>
                          onRetryMemberAssetHistory(selectedMember)
                        }
                        onRetryRight={() =>
                          onRetryMemberAssetHistory(compareMember)
                        }
                      />
                    </>
                  ) : (
                    <p className="activity-drawer__empty">
                      같은 대수 안에서 비교할 의원을 선택해 주세요.
                    </p>
                  )}
                </div>
              ) : null}

              {!selectedMember ? (
                <p className="activity-drawer__empty">
                  표시할 의원을 선택해 주세요.
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>
    </section>
  );
}
