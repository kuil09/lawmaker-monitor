import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { useMemo, useState } from "react";

import { MemberIdentity } from "./MemberIdentity.js";
import { buildCalendarHref } from "../lib/calendar-route.js";
import "../styles/change-docket.css";

import type {
  AccountabilitySummaryExport,
  AccountabilityTrendsExport,
  BillProposalActivityExport
} from "@lawmaker-monitor/schemas";

type ChangeDocketProps = {
  accountabilityTrends: AccountabilityTrendsExport | null;
  accountabilitySummary: AccountabilitySummaryExport | null;
  billProposalActivity: BillProposalActivityExport | null;
};

type DocketStatus =
  | "absence"
  | "legislative"
  | "changed"
  | "steady"
  | "unobserved";
type DocketFilter = "all" | DocketStatus;

type DocketItem = {
  memberId: string;
  name: string;
  party: string;
  district: string | null;
  photoUrl?: string | null;
  previousRate: number | null;
  currentRate: number | null;
  delta: number | null;
  currentNegativeCount: number;
  currentEligibleCount: number;
  currentAbsentCount: number;
  latestProposalAt: string | null;
  totalProposalCount: number;
  statuses: DocketStatus[];
  primaryStatus: DocketStatus;
};

const statusMeta: Record<
  DocketStatus,
  { label: string; shortLabel: string; description: string }
> = {
  absence: {
    label: "불참 기록",
    shortLabel: "불참",
    description: "최근 비교 구간의 공개 표결에서 불참 기록이 있습니다."
  },
  legislative: {
    label: "입법 활동 참여",
    shortLabel: "입법 참여",
    description: "최근 비교 구간에 발의 또는 공동발의 기록이 있습니다."
  },
  changed: {
    label: "표결 변화",
    shortLabel: "변화",
    description: "직전 구간과 비교해 반대·기권·불참 비중이 달라졌습니다."
  },
  steady: {
    label: "현황 유지",
    shortLabel: "유지",
    description: "비교 가능한 두 구간의 반대·기권·불참 비중이 같습니다."
  },
  unobserved: {
    label: "관측 대기",
    shortLabel: "대기",
    description: "두 구간을 비교할 공개 표결 기록이 충분하지 않습니다."
  }
};

const filters: Array<{ id: DocketFilter; label: string }> = [
  { id: "all", label: "전체 의원" },
  { id: "absence", label: "불참 기록" },
  { id: "legislative", label: "입법 활동 참여" },
  { id: "changed", label: "표결 변화" },
  { id: "steady", label: "현황 유지" },
  { id: "unobserved", label: "관측 대기" }
];

const statusOrder: Record<DocketStatus, number> = {
  absence: 0,
  legislative: 1,
  changed: 2,
  steady: 3,
  unobserved: 4
};

function getRate(args: {
  noCount: number;
  abstainCount: number;
  absentCount: number;
  eligibleCount: number;
}): number | null {
  if (args.eligibleCount <= 0) {
    return null;
  }

  return (
    (args.noCount + args.abstainCount + args.absentCount) / args.eligibleCount
  );
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatShortDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split("-");
  if (!year || !month || !day) {
    return value;
  }
  return `${Number(month)}/${Number(day)}`;
}

function normalizeSearchValue(value: string): string {
  return value.toLocaleLowerCase("ko-KR").replace(/\s+/g, "");
}

