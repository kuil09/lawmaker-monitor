import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { useEffect, useMemo, useState } from "react";

import {
  buildDataUrl,
  loadMemberStatementSummaries,
  loadMemberStatementSummariesIndex
} from "../lib/data.js";
import { formatDate } from "../lib/format.js";

import type { MemberStatementSummariesExport } from "@lawmaker-monitor/schemas";

type MemberStatementSummarySectionProps = {
  memberId: string;
};

export function MemberStatementSummarySection({
  memberId
}: MemberStatementSummarySectionProps) {
  const [payload, setPayload] = useState<MemberStatementSummariesExport | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let active = true;
    setPayload(null);
    setLoading(true);
    setError(null);
    setShowAll(false);

    void loadMemberStatementSummariesIndex()
      .then((index) => {
        const member = index?.members.find(
          (candidate) => candidate.memberId === memberId
        );
        return member ? loadMemberStatementSummaries(member.path) : null;
      })
      .then((result) => {
        if (active) {
          setPayload(result);
        }
      })
      .catch((loadError: Error) => {
        if (active) {
          setError(loadError.message);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [memberId, retryKey]);

  const visibleSummaries = showAll
    ? (payload?.summaries ?? [])
    : (payload?.summaries.slice(0, 4) ?? []);
  const statementChangePair = useMemo(() => {
    const summaries = payload?.summaries ?? [];
    const groups = new Map<string, typeof summaries>();

    for (const item of summaries) {
      const issueKey =
        item.billIds[0] ??
        item.agendaTitle.replace(/\s+/g, " ").trim().toLocaleLowerCase("ko-KR");
      const current = groups.get(issueKey) ?? [];
      current.push(item);
      groups.set(issueKey, current);
    }

    return (
      [...groups.values()]
        .filter((items) => items.length >= 2)
        .map((items) =>
          [...items].sort(
            (left, right) =>
              new Date(left.meetingDate).getTime() -
              new Date(right.meetingDate).getTime()
          )
        )
        .sort((left, right) => {
          const leftLatest = left.at(-1)?.meetingDate ?? "";
          const rightLatest = right.at(-1)?.meetingDate ?? "";
          return rightLatest.localeCompare(leftLatest);
        })
        .map((items) => ({
          previous: items.at(-2)!,
          current: items.at(-1)!
        }))[0] ?? null
    );
  }, [payload]);

  if (!loading && !error && !payload) {
    return null;
  }

  return (
    <section className="member-statement-summary" aria-label="회의록 발언 요약">
      <div className="member-statement-summary__header">
        <div>
          <div className="member-statement-summary__eyebrow">
            <span>회의록 발언</span>
            <span className="member-statement-summary__ai-badge">
              경량 AI 요약
            </span>
          </div>
          <h3>회의록별 발언 핵심</h3>
        </div>
        <p>
          국회가 공개한 개별 회의록 원문을 수집해 회의·안건별로 나누고, 해당
          의원의 발언만 분리해 요약했습니다.
        </p>
      </div>

      {loading ? (
        <div className="member-statement-summary__status" role="status">
          회의록 발언 요약을 불러오는 중입니다.
        </div>
      ) : null}

      {error ? (
        <div className="member-statement-summary__status is-error">
          <p>발언 요약을 불러오지 못했습니다. {error}</p>
          <button
            type="button"
            onClick={() => setRetryKey((value) => value + 1)}
          >
            다시 시도
          </button>
        </div>
      ) : null}

      {payload ? (
        <>
          {statementChangePair ? (
            <section
              className="member-statement-summary__change-docket"
              aria-labelledby="member-statement-change-title"
            >
              <header>
                <div>
                  <span>ISSUE BEFORE → AFTER</span>
                  <h4 id="member-statement-change-title">
                    같은 쟁점의 발언 기록 대조
                  </h4>
                </div>
                <p>
                  두 발언을 자동 평가하지 않고 수집 시점과 요약을 나란히
                  보여줍니다.
                </p>
              </header>
              <div>
                <article>
                  <span>이전 발언</span>
                  <time dateTime={statementChangePair.previous.meetingDate}>
                    {formatDate(statementChangePair.previous.meetingDate)}
                  </time>
                  <h5>{statementChangePair.previous.agendaTitle}</h5>
                  <p>{statementChangePair.previous.summary}</p>
                  <a
                    href={`${statementChangePair.previous.sourceUrl}${statementChangePair.previous.sourceFragment}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    이전 원문
                  </a>
                </article>
                <ArrowRightIcon size={24} weight="bold" aria-hidden="true" />
                <article>
                  <span>최근 발언</span>
                  <time dateTime={statementChangePair.current.meetingDate}>
                    {formatDate(statementChangePair.current.meetingDate)}
                  </time>
                  <h5>{statementChangePair.current.agendaTitle}</h5>
                  <p>{statementChangePair.current.summary}</p>
                  <a
                    href={`${statementChangePair.current.sourceUrl}${statementChangePair.current.sourceFragment}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    최근 원문
                  </a>
                </article>
              </div>
            </section>
          ) : null}

          <div className="member-statement-summary__list">
            {visibleSummaries.map((item) => (
              <article
                className="member-statement-summary__item"
                key={item.statementId}
              >
                <div className="member-statement-summary__meta">
                  <span>{formatDate(item.meetingDate)}</span>
                  {item.committeeName ? (
                    <span>{item.committeeName}</span>
                  ) : null}
                  {item.speakerRole ? <span>{item.speakerRole}</span> : null}
                </div>
                <h4>{item.agendaTitle}</h4>
                <p className="member-statement-summary__copy">{item.summary}</p>
                <details className="member-statement-summary__evidence">
                  <summary>근거 발언 확인</summary>
                  <blockquote>{item.evidenceExcerpt}</blockquote>
                </details>
                <div className="member-statement-summary__links">
                  <a
                    href={`${item.sourceUrl}${item.sourceFragment}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    국회 회의록에서 확인
                  </a>
                  <a
                    href={buildDataUrl(item.sourceDocumentPath)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    수집 회의록 원문
                  </a>
                  {item.billIds.length > 0 ? (
                    <span>의안 {item.billIds.join(", ")}</span>
                  ) : (
                    <span>국회 회의록 원문</span>
                  )}
                </div>
              </article>
            ))}
          </div>

          {payload.summaries.length > 4 ? (
            <button
              className="member-statement-summary__more"
              type="button"
              onClick={() => setShowAll((value) => !value)}
            >
              {showAll
                ? "요약 접기"
                : `나머지 ${payload.summaries.length - 4}건 보기`}
            </button>
          ) : null}
          <p className="member-statement-summary__disclaimer">
            AI가 생성한 참고용 요약이며 국회의 공식 입장이나 의원 발언 원문을
            대체하지 않습니다.
          </p>
        </>
      ) : null}
    </section>
  );
}
