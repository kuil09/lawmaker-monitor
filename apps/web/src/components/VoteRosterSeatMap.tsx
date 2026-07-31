import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { useMemo, useState } from "react";

import { MemberIdentity } from "./MemberIdentity.js";
import { buildCalendarHref } from "../lib/calendar-route.js";
import { getOptimizedMemberPhotoUrl } from "../lib/member-photo.js";
import {
  buildPlenarySeatAssignments,
  countLinkedSeatOutcomes,
  matchesPlenarySeatFilters,
  type PlenarySeatAssignment
} from "../lib/plenary-seats.js";
import "../styles/plenary-chamber.css";
import "../styles/vote-roster-seat-map.css";

import type {
  AccountabilitySummaryExport,
  LatestVoteItem
} from "@lawmaker-monitor/schemas";

type VoteRosterSeatMapProps = {
  item: LatestVoteItem;
  members: AccountabilitySummaryExport["items"];
};

type PublicVoteOutcome = "yes" | "no" | "abstain" | "absent";

const outcomeLabels: Record<PublicVoteOutcome, string> = {
  yes: "찬성",
  no: "반대",
  abstain: "기권",
  absent: "불참"
};

const publicOutcomes: PublicVoteOutcome[] = ["yes", "no", "abstain", "absent"];

function buildSeatLabel(assignment: PlenarySeatAssignment): string {
  if (!assignment.member) {
    return `${assignment.seatNumber}번 좌석, 의원 정보 없음`;
  }

  const outcome =
    assignment.outcome === "unlinked" || assignment.outcome === "vacant"
      ? "개별 선택 연결 전"
      : assignment.outcome === "absent"
        ? "불참"
        : outcomeLabels[assignment.outcome];

  return `${assignment.member.name}, ${assignment.member.party}, ${
    assignment.member.district ?? "비례대표"
  }, ${outcome}`;
}

export function VoteRosterSeatMap({ item, members }: VoteRosterSeatMapProps) {
  const [activeOutcome, setActiveOutcome] = useState<PublicVoteOutcome>("yes");
  const [partyFilter, setPartyFilter] = useState("all");
  const [memberQuery, setMemberQuery] = useState("");
  const [selectedSeatNumber, setSelectedSeatNumber] = useState<number | null>(
    null
  );
  const assignments = useMemo(
    () => buildPlenarySeatAssignments({ members, vote: item }),
    [item, members]
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
  const selectedAssignment =
    assignments.find(
      (assignment) => assignment.seatNumber === selectedSeatNumber
    ) ?? null;
  const matchingCount = assignments.filter(
    (assignment) =>
      assignment.outcome === activeOutcome &&
      matchesPlenarySeatFilters(assignment, {
        party: partyFilter,
        query: memberQuery
      })
  ).length;

  if (members.length === 0) {
    return (
      <p className="vote-roster-seat-map__empty">
        의원 명부를 불러온 뒤 공개 선택 배치도를 표시합니다.
      </p>
    );
  }

  return (
    <section
      className="vote-roster-seat-map"
      aria-labelledby={`vote-roster-map-title-${item.rollCallId}`}
    >
      <header className="vote-roster-seat-map__header">
        <div>
          <p>공개 선택 명단</p>
          <h4 id={`vote-roster-map-title-${item.rollCallId}`}>
            공개 선택 배치도
          </h4>
        </div>
        <p>
          명단을 나열하는 대신 본회의장 좌석 위치에서 선택과 의원 정보를 함께
          확인합니다.
        </p>
      </header>

      <div
        className="vote-roster-seat-map__outcomes"
        role="tablist"
        aria-label="표결 선택별 배치도"
      >
        {publicOutcomes.map((outcome) => (
          <button
            key={outcome}
            type="button"
            role="tab"
            aria-selected={activeOutcome === outcome}
            onClick={() => {
              setActiveOutcome(outcome);
              setSelectedSeatNumber(null);
            }}
          >
            <span>{outcomeLabels[outcome]}</span>
            <strong>{item.counts[outcome]}</strong>
            <small>{`${linkedCounts[outcome]}명 연결`}</small>
          </button>
        ))}
      </div>

      <div className="vote-roster-seat-map__filters">
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
        <label>
          <span>의원 검색</span>
          <span className="vote-roster-seat-map__search">
            <MagnifyingGlassIcon size={15} weight="bold" aria-hidden="true" />
            <input
              type="search"
              value={memberQuery}
              onChange={(event) => setMemberQuery(event.target.value)}
              placeholder="이름·정당·지역구"
            />
          </span>
        </label>
        <p role="status" aria-live="polite">
          <strong>{matchingCount}명</strong>
          <span>{`${outcomeLabels[activeOutcome]} · 현재 조건`}</span>
        </p>
      </div>

      {activeOutcome === "absent" &&
      item.absentListStatus === "unavailable" &&
      item.counts.absent > 0 ? (
        <p className="vote-roster-seat-map__notice">
          불참 총계는 공개됐지만 의원별 명단이 아직 연결되지 않았습니다.
        </p>
      ) : null}

      <div className="vote-roster-seat-map__workspace">
        <div className="vote-roster-seat-map__viewport">
          <div
            className="vote-roster-seat-map__canvas"
            aria-label={`${item.billName} ${outcomeLabels[activeOutcome]} 의원 배치도`}
          >
            <div className="vote-roster-seat-map__speaker" aria-hidden="true">
              의장석
            </div>
            {assignments.map((assignment) => {
              const isFilteredOut =
                assignment.outcome !== activeOutcome ||
                !matchesPlenarySeatFilters(assignment, {
                  party: partyFilter,
                  query: memberQuery
                });
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
                  aria-pressed={assignment.seatNumber === selectedSeatNumber}
                  aria-label={buildSeatLabel(assignment)}
                  title={buildSeatLabel(assignment)}
                  style={{
                    left: `${assignment.xPercent}%`,
                    top: `${assignment.yPercent}%`
                  }}
                  onClick={() => setSelectedSeatNumber(assignment.seatNumber)}
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

        <aside className="vote-roster-seat-map__detail" aria-live="polite">
          {selectedAssignment?.member ? (
            <>
              <span>{`${selectedAssignment.seatNumber}번 좌석`}</span>
              <MemberIdentity
                name={selectedAssignment.member.name}
                party={selectedAssignment.member.party}
                district={selectedAssignment.member.district}
                photoUrl={selectedAssignment.member.photoUrl}
                calendarHref={buildCalendarHref({
                  memberId: selectedAssignment.member.memberId
                })}
                size="small"
              />
              <strong>
                {selectedAssignment.outcome === "unlinked"
                  ? "개별 선택 연결 전"
                  : selectedAssignment.outcome === "vacant"
                    ? "의원 정보 없음"
                    : selectedAssignment.outcome === "absent"
                      ? "불참"
                      : outcomeLabels[selectedAssignment.outcome]}
              </strong>
            </>
          ) : (
            <>
              <span>선택 의원</span>
              <p>
                강조된 얼굴을 선택하면 의원의 정당·지역구와 공개 기록으로 이동할
                수 있습니다.
              </p>
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
