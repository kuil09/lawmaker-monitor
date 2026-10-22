import { useEffect, useMemo, useState } from "react";

import { MemberCareerConnections } from "./MemberCareerConnections.js";
import { MemberConditionDistance } from "./MemberConditionDistance.js";
import {
  loadMemberAnalysisDetail,
  loadMemberAnalysisIndex
} from "../lib/data.js";
import { formatDateTime } from "../lib/format.js";
import { aggregatePeriodMetrics } from "../lib/member-analysis.js";
import "../styles/v3-evidence.css";
import "../styles/member-analysis.css";

import type {
  AnalysisMember,
  MemberAnalysisDetail,
  MemberAnalysisIndex
} from "@lawmaker-monitor/schemas";

const kindNames = {
  vote: "표결 참여",
  proposal: "대표발의",
  statement: "발언"
};
function percent(value: number | null) {
  return value === null ? "자료 없음" : `${(value * 100).toFixed(1)}%`;
}
function amount(value: number) {
  return `${(value / 100_000).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}억원`;
}
function chooseMember(memberId: string) {
  window.location.hash = `analysis?member=${encodeURIComponent(memberId)}`;
}
function monthRange(from: string, to: string): string[] {
  if (!/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to) || from > to)
    return [];
  const months = [];
  const date = new Date(`${from}-01T00:00:00Z`);
  while (date.toISOString().slice(0, 7) <= to && months.length < 1200) {
    months.push(date.toISOString().slice(0, 7));
    date.setUTCMonth(date.getUTCMonth() + 1);
  }
  return months;
}
function EvidenceLink({
  href,
  children
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
      <span className="analysis-external" aria-hidden="true">
        {" "}
        ↗
      </span>
    </a>
  );
}
function MetricRow({ metrics }: { metrics: MemberAnalysisDetail["metrics"] }) {
  return (
    <>
      <td>
        {percent(metrics.participationRate)}{" "}
        <small>
          ({metrics.participatedVotes}/{metrics.eligibleVotes})
        </small>
      </td>
      <td>{metrics.unknownVotes}</td>
      <td>{metrics.proposals}</td>
      <td>{metrics.statements}</td>
    </>
  );
}

