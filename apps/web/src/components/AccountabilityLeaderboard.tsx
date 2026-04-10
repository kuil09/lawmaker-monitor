import { useEffect, useState } from "react";

import type {
  AccountabilitySummaryItem,
  MemberAssetsIndexItem
} from "@lawmaker-monitor/schemas";

import { buildCalendarHref } from "../lib/calendar-route.js";
import {
  getYesCount,
  rankLeaderboardItems,
  type LeaderboardMetric
} from "../lib/accountability.js";
import {
  formatAssetEok,
  formatAssetEokDelta,
  formatNumber,
  formatPercent
} from "../lib/format.js";
import type { MemberAttendanceSummary } from "../lib/member-activity.js";
import { MemberIdentity } from "./MemberIdentity.js";

type AccountabilityLeaderboardProps = {
  items: AccountabilitySummaryItem[];
  assemblyLabel: string;
  attendanceByMemberId?: Map<string, MemberAttendanceSummary>;
  assetItems?: MemberAssetsIndexItem[];
};

type HomeLeaderboardMetric = LeaderboardMetric | "realEstate" | "assetTotal";

type LeaderboardMetricOption = {
  value: HomeLeaderboardMetric;
  label: string;
  styleKey: string;
};

type RankedAssetLeaderboardItem = MemberAssetsIndexItem & {
  metricValue: number;
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

const baseLeaderboardMetricOptions: LeaderboardMetricOption[] = [
  defaultMetricOption,
  { value: "no", label: "반대", styleKey: "no" },
  { value: "abstain", label: "기권", styleKey: "abstain" },
  { value: "yes", label: "찬성", styleKey: "yes" }
];

function isAssetMetric(metric: HomeLeaderboardMetric): metric is "realEstate" | "assetTotal" {
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
          : item.latestRealEstateTotal ?? Number.NEGATIVE_INFINITY
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
  const hasRealEstateData = assetItems.some((item) => item.latestRealEstateTotal != null);
  const hasAssetTotalData = assetItems.length > 0;
  const metricOptions = [
    ...baseLeaderboardMetricOptions,
    ...(hasRealEstateData ? [realEstateMetricOption] : []),
    ...(hasAssetTotalData ? [assetTotalMetricOption] : [])
  ];

  useEffect(() => {
    if (!metricOptions.some((option) => option.value === metric)) {
      setMetric("absent");
    }
  }, [metric, metricOptions]);

  const metricOption =
    metricOptions.find((option) => option.value === metric) ?? defaultMetricOption;
  const rankedItems = isAssetMetric(metric) ? [] : rankLeaderboardItems(items, metric).slice(0, 10);
  const rankedAssetItems = isAssetMetric(metric)
    ? rankAssetItems(assetItems, metric).slice(0, 10)
    : [];
  const leaderboardCopy = isAssetMetric(metric)
    ? metric === "realEstate"
      ? "최신 재산 공개 기준 건물·토지 합계로 정렬하고, 총재산과 22대 누적 증감폭을 함께 비교합니다."
      : "최신 재산 공개 기준 총재산 순위를 보여 주고, 부동산 규모와 22대 누적 증감폭을 함께 봅니다."
    : metric === "absent"
      ? "불참 기준으로 먼저 정렬해 출석 문제를 바로 드러내고, 나머지 선택 구성은 작은 막대로 함께 봅니다."
      : `${metricOption.label} 기준으로 정렬하되, 불참 막대를 함께 남겨 출석 문제를 놓치지 않도록 했습니다.`;
  const topAssetMetricValue = rankedAssetItems[0]?.metricValue ?? 0;

  return (
    <section className="leaderboard-panel">
      <div className="leaderboard-panel__header">
        <div>
          <p className="section-label">의원 랭킹</p>
          <h2>{`${assemblyLabel} 의원 순위`}</h2>
        </div>
        <div className="metric-toggle" role="tablist" aria-label="의원 랭킹 기준">
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
            const graphWidth =
              topAssetMetricValue > 0 ? Math.max((item.metricValue / topAssetMetricValue) * 100, 6) : 0;
            const metricLabel = metric === "realEstate" ? "최신 부동산" : "최신 총재산";
            const secondaryText =
              metric === "realEstate"
                ? `총재산 ${formatAssetEok(item.latestTotal)}`
                : item.latestRealEstateTotal != null
                  ? `부동산 ${formatAssetEok(item.latestRealEstateTotal)}`
                  : "부동산 데이터 준비 중";
            const metaItems = [
              { key: "asset-total", label: "총재산", value: formatAssetEok(item.latestTotal) },
              {
                key: "real-estate",
                label: "부동산",
                value:
                  item.latestRealEstateTotal != null
                    ? formatAssetEok(item.latestRealEstateTotal)
                    : "준비 중"
              },
              { key: "asset-delta", label: "증감", value: formatAssetEokDelta(item.totalDelta) },
              {
                key: "asset-date",
                label: "공개일",
                value: formatDisclosureDate(item.latestDisclosureDate)
              }
            ] as const;

            return (
              <li key={item.memberId} className="ranking-item">
                <div className="ranking-item__rank">{formatNumber(index + 1)}</div>
                <div className="ranking-item__content">
                  <div className="ranking-item__header">
                    <div className="ranking-item__main">
                      <MemberIdentity
                        name={item.name}
                        party={item.party}
                        photoUrl={item.photoUrl}
                        calendarHref={buildCalendarHref({ memberId: item.memberId })}
                        size="small"
                      />
                    </div>
                    <div className={`ranking-item__stats ranking-item__stats--${metricOption.styleKey}`}>
                      <span className="ranking-item__stats-label">{metricLabel}</span>
                      <strong>{formatAssetEok(item.metricValue)}</strong>
                      <span className="ranking-item__stats-rate">{secondaryText}</span>
                    </div>
                  </div>
                  <div className="ranking-item__graph" aria-hidden="true">
                    <span
                      className={`ranking-item__segment ranking-item__segment--${metricOption.styleKey}`}
                      style={{ width: `${graphWidth}%` }}
                    />
                  </div>
                  <div className="ranking-item__meta">
                    {metaItems.map((metaItem) => (
                      <span
                        key={metaItem.key}
                        className={`ranking-item__meta-item ranking-item__meta-item--${metaItem.key}`}
                      >
                        <span className="ranking-item__meta-label">{metaItem.label}</span>
                        <strong className="ranking-item__meta-value">{metaItem.value}</strong>
                      </span>
                    ))}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <ol className="ranking-list">
          {rankedItems.map((item, index) => {
            const yesCount = getYesCount(item);
            const noShare = item.totalRecordedVotes > 0 ? (item.noCount / item.totalRecordedVotes) * 100 : 0;
            const abstainShare =
              item.totalRecordedVotes > 0 ? (item.abstainCount / item.totalRecordedVotes) * 100 : 0;
            const absentShare =
              item.totalRecordedVotes > 0 ? (item.absentCount / item.totalRecordedVotes) * 100 : 0;
            const yesShare = item.totalRecordedVotes > 0 ? (yesCount / item.totalRecordedVotes) * 100 : 0;
            const attendanceSummary = attendanceByMemberId?.get(item.memberId);
            const breakdownItems = [
              { key: "yes", label: "찬성", count: yesCount },
              { key: "no", label: "반대", count: item.noCount },
              { key: "abstain", label: "기권", count: item.abstainCount },
              { key: "absent", label: "불참", count: item.absentCount }
            ] as const;

            const absentRate = item.totalRecordedVotes > 0
              ? item.absentCount / item.totalRecordedVotes
              : null;

            return (
              <li key={item.memberId} className="ranking-item">
                <div className="ranking-item__rank">{formatNumber(index + 1)}</div>
                <div className="ranking-item__content">
                  <div className="ranking-item__header">
                    <div className="ranking-item__main">
                      <MemberIdentity
                        name={item.name}
                        party={item.party}
                        photoUrl={item.photoUrl}
                        calendarHref={buildCalendarHref({ memberId: item.memberId })}
                        size="small"
                      />
                      {metric === "absent" && absentRate !== null ? (
                        <span className="ranking-item__absent-rate">
                          불참 {formatPercent(absentRate)}
                        </span>
                      ) : null}
                    </div>
                    <div className="ranking-item__stats">
                      <span className="ranking-item__stats-label">출석 현황</span>
                      <strong>
                        {attendanceSummary
                          ? `출석 ${formatNumber(attendanceSummary.attendedDays)}일 / 대상 ${formatNumber(
                              attendanceSummary.eligibleDays
                            )}일`
                          : "준비 중"}
                      </strong>
                      <span className="ranking-item__stats-rate">
                        {attendanceSummary
                          ? `출석률 ${formatPercent(attendanceSummary.attendanceRate)}`
                          : "활동 데이터 확인 전"}
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
                    {breakdownItems.map((breakdownItem) => (
                      <span
                        key={breakdownItem.key}
                        className={`ranking-item__meta-item ranking-item__meta-item--${breakdownItem.key}`}
                      >
                        <span className="ranking-item__meta-label">{breakdownItem.label}</span>
                        <strong className="ranking-item__meta-value">{`${formatNumber(breakdownItem.count)}건`}</strong>
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
