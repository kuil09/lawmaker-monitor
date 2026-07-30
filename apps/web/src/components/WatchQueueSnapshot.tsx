import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { WarningDiamondIcon } from "@phosphor-icons/react/dist/csr/WarningDiamond";
import { useMemo, useState } from "react";

import { MemberIdentity } from "./MemberIdentity.js";
import { buildCalendarHref } from "../lib/calendar-route.js";
import { formatDate, formatDateTime, formatNumber } from "../lib/format.js";
import { formatMemberAffiliation } from "../lib/member-affiliation.js";
import "../styles/watch-queue-snapshot.css";

import type {
  AccountabilitySummaryExport,
  AccountabilityTrendsExport,
  BillProposalActivityExport
} from "@lawmaker-monitor/schemas";

type QueueTone = "attention" | "change" | "evidence";

type VoteWindowBreakdown = {
  eligibleCount: number;
  yesCount: number;
  noCount: number;
  abstainCount: number;
  absentCount: number;
};

type QueueRecord = {
  id: string;
  tone: QueueTone;
  memberId: string;
  name: string;
  party: string;
  district: string | null;
  photoUrl?: string | null;
  recordType: "표결 변화" | "입법 결과" | "행위 부재";
  headline: string;
  rationale: string;
  previousValue: number | null;
  currentValue: number | null;
  delta: number | null;
  currentLabel: string;
  actionLabel: string;
  basisLabel: string;
  generatedAt: string | null;
  voteComparison?: {
    previous: VoteWindowBreakdown;
    current: VoteWindowBreakdown;
  };
};

type WatchQueueSnapshotProps = {
  accountabilitySummary: AccountabilitySummaryExport | null;
  accountabilityTrends: AccountabilityTrendsExport | null;
  billProposalActivity: BillProposalActivityExport | null;
  loading: boolean;
  unavailable: boolean;
  onOpenMember: (memberId: string) => void;
};

const donationCenterUrl =
  "https://www.give.go.kr/portal/supporter/supporterSearch/list.do?menuNo=200025";

const filterLabels: Array<{ id: QueueTone; label: string }> = [
  { id: "attention", label: "확인 필요" },
  { id: "change", label: "표결 변화" },
  { id: "evidence", label: "결과 확인" }
];

