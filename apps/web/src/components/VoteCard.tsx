import { useState } from "react";

import { StatusBadge } from "./StatusBadge.js";
import { VoteMinutesOpinionPanel } from "./VoteMinutesOpinionPanel.js";
import { VoteRosterSeatMap } from "./VoteRosterSeatMap.js";
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

type VoteCardProps = {
  item: LatestVoteItem;
  opinion?: VoteMinutesOpinionItem | null;
  memberDirectory?: AccountabilitySummaryExport["items"];
};

export function VoteCard({
  item,
  opinion = null,
  memberDirectory = []
}: VoteCardProps) {
  const voteTotal =
    item.counts.yes + item.counts.no + item.counts.abstain + item.counts.absent;
  const flaggedVoteCount =
    item.counts.no + item.counts.abstain + item.counts.absent;
  const combinedTitle = item.committeeName
    ? `${item.committeeName} · ${item.billName}`
    : item.billName;
  const showProvisional = item.sourceStatus !== "confirmed";
  const showVisibility = item.voteVisibility !== "recorded";
  const [evidenceOpen, setEvidenceOpen] = useState(false);

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

      <details
        className="vote-card__highlight"
        onToggle={(event) => setEvidenceOpen(event.currentTarget.open)}
      >
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

        {evidenceOpen ? (
          <div className="vote-card__highlight-body">
            {item.voteVisibility === "secret" ? (
              <p className="vote-card__private-note">
                무기명 표결은 개인별 표결 내역을 공개하지 않습니다.
              </p>
            ) : (
              <VoteRosterSeatMap item={item} members={memberDirectory} />
            )}

            <VoteMinutesOpinionPanel vote={item} opinion={opinion} />
          </div>
        ) : null}
      </details>
    </article>
  );
}
