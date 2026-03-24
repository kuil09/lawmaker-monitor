import type { LatestVoteItem } from "@lawmaker-monitor/schemas";

import { buildCalendarHref } from "../lib/calendar-route.js";
import {
  formatDate,
  formatSourceStatusLabel,
  formatVoteVisibilityLabel
} from "../lib/format.js";
import { StatusBadge } from "./StatusBadge.js";

type VoteCardProps = {
  item: LatestVoteItem;
};

export function VoteCard({ item }: VoteCardProps) {
  const voteTotal = item.counts.yes + item.counts.no + item.counts.abstain + item.counts.absent;
  const noVotes = item.highlightedVotes.filter((vote) => vote.voteCode === "no");
  const abstainVotes = item.highlightedVotes.filter((vote) => vote.voteCode === "abstain");
  const absentVotes = item.absentVotes;
  const flaggedVoteCount = item.counts.no + item.counts.abstain + item.counts.absent;
  const combinedTitle = item.committeeName
    ? `${item.committeeName} · ${item.billName}`
    : item.billName;
  const emptyHighlightMessage =
    item.voteVisibility === "secret"
      ? "무기명 표결은 개인별 표결 내역을 공개하지 않습니다."
      : "공개된 반대·기권·불참 내역이 없습니다.";
  const showProvisional = item.sourceStatus !== "confirmed";
  const showVisibility = item.voteVisibility !== "recorded";
  const hasAnyFlaggedVotes = item.counts.no > 0 || item.counts.abstain > 0 || item.counts.absent > 0;
  const showUnavailableAbsentNote =
    item.absentListStatus === "unavailable" && item.counts.absent > 0 && absentVotes.length === 0;

  function renderVoteGroup(
    title: string,
    votes: typeof item.highlightedVotes | typeof item.absentVotes,
    totalCount: number,
    options?: {
      unavailableMessage?: string;
    }
  ) {
    if (totalCount === 0) {
      return (
        <div className="vote-card__group">
          <h5>{title}</h5>
          <p>없음</p>
        </div>
      );
    }

    return (
      <div className="vote-card__group">
        <h5>{title}</h5>
        {options?.unavailableMessage ? (
          <p>{options.unavailableMessage}</p>
        ) : (
          <ul>
            {votes.map((vote) => (
              <li key={`${item.rollCallId}:${title}:${vote.memberId}`}>
                {vote.memberId ? (
                  <a href={buildCalendarHref({ memberId: vote.memberId })}>
                    {vote.memberName}
                  </a>
                ) : (
                  <span className="vote-card__member-name">{vote.memberName}</span>
                )}
                <span className="vote-card__member-party">{vote.party}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <article className="vote-card">
      <header className="vote-card__top">
        <div>
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
            aria-label="공식 사이트"
            title="공식 사이트"
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <circle
                cx="10"
                cy="10"
                r="6.7"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
              />
              <path
                d="M3.9 10h12.2M10 3.3c1.7 1.6 2.8 4.1 2.8 6.7s-1.1 5.1-2.8 6.7c-1.7-1.6-2.8-4.1-2.8-6.7s1.1-5.1 2.8-6.7Z"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.4"
              />
            </svg>
            <span>공식 사이트</span>
          </a>
        </div>
      </header>

      <div className="vote-card__mini-bar" aria-hidden="true">
        <span
          className="vote-card__mini-bar-segment vote-card__mini-bar-segment--yes"
          style={{ width: `${voteTotal > 0 ? (item.counts.yes / voteTotal) * 100 : 0}%` }}
        />
        <span
          className="vote-card__mini-bar-segment vote-card__mini-bar-segment--no"
          style={{ width: `${voteTotal > 0 ? (item.counts.no / voteTotal) * 100 : 0}%` }}
        />
        <span
          className="vote-card__mini-bar-segment vote-card__mini-bar-segment--abstain"
          style={{ width: `${voteTotal > 0 ? (item.counts.abstain / voteTotal) * 100 : 0}%` }}
        />
        <span
          className="vote-card__mini-bar-segment vote-card__mini-bar-segment--absent"
          style={{ width: `${voteTotal > 0 ? (item.counts.absent / voteTotal) * 100 : 0}%` }}
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
          <span>반대 / 기권 / 불참</span>
          <span className="vote-card__highlight-count">{`${flaggedVoteCount}건`}</span>
        </summary>
        <div className="vote-card__highlight-body">
          {item.voteVisibility === "secret" ? (
            <p>{emptyHighlightMessage}</p>
          ) : hasAnyFlaggedVotes ? (
            <div className="vote-card__groups">
              {renderVoteGroup("반대", noVotes, item.counts.no)}
              {renderVoteGroup("기권", abstainVotes, item.counts.abstain)}
              {renderVoteGroup("불참", absentVotes, item.counts.absent, {
                unavailableMessage: showUnavailableAbsentNote
                  ? "불참 명단은 공식 총계와 개인별 공개 기록이 일치할 때만 표시합니다."
                  : undefined
              })}
            </div>
          ) : (
            <p>{emptyHighlightMessage}</p>
          )}
        </div>
      </details>
    </article>
  );
}
