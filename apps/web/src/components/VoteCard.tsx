import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { useMemo, useState } from "react";

import { MemberIdentity } from "./MemberIdentity.js";
import { StatusBadge } from "./StatusBadge.js";
import { VoteMinutesOpinionPanel } from "./VoteMinutesOpinionPanel.js";
import { buildCalendarHref } from "../lib/calendar-route.js";
import {
  formatDate,
  formatSourceStatusLabel,
  formatVoteVisibilityLabel
} from "../lib/format.js";

import type {
  AccountabilitySummaryExport,
  LatestVoteItem,
  VoteMinutesOpinionItem
} from "@lawmaker-monitor/schemas";

type RosterId = "no" | "abstain" | "absent";
type VoteRosterEntry =
  | LatestVoteItem["highlightedVotes"][number]
  | LatestVoteItem["absentVotes"][number];

type VoteCardProps = {
  item: LatestVoteItem;
  opinion?: VoteMinutesOpinionItem | null;
  memberDirectory?: AccountabilitySummaryExport["items"];
};

const rosterPageSize = 12;

const rosterLabels: Record<
  RosterId,
  { label: string; guidance: string }
> = {
  no: {
    label: "반대",
    guidance: "공개 표결에서 반대로 기록된 의원입니다."
  },
  abstain: {
    label: "기권",
    guidance: "공개 표결에서 기권으로 기록된 의원입니다."
  },
  absent: {
    label: "불참",
    guidance:
      "불참 기록은 사유나 의견을 뜻하지 않습니다. 공식 참석 기록만 표시합니다."
  }
};