function buildDocketItems(
  trends: AccountabilityTrendsExport | null,
  summary: AccountabilitySummaryExport | null,
  billActivity: BillProposalActivityExport | null
): DocketItem[] {
  const summaryByMemberId = new Map(
    (summary?.items ?? []).map((member) => [member.memberId, member])
  );
  const moverByMemberId = new Map(
    (trends?.movers ?? []).map((mover) => [mover.memberId, mover])
  );
  const billActivityByMemberId = new Map(
    (billActivity?.items ?? []).map((item) => [item.memberId, item])
  );
  const memberIds = new Set([
    ...summaryByMemberId.keys(),
    ...moverByMemberId.keys(),
    ...billActivityByMemberId.keys()
  ]);
  const recentWindowStart =
    trends?.weeks.slice(-4)[0]?.weekStart ??
    billActivity?.generatedAt.slice(0, 10) ??
    null;

  return [...memberIds]
    .flatMap((memberId): DocketItem[] => {
      const summaryMember = summaryByMemberId.get(memberId);
      const mover = moverByMemberId.get(memberId);
      const billItem = billActivityByMemberId.get(memberId);
      const name = summaryMember?.name ?? mover?.name ?? billItem?.name;
      const party = summaryMember?.party ?? mover?.party ?? billItem?.party;

      if (!name || !party) {
        return [];
      }

      const previousRate = mover
        ? getRate({
            noCount: mover.previousWindowNoCount,
            abstainCount: mover.previousWindowAbstainCount,
            absentCount: mover.previousWindowAbsentCount,
            eligibleCount: mover.previousWindowEligibleCount
          })
        : null;
      const currentRate = mover
        ? getRate({
            noCount: mover.currentWindowNoCount,
            abstainCount: mover.currentWindowAbstainCount,
            absentCount: mover.currentWindowAbsentCount,
            eligibleCount: mover.currentWindowEligibleCount
          })
        : null;
      const delta =
        previousRate === null || currentRate === null
          ? null
          : currentRate - previousRate;
      const hasRecentProposal = Boolean(
        recentWindowStart &&
        billItem?.latestProposalAt &&
        billItem.latestProposalAt.slice(0, 10) >= recentWindowStart
      );
      const currentAbsentCount = mover?.currentWindowAbsentCount ?? 0;
      const statuses: DocketStatus[] = [];

      if (currentAbsentCount > 0) {
        statuses.push("absence");
      }
      if (hasRecentProposal) {
        statuses.push("legislative");
      }
      if (delta !== null && Math.abs(delta) >= 0.0001) {
        statuses.push("changed");
      } else if (delta !== null) {
        statuses.push("steady");
      } else {
        statuses.push("unobserved");
      }

      return [
        {
          memberId,
          name,
          party,
          district: summaryMember?.district ?? billItem?.district ?? null,
          photoUrl: summaryMember?.photoUrl ?? mover?.photoUrl,
          previousRate,
          currentRate,
          delta,
          currentNegativeCount: mover
            ? mover.currentWindowNoCount +
              mover.currentWindowAbstainCount +
              mover.currentWindowAbsentCount
            : 0,
          currentEligibleCount: mover?.currentWindowEligibleCount ?? 0,
          currentAbsentCount,
          latestProposalAt: billItem?.latestProposalAt ?? null,
          totalProposalCount: billItem?.totalProposalCount ?? 0,
          statuses,
          primaryStatus: statuses[0] ?? "unobserved"
        }
      ];
    })
    .sort((left, right) => {
      const statusDifference =
        statusOrder[left.primaryStatus] - statusOrder[right.primaryStatus];
      if (statusDifference !== 0) {
        return statusDifference;
      }
      if (left.primaryStatus === "absence") {
        const absenceDifference =
          right.currentAbsentCount - left.currentAbsentCount;
        if (absenceDifference !== 0) {
          return absenceDifference;
        }
      }
      if (left.primaryStatus === "legislative") {
        const dateDifference = (right.latestProposalAt ?? "").localeCompare(
          left.latestProposalAt ?? ""
        );
        if (dateDifference !== 0) {
          return dateDifference;
        }
      }
      if (left.primaryStatus === "changed") {
        const deltaDifference =
          Math.abs(right.delta ?? 0) - Math.abs(left.delta ?? 0);
        if (deltaDifference !== 0) {
          return deltaDifference;
        }
      }
      return left.name.localeCompare(right.name, "ko-KR");
    });
}

