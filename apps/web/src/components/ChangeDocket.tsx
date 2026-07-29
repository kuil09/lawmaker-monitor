import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { FunnelSimpleIcon } from "@phosphor-icons/react/dist/csr/FunnelSimple";
import { useMemo, useState } from "react";

import { MemberIdentity } from "./MemberIdentity.js";
import { buildCalendarHref } from "../lib/calendar-route.js";
import { formatMemberAffiliation } from "../lib/member-affiliation.js";
import "../styles/change-docket.css";

import type {
  AccountabilitySummaryExport,
  AccountabilityTrendsExport
} from "@lawmaker-monitor/schemas";

type ChangeDocketProps = {
  accountabilityTrends: AccountabilityTrendsExport | null;
  accountabilitySummary: AccountabilitySummaryExport | null;
};

type DocketTone = "attention" | "improved";
type DocketFilter = "all" | DocketTone;

type DocketItem = {
  memberId: string;
  name: string;
  party: string;
  district: string | null;
  photoUrl?: string | null;
  previousRate: number;
  currentRate: number;
  delta: number;
  currentCount: number;
  currentEligibleCount: number;
  tone: DocketTone;
};

const filters: Array<{ id: DocketFilter; label: string }> = [
  { id: "all", label: "전체 변화" },
  { id: "attention", label: "확인 필요" },
  { id: "improved", label: "개선" }
];

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

function buildDocketItems(
  trends: AccountabilityTrendsExport | null,
  summary: AccountabilitySummaryExport | null
): DocketItem[] {
  const summaryByMemberId = new Map(
    (summary?.items ?? []).map((member) => [member.memberId, member])
  );

  return (trends?.movers ?? [])
    .flatMap((mover): DocketItem[] => {
      const previousRate = getRate({
        noCount: mover.previousWindowNoCount,
        abstainCount: mover.previousWindowAbstainCount,
        absentCount: mover.previousWindowAbsentCount,
        eligibleCount: mover.previousWindowEligibleCount
      });
      const currentRate = getRate({
        noCount: mover.currentWindowNoCount,
        abstainCount: mover.currentWindowAbstainCount,
        absentCount: mover.currentWindowAbsentCount,
        eligibleCount: mover.currentWindowEligibleCount
      });

      if (previousRate === null || currentRate === null) {
        return [];
      }

      const delta = currentRate - previousRate;
      if (Math.abs(delta) < 0.0001) {
        return [];
      }

      const summaryMember = summaryByMemberId.get(mover.memberId);
      return [
        {
          memberId: mover.memberId,
          name: mover.name,
          party: mover.party,
          district: summaryMember?.district ?? null,
          photoUrl: mover.photoUrl,
          previousRate,
          currentRate,
          delta,
          currentCount:
            mover.currentWindowNoCount +
            mover.currentWindowAbstainCount +
            mover.currentWindowAbsentCount,
          currentEligibleCount: mover.currentWindowEligibleCount,
          tone: delta > 0 ? "attention" : "improved"
        }
      ];
    })
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta));
}

export function ChangeDocket({
  accountabilityTrends,
  accountabilitySummary
}: ChangeDocketProps) {
  const [activeFilter, setActiveFilter] = useState<DocketFilter>("all");
  const items = useMemo(
    () => buildDocketItems(accountabilityTrends, accountabilitySummary),
    [accountabilitySummary, accountabilityTrends]
  );
  const visibleItems = items
    .filter((item) => activeFilter === "all" || item.tone === activeFilter)
    .slice(0, 8);

  return (
    <section className="change-docket" aria-labelledby="change-docket-title">
      <header className="change-docket__head">
        <div>
          <p>BEFORE → AFTER DOCKET</p>
          <h2 id="change-docket-title">변화 전후 도켓</h2>
          <span>
            최근 구간과 직전 구간의 반대·기권·불참 비중을 같은 분모로
            비교합니다.
          </span>
        </div>
        <div className="change-docket__filters" aria-label="변화 필터">
          <FunnelSimpleIcon size={17} weight="bold" aria-hidden="true" />
          {filters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              aria-pressed={activeFilter === filter.id}
              onClick={() => setActiveFilter(filter.id)}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </header>

      {visibleItems.length > 0 ? (
        <ol className="change-docket__list">
          {visibleItems.map((item) => (
            <li key={item.memberId} className={`is-${item.tone}`}>
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
              <span className="change-docket__affiliation">
                {formatMemberAffiliation(item.party, item.district)}
              </span>
              <dl className="change-docket__values">
                <div>
                  <dt>이전</dt>
                  <dd>{formatPercent(item.previousRate)}</dd>
                </div>
                <ArrowRightIcon size={18} weight="bold" aria-hidden="true" />
                <div>
                  <dt>최근</dt>
                  <dd>{formatPercent(item.currentRate)}</dd>
                </div>
              </dl>
              <div className="change-docket__result">
                <strong>{`${item.delta > 0 ? "+" : ""}${(
                  item.delta * 100
                ).toFixed(1)}%p`}</strong>
                <span>
                  {`${item.currentCount}/${item.currentEligibleCount}건`}
                </span>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="change-docket__empty">
          선택한 조건에서 비교 가능한 변화 기록이 없습니다.
        </p>
      )}
    </section>
  );
}
