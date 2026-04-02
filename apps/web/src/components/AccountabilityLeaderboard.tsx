import { useState } from "react";

import type { AccountabilitySummaryItem } from "@lawmaker-monitor/schemas";

import { buildCalendarHref } from "../lib/calendar-route.js";
import {
  getYesCount,
  rankLeaderboardItems,
  type LeaderboardMetric
} from "../lib/accountability.js";
import { formatNumber, formatPercent } from "../lib/format.js";
import type { MemberAttendanceSummary } from "../lib/member-activity.js";
import { MemberIdentity } from "./MemberIdentity.js";

type AccountabilityLeaderboardProps = {
  items: AccountabilitySummaryItem[];
  assemblyLabel: string;
  attendanceByMemberId?: Map<string, MemberAttendanceSummary>;
};

const leaderboardMetricOptions: Array<{
  value: LeaderboardMetric;
  label: string;
}> = [
  { value: "absent", label: "불참" },
  { value: "no", label: "반대" },
  { value: "abstain", label: "기권" },
  { value: "yes", label: "찬성" }
];

export function AccountabilityLeaderboard({
  items,
  assemblyLabel,
  attendanceByMemberId
}: AccountabilityLeaderboardProps) {
  const [metric, setMetric] = useState<LeaderboardMetric>("absent");
  const rankedItems = rankLeaderboardItems(items, metric).slice(0, 10);
  const metricLabel =
    leaderboardMetricOptions.find((option) => option.value === metric)?.label ?? "불참";
  const leaderboardCopy =
    metric === "absent"
      ? "불참 기준으로 먼저 정렬해 출석 문제를 바로 드러내고, 나머지 선택 구성은 작은 막대로 함께 봅니다."
      : `${metricLabel} 기준으로 정렬하되, 불참 막대를 함께 남겨 출석 문제를 놓치지 않도록 했습니다.`;

  return (
    <section className="leaderboard-panel">
      <div className="leaderboard-panel__header">
        <div>
          <p className="section-label">의원 랭킹</p>
          <h2>{`${assemblyLabel} 의원 순위`}</h2>
        </div>
        <div className="metric-toggle" role="tablist" aria-label="의원 랭킹 기준">
          {leaderboardMetricOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={metric === option.value}
              className={
                metric === option.value
                  ? `metric-toggle__button is-active metric-toggle__button--${option.value}`
                  : `metric-toggle__button metric-toggle__button--${option.value}`
              }
              onClick={() => setMetric(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <p className="leaderboard-panel__copy">
        {leaderboardCopy}
      </p>

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
    </section>
  );
}
