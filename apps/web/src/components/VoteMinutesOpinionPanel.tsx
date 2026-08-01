import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { QuotesIcon } from "@phosphor-icons/react/dist/csr/Quotes";

import { MemberDetailLink } from "./MemberDetailLink.js";
import { formatDate } from "../lib/format.js";

import type {
  LatestVoteItem,
  VoteMinutesOpinionEvidence,
  VoteMinutesOpinionItem
} from "@lawmaker-monitor/schemas";

type VoteMinutesOpinionPanelProps = {
  vote: LatestVoteItem;
  opinion: VoteMinutesOpinionItem | null;
};

type OpinionSection = {
  id: "majority" | "counter" | "abstain";
  label: string;
  description: string;
  voteCode: "yes" | "no" | "abstain";
};

const voteCodeLabel = {
  yes: "찬성",
  no: "반대",
  abstain: "기권"
} as const;

function buildOpinionSections(
  majorityVoteCode: VoteMinutesOpinionItem["majorityVoteCode"]
): OpinionSection[] {
  const majority = majorityVoteCode ?? "yes";
  const counter = majority === "no" ? "yes" : "no";
  const sections: OpinionSection[] = [
    {
      id: "majority",
      label: `다수 선택 · ${voteCodeLabel[majority]}`,
      description: "표결 다수와 같은 선택을 한 의원의 확인 발언",
      voteCode: majority
    },
    {
      id: "counter",
      label: `${voteCodeLabel[counter]} 선택`,
      description: "다수 선택과 다른 선택을 한 의원의 확인 발언",
      voteCode: counter
    }
  ];

  if (majority !== "abstain") {
    sections.push({
      id: "abstain",
      label: "기권 선택",
      description: "기권으로 기록된 의원의 확인 발언",
      voteCode: "abstain"
    });
  }

  return sections;
}

function buildSourceHref(evidence: VoteMinutesOpinionEvidence): string {
  return `${evidence.sourceUrl}${evidence.sourceFragment}`;
}

export function VoteMinutesOpinionPanel({
  vote,
  opinion
}: VoteMinutesOpinionPanelProps) {
  const sections = buildOpinionSections(opinion?.majorityVoteCode ?? null);

  return (
    <section
      className="vote-opinion-panel"
      aria-labelledby={`vote-opinion-title-${vote.rollCallId}`}
    >
      <header className="vote-opinion-panel__header">
        <div>
          <p className="vote-opinion-panel__kicker">
            <QuotesIcon size={17} weight="fill" aria-hidden="true" />
            공식 회의록 대조
          </p>
          <h4 id={`vote-opinion-title-${vote.rollCallId}`}>선택별 확인 발언</h4>
        </div>
        {opinion ? (
          <p className="vote-opinion-panel__coverage">
            <strong>{`${opinion.sourceStatementCount}건`}</strong>
            <span>{`${opinion.sourceMeetingCount}개 회의록 · ${formatDate(opinion.latestMeetingDate)}`}</span>
          </p>
        ) : (
          <span className="vote-opinion-panel__pending">연결 대기</span>
        )}
      </header>

      {opinion ? (
        <>
          <div className="vote-opinion-panel__sections">
            {sections.map((section) => {
              const evidence = opinion.evidence.filter(
                (entry) => entry.voteCode === section.voteCode
              );

              return (
                <section
                  key={section.id}
                  className={`vote-opinion-column vote-opinion-column--${section.id}`}
                >
                  <header>
                    <div>
                      <h5>{section.label}</h5>
                      <p>{section.description}</p>
                    </div>
                    <strong>{`${evidence.length}건`}</strong>
                  </header>

                  {evidence.length > 0 ? (
                    <ol>
                      {evidence.slice(0, 3).map((entry) => (
                        <li key={entry.statementId}>
                          <div className="vote-opinion-column__speaker">
                            <MemberDetailLink
                              memberId={entry.memberId}
                              name={entry.name}
                            />
                            <span>{entry.party}</span>
                          </div>
                          <p>{entry.summary}</p>
                          <a
                            href={buildSourceHref(entry)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <span>{`${formatDate(entry.meetingDate)} · ${entry.meetingTitle}`}</span>
                            <ArrowSquareOutIcon
                              size={14}
                              weight="bold"
                              aria-hidden="true"
                            />
                          </a>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="vote-opinion-column__empty">
                      이 선택과 연결된 의원 발언이 현재 회의록에서 확인되지
                      않았습니다.
                    </p>
                  )}

                  {evidence.length > 3 ? (
                    <p className="vote-opinion-column__more">
                      {`같은 선택의 확인 발언 ${evidence.length - 3}건이 더 있습니다.`}
                    </p>
                  ) : null}
                </section>
              );
            })}
          </div>
          <p className="vote-opinion-panel__notice">
            동일 의안번호의 공식 회의록 발언과 공개 표결 선택을 연결했습니다.
            발언을 표결 사유로 단정하거나, 발언이 없는 의원의 입장을 추정하지
            않습니다.
          </p>
        </>
      ) : (
        <div className="vote-opinion-panel__empty-state">
          <strong>연결된 회의록 발언이 아직 없습니다.</strong>
          <p>
            공식 회의록의 의안번호와 이 표결을 대조한 뒤 확인된 의원 발언만
            표시합니다.
          </p>
        </div>
      )}
    </section>
  );
}