function getWindowNegativeRate(args: {
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

function buildVoteWindowBreakdown(args: {
  eligibleCount: number;
  noCount: number;
  abstainCount: number;
  absentCount: number;
}): VoteWindowBreakdown {
  return {
    eligibleCount: args.eligibleCount,
    yesCount: Math.max(
      0,
      args.eligibleCount - args.noCount - args.abstainCount - args.absentCount
    ),
    noCount: args.noCount,
    abstainCount: args.abstainCount,
    absentCount: args.absentCount
  };
}

function getDominantVoteRecord(window: VoteWindowBreakdown): {
  key: "yes" | "no" | "abstain" | "absent";
  label: string;
  count: number;
} {
  return [
    { key: "yes" as const, label: "찬성", count: window.yesCount },
    { key: "no" as const, label: "반대", count: window.noCount },
    { key: "abstain" as const, label: "기권", count: window.abstainCount },
    { key: "absent" as const, label: "불참", count: window.absentCount }
  ].reduce((dominant, item) => (item.count > dominant.count ? item : dominant));
}

function buildVoteChangeHeadline(
  previous: VoteWindowBreakdown,
  current: VoteWindowBreakdown
): string {
  const previousDominant = getDominantVoteRecord(previous);
  const currentDominant = getDominantVoteRecord(current);

  if (previousDominant.key !== currentDominant.key) {
    return `주된 표결 기록: 직전 ${previousDominant.label} ${formatNumber(
      previousDominant.count
    )}건 → 최근 ${currentDominant.label} ${formatNumber(
      currentDominant.count
    )}건`;
  }

  return `최근 ${formatNumber(
    current.eligibleCount
  )}건의 표결 선택이 직전 구간과 달라졌습니다.`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function parseTimestamp(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function buildChangeRecords(
  trends: AccountabilityTrendsExport | null,
  summary: AccountabilitySummaryExport | null
): QueueRecord[] {
  const summaryByMemberId = new Map(
    (summary?.items ?? []).map((member) => [member.memberId, member])
  );

  return (trends?.movers ?? [])
    .flatMap((mover): QueueRecord[] => {
      const previousValue = getWindowNegativeRate({
        noCount: mover.previousWindowNoCount,
        abstainCount: mover.previousWindowAbstainCount,
        absentCount: mover.previousWindowAbsentCount,
        eligibleCount: mover.previousWindowEligibleCount
      });
      const currentValue = getWindowNegativeRate({
        noCount: mover.currentWindowNoCount,
        abstainCount: mover.currentWindowAbstainCount,
        absentCount: mover.currentWindowAbsentCount,
        eligibleCount: mover.currentWindowEligibleCount
      });

      if (previousValue === null || currentValue === null) {
        return [];
      }

      const delta = currentValue - previousValue;
      if (Math.abs(delta) < 0.0001) {
        return [];
      }

      const summaryMember = summaryByMemberId.get(mover.memberId);
      const previousBreakdown = buildVoteWindowBreakdown({
        eligibleCount: mover.previousWindowEligibleCount,
        noCount: mover.previousWindowNoCount,
        abstainCount: mover.previousWindowAbstainCount,
        absentCount: mover.previousWindowAbsentCount
      });
      const currentBreakdown = buildVoteWindowBreakdown({
        eligibleCount: mover.currentWindowEligibleCount,
        noCount: mover.currentWindowNoCount,
        abstainCount: mover.currentWindowAbstainCount,
        absentCount: mover.currentWindowAbsentCount
      });
      return [
        {
          id: `trend:${mover.memberId}`,
          tone: "change",
          memberId: mover.memberId,
          name: mover.name,
          party: mover.party,
          district: summaryMember?.district ?? null,
          photoUrl: mover.photoUrl ?? summaryMember?.photoUrl,
          recordType: "표결 변화",
          headline: buildVoteChangeHeadline(
            previousBreakdown,
            currentBreakdown
          ),
          rationale:
            "찬성·반대·기권은 표결에 참여한 기록입니다. 불참은 해당 기록표결에서 표를 행사하지 않은 경우로 따로 표시합니다.",
          previousValue,
          currentValue,
          delta,
          currentLabel: "최근 표결 참여",
          actionLabel: "표결별 기록 보기",
          basisLabel: `직전 ${formatNumber(
            mover.previousWindowEligibleCount
          )}건 · 최근 ${formatNumber(mover.currentWindowEligibleCount)}건`,
          generatedAt: trends?.generatedAt ?? null,
          voteComparison: {
            previous: previousBreakdown,
            current: currentBreakdown
          }
        }
      ];
    })
    .sort(
      (left, right) => Math.abs(right.delta ?? 0) - Math.abs(left.delta ?? 0)
    );
}

function buildLegislativeRecords(
  data: BillProposalActivityExport | null,
  summary: AccountabilitySummaryExport | null
): QueueRecord[] {
  const summaryByMemberId = new Map(
    (summary?.items ?? []).map((member) => [member.memberId, member])
  );

  return [...(data?.items ?? [])]
    .filter((member) => member.leadResultAvailableProposalCount > 0)
    .sort((left, right) => {
      const leftOutcomeCount =
        left.leadPassedProposalCount +
        left.leadAlternativeReflectedProposalCount;
      const rightOutcomeCount =
        right.leadPassedProposalCount +
        right.leadAlternativeReflectedProposalCount;
      return (
        rightOutcomeCount / right.leadResultAvailableProposalCount -
        leftOutcomeCount / left.leadResultAvailableProposalCount
      );
    })
    .slice(0, 3)
    .map((member) => {
      const summaryMember = summaryByMemberId.get(member.memberId);
      const outcomeCount =
        member.leadPassedProposalCount +
        member.leadAlternativeReflectedProposalCount;
      const outcomeRate =
        outcomeCount / member.leadResultAvailableProposalCount;
      return {
        id: `legislation:${member.memberId}`,
        tone: "evidence" as const,
        memberId: member.memberId,
        name: member.name,
        party: member.party,
        district: member.district ?? summaryMember?.district ?? null,
        photoUrl: summaryMember?.photoUrl,
        recordType: "입법 결과" as const,
        headline: `대표발의 ${member.leadProposalCount}건 중 처리결과가 확인된 기록입니다.`,
        rationale:
          "통과와 대안반영은 공개된 처리결과가 있는 대표발의만 분모로 계산했습니다.",
        previousValue: null,
        currentValue: outcomeRate,
        delta: null,
        currentLabel: "가결·대안반영",
        actionLabel: "입법 결과 근거 보기",
        basisLabel: `${outcomeCount}/${member.leadResultAvailableProposalCount}건`,
        generatedAt: data?.generatedAt ?? null
      };
    });
}

function buildAbsenceRecords(
  summary: AccountabilitySummaryExport | null
): QueueRecord[] {
  return [...(summary?.items ?? [])]
    .filter((member) => member.totalRecordedVotes > 0 && member.absentCount > 0)
    .sort(
      (left, right) =>
        right.absentCount / right.totalRecordedVotes -
        left.absentCount / left.totalRecordedVotes
    )
    .slice(0, 3)
    .map((member) => {
      const absenceRate = member.absentCount / member.totalRecordedVotes;
      return {
        id: `absence:${member.memberId}`,
        tone: "attention" as const,
        memberId: member.memberId,
        name: member.name,
        party: member.party,
        district: member.district ?? null,
        photoUrl: member.photoUrl,
        recordType: "행위 부재" as const,
        headline: `공개 기록표결 결석률이 ${formatPercent(absenceRate)}입니다.`,
        rationale:
          "공개된 기록표결 중 불참으로 기록된 건수를 같은 분모로 비교했습니다.",
        previousValue: null,
        currentValue: absenceRate,
        delta: null,
        currentLabel: "결석률",
        actionLabel: "표결별 결석 근거 보기",
        basisLabel: `${formatNumber(
          member.totalRecordedVotes
        )}건 중 불참 ${formatNumber(member.absentCount)}건`,
        generatedAt: summary?.generatedAt ?? null
      };
    });
}

function QueueStateIcon({ tone }: { tone: QueueTone }) {
  if (tone === "attention") {
    return <WarningDiamondIcon aria-hidden="true" size={17} weight="fill" />;
  }
  return <CheckCircleIcon aria-hidden="true" size={17} weight="fill" />;
}

function VoteComparison({
  comparison
}: {
  comparison: NonNullable<QueueRecord["voteComparison"]>;
}) {
  const rows = [
    {
      label: "표결 참여",
      previous:
        comparison.previous.yesCount +
        comparison.previous.noCount +
        comparison.previous.abstainCount,
      current:
        comparison.current.yesCount +
        comparison.current.noCount +
        comparison.current.abstainCount,
      summary: true
    },
    {
      label: "찬성",
      previous: comparison.previous.yesCount,
      current: comparison.current.yesCount
    },
    {
      label: "반대",
      previous: comparison.previous.noCount,
      current: comparison.current.noCount
    },
    {
      label: "기권",
      previous: comparison.previous.abstainCount,
      current: comparison.current.abstainCount
    },
    {
      label: "표결 불참",
      previous: comparison.previous.absentCount,
      current: comparison.current.absentCount,
      summary: true
    }
  ];

  return (
    <div
      className="watch-queue-record__vote-comparison"
      role="table"
      aria-label="직전과 최근 표결 기록 비교"
    >
      <div role="row" className="watch-queue-record__vote-comparison-head">
        <span role="columnheader">구분</span>
        <span role="columnheader">
          {`직전 ${formatNumber(comparison.previous.eligibleCount)}건`}
        </span>
        <span role="columnheader">
          {`최근 ${formatNumber(comparison.current.eligibleCount)}건`}
        </span>
      </div>
      {rows.map((row) => (
        <div
          key={row.label}
          role="row"
          className={row.summary ? "is-summary" : undefined}
        >
          <span role="rowheader">{row.label}</span>
          <strong role="cell">{`${formatNumber(row.previous)}건`}</strong>
          <strong role="cell">{`${formatNumber(row.current)}건`}</strong>
        </div>
      ))}
    </div>
  );
}

export function WatchQueueSnapshot({
  accountabilitySummary,
  accountabilityTrends,
  billProposalActivity,
  loading,
  unavailable,
  onOpenMember
}: WatchQueueSnapshotProps) {
  const [activeFilters, setActiveFilters] = useState<
    Record<QueueTone, boolean>
  >({
    attention: true,
    change: true,
    evidence: true
  });
  const [showAll, setShowAll] = useState(false);
  const records = useMemo(
    () =>
      [
        ...buildChangeRecords(accountabilityTrends, accountabilitySummary),
        ...buildAbsenceRecords(accountabilitySummary),
        ...buildLegislativeRecords(billProposalActivity, accountabilitySummary)
      ].sort(
        (left, right) =>
          parseTimestamp(right.generatedAt) - parseTimestamp(left.generatedAt)
      ),
    [accountabilitySummary, accountabilityTrends, billProposalActivity]
  );
  const filteredRecords = records.filter(
    (record) => activeFilters[record.tone]
  );
  const visibleRecords = filteredRecords.slice(0, showAll ? 10 : 5);
  const latestGeneratedAt =
    [
      accountabilityTrends?.generatedAt,
      accountabilitySummary?.generatedAt,
      billProposalActivity?.generatedAt
    ]
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => parseTimestamp(right) - parseTimestamp(left))[0] ??
    null;
  const observedPeriod =
    accountabilityTrends && accountabilityTrends.weeks.length > 0
      ? `${formatDate(accountabilityTrends.weeks[0]!.weekStart)} – ${formatDate(
          accountabilityTrends.weeks.at(-1)!.weekEnd
        )}`
      : "관측 기간 확인 중";

  function toggleFilter(filter: QueueTone) {
    setActiveFilters((current) => ({
      ...current,
      [filter]: !current[filter]
    }));
  }

  return (
    <section
      className="watch-queue-snapshot"
      aria-labelledby="watch-queue-snapshot-title"
    >
      <header className="watch-queue-snapshot__heading">
        <div>
          <p>국회 출석부 · 최근 수집 기록</p>
          <h2 id="watch-queue-snapshot-title">국회 출석부</h2>
        </div>
        <p>
          최근 수집된 공개 기록을 변화·결과·행위 부재 기준으로 확인하고 공식
          근거까지 따라갑니다.
          {latestGeneratedAt ? (
            <time dateTime={latestGeneratedAt}>
              {` 최근 수집 ${formatDateTime(latestGeneratedAt)}`}
            </time>
          ) : null}
        </p>
      </header>

      <div className="watch-queue-workbench">
        <aside className="watch-queue-filters" aria-label="국회 출석부 필터">
          <div>
            <h3>증거 상태</h3>
            {filterLabels.map((filter) => (
              <label key={filter.id}>
                <input
                  type="checkbox"
                  checked={activeFilters[filter.id]}
                  onChange={() => toggleFilter(filter.id)}
                />
                <span className={`is-${filter.id}`} aria-hidden="true" />
                {filter.label}
              </label>
            ))}
          </div>
          <div>
            <h3>관측 범위</h3>
            <dl>
              <div>
                <dt>의원</dt>
                <dd>
                  {accountabilitySummary
                    ? `${formatNumber(accountabilitySummary.items.length)}명`
                    : "미수집"}
                </dd>
              </div>
              <div>
                <dt>기간</dt>
                <dd>{observedPeriod}</dd>
              </div>
            </dl>
          </div>
          <p>
            공개 기록 범위의 관찰 신호이며 위법성·무능·의도를 판정하지 않습니다.
          </p>
        </aside>

        <div className="watch-queue-feed">
          <div className="watch-queue-feed__toolbar">
            <strong role="status" aria-live="polite" aria-atomic="true">
              {`전체 ${filteredRecords.length}건 중 ${visibleRecords.length}건 표시`}
            </strong>
            <span>수집 시점 최신순 · 전후 비교 우선</span>
          </div>
          {loading && records.length === 0 ? (
            <p className="watch-queue-feed__empty">
              공개 기록을 수집 중입니다.
            </p>
          ) : unavailable && records.length === 0 ? (
            <p className="watch-queue-feed__empty">
              일부 공개 기록을 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.
            </p>
          ) : visibleRecords.length > 0 ? (
            <ol>
              {visibleRecords.map((record) => (
                <li key={record.id}>
                  <article className={`watch-queue-record is-${record.tone}`}>
                    <header>
                      <span>
                        <QueueStateIcon tone={record.tone} />
                        {record.tone === "attention"
                          ? "추가 확인"
                          : record.tone === "change"
                            ? "변화 기록"
                            : "결과 확인"}
                      </span>
                      <small>{record.recordType}</small>
                    </header>
                    <div className="watch-queue-record__body">
                      <MemberIdentity
                        name={record.name}
                        party={record.party}
                        district={record.district}
                        photoUrl={record.photoUrl}
                        calendarHref={buildCalendarHref({
                          memberId: record.memberId
                        })}
                        size="small"
                      />
                      <div>
                        <h3>{record.headline}</h3>
                        <p>{record.rationale}</p>
                        {record.voteComparison ? (
                          <VoteComparison comparison={record.voteComparison} />
                        ) : null}
                        <dl>
                          {record.voteComparison ||
                          record.previousValue === null ? null : (
                            <div>
                              <dt>직전 비중</dt>
                              <dd>{formatPercent(record.previousValue)}</dd>
                            </div>
                          )}
                          {record.voteComparison ||
                          record.currentValue === null ? null : (
                            <div>
                              <dt>{record.currentLabel}</dt>
                              <dd>{formatPercent(record.currentValue)}</dd>
                            </div>
                          )}
                          <div>
                            <dt>근거</dt>
                            <dd>{record.basisLabel}</dd>
                          </div>
                          <div>
                            <dt>수집</dt>
                            <dd>
                              {record.generatedAt
                                ? formatDate(record.generatedAt)
                                : "확인 중"}
                            </dd>
                          </div>
                        </dl>
                      </div>
                    </div>
                    <footer>
                      <button
                        type="button"
                        onClick={() => onOpenMember(record.memberId)}
                      >
                        {record.actionLabel}
                        <ArrowRightIcon aria-hidden="true" size={15} />
                      </button>
                      <span>
                        {formatMemberAffiliation(record.party, record.district)}
                      </span>
                    </footer>
                  </article>
                </li>
              ))}
            </ol>
          ) : (
            <p className="watch-queue-feed__empty">
              선택한 증거 상태에 해당하는 공개 기록이 없습니다.
            </p>
          )}
          {filteredRecords.length > 5 ? (
            <button
              type="button"
              className="watch-queue-feed__more"
              onClick={() => setShowAll((current) => !current)}
            >
              <ClockCounterClockwiseIcon aria-hidden="true" size={17} />
              {showAll ? "최근 5건만 보기" : "이전 기록 더 보기"}
            </button>
          ) : null}
        </div>

        <aside className="watch-queue-briefing" aria-label="국회 출석부 브리핑">
          <section>
            <p>HOT ISSUES</p>
            <h3>지금 주목할 변화</h3>
            <ol>
              {records.slice(0, 3).map((record) => (
                <li key={`brief:${record.id}`}>
                  <button
                    type="button"
                    onClick={() => onOpenMember(record.memberId)}
                  >
                    <strong>{record.name}</strong>
                    <span>{record.headline}</span>
                  </button>
                </li>
              ))}
            </ol>
          </section>
          <section>
            <p>SOURCE COVERAGE</p>
            <h3>공개 범위</h3>
            <dl>
              <div>
                <dt>변화 비교</dt>
                <dd>
                  {accountabilityTrends
                    ? `${formatNumber(accountabilityTrends.movers.length)}명`
                    : "미수집"}
                </dd>
              </div>
              <div>
                <dt>입법 결과</dt>
                <dd>
                  {billProposalActivity
                    ? `${formatNumber(billProposalActivity.items.length)}명`
                    : "미수집"}
                </dd>
              </div>
            </dl>
          </section>
          <section className="watch-queue-briefing__account">
            <p>공식 후원 정보</p>
            <h3>후원회·계좌 확인</h3>
            <span>
              검증된 계좌만 의원 상세에서 복사할 수 있습니다. 송금 전 공식
              출처를 다시 확인하세요.
            </span>
            <a href={donationCenterUrl} target="_blank" rel="noreferrer">
              중앙선관위 후원회 찾기
              <ArrowRightIcon aria-hidden="true" size={15} />
            </a>
          </section>
        </aside>
      </div>
    </section>
  );
}