export function MemberAnalysisPage({ memberId }: { memberId: string | null }) {
  const [index, setIndex] = useState<MemberAnalysisIndex | null>(null);
  const [indexLoading, setIndexLoading] = useState(true);
  const [detail, setDetail] = useState<MemberAnalysisDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState("");
  const [career, setCareer] = useState("");
  const [topic, setTopic] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [kind, setKind] = useState<"all" | keyof typeof kindNames>("all");
  const [transitionId, setTransitionId] = useState("");
  const [affiliationBasis, setAffiliationBasis] = useState<
    "current_roster" | "verified_period"
  >("current_roster");
  useEffect(() => {
    let active = true;
    setError(null);
    setIndexLoading(true);
    void loadMemberAnalysisIndex()
      .then((data) => {
        if (!active) return;
        setIndex(data);
        if (data) {
          setFrom(data.coverage.firstActivityDate?.slice(0, 7) ?? "");
          setTo(data.coverage.lastActivityDate?.slice(0, 7) ?? "");
        }
      })
      .catch((reason: Error) => {
        if (active) setError(reason.message);
      })
      .finally(() => {
        if (active) setIndexLoading(false);
      });
    return () => {
      active = false;
    };
  }, [retry]);
  const member =
    index?.members.find((item) => item.memberId === memberId) ??
    (!memberId ? index?.members[0] : undefined);
  useEffect(() => {
    let active = true;
    setDetail(null);
    setTransitionId("");
    if (!member) return;
    setError(null);
    void loadMemberAnalysisDetail(member.detailPath, index?.generatedAt)
      .then((data) => {
        if (!active) return;
        if (
          data.memberId !== member.memberId ||
          data.generatedAt !== index?.generatedAt ||
          data.snapshotId !== index?.snapshotId
        ) {
          setError("분석 자료가 갱신 중입니다. 잠시 뒤 다시 시도해 주세요.");
          return;
        }
        setDetail(data);
      })
      .catch((reason: Error) => {
        if (active) setError(reason.message);
      });
    return () => {
      active = false;
    };
  }, [member, index?.snapshotId, index?.generatedAt, retry]);
  const directory = useMemo(
    () =>
      index?.members.filter(
        (item) =>
          `${item.name} ${item.party} ${item.district ?? ""}`.includes(
            search
          ) &&
          (!career ||
            item.careerClaims.some((claim) => claim.category === career))
      ) ?? [],
    [index, search, career]
  );
  const careerOptions = useMemo(
    () => [
      ...new Map(
        index?.members.flatMap((item) =>
          item.careerClaims.map(
            (claim) => [claim.category, claim.label] as const
          )
        )
      ).entries()
    ],
    [index]
  );
  const months = useMemo(() => monthRange(from, to), [from, to]);
  const filteredTopics =
    detail?.topics.filter(
      (row) =>
        row.month >= from &&
        row.month <= to &&
        (!topic || row.topic === topic) &&
        (kind === "all" || row.kind === kind)
    ) ?? [];
  const topics = [
    ...new Set(detail?.topics.map((row) => row.topic) ?? [])
  ].sort();
  const activityCounts = months.map(
    (month) =>
      Object.fromEntries(
        Object.keys(kindNames).map((activityKind) => [
          activityKind,
          filteredTopics
            .filter((row) => row.month === month && row.kind === activityKind)
            .reduce((sum, row) => sum + row.count, 0)
        ])
      ) as Record<keyof typeof kindNames, number>
  );
  const maxCount = Math.max(
    1,
    ...activityCounts.map(
      (counts) => counts.vote + counts.proposal + counts.statement
    )
  );
  const filteredEvidence =
    detail?.evidence.filter(
      (row) =>
        row.date.slice(0, 7) >= from &&
        row.date.slice(0, 7) <= to &&
        (!topic || row.topic === topic) &&
        (kind === "all" || row.kind === kind)
    ) ?? [];
  const transition =
    detail?.transitions.find((row) => row.eventId === transitionId) ??
    detail?.transitions.at(-1);
  const coalitionRows =
    detail?.coalitions.filter(
      (row) => row.basis === affiliationBasis && (!topic || row.topic === topic)
    ) ?? [];
  const assetRows =
    detail?.assets.filter(
      (row) =>
        row.reportedAt.slice(0, 7) >= from && row.reportedAt.slice(0, 7) <= to
    ) ?? [];
  const findMember = (id: string): AnalysisMember | undefined =>
    index?.members.find((item) => item.memberId === id);

  return (
    <main className="v3-evidence-page member-analysis">
      <header className="v3-page-header analysis-heading">
        <div className="v3-page-header__copy">
          <h1>의원 이력·활동 분석</h1>
          <p>
            어떤 경험을 가진 의원이 어떤 활동을 했을까요? 공개 약력과 의정활동을
            같은 시간축에서 비교합니다.
          </p>
        </div>
        <p className="v3-page-header__stamp">
          <span>활동 수록 기간</span>
          <strong>
            {index
              ? `${index.coverage.firstActivityDate ?? "미확인"} — ${index.coverage.lastActivityDate ?? "미확인"}`
              : "자료 확인 중"}
          </strong>
        </p>
      </header>
      {indexLoading ? (
        <p role="status">의원 이력 분석을 불러오고 있습니다.</p>
      ) : null}
      {error ? (
        <div role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            다시 불러오기
          </button>
        </div>
      ) : null}
      {!indexLoading && !index && !error ? (
        <p>
          이력 분석 자료가 아직 게시되지 않았습니다. 기존 의원 기록은 의원
          대장에서 확인할 수 있습니다.
        </p>
      ) : null}
      {index ? (
        <>
          <div className="analysis-coverage" aria-label="분석 자료 수록 범위">
            <div>
              <span>공식 약력 경력 분류</span>
              <strong>
                {index.coverage.careerMembers}
                <small> / {index.coverage.members}명</small>
              </strong>
            </div>
            <div>
              <span>날짜가 있는 재임·위원회 이력</span>
              <strong>
                {index.coverage.datedRoles.toLocaleString()}
                <small>건</small>
              </strong>
            </div>
            <div>
              <span>수집된 회의록의 발언</span>
              <strong>
                {index.coverage.statements.toLocaleString()}
                <small>건</small>
              </strong>
            </div>
          </div>
          <div className="analysis-workspace">
            <aside className="analysis-directory" aria-label="분석할 의원 선택">
              <label>
                의원·정당·지역 검색
                <input
                  placeholder="이름·정당·지역으로 찾기"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  type="search"
                />
              </label>
              <label>
                약력에서 찾은 경력
                <select
                  aria-label="약력에서 찾은 경력"
                  value={career}
                  onChange={(event) => setCareer(event.target.value)}
                >
                  <option value="">모든 경력</option>
                  {careerOptions.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <p>{directory.length}명</p>
              <ul>
                {directory.map((item) => (
                  <li key={item.memberId}>
                    <button
                      type="button"
                      aria-pressed={item.memberId === member?.memberId}
                      onClick={() => chooseMember(item.memberId)}
                    >
                      <strong>{item.name}</strong>
                      <span>
                        {item.party} · {item.district ?? "지역 미확인"}
                      </span>
                      <small>
                        {[
                          ...new Set(
                            item.careerClaims.map((claim) => claim.label)
                          )
                        ].join(" · ") || "경력 미분류"}
                      </small>
                    </button>
                  </li>
                ))}
              </ul>
            </aside>
            <div className="analysis-story">
              {!member ? (
                <p role="status">
                  선택한 의원을 현재 분석 자료에서 찾을 수 없습니다.
                </p>
              ) : (
                <>
                  <header className="analysis-member-heading">
                    <div>
                      <p>
                        {member.reelectionLabel ?? "선수 미확인"} ·{" "}
                        {member.proportionalFlag ? "비례대표" : "지역구"}
                      </p>
                      <h2>
                        {member.name} <small>{member.party}</small>
                      </h2>
                      <p>
                        {member.committees.join(" · ") || "현재 위원회 미확인"}
                      </p>
                    </div>
                    <EvidenceLink href={member.sourceUrl}>
                      공식 의원 소개
                    </EvidenceLink>
                  </header>
                  {!detail && !error ? (
                    <p role="status">활동 기록을 불러오고 있습니다.</p>
                  ) : null}
                  {detail ? (
                    <>
                      <section
                        className="analysis-section"
                        aria-labelledby="analysis-peers"
                      >
                        <h3 id="analysis-peers">
                          조건이 가까운 의원과 먼 의원
                        </h3>
                        <MemberConditionDistance
                          key={member.memberId}
                          member={member}
                          members={index.members}
                          onChoose={chooseMember}
                        />
                        <details className="analysis-peer-table">
                          <summary>같은 위원회 의원의 활동 수치 보기</summary>
                          <p>
                            현재 위원회가 겹치는 의원 중 선수·선출 방식이 가까운
                            의원을 먼저 표시합니다. 선택한 기간의 각 의원 재임
                            중 공개 표결 기준입니다. 의제·활동 필터는 이 표의
                            참여율 분모를 바꾸지 않습니다.
                          </p>
                          <div className="analysis-scroll">
                            <table>
                              <caption>
                                참여 가능한 표결 수를 반영한 비교
                              </caption>
                              <thead>
                                <tr>
                                  <th>의원·비교 조건</th>
                                  <th>표결 참여율 (참여/대상)</th>
                                  <th>확인 불가</th>
                                  <th>대표발의</th>
                                  <th>발언</th>
                                </tr>
                              </thead>
                              <tbody>
                                <tr>
                                  <th>{member.name} (선택)</th>
                                  <MetricRow
                                    metrics={aggregatePeriodMetrics(
                                      detail.monthlyMetrics,
                                      from,
                                      to
                                    )}
                                  />
                                </tr>
                                {detail.peers.map((peer) => (
                                  <tr key={peer.memberId}>
                                    <th>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          chooseMember(peer.memberId)
                                        }
                                      >
                                        {findMember(peer.memberId)?.name ??
                                          peer.memberId}
                                      </button>
                                      <small>
                                        위원회 {peer.sharedCommittees}개 공통
                                        {peer.sameReelectionLabel
                                          ? " · 같은 선수"
                                          : ""}
                                        {peer.sameElectionType
                                          ? " · 같은 선출 방식"
                                          : ""}
                                      </small>
                                    </th>
                                    <MetricRow
                                      metrics={aggregatePeriodMetrics(
                                        peer.monthlyMetrics,
                                        from,
                                        to
                                      )}
                                    />
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {!detail.peers.length ? (
                            <p>같은 위원회에 속한 비교군이 없습니다.</p>
                          ) : null}
                        </details>
                      </section>
                      <MemberCareerConnections
                        member={member}
                        detail={detail}
                        from={from}
                        to={to}
                        onCareerSelect={setCareer}
                        onPeriodSelect={(claim) => {
                          setFrom(
                            (claim.startDate ?? claim.endDate)!.slice(0, 7)
                          );
                          setTo(
                            claim.endDate?.slice(0, 7) ??
                              index.coverage.lastActivityDate?.slice(0, 7) ??
                              to
                          );
                        }}
                      />
                      <section
                        className="analysis-section"
                        aria-labelledby="analysis-timeline"
                      >
                        <h3 id="analysis-timeline">이력과 활동 연표</h3>
                        <div className="analysis-filters">
                          <label>
                            시작 월
                            <input
                              aria-label="분석 시작 월"
                              type="month"
                              value={from}
                              max={to}
                              onChange={(event) => setFrom(event.target.value)}
                            />
                          </label>
                          <label>
                            종료 월
                            <input
                              aria-label="분석 종료 월"
                              type="month"
                              value={to}
                              min={from}
                              onChange={(event) => setTo(event.target.value)}
                            />
                          </label>
                          <label>
                            의제
                            <select
                              aria-label="의제"
                              value={topic}
                              onChange={(event) => setTopic(event.target.value)}
                            >
                              <option value="">모든 의제</option>
                              {topics.map((value) => (
                                <option key={value}>{value}</option>
                              ))}
                            </select>
                          </label>
                          <label>
                            활동
                            <select
                              aria-label="활동"
                              value={kind}
                              onChange={(event) =>
                                setKind(event.target.value as typeof kind)
                              }
                            >
                              <option value="all">모든 활동</option>
                              {Object.entries(kindNames).map(
                                ([value, label]) => (
                                  <option key={value} value={value}>
                                    {label}
                                  </option>
                                )
                              )}
                            </select>
                          </label>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setFrom(
                              index.coverage.firstActivityDate?.slice(0, 7) ??
                                ""
                            );
                            setTo(
                              index.coverage.lastActivityDate?.slice(0, 7) ?? ""
                            );
                          }}
                        >
                          활동 수록 전체 기간
                        </button>
                        {!months.length ? (
                          <p role="status">
                            시작 월과 종료 월을 확인해 주세요.
                          </p>
                        ) : null}
                        <p className="analysis-note">
                          날짜가 확인된 재임·위원회 이력과 처음 확인한
                          소속·직책을 구분합니다. 소속 관찰일은 실제 변경일을
                          뜻하지 않습니다. 약력의 연·월 표기는 해당 단위 범위로
                          그리며, 임명·재직 여부는 원문 표현을 확인해야 합니다.
                        </p>
                        <div className="analysis-scroll">
                          <div
                            className="analysis-timeline"
                            style={{
                              minWidth: Math.max(560, months.length * 32)
                            }}
                          >
                            {detail.events
                              .filter(
                                (event) =>
                                  event.startDate &&
                                  event.startDate.slice(0, 7) <= to &&
                                  (!event.endDate ||
                                    event.endDate.slice(0, 7) >= from)
                              )
                              .map((event) => {
                                const start = Math.max(
                                  0,
                                  months.findIndex(
                                    (month) =>
                                      month >= event.startDate!.slice(0, 7)
                                  )
                                );
                                const last = event.endDate
                                  ? months.reduce(
                                      (latest, month, i) =>
                                        month <= event.endDate!.slice(0, 7)
                                          ? i
                                          : latest,
                                      -1
                                    )
                                  : months.length - 1;
                                return (
                                  <div
                                    className="analysis-event-row"
                                    key={event.eventId}
                                  >
                                    <EvidenceLink href={event.sourceUrl}>
                                      {event.label}
                                    </EvidenceLink>
                                    <div className="analysis-event-track">
                                      <span
                                        className={`analysis-event-period ${event.dateBasis === "observed" ? "is-observed" : event.kind === "career" ? "is-biography" : ""}`}
                                        style={{
                                          left: `${(start / Math.max(1, months.length)) * 100}%`,
                                          width: `${(Math.max(1, last - start + 1) / Math.max(1, months.length)) * 100}%`
                                        }}
                                      >
                                        {event.dateLabel ??
                                          `${event.startDate} — ${event.endDate ?? "현재"}`}
                                        {event.dateBasis === "observed"
                                          ? " (관찰)"
                                          : ""}
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}
                            <div
                              className="analysis-months"
                              role="img"
                              aria-label="월별 의제 활동량. 아래 월별 수치 표에서 동일한 값을 확인할 수 있습니다."
                            >
                              {months.map((month, i) => (
                                <div className="analysis-month" key={month}>
                                  <div className="analysis-month-bar">
                                    {Object.entries(kindNames).map(
                                      ([activityKind, label]) => (
                                        <span
                                          key={activityKind}
                                          className={`analysis-bar-${activityKind}`}
                                          title={`${month} ${label} ${activityCounts[i]![activityKind as keyof typeof kindNames]}건`}
                                          style={{
                                            height: `${(activityCounts[i]![activityKind as keyof typeof kindNames] / maxCount) * 100}%`
                                          }}
                                        />
                                      )
                                    )}
                                  </div>
                                  <span>{month.slice(2)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                        <div className="analysis-legend">
                          {Object.entries(kindNames).map(([value, label]) => (
                            <span key={value}>
                              <i className={`analysis-bar-${value}`} />
                              {label}
                            </span>
                          ))}
                        </div>
                        <details>
                          <summary>월별 수치 표</summary>
                          <div className="analysis-scroll">
                            <table>
                              <caption>
                                선택한 기간·의제·활동의 월별 건수
                              </caption>
                              <thead>
                                <tr>
                                  <th>월</th>
                                  <th>표결 참여</th>
                                  <th>대표발의</th>
                                  <th>발언</th>
                                </tr>
                              </thead>
                              <tbody>
                                {months.map((month, i) => (
                                  <tr key={month}>
                                    <th>{month}</th>
                                    <td>{activityCounts[i]!.vote}</td>
                                    <td>{activityCounts[i]!.proposal}</td>
                                    <td>{activityCounts[i]!.statement}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </details>
                      </section>
                      <section
                        className="analysis-section"
                        aria-labelledby="analysis-transitions"
                      >
                        <h3 id="analysis-transitions">역할 변화 전후 90일</h3>
                        {transition ? (
                          <>
                            <label>
                              기준 이력
                              <select
                                aria-label="기준 이력"
                                value={transition.eventId}
                                onChange={(event) =>
                                  setTransitionId(event.target.value)
                                }
                              >
                                {detail.transitions.map((row) => (
                                  <option key={row.eventId} value={row.eventId}>
                                    {row.date} · {row.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <p>
                              {transition.basis === "party_observation_bounds"
                                ? `이전 소속의 마지막 관찰일 ${transition.beforeEndDate}, 새 소속의 첫 관찰일 ${transition.afterStartDate} 기준입니다. 사이의 ${transition.uncertainDays}일은 비교에서 제외합니다. 관찰된 소속의 차이는 실제 변경일을 확정하지 않습니다.`
                                : `선택 이력: ${transition.date}.`}{" "}
                              전후 변화는 관찰된 차이이며, 인과효과를 뜻하지
                              않습니다.
                            </p>
                            <div className="analysis-scroll">
                              <table>
                                <caption>이력·소속 기록 기준 전후 비교</caption>
                                <thead>
                                  <tr>
                                    <th>기간</th>
                                    <th>표결 참여율 (참여/대상)</th>
                                    <th>확인 불가</th>
                                    <th>대표발의</th>
                                    <th>발언</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  <tr>
                                    <th>
                                      이전 90일{" "}
                                      <small>
                                        수록 범위{" "}
                                        {transition.beforeObservedDays}일
                                      </small>
                                    </th>
                                    <MetricRow metrics={transition.before} />
                                  </tr>
                                  <tr>
                                    <th>
                                      이후 90일{" "}
                                      <small>
                                        수록 범위 {transition.afterObservedDays}
                                        일
                                      </small>
                                    </th>
                                    <MetricRow metrics={transition.after} />
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                            <p className="analysis-note">
                              수록 범위는 전체 활동의 첫날·마지막 날과 비교
                              기간이 겹치는 일수입니다. 자료가 빠진 날의
                              완전성을 보장하지 않습니다.
                            </p>
                          </>
                        ) : (
                          <p>비교할 수 있는 날짜가 있는 이력이 없습니다.</p>
                        )}
                      </section>
                      <section
                        className="analysis-section"
                        aria-labelledby="analysis-coalitions"
                      >
                        <h3 id="analysis-coalitions">
                          정당을 가로지르는 표결 관계
                        </h3>
                        <label>
                          소속 비교 기준
                          <select
                            aria-label="소속 비교 기준"
                            value={affiliationBasis}
                            onChange={(event) =>
                              setAffiliationBasis(
                                event.target.value as typeof affiliationBasis
                              )
                            }
                          >
                            <option value="current_roster">
                              현재 소속 기준
                            </option>
                            <option value="verified_period">
                              검증된 당시 소속 기준
                            </option>
                          </select>
                        </label>
                        <p>
                          {affiliationBasis === "current_roster"
                            ? `소속 확인 시점 ${index.coverage.currentPartyObservedAt ? formatDateTime(index.coverage.currentPartyObservedAt) : formatDateTime(index.generatedAt)}의 서로 다른 정당 의원을 묶어 과거 표결을 비교합니다. 이 소속을 표결 당시 소속으로 해석하지 않습니다.`
                            : `명시적인 날짜와 근거가 검토된 소속 기간만 사용합니다. 전체 수록 표결 중 당시 소속 확인 ${index.coverage.verifiedPartyVotes.toLocaleString()}건이며, 미확인 표결은 관계 계산에서 제외합니다.`}
                        </p>
                        <p>
                          현재 분석 대상 의원의 명시된 찬성·반대·기권 중 최다
                          선택이 95% 미만인 안건에서, 선택한 소속 기준으로 같은
                          의제에 공동 표결한 기록이 5건 이상인 관계입니다.
                          수록된 전체 기간·선택한 의제 기준이며, 의제마다
                          일치율이 높은 최대 5명을 표시합니다.
                        </p>
                        {coalitionRows.length ? (
                          <div className="analysis-scroll">
                            <table>
                              <caption>
                                논쟁이 있는 표결에서의 의제별 선택 일치
                              </caption>
                              <thead>
                                <tr>
                                  <th>의원</th>
                                  <th>의제</th>
                                  <th>일치/공동 표결</th>
                                  <th>일치율</th>
                                  <th>소속 기준 충족</th>
                                </tr>
                              </thead>
                              <tbody>
                                {coalitionRows.map((row) => (
                                  <tr key={`${row.memberId}-${row.topic}`}>
                                    <th>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          chooseMember(row.memberId)
                                        }
                                      >
                                        {findMember(row.memberId)?.name ??
                                          row.memberId}
                                      </button>
                                    </th>
                                    <td>{row.topic}</td>
                                    <td>
                                      {row.sameVotes}/{row.sharedVotes}
                                    </td>
                                    <td>{percent(row.agreementRate)}</td>
                                    <td>{row.crossPartyVotes}건</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p>
                            현재 수록 자료에서 최소 공동 표결 조건을 충족하는
                            관계가 없습니다.
                          </p>
                        )}
                      </section>
                      <section
                        className="analysis-section"
                        aria-labelledby="analysis-assets"
                      >
                        <h3 id="analysis-assets">재산 신고와 공적 역할</h3>
                        <p>
                          신고일과 당시 확인 가능한 재임·위원회 이력을 나란히
                          표시합니다. 금액은 가족 포함 신고 총액이며, 증감에는
                          평가액 변동 등이 포함됩니다.
                        </p>
                        {assetRows.length ? (
                          <div className="analysis-scroll">
                            <table>
                              <caption>공식 재산 신고 이력</caption>
                              <thead>
                                <tr>
                                  <th>신고일</th>
                                  <th>재임·위원회</th>
                                  <th>신고 총액</th>
                                  <th>신고 증감</th>
                                  <th>가액 변동</th>
                                  <th>근거</th>
                                </tr>
                              </thead>
                              <tbody>
                                {detail.assets
                                  .filter(
                                    (row) =>
                                      row.reportedAt.slice(0, 7) >= from &&
                                      row.reportedAt.slice(0, 7) <= to
                                  )
                                  .map((row, i) => (
                                    <tr key={`${row.reportedAt}-${i}`}>
                                      <th>{row.reportedAt}</th>
                                      <td>
                                        {detail.events
                                          .filter(
                                            (event) =>
                                              event.dateBasis ===
                                                "official_period" &&
                                              event.startDate &&
                                              event.startDate <=
                                                row.reportedAt &&
                                              (!event.endDate ||
                                                event.endDate >= row.reportedAt)
                                          )
                                          .map((event) => event.label)
                                          .join(" · ") || "당시 역할 미확인"}
                                      </td>
                                      <td>{amount(row.currentAmount)}</td>
                                      <td>{amount(row.deltaAmount)}</td>
                                      <td>{amount(row.valueChangeAmount)}</td>
                                      <td>
                                        <EvidenceLink href={row.sourceUrl}>
                                          신고 원문
                                        </EvidenceLink>
                                      </td>
                                    </tr>
                                  ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p>
                            선택한 기간에 연결할 수 있는 재산 신고 자료가
                            없습니다.
                          </p>
                        )}
                      </section>
                      <section
                        className="analysis-section"
                        aria-labelledby="analysis-evidence"
                      >
                        <h3 id="analysis-evidence">
                          관심사의 흐름과 근거 기록
                        </h3>
                        <p>
                          선택한 기간·의제·활동에 해당하는 최근 원문 기록입니다.
                          최대 500건의 최근 기록에서 표시하며, 위 월별 집계는
                          수록된 전체 기록을 사용합니다. 발언 수는 수집·요약
                          범위에 영향을 받습니다.
                        </p>
                        <p>{Math.min(40, filteredEvidence.length)}건 표시</p>
                        <ol className="analysis-evidence-list">
                          {filteredEvidence.slice(0, 40).map((row, i) => (
                            <li key={`${row.date}-${i}`}>
                              <p>
                                <time>{row.date}</time> · {kindNames[row.kind]}{" "}
                                · {row.topic}
                              </p>
                              <EvidenceLink href={row.sourceUrl}>
                                {row.title}
                              </EvidenceLink>
                              {row.excerpt ? (
                                <blockquote>{row.excerpt}</blockquote>
                              ) : null}
                            </li>
                          ))}
                        </ol>
                        {filteredEvidence.length > 40 ? (
                          <p>
                            화면에는 최근 40건을 표시합니다. 월·의제 필터로
                            범위를 좁힐 수 있습니다.
                          </p>
                        ) : null}
                        {!filteredEvidence.length ? (
                          <p>
                            선택한 조건에 해당하는 최근 원문 기록이 없습니다.
                          </p>
                        ) : null}
                      </section>
                    </>
                  ) : null}
                </>
              )}
            </div>
          </div>
          <footer className="analysis-method">
            <p>분석 자료 갱신 {formatDateTime(index.generatedAt)}</p>
            <p>
              경력·의제 연결과 표결 일치는 탐색 지표입니다. 전문성·성과·정치적
              동기 또는 이해충돌에 대한 판정을 제공하지 않습니다. 현재 소속과
              과거 소속이 확인되지 않은 구간을 구분해 표시합니다.
            </p>
          </footer>
        </>
      ) : null}
    </main>
  );
}
