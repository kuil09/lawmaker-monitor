import { useEffect, useMemo, useState } from "react";

import { MemberIdentity } from "./MemberIdentity.js";
import {
  getYesCount,
  rankLeaderboardItems,
  type LeaderboardMetric
} from "../lib/accountability.js";
import { buildCalendarHref } from "../lib/calendar-route.js";
import {
  formatAssetEok,
  formatAssetEokDelta,
  formatNumber,
  formatPercent
} from "../lib/format.js";

import type { MemberAttendanceSummary } from "../lib/member-activity.js";
import type { AssetAllocationSummary } from "../lib/member-assets.js";
import type {
  AccountabilitySummaryItem,
  MemberAssetsIndexItem
} from "@lawmaker-monitor/schemas";

type AccountabilityLeaderboardProps = {
  items: AccountabilitySummaryItem[];
  assemblyLabel: string;
  attendanceByMemberId?: Map<string, MemberAttendanceSummary>;
  assetItems?: Array<
    MemberAssetsIndexItem & {
      assetAllocation?: AssetAllocationSummary;
    }
  >;
};

type HomeLeaderboardMetric = LeaderboardMetric | "realEstate" | "assetTotal";

type LeaderboardMetricOption = {
  value: HomeLeaderboardMetric;
  label: string;
  styleKey: string;
};

type RankedAssetLeaderboardItem = MemberAssetsIndexItem & {
  metricValue: number;
  assetAllocation?: AssetAllocationSummary;
};

const defaultMetricOption: LeaderboardMetricOption = {
  value: "absent",
  label: "불참",
  styleKey: "absent"
};

const realEstateMetricOption: LeaderboardMetricOption = {
  value: "realEstate",
  label: "부동산",
  styleKey: "real-estate"
};

const assetTotalMetricOption: LeaderboardMetricOption = {
  value: "assetTotal",
  label: "총재산",
  styleKey: "asset-total"
};

const partyLineMetricOption: LeaderboardMetricOption = {
  value: "partyLine",
  label: "당내 이탈",
  styleKey: "party-line"
};

const baseLeaderboardMetricOptions: LeaderboardMetricOption[] = [
  defaultMetricOption,
  { value: "no", label: "반대", styleKey: "no" },
  { value: "abstain", label: "기권", styleKey: "abstain" },
  partyLineMetricOption,
  { value: "yes", label: "찬성", styleKey: "yes" }
];

function isAssetMetric(
  metric: HomeLeaderboardMetric
): metric is "realEstate" | "assetTotal" {
  return metric === "realEstate" || metric === "assetTotal";
}

function rankAssetItems(
  items: MemberAssetsIndexItem[],
  metric: "realEstate" | "assetTotal"
): RankedAssetLeaderboardItem[] {
  return items
    .map((item) => ({
      ...item,
      metricValue:
        metric === "assetTotal"
          ? item.latestTotal
          : (item.latestRealEstateTotal ?? Number.NEGATIVE_INFINITY)
    }))
    .filter((item) => Number.isFinite(item.metricValue))
    .sort((left, right) => {
      if (right.metricValue !== left.metricValue) {
        return right.metricValue - left.metricValue;
      }

      if (right.latestTotal !== left.latestTotal) {
        return right.latestTotal - left.latestTotal;
      }

      return left.name.localeCompare(right.name, "ko-KR");
    });
}

function formatDisclosureDate(value: string): string {
  return value.replaceAll("-", ".");
}

