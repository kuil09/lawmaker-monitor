import { useEffect, useState } from "react";

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

  if (!loading && !error && !payload) {
    return null;
  }

  const visibleSummaries = showAll
    ? (payload?.summaries ?? [])
    : (payload?.summaries.slice(0, 4) ?? []);

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