export function VoteCard({
  item,
  opinion = null,
  memberDirectory = []
}: VoteCardProps) {
  const voteTotal =
    item.counts.yes + item.counts.no + item.counts.abstain + item.counts.absent;
  const noVotes = item.highlightedVotes.filter(
    (vote) => vote.voteCode === "no"
  );
  const abstainVotes = item.highlightedVotes.filter(
    (vote) => vote.voteCode === "abstain"
  );
  const absentVotes = item.absentVotes;
  const flaggedVoteCount =
    item.counts.no + item.counts.abstain + item.counts.absent;
  const combinedTitle = item.committeeName
    ? `${item.committeeName} · ${item.billName}`
    : item.billName;
  const showProvisional = item.sourceStatus !== "confirmed";
  const showVisibility = item.voteVisibility !== "recorded";
  const showUnavailableAbsentNote =
    item.absentListStatus === "unavailable" &&
    item.counts.absent > 0 &&
    absentVotes.length === 0;
  const initialRoster: RosterId =
    item.counts.no > 0
      ? "no"
      : item.counts.abstain > 0
        ? "abstain"
        : "absent";
  const [activeRoster, setActiveRoster] = useState<RosterId>(initialRoster);
  const [rosterQuery, setRosterQuery] = useState("");
  const [rosterLimit, setRosterLimit] = useState(rosterPageSize);
  const memberById = useMemo(
    () => new Map(memberDirectory.map((member) => [member.memberId, member])),
    [memberDirectory]
  );
  const rosters: Record<
    RosterId,
    { count: number; entries: VoteRosterEntry[] }
  > = {
    no: { count: item.counts.no, entries: noVotes },
    abstain: { count: item.counts.abstain, entries: abstainVotes },
    absent: { count: item.counts.absent, entries: absentVotes }
  };
  const selectedRoster = rosters[activeRoster];
  const normalizedRosterQuery = rosterQuery.trim().toLocaleLowerCase("ko-KR");
  const filteredRoster = selectedRoster.entries.filter((entry) => {
    const member = entry.memberId ? memberById.get(entry.memberId) : null;
    return [entry.memberName, entry.party, member?.district ?? "비례대표"]
      .join(" ")
      .toLocaleLowerCase("ko-KR")
      .includes(normalizedRosterQuery);
  });
  const visibleRoster = filteredRoster.slice(0, rosterLimit);
  const remainingRosterCount = Math.max(
    filteredRoster.length - visibleRoster.length,
    0
  );

  function selectRoster(rosterId: RosterId) {
    setActiveRoster(rosterId);
    setRosterQuery("");
    setRosterLimit(rosterPageSize);
  }

  return (
    <article className="vote-card">
      <header className="vote-card__top">
        <div className="vote-card__headline">
          <p className="vote-card__eyebrow">공개 기록표결</p>
          <h3>{combinedTitle}</h3>
          <p className="vote-card__meta">{formatDate(item.voteDatetime)}</p>
        </div>
        <div className="vote-card__actions">
          <div className="vote-card__notes">
            {showProvisional ? (
              <StatusBadge tone={item.sourceStatus}>
                {formatSourceStatusLabel(item.sourceStatus)}
              </StatusBadge>
            ) : null}
            {showVisibility ? (
              <StatusBadge tone="visibility">
                {formatVoteVisibilityLabel(item.voteVisibility)}
              </StatusBadge>
            ) : null}
          </div>
          <a
            className="vote-card__source-link"
            href={item.officialSourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            <span>표결 원문</span>
          </a>
        </div>
      </header>

      <div className="vote-card__mini-bar" aria-hidden="true">
        <span
          className="vote-card__mini-bar-segment vote-card__mini-bar-segment--yes"
          style={{
            width: `${voteTotal > 0 ? (item.counts.yes / voteTotal) * 100 : 0}%`
          }}
        />
        <span
          className="vote-card__mini-bar-segment vote-card__mini-bar-segment--no"
          style={{
            width: `${voteTotal > 0 ? (item.counts.no / voteTotal) * 100 : 0}%`
          }}
        />
        <span
          className="vote-card__mini-bar-segment vote-card__mini-bar-segment--abstain"
          style={{
            width: `${voteTotal > 0 ? (item.counts.abstain / voteTotal) * 100 : 0}%`
          }}
        />
        <span
          className="vote-card__mini-bar-segment vote-card__mini-bar-segment--absent"
          style={{
            width: `${voteTotal > 0 ? (item.counts.absent / voteTotal) * 100 : 0}%`
          }}
        />
      </div>

      <dl className="vote-card__stats">
        <div className="vote-card__stat vote-card__stat--yes">
          <dt>찬성</dt>
          <dd>{item.counts.yes}</dd>
        </div>
        <div className="vote-card__stat vote-card__stat--no">
          <dt>반대</dt>
          <dd>{item.counts.no}</dd>
        </div>
        <div className="vote-card__stat vote-card__stat--abstain">
          <dt>기권</dt>
          <dd>{item.counts.abstain}</dd>
        </div>
        <div className="vote-card__stat vote-card__stat--absent">
          <dt>불참</dt>
          <dd>{item.counts.absent}</dd>
        </div>
      </dl>

      <details className="vote-card__highlight">
        <summary className="vote-card__highlight-summary">
          <span className="vote-card__highlight-label">
            <strong>명단·회의록 근거</strong>
            <small>선택별 의원과 공식 발언을 함께 확인</small>
          </span>
          <span className="vote-card__highlight-meta">
            {opinion ? (
              <span>{`발언 ${opinion.sourceStatementCount}건`}</span>
            ) : null}
            <strong>{`${flaggedVoteCount}명`}</strong>
          </span>
        </summary>

        <div className="vote-card__highlight-body">
          {item.voteVisibility === "secret" ? (
            <p className="vote-card__private-note">
              무기명 표결은 개인별 표결 내역을 공개하지 않습니다.
            </p>
          ) : (
            <section
              className="vote-roster-workbench"
              aria-labelledby={`vote-roster-title-${item.rollCallId}`}
            >
              <header className="vote-roster-workbench__header">
                <div>
                  <p>공개 선택 명단</p>
                  <h4 id={`vote-roster-title-${item.rollCallId}`}>
                    의원별 기록
                  </h4>
                </div>
                <p>{rosterLabels[activeRoster].guidance}</p>
              </header>

              <div
                className="vote-roster-tabs"
                role="tablist"
                aria-label="표결 선택별 의원 명단"
              >
                {(Object.keys(rosters) as RosterId[]).map((rosterId) => (
                  <button
                    key={rosterId}
                    type="button"
                    role="tab"
                    aria-selected={activeRoster === rosterId}
                    aria-controls={`vote-roster-panel-${item.rollCallId}`}
                    onClick={() => selectRoster(rosterId)}
                  >
                    <span>{rosterLabels[rosterId].label}</span>
                    <strong>{rosters[rosterId].count}</strong>
                  </button>
                ))}
              </div>

              <div
                id={`vote-roster-panel-${item.rollCallId}`}
                className="vote-roster-panel"
                role="tabpanel"
              >
                <div className="vote-roster-panel__toolbar">
                  <p>
                    <strong>{`${rosterLabels[activeRoster].label} ${selectedRoster.count}명`}</strong>
                    <span>{`${selectedRoster.entries.length}명 명단 확인`}</span>
                  </p>
                  {selectedRoster.entries.length > 8 ? (
                    <label>
                      <span className="v3-sr-only">의원 명단 검색</span>
                      <MagnifyingGlassIcon
                        size={16}
                        weight="bold"
                        aria-hidden="true"
                      />
                      <input
                        type="search"
                        value={rosterQuery}
                        onChange={(event) => {
                          setRosterQuery(event.target.value);
                          setRosterLimit(rosterPageSize);
                        }}
                        placeholder="이름·정당·지역구 검색"
                      />
                    </label>
                  ) : null}
                </div>

                {showUnavailableAbsentNote && activeRoster === "absent" ? (
                  <p className="vote-roster-panel__empty">
                    불참 명단은 공식 총계와 개인별 공개 기록이 일치할 때만
                    표시합니다.
                  </p>
                ) : selectedRoster.count === 0 ? (
                  <p className="vote-roster-panel__empty">
                    해당 선택으로 기록된 의원이 없습니다.
                  </p>
                ) : visibleRoster.length === 0 ? (
                  <p className="vote-roster-panel__empty">
                    검색 조건과 일치하는 의원이 없습니다.
                  </p>
                ) : (
                  <>
                    <ul className="vote-roster-list">
                      {visibleRoster.map((entry) => {
                        const member = entry.memberId
                          ? memberById.get(entry.memberId)
                          : null;
                        return (
                          <li
                            key={`${item.rollCallId}:${activeRoster}:${entry.memberId ?? entry.memberName}`}
                          >
                            <MemberIdentity
                              name={entry.memberName}
                              party={member?.party ?? entry.party}
                              district={member?.district ?? null}
                              photoUrl={member?.photoUrl ?? null}
                              calendarHref={
                                entry.memberId
                                  ? buildCalendarHref({
                                      memberId: entry.memberId
                                    })
                                  : null
                              }
                              size="small"
                            />
                          </li>
                        );
                      })}
                    </ul>
                    {remainingRosterCount > 0 ? (
                      <button
                        className="vote-roster-panel__more"
                        type="button"
                        onClick={() =>
                          setRosterLimit(
                            (currentLimit) => currentLimit + rosterPageSize
                          )
                        }
                      >
                        {`${Math.min(rosterPageSize, remainingRosterCount)}명 더 보기`}
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            </section>
          )}

          <VoteMinutesOpinionPanel vote={item} opinion={opinion} />
        </div>
      </details>
    </article>
  );
}
