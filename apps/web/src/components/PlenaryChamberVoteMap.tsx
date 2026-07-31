import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { InfoIcon } from "@phosphor-icons/react/dist/csr/Info";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { useEffect, useMemo, useRef, useState } from "react";

import { MemberIdentity } from "./MemberIdentity.js";
import { VoteMinutesOpinionPanel } from "./VoteMinutesOpinionPanel.js";
import { buildCalendarHref } from "../lib/calendar-route.js";
import { formatDate } from "../lib/format.js";
import { getOptimizedMemberPhotoUrl } from "../lib/member-photo.js";
import {
  buildPlenarySeatAssignments,
  countLinkedSeatOutcomes,
  matchesPlenarySeatFilters,
  type PlenarySeatAssignment,
  type PlenarySeatOutcome
} from "../lib/plenary-seats.js";
import "../styles/plenary-chamber.css";

import type {
  AccountabilitySummaryExport,
  LatestVoteItem,
  VoteMinutesOpinionsExport
} from "@lawmaker-monitor/schemas";

type PlenaryChamberVoteMapProps = {
  items: LatestVoteItem[] | null;
  members: AccountabilitySummaryExport["items"];
  loading: boolean;
  unavailable: boolean;
  mode?: "latest" | "archive";
  voteMinutesOpinions?: VoteMinutesOpinionsExport | null;
};

type OutcomeFilter = "all" | "yes" | "no" | "abstain" | "absent";
type ArchiveFilter = "all" | "no" | "abstain" | "absent";
type MapScale = 1 | 1.25 | 1.5;

const mobileRosterPageSize = 40;
const mobileOutcomeOrder: Record<PlenarySeatOutcome, number> = {
  no: 0,
  abstain: 1,
  absent: 2,
  yes: 3,
  unlinked: 4,
  vacant: 5
};

const outcomeLabels: Record<PlenarySeatOutcome, string> = {
  yes: "찬성",
  no: "반대",
  abstain: "기권",
  absent: "표결 불참",
  unlinked: "개별 선택 연결 전",
  vacant: "현재 의원 정보 없음"
};

const filterLabels: Record<OutcomeFilter, string> = {
  all: "전체 좌석",
  yes: "찬성",
  no: "반대",
  abstain: "기권",
  absent: "불참"
};

const archiveFilterLabels: Record<ArchiveFilter, string> = {
  all: "전체 기록",
  no: "반대 있음",
  abstain: "기권 있음",
  absent: "불참 있음"
};

const visibleVoteLimit = 12;
const mapScales: MapScale[] = [1, 1.25, 1.5];

function buildSeatAccessibleLabel(assignment: PlenarySeatAssignment): string {
  if (!assignment.member) {
    return `${assignment.seatNumber}번 좌석, ${outcomeLabels.vacant}`;
  }

  return `${assignment.member.name}, ${assignment.member.party}, ${
    assignment.member.district ?? "비례대표"
  }, ${outcomeLabels[assignment.outcome]}`;
}

function getSelectedOutcomeDescription(
  assignment: PlenarySeatAssignment | null
): string {
  if (!assignment) {
    return "좌석을 선택하면 의원 정보와 공개된 표결 상태를 확인할 수 있습니다.";
  }

  if (assignment.outcome === "unlinked") {
    return "현재 경량 표결 파일에는 이 의원의 개별 찬성 여부가 포함되지 않습니다. 공식 전체 명단을 수집한 뒤 좌석에 연결해야 합니다.";
  }

  if (assignment.outcome === "vacant") {
    return "현재 의원 명부와 연결되지 않은 좌석입니다.";
  }

  if (assignment.outcome === "absent") {
    return "공개 표결 기록에서 불참으로 확인되었습니다. 표결에 참여하지 않은 사유는 별도 확인이 필요합니다.";
  }

  return `공개 기록에서 ${outcomeLabels[assignment.outcome]}으로 확인된 의원입니다.`;
}