export function AccountabilityLeaderboard({
  items,
  assemblyLabel,
  attendanceByMemberId,
  assetItems = []
}: AccountabilityLeaderboardProps) {
  const [metric, setMetric] = useState<HomeLeaderboardMetric>("absent");
  const hasRealEstateData = assetItems.some(
    (item) => item.latestRealEstateTotal != null
  );
  const hasAssetTotalData = assetItems.length > 0;
  const metricOptions = useMemo(
    () => [
      ...baseLeaderboardMetricOptions,
      ...(hasRealEstateData ? [realEstateMetricOption] : []),
      ...(hasAssetTotalData ? [assetTotalMetricOption] : [])
    ],
    [hasAssetTotalData, hasRealEstateData]
  );

  useEffect(() => {
    if (!metricOptions.some((option) => option.value === metric)) {
      setMetric("absent");
    }
  }, [metric, metricOptions]);

  const metricOption =
    metricOptions.find((option) => option.value === metric) ??
    defaultMetricOption;
  const visibleItems =
    metric === "partyLine"
      ? items.filter((item) => item.partyLineOpportunityCount > 0)
      : items;
  const rankedItems = isAssetMetric(metric)
    ? []
    : rankLeaderboardItems(visibleItems, metric).slice(0, 10);
  const rankedAssetItems = isAssetMetric(metric)
    ? rankAssetItems(assetItems, metric).slice(0, 10)
    : [];
  const leaderboardCopy = isAssetMetric(metric)
    ? metric === "realEstate"
      ? "최신 재산 공개 기준 건물·토지 합계로 정렬하고, 그래프에는 공개된 플러스 자산 중 부동산 비중을 함께 반영합니다."
      : "최신 재산 공개 기준 총재산 순위를 보여 주고, 그래프에는 공개된 플러스 자산 중 부동산 비중을 함께 반영합니다."
    : metric === "partyLine"
      ? "같은 당 의원들이 한쪽으로 표를 모았던 표결에서, 이 의원이 얼마나 다르게 투표했는지 보여 줍니다. 표결에 참여하지 않은 경우는 이탈이 아니라 미참여로 따로 집계합니다."
      : metric === "absent"
        ? "불참 기준으로 먼저 정렬해 출석 문제를 바로 드러내고, 나머지 선택 구성은 작은 막대로 함께 봅니다."
        : `${metricOption.label} 기준으로 정렬하되, 불참 막대를 함께 남겨 출석 문제를 놓치지 않도록 했습니다.`;

  return (
    <section className="leaderboard-panel">
      <div className="leaderboard-panel__header">
        <div>
          <p className="section-label">의원 랭킹</p>
          <h2>{`${assemblyLabel} 의원 순위`}</h2>
        </div>
        <div
          className="metric-toggle"
          role="tablist"
          aria-label="의원 랭킹 기준"
        >
          {metricOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={metric === option.value}
              className={
                metric === option.value
                  ? `metric-toggle__button is-active metric-toggle__button--${option.styleKey}`
                  : `metric-toggle__button metric-toggle__button--${option.styleKey}`
              }
              onClick={() => setMetric(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <p className="leaderboard-panel__copy">{leaderboardCopy}</p>

      {isAssetMetric(metric) ? (
        <ol className="ranking-list">
          {rankedAssetItems.map((item, index) => {
            const metricLabel =
              metric === "realEstate" ? "최신 부동산" : "최신 총재산";
            const assetShareText = item.assetAllocation
              ? `비중 ${formatPercent(item.assetAllocation.realEstateShare)}`
              : "비중 계산 중";
            const secondaryText =
              metric === "realEstate"
                ? `총재산 ${formatAssetEok(item.latestTotal)} · ${assetShareText}`
                : item.latestRealEstateTotal != null
                  ? `부동산 ${formatAssetEok(item.latestRealEstateTotal)} · ${assetShareText}`
                  : `부동산 데이터 준비 중 · ${assetShareText}`;
            const metaItems = [
              {
                key: "asset-total",
                label: "총재산",
                value: formatAssetEok(item.latestTotal)
              },
              {
                key: "real-estate",
                label: "부동산",
                value:
                  item.latestRealEstateTotal != null
                    ? formatAssetEok(item.latestRealEstateTotal)
                    : "준비 중"
              },
              {
                key: "asset-share",
                label: "부동산 비중",
                value: item.assetAllocation
                  ? formatPercent(item.assetAllocation.realEstateShare)
                  : "계산 중"
              },
              {
                key: "asset-delta",
                label: "증감",
                value: formatAssetEokDelta(item.totalDelta)
              },
              {
                key: "asset-date",
                label: "공개일",
                value: formatDisclosureDate(item.latestDisclosureDate)
              }
            ] as const;

            return (
              <li key={item.memberId} className="ranking-item">
                <div className="ranking-item__rank">
                  {formatNumber(index + 1)}
                </div>
                <div className="ranking-item__content">
                  <div className="ranking-item__header">
                    <div className="ranking-item__main">
                      <MemberIdentity
                        name={item.name}
                        party={item.party}
                        photoUrl={item.photoUrl}
                        calendarHref={buildCalendarHref({
                          memberId: item.memberId
                        })}
                        size="small"
                      />
                    </div>
                    <div
                      className={`ranking-item__stats ranking-item__stats--${metricOption.styleKey}`}
                    >
                      <span className="ranking-item__stats-label">
                        {metricLabel}
                      </span>
                      <strong>{formatAssetEok(item.metricValue)}</strong>
                      <span className="ranking-item__stats-rate">
                        {secondaryText}
                      </span>
                    </div>
                  </div>
                  <div className="ranking-item__graph" aria-hidden="true">
                    {item.assetAllocation ? (
                      <>
                        <span
                          className="ranking-item__segment ranking-item__segment--real-estate-share"
                          style={{
                            width: `${item.assetAllocation.realEstateShare * 100}%`
                          }}
                        />
                        <span
                          className="ranking-item__segment ranking-item__segment--other-assets-share"
                          style={{
                            width: `${(1 - item.assetAllocation.realEstateShare) * 100}%`
                          }}
                        />
                      </>
                    ) : (
                      <span
                        className={`ranking-item__segment ranking-item__segment--${metricOption.styleKey}`}
                        style={{ width: "100%" }}
                      />
                    )}
                  </div>
                  <div className="ranking-item__meta">
                    {metaItems.map((metaItem) => (
                      <span
                        key={metaItem.key}
                        className={`ranking-item__meta-item ranking-item__meta-item--${metaItem.key}`}
                      >
                        <span className="ranking-item__meta-label">
                          {metaItem.label}
                        </span>
                        <strong className="ranking-item__meta-value">
                          {metaItem.value}
                        </strong>
                      </span>
                    ))}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      ) : metric === "partyLine" && rankedItems.length === 0 ? (
        <p className="leaderboard-panel__empty">
          당 기준이 성립한 표결이 아직 집계되지 않았습니다. 데이터가
          갱신되면 순위가 표시됩니다.
        </p>
      ) : (
        <ol className="ranking-list">
          {rankedItems.map((item, index) => {
            const yesCount = getYesCount(item);
            const noShare =
              item.totalRecordedVotes > 0
                ? (item.noCount / item.totalRecordedVotes) * 100
                : 0;
            const abstainShare =
              item.totalRecordedVotes > 0
                ? (item.abstainCount / item.totalRecordedVotes) * 100
                : 0;
            const absentShare =
              item.totalRecordedVotes > 0
                ? (item.absentCount / item.totalRecordedVotes) * 100
                : 0;
            const yesShare =
              item.totalRecordedVotes > 0
                ? (yesCount / item.totalRecordedVotes) * 100
                : 0;
            const attendanceSummary = attendanceByMemberId?.get(item.memberId);
            const breakdownItems = [
              { key: "yes", label: "찬성", count: yesCount },
              { key: "no", label: "반대", count: item.noCount },
              { key: "abstain", label: "기권", count: item.abstainCount },
              { key: "absent", label: "불참", count: item.absentCount }
            ] as const;

            const absentRate =
              item.totalRecordedVotes > 0
                ? item.absentCount / item.totalRecordedVotes
                : null;
            const partyLineSkippedCount = Math.max(
              item.partyLineOpportunityCount - item.partyLineParticipationCount,
              0
            );
            const statsLabel =
              metric === "partyLine" ? "당내 이탈도" : "출석 현황";
            const statsValue =
              metric === "partyLine"
                ? `이탈 ${formatNumber(item.partyLineDefectionCount)}회 / 참여 ${formatNumber(
                    item.partyLineParticipationCount
                  )}회`
                : attendanceSummary
                  ? `출석 ${formatNumber(attendanceSummary.attendedDays)}일 / 대상 ${formatNumber(
                      attendanceSummary.eligibleDays
                    )}일`
                  : "준비 중";
            const statsRate =
              metric === "partyLine"
                ? `이탈률 ${formatPercent(item.partyLineDefectionRate)} · 기준 기회 ${formatNumber(item.partyLineOpportunityCount)}회`
                : attendanceSummary
                  ? `출석률 ${formatPercent(attendanceSummary.attendanceRate)}`
                  : "활동 데이터 확인 전";
            const metaItems =
              metric === "partyLine"
                ? [
                    {
                      key: "party-line-defection-rate",
                      label: "이탈률",
                      value: formatPercent(item.partyLineDefectionRate)
                    },
                    {
                      key: "party-line-defection-count",
                      label: "이탈",
                      value: `${formatNumber(item.partyLineDefectionCount)}회`
                    },
                    {
                      key: "party-line-participation-count",
                      label: "참여",
                      value: `${formatNumber(item.partyLineParticipationCount)}회`
                    },
                    {
                      key: "party-line-opportunity-count",
                      label: "기준 기회",
                      value: `${formatNumber(item.partyLineOpportunityCount)}회`
                    },
                    {
                      key: "party-line-skipped-count",
                      label: "미참여",
                      value: `${formatNumber(partyLineSkippedCount)}회`
                    }
                  ]
                : breakdownItems.map((breakdownItem) => ({
                    key: breakdownItem.key,
                    label: breakdownItem.label,
                    value: `${formatNumber(breakdownItem.count)}건`
                  }));

            return (
              <li key={item.memberId} className="ranking-item">
                <div className="ranking-item__rank">
                  {formatNumber(index + 1)}
                </div>
                <div className="ranking-item__content">
                  <div className="ranking-item__header">
                    <div className="ranking-item__main">
                      <MemberIdentity
                        name={item.name}
                        party={item.party}
                        photoUrl={item.photoUrl}
                        calendarHref={buildCalendarHref({
                          memberId: item.memberId
                        })}
                        size="small"
                      />
                      {metric === "absent" && absentRate !== null ? (
                        <span className="ranking-item__absent-rate">
                          불참 {formatPercent(absentRate)}
                        </span>
                      ) : null}
                    </div>
                    <div
                      className={
                        metric === "partyLine"
                          ? "ranking-item__stats ranking-item__stats--party-line"
                          : "ranking-item__stats"
                      }
                    >
                      <span className="ranking-item__stats-label">
                        {statsLabel}
                      </span>
                      <strong>{statsValue}</strong>
                      <span className="ranking-item__stats-rate">
                        {statsRate}
                      </span>
                    </div>
                  </div>
                  <div className="ranking-item__graph" aria-hidden="true">
                    <span
                      className="ranking-item__segment ranking-item__segment--yes"
                      style={{ width: `${yesShare}%` }}
                    />
                    <span
                      className="ranking-item__segment ranking-item__segment--no"
                      style={{ width: `${noShare}%` }}
                    />
                    <span
                      className="ranking-item__segment ranking-item__segment--abstain"
                      style={{ width: `${abstainShare}%` }}
                    />
                    <span
                      className="ranking-item__segment ranking-item__segment--absent"
                      style={{ width: `${absentShare}%` }}
                    />
                  </div>
                  <div className="ranking-item__meta">
                    {metaItems.map((metaItem) => (
                      <span
                        key={metaItem.key}
                        className={`ranking-item__meta-item ranking-item__meta-item--${metaItem.key}`}
                      >
                        <span className="ranking-item__meta-label">
                          {metaItem.label}
                        </span>
                        <strong className="ranking-item__meta-value">
                          {metaItem.value}
                        </strong>
                      </span>
                    ))}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