export function ChangeDocket({
  accountabilityTrends,
  accountabilitySummary,
  billProposalActivity
}: ChangeDocketProps) {
  const [activeFilter, setActiveFilter] = useState<DocketFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const items = useMemo(
    () =>
      buildDocketItems(
        accountabilityTrends,
        accountabilitySummary,
        billProposalActivity
      ),
    [accountabilitySummary, accountabilityTrends, billProposalActivity]
  );
  const counts = useMemo(
    () =>
      items.reduce(
        (result, item) => {
          item.statuses.forEach((status) => {
            result[status] += 1;
          });
          return result;
        },
        {
          absence: 0,
          legislative: 0,
          changed: 0,
          steady: 0,
          unobserved: 0
        } satisfies Record<DocketStatus, number>
      ),
    [items]
  );
  const normalizedQuery = normalizeSearchValue(searchQuery);
  const visibleItems = items.filter((item) => {
    if (activeFilter !== "all" && !item.statuses.includes(activeFilter)) {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }
    return normalizeSearchValue(
      `${item.name} ${item.party} ${item.district ?? ""}`
    ).includes(normalizedQuery);
  });

  return (
    <section className="change-docket" aria-labelledby="change-docket-title">
      <header className="change-docket__head">
        <div>
          <p>LIVE MEMBER DOCKET</p>
          <h2 id="change-docket-title">의원 활동 현황판</h2>
          <span>
            의원 전원을 최근 공개 표결과 입법 기록에 따라 한 화면에서
            비교합니다.
          </span>
        </div>
        <p className="change-docket__coverage">
          <strong>{items.length}명</strong>
          <span>현재 확인 가능</span>
        </p>
      </header>

      <div className="change-docket__toolbar">
        <div className="change-docket__filters" aria-label="활동 상태 필터">
          {filters.map((filter) => {
            const count =
              filter.id === "all" ? items.length : counts[filter.id];
            return (
              <button
                key={filter.id}
                type="button"
                aria-pressed={activeFilter === filter.id}
                onClick={() => setActiveFilter(filter.id)}
              >
                <span>{filter.label}</span>
                <strong>{count}</strong>
              </button>
            );
          })}
        </div>
        <label className="change-docket__search">
          <span className="sr-only">의원·정당·지역구 검색</span>
          <MagnifyingGlassIcon size={17} weight="bold" aria-hidden="true" />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="의원·정당·지역구 검색"
          />
        </label>
      </div>

      <div className="change-docket__legend" aria-label="현황 분류 안내">
        {(Object.keys(statusMeta) as DocketStatus[]).map((status) => (
          <span key={status} className={`is-${status}`}>
            <i aria-hidden="true" />
            <strong>{statusMeta[status].label}</strong>
            <small>{statusMeta[status].description}</small>
          </span>
        ))}
      </div>

      <p className="change-docket__result-count" aria-live="polite">
        전체 {items.length}명 중 <strong>{visibleItems.length}명</strong> 표시
      </p>

      {visibleItems.length > 0 ? (
        <ol className="change-docket__board" data-testid="change-docket-board">
          {visibleItems.map((item) => (
            <li
              key={item.memberId}
              className={`is-${item.primaryStatus}`}
              data-docket-status={item.statuses.join(" ")}
            >
              <div className="change-docket__statuses">
                {item.statuses.map((status) => (
                  <span key={status} className={`is-${status}`}>
                    <i aria-hidden="true" />
                    <strong>{statusMeta[status].shortLabel}</strong>
                  </span>
                ))}
              </div>
              <MemberIdentity
                name={item.name}
                party={item.party}
                district={item.district}
                photoUrl={item.photoUrl}
                calendarHref={buildCalendarHref({
                  memberId: item.memberId
                })}
                size="small"
              />
              <dl className="change-docket__values">
                {item.previousRate !== null && item.currentRate !== null ? (
                  <>
                    <div>
                      <dt>직전</dt>
                      <dd>{formatPercent(item.previousRate)}</dd>
                    </div>
                    <ArrowRightIcon
                      size={15}
                      weight="bold"
                      aria-hidden="true"
                    />
                    <div>
                      <dt>최근</dt>
                      <dd>{formatPercent(item.currentRate)}</dd>
                    </div>
                  </>
                ) : (
                  <div className="change-docket__unobserved-value">
                    <dt>표결 비교</dt>
                    <dd>관측 대기</dd>
                  </div>
                )}
              </dl>
              <div className="change-docket__signals">
                <span>
                  <small>불참</small>
                  <strong>
                    {item.currentEligibleCount > 0
                      ? `${item.currentAbsentCount}/${item.currentEligibleCount}`
                      : "—"}
                  </strong>
                </span>
                <span>
                  <small>최근 비참여 합계</small>
                  <strong>
                    {item.currentEligibleCount > 0
                      ? `${item.currentNegativeCount}건`
                      : "—"}
                  </strong>
                </span>
                <span>
                  <small>최근 발의</small>
                  <strong>
                    {item.latestProposalAt
                      ? formatShortDate(item.latestProposalAt)
                      : "—"}
                  </strong>
                </span>
              </div>
              <footer className="change-docket__ticker">
                <span>누적 입법 {item.totalProposalCount}건</span>
                {item.delta !== null ? (
                  <strong>
                    {`${item.delta > 0 ? "+" : ""}${(item.delta * 100).toFixed(
                      1
                    )}%p`}
                  </strong>
                ) : (
                  <strong>비교 전</strong>
                )}
              </footer>
            </li>
          ))}
        </ol>
      ) : (
        <p className="change-docket__empty">
          선택한 조건에 해당하는 의원이 없습니다.
        </p>
      )}
    </section>
  );
}