export function PlenaryChamberVoteMap({
  items,
  members,
  loading,
  unavailable,
  mode = "latest",
  voteMinutesOpinions = null
}: PlenaryChamberVoteMapProps) {
  const recordedVotes = useMemo(
    () =>
      [...(items ?? [])]
        .filter((item) =>
          mode === "archive"
            ? item.voteVisibility === "recorded" ||
              item.voteVisibility === "named"
            : item.voteVisibility === "recorded"
        )
        .sort(
          (left, right) =>
            new Date(right.voteDatetime).getTime() -
            new Date(left.voteDatetime).getTime()
        ),
    [items, mode]
  );
  const [archiveQuery, setArchiveQuery] = useState("");
  const [archiveFilter, setArchiveFilter] = useState<ArchiveFilter>("all");
  const [selectedVoteId, setSelectedVoteId] = useState("");
  const [selectedSeatNumber, setSelectedSeatNumber] = useState<number | null>(
    null
  );
  const [activeFilter, setActiveFilter] = useState<OutcomeFilter>("all");
  const [partyFilter, setPartyFilter] = useState("all");
  const [memberQuery, setMemberQuery] = useState("");
  const [mapScale, setMapScale] = useState<MapScale>(1);
  const [mobileRosterLimit, setMobileRosterLimit] =
    useState(mobileRosterPageSize);
  const mapViewportRef = useRef<HTMLDivElement | null>(null);
  const normalizedArchiveQuery = archiveQuery.trim().toLocaleLowerCase("ko-KR");
  const archiveFilterCounts = useMemo(
    () => ({
      all: recordedVotes.length,
      no: recordedVotes.filter((item) => item.counts.no > 0).length,
      abstain: recordedVotes.filter((item) => item.counts.abstain > 0).length,
      absent: recordedVotes.filter((item) => item.counts.absent > 0).length
    }),
    [recordedVotes]
  );
  const availableVotes = useMemo(() => {
    if (mode === "latest") {
      return recordedVotes.slice(0, visibleVoteLimit);
    }

    return recordedVotes.filter((item) => {
      if (archiveFilter !== "all" && item.counts[archiveFilter] === 0) {
        return false;
      }

      if (!normalizedArchiveQuery) {
        return true;
      }

      return [
        item.billName,
        item.committeeName ?? "",
        item.rollCallId,
        item.meetingId
      ]
        .join(" ")
        .toLocaleLowerCase("ko-KR")
        .includes(normalizedArchiveQuery);
    });
  }, [archiveFilter, mode, normalizedArchiveQuery, recordedVotes]);

  useEffect(() => {
    const firstAvailableVote = availableVotes[0];
    if (
      firstAvailableVote &&
      !availableVotes.some((vote) => vote.rollCallId === selectedVoteId)
    ) {
      setSelectedVoteId(firstAvailableVote.rollCallId);
    }
  }, [availableVotes, selectedVoteId]);

  const selectedVote =
    availableVotes.find((vote) => vote.rollCallId === selectedVoteId) ??
    availableVotes[0] ??
    null;
  const assignments = useMemo(
    () =>
      selectedVote
        ? buildPlenarySeatAssignments({ members, vote: selectedVote })
        : [],
    [members, selectedVote]
  );
  const linkedCounts = useMemo(
    () => countLinkedSeatOutcomes(assignments),
    [assignments]
  );
  const partyOptions = useMemo(
    () =>
      [...new Set(members.map((member) => member.party))].sort((left, right) =>
        left.localeCompare(right, "ko-KR")
      ),
    [members]
  );
  const filteredAssignments = useMemo(
    () =>
      assignments.filter(
        (assignment) =>
          assignment.member &&
          (activeFilter === "all" || assignment.outcome === activeFilter) &&
          matchesPlenarySeatFilters(assignment, {
            party: partyFilter,
            query: memberQuery
          })
      ),
    [activeFilter, assignments, memberQuery, partyFilter]
  );
  const visibleMemberCount = filteredAssignments.length;
  const mobileRosterAssignments = useMemo(
    () =>
      [...filteredAssignments].sort((left, right) => {
        const outcomeDifference =
          mobileOutcomeOrder[left.outcome] - mobileOutcomeOrder[right.outcome];
        if (outcomeDifference !== 0) {
          return outcomeDifference;
        }
        return (left.member?.name ?? "").localeCompare(
          right.member?.name ?? "",
          "ko-KR"
        );
      }),
    [filteredAssignments]
  );
  const visibleMobileRosterAssignments = mobileRosterAssignments.slice(
    0,
    mobileRosterLimit
  );
  const selectedAssignment =
    assignments.find(
      (assignment) => assignment.seatNumber === selectedSeatNumber
    ) ?? null;
  const selectedOpinion = useMemo(
    () =>
      selectedVote
        ? ((voteMinutesOpinions?.items ?? []).find(
            (item) => item.rollCallId === selectedVote.rollCallId
          ) ?? null)
        : null,
    [selectedVote, voteMinutesOpinions]
  );

  useEffect(() => {
    setSelectedSeatNumber(null);
    setActiveFilter("all");
  }, [selectedVoteId]);

  useEffect(() => {
    setMobileRosterLimit(mobileRosterPageSize);
  }, [activeFilter, memberQuery, partyFilter, selectedVoteId]);

  useEffect(() => {
    const viewport = mapViewportRef.current;
    if (!viewport) {
      return;
    }

    viewport.scrollLeft = Math.max(
      (viewport.scrollWidth - viewport.clientWidth) / 2,
      0
    );
  }, [mapScale, selectedVoteId]);

  if (loading) {
    return (
      <section className="plenary-chamber plenary-chamber--loading">
        <div role="status" aria-live="polite">
          본회의장 표결판을 준비하고 있습니다.
        </div>
      </section>
    );
  }

  if (unavailable || !items) {
    return (
      <section className="plenary-chamber plenary-chamber--empty">
        <p role="status">
          표결 데이터를 불러온 뒤 본회의장 표결판을 표시합니다.
        </p>
      </section>
    );
  }

  if (recordedVotes.length === 0) {
    return (
      <section className="plenary-chamber plenary-chamber--empty">
        <p role="status">공개된 기명 표결이 없습니다.</p>
      </section>
    );
  }

  const filterCounts: Record<OutcomeFilter, number> = {
    all: members.length,
    yes: selectedVote?.counts.yes ?? 0,
    no: selectedVote?.counts.no ?? 0,
    abstain: selectedVote?.counts.abstain ?? 0,
    absent: selectedVote?.counts.absent ?? 0
  };
  const headingId =
    mode === "archive"
      ? "latest-vote-records-heading"
      : "plenary-chamber-heading";

  return (
    <section
      className={`plenary-chamber plenary-chamber--${mode}`}
      aria-labelledby={headingId}
    >
      <header className="plenary-chamber__header">
        <div>
          <p className="v3-kicker">
            {mode === "archive"
              ? "PUBLIC VOTE ARCHIVE"
              : "PLENARY SEAT VIEW · LOCAL PROTOTYPE"}
          </p>
          <h2 id={headingId}>
            {mode === "archive" ? "표결 기록 탐색" : "본회의장 표결판"}
          </h2>
          <p>
            {mode === "archive"
              ? "공개된 표결 기록을 고른 뒤 같은 본회의장 좌석판에서 선택 결과와 회의록 근거를 대조합니다."
              : "공식 의석표의 부채꼴 구조 위에서 찬성·반대·기권·표결 불참 의원을 얼굴과 좌석 단위로 확인합니다."}
          </p>
        </div>
        <div className="plenary-chamber__badges">
          <span className="plenary-chamber__prototype-badge">
            {mode === "archive"
              ? `기명 표결 ${recordedVotes.length}건`
              : "최신 지정 좌석 매핑 전"}
          </span>
          {selectedVote ? (
            <span
              className="plenary-chamber__vote-list-badge"
              data-status={selectedVote.memberVoteListStatus}
            >
              {selectedVote.memberVoteListStatus === "verified"
                ? "개별 표결 명단 검증"
                : selectedVote.memberVoteListStatus === "partial"
                  ? "개별 표결 명단 일부 연결"
                  : "개별 표결 명단 갱신 대기"}
            </span>
          ) : null}
        </div>
      </header>

      {mode === "archive" ? (
        <div className="plenary-chamber__archive-controls">
          <label className="plenary-chamber__archive-search">
            <span>기록 검색</span>
            <span>
              <MagnifyingGlassIcon size={17} weight="bold" aria-hidden="true" />
              <input
                type="search"
                value={archiveQuery}
                onChange={(event) => setArchiveQuery(event.target.value)}
                placeholder="법률안·위원회·표결 ID"
              />
            </span>
          </label>
          <div>
            <span>기록 조건</span>
            <div
              className="plenary-chamber__archive-filter-buttons"
              aria-label="표결 기록 필터"
            >
              {(Object.keys(archiveFilterLabels) as ArchiveFilter[]).map(
                (filter) => (
                  <button
                    key={filter}
                    type="button"
                    aria-pressed={archiveFilter === filter}
                    onClick={() => setArchiveFilter(filter)}
                  >
                    <span>{archiveFilterLabels[filter]}</span>
                    <strong>{archiveFilterCounts[filter]}</strong>
                  </button>
                )
              )}
            </div>
          </div>
          <p role="status" aria-live="polite">
            <strong>{availableVotes.length}건</strong>
            <span>{`전체 ${recordedVotes.length}건 중 일치`}</span>
          </p>
        </div>
      ) : null}

      {selectedVote ? (
        <>
          <div className="plenary-chamber__toolbar">
            <label>
              <span>표결 안건</span>
              <select
                value={selectedVote.rollCallId}
                onChange={(event) => setSelectedVoteId(event.target.value)}
              >
                {availableVotes.map((vote) => (
                  <option key={vote.rollCallId} value={vote.rollCallId}>
                    {`${formatDate(vote.voteDatetime)} · ${vote.billName}`}
                  </option>
                ))}
              </select>
            </label>

            <div
              className="plenary-chamber__filters"
              aria-label="좌석 표결 상태 필터"
            >
              {(Object.keys(filterLabels) as OutcomeFilter[]).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  aria-pressed={activeFilter === filter}
                  onClick={() => setActiveFilter(filter)}
                >
                  <span>{filterLabels[filter]}</span>
                  <strong>{filterCounts[filter]}</strong>
                </button>
              ))}
            </div>
          </div>

          <div className="plenary-chamber__member-filters">
            <label>
              <span>정당</span>
              <select
                value={partyFilter}
                onChange={(event) => setPartyFilter(event.target.value)}
              >
                <option value="all">모든 정당</option>
                {partyOptions.map((party) => (
                  <option key={party} value={party}>
                    {party}
                  </option>
                ))}
              </select>
            </label>
            <label className="plenary-chamber__member-search">
              <span>의원 검색</span>
              <span>
                <MagnifyingGlassIcon
                  size={16}
                  weight="bold"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={memberQuery}
                  onChange={(event) => setMemberQuery(event.target.value)}
                  placeholder="이름·정당·지역구"
                />
              </span>
            </label>
            <p role="status" aria-live="polite">
              <strong>{visibleMemberCount}명</strong>
              <span>현재 조건과 일치</span>
            </p>
            {partyFilter !== "all" || memberQuery ? (
              <button
                type="button"
                onClick={() => {
                  setPartyFilter("all");
                  setMemberQuery("");
                }}
              >
                검색 조건 초기화
              </button>
            ) : null}
          </div>

          <div className="plenary-chamber__bill">
            <div>
              <span>{selectedVote.committeeName ?? "본회의"}</span>
              <h3>{selectedVote.billName}</h3>
              <p>{formatDate(selectedVote.voteDatetime)}</p>
            </div>
            <dl aria-label="선택한 안건 표결 결과">
              <div data-outcome="yes">
                <dt>찬성</dt>
                <dd>{selectedVote.counts.yes}</dd>
              </div>
              <div data-outcome="no">
                <dt>반대</dt>
                <dd>{selectedVote.counts.no}</dd>
              </div>
              <div data-outcome="abstain">
                <dt>기권</dt>
                <dd>{selectedVote.counts.abstain}</dd>
              </div>
              <div data-outcome="absent">
                <dt>불참</dt>
                <dd>{selectedVote.counts.absent}</dd>
              </div>
            </dl>
          </div>

          <div className="plenary-chamber__workspace">
            <div className="plenary-chamber__visual">
              <div className="plenary-chamber__map-tools">
                <div>
                  <strong>의장석 기준 의원 배치</strong>
                  <span>얼굴을 선택하면 의원별 공개 기록을 확인합니다.</span>
                </div>
                <div role="group" aria-label="좌석판 확대·축소">
                  <button
                    type="button"
                    disabled={mapScale === mapScales[0]}
                    onClick={() => {
                      const currentIndex = mapScales.indexOf(mapScale);
                      setMapScale(
                        mapScales[Math.max(currentIndex - 1, 0)] ?? 1
                      );
                    }}
                  >
                    축소
                  </button>
                  <output aria-live="polite">{`${Math.round(mapScale * 100)}%`}</output>
                  <button
                    type="button"
                    disabled={mapScale === mapScales.at(-1)}
                    onClick={() => {
                      const currentIndex = mapScales.indexOf(mapScale);
                      setMapScale(
                        mapScales[
                          Math.min(currentIndex + 1, mapScales.length - 1)
                        ] ?? 1
                      );
                    }}
                  >
                    확대
                  </button>
                </div>
              </div>
              <div className="plenary-chamber__viewport" ref={mapViewportRef}>
                <div
                  className="plenary-chamber__seats"
                  aria-label={`${selectedVote.billName} 본회의장 좌석 시각화`}
                  style={{
                    width: `${mapScale * 100}%`,
                    minWidth: `${980 * mapScale}px`,
                    height: `${620 * mapScale}px`
                  }}
                >
                  <div className="plenary-chamber__speaker" aria-hidden="true">
                    <span>의장석</span>
                  </div>
                  {assignments.map((assignment) => {
                    const isFilteredOut =
                      (activeFilter !== "all" &&
                        assignment.outcome !== activeFilter) ||
                      !matchesPlenarySeatFilters(assignment, {
                        party: partyFilter,
                        query: memberQuery
                      });
                    const isSelected =
                      assignment.seatNumber === selectedSeatNumber;
                    const photoUrl = getOptimizedMemberPhotoUrl(
                      assignment.member?.photoUrl
                    );

                    return (
                      <button
                        key={assignment.seatNumber}
                        className="plenary-chamber__seat"
                        type="button"
                        data-outcome={assignment.outcome}
                        data-muted={isFilteredOut ? "true" : "false"}
                        aria-pressed={isSelected}
                        aria-label={buildSeatAccessibleLabel(assignment)}
                        title={buildSeatAccessibleLabel(assignment)}
                        style={{
                          left: `${assignment.xPercent}%`,
                          top: `${assignment.yPercent}%`
                        }}
                        onClick={() =>
                          setSelectedSeatNumber(assignment.seatNumber)
                        }
                      >
                        {assignment.member ? (
                          <span
                            className="plenary-chamber__seat-portrait"
                            aria-hidden="true"
                          >
                            {photoUrl ? (
                              <span
                                className="plenary-chamber__seat-photo"
                                style={{
                                  backgroundImage: `url(${JSON.stringify(photoUrl)})`
                                }}
                              />
                            ) : (
                              <span className="plenary-chamber__seat-fallback">
                                {assignment.member.name.slice(0, 1)}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span
                            className="plenary-chamber__seat-vacant"
                            aria-hidden="true"
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              <section
                className="plenary-chamber__mobile-roster"
                aria-labelledby={`${headingId}-mobile-roster`}
              >
                <header>
                  <div>
                    <h3 id={`${headingId}-mobile-roster`}>의원별 표결 명단</h3>
                    <span>반대·기권·불참을 먼저 보여줍니다.</span>
                  </div>
                  <p>
                    <strong>{visibleMemberCount}명</strong>
                    <span>현재 조건</span>
                  </p>
                </header>

                {visibleMobileRosterAssignments.length > 0 ? (
                  <ol>
                    {visibleMobileRosterAssignments.map((assignment) => (
                      <li key={assignment.seatNumber}>
                        <button
                          type="button"
                          data-outcome={assignment.outcome}
                          aria-pressed={
                            assignment.seatNumber === selectedSeatNumber
                          }
                          aria-label={buildSeatAccessibleLabel(assignment)}
                          onClick={() =>
                            setSelectedSeatNumber(assignment.seatNumber)
                          }
                        >
                          {assignment.member ? (
                            <MemberIdentity
                              name={assignment.member.name}
                              party={assignment.member.party}
                              district={assignment.member.district}
                              photoUrl={assignment.member.photoUrl}
                              size="small"
                            />
                          ) : (
                            <span className="plenary-chamber__mobile-vacant">
                              {`${assignment.seatNumber}번 좌석`}
                            </span>
                          )}
                          <span className="plenary-chamber__mobile-outcome">
                            {outcomeLabels[assignment.outcome]}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="plenary-chamber__mobile-empty">
                    현재 조건에 해당하는 의원이 없습니다.
                  </p>
                )}

                {visibleMobileRosterAssignments.length <
                mobileRosterAssignments.length ? (
                  <button
                    className="plenary-chamber__mobile-more"
                    type="button"
                    onClick={() =>
                      setMobileRosterLimit(
                        (currentLimit) => currentLimit + mobileRosterPageSize
                      )
                    }
                  >
                    {`다음 ${Math.min(
                      mobileRosterPageSize,
                      mobileRosterAssignments.length -
                        visibleMobileRosterAssignments.length
                    )}명 보기`}
                  </button>
                ) : null}
              </section>

              <div className="plenary-chamber__legend">
                <span>
                  <i data-outcome="yes" aria-hidden="true" />
                  찬성
                </span>
                <span>
                  <i data-outcome="no" aria-hidden="true" />
                  반대
                </span>
                <span>
                  <i data-outcome="abstain" aria-hidden="true" />
                  기권
                </span>
                <span>
                  <i data-outcome="absent" aria-hidden="true" />
                  표결 불참
                </span>
                <span>
                  <i data-outcome="unlinked" aria-hidden="true" />
                  개별 선택 연결 전
                </span>
              </div>
            </div>

            <aside className="plenary-chamber__detail" aria-live="polite">
              <div className="plenary-chamber__detail-heading">
                <span className="plenary-chamber__desktop-detail-label">
                  선택 좌석
                </span>
                <span className="plenary-chamber__mobile-detail-label">
                  선택 의원
                </span>
                <strong className="plenary-chamber__desktop-detail-label">
                  {selectedAssignment
                    ? `${selectedAssignment.seatNumber}번`
                    : "좌석을 선택하세요"}
                </strong>
                <strong className="plenary-chamber__mobile-detail-label">
                  {selectedAssignment?.member?.name ?? "의원을 선택하세요"}
                </strong>
              </div>

              {selectedAssignment?.member ? (
                <>
                  <MemberIdentity
                    name={selectedAssignment.member.name}
                    party={selectedAssignment.member.party}
                    district={selectedAssignment.member.district}
                    photoUrl={selectedAssignment.member.photoUrl}
                    calendarHref={buildCalendarHref({
                      memberId: selectedAssignment.member.memberId
                    })}
                    size="large"
                  />
                  <div
                    className="plenary-chamber__outcome"
                    data-outcome={selectedAssignment.outcome}
                  >
                    <span>{outcomeLabels[selectedAssignment.outcome]}</span>
                    <p>{getSelectedOutcomeDescription(selectedAssignment)}</p>
                  </div>
                  <a
                    className="plenary-chamber__member-link"
                    href={buildCalendarHref({
                      memberId: selectedAssignment.member.memberId
                    })}
                  >
                    의원 공개 기록 열기
                  </a>
                </>
              ) : (
                <p className="plenary-chamber__detail-empty">
                  {getSelectedOutcomeDescription(selectedAssignment)}
                </p>
              )}

              <div className="plenary-chamber__coverage">
                <strong>현재 연결 범위</strong>
                <dl>
                  <div>
                    <dt>찬성 명단</dt>
                    <dd>{`${linkedCounts.yes}/${selectedVote.counts.yes}`}</dd>
                  </div>
                  <div>
                    <dt>반대 명단</dt>
                    <dd>{`${linkedCounts.no}/${selectedVote.counts.no}`}</dd>
                  </div>
                  <div>
                    <dt>기권 명단</dt>
                    <dd>{`${linkedCounts.abstain}/${selectedVote.counts.abstain}`}</dd>
                  </div>
                  <div>
                    <dt>불참 명단</dt>
                    <dd>{`${linkedCounts.absent}/${selectedVote.counts.absent}`}</dd>
                  </div>
                </dl>
              </div>
            </aside>
          </div>

          {mode === "archive" ? (
            <VoteMinutesOpinionPanel
              vote={selectedVote}
              opinion={selectedOpinion}
            />
          ) : null}

          <footer className="plenary-chamber__source">
            <p>
              <InfoIcon size={17} weight="bold" aria-hidden="true" />
              <span>
                좌석 형태는 2024년 9월 19일 기준 공식 의석표를 참고했습니다.
                현재 의원별 지정 좌석은 최신 공식 자료 수집 전이라 임시입니다.
                찬성 포함 개별 표결 상태는 공식 명단에서 확인된 범위만
                표시합니다.
              </span>
            </p>
            <div>
              <a
                href={selectedVote.officialSourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                선택 표결 공식 원문
                <ArrowSquareOutIcon
                  size={15}
                  weight="bold"
                  aria-hidden="true"
                />
              </a>
              <a
                href="https://record.assembly.go.kr/"
                target="_blank"
                rel="noreferrer"
              >
                국회 회의록
                <ArrowSquareOutIcon
                  size={15}
                  weight="bold"
                  aria-hidden="true"
                />
              </a>
            </div>
          </footer>
        </>
      ) : (
        <div className="plenary-chamber__archive-empty" role="status">
          <strong>조건에 맞는 표결 기록이 없습니다.</strong>
          <p>검색어를 줄이거나 기록 조건을 전체 기록으로 바꿔보세요.</p>
          <button
            type="button"
            onClick={() => {
              setArchiveQuery("");
              setArchiveFilter("all");
            }}
          >
            검색 조건 초기화
          </button>
        </div>
      )}
    </section>
  );
}
