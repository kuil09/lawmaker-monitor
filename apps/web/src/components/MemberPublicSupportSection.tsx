import {
  buildMemberPublicSupportModel,
  formatWonExact,
  type PublicSupportEvidenceKind
} from "../lib/member-public-support.js";

type MemberPublicSupportSectionProps = {
  memberName: string;
};

const evidenceLabels: Record<PublicSupportEvidenceKind, string> = {
  statutory: "법정 기준",
  estimated: "공식 기준 추정",
  "actual-unavailable": "실제 집행 미확보",
  "shared-excluded": "개인 배분 제외"
};

export function MemberPublicSupportSection({
  memberName
}: MemberPublicSupportSectionProps) {
  const model = buildMemberPublicSupportModel();

  return (
    <section className="public-support" aria-labelledby="public-support-title">
      <header className="public-support__head">
        <div>
          <p className="section-label">의원실 운영 기반</p>
          <h3 id="public-support-title">공적 지원 현황</h3>
        </div>
        <span className="public-support__period">
          {model.fiscalYear}년 기준
        </span>
      </header>

      <p className="public-support__intro">
        {memberName} 의원실에 적용되는 법정 지원 기준입니다. 아래 금액은 의원
        개인이 받은 돈이 아니라, 공식 정원과 보수표로 계산한 보좌 인력의
        기본봉급 추정입니다.
      </p>

      <div className="public-support__estimate">
        <div className="public-support__estimate-copy">
          <span>보좌직원 {model.staffHeadcount}명 정원 기준</span>
          <strong>{formatWonExact(model.annualStaffBaseEstimateWon)}</strong>
          <small>
            연간 기본봉급 추정 · 월{" "}
            {formatWonExact(model.monthlyStaffBaseEstimateWon)}
          </small>
        </div>
        <div className="public-support__estimate-status">
          <span className="public-support__badge public-support__badge--estimated">
            추정
          </span>
          <p>실제 의원실 집행액 아님</p>
        </div>
      </div>

      <div
        className="public-support__visual"
        aria-label="직급별 연간 기본봉급 구성"
      >
        <div className="public-support__stack" aria-hidden="true">
          {model.staffGrades.map((grade) => (
            <span
              key={grade.gradeLabel}
              className={`public-support__stack-segment public-support__stack-segment--${grade.tone}`}
              style={{ width: `${grade.sharePercent}%` }}
            />
          ))}
        </div>
        <ul className="public-support__grade-list">
          {model.staffGrades.map((grade) => (
            <li key={grade.gradeLabel}>
              <span
                className={`public-support__swatch public-support__swatch--${grade.tone}`}
                aria-hidden="true"
              />
              <div>
                <strong>{grade.gradeLabel}</strong>
                <small>
                  {grade.headcount}명 · {grade.referenceStep} · 1인 월{" "}
                  {formatWonExact(grade.monthlyPerPersonWon)}
                </small>
              </div>
              <span>{formatWonExact(grade.annualAmountWon)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="public-support__evidence-grid">
        {model.categories.map((category) => (
          <article
            key={category.title}
            className={`public-support__evidence public-support__evidence--${category.evidenceKind}`}
          >
            <span>{category.statusLabel}</span>
            <h4>{category.title}</h4>
            <p>{category.description}</p>
          </article>
        ))}
      </div>

      <details className="public-support__method">
        <summary>산정 기준과 출처 확인</summary>
        <div className="public-support__method-body">
          <div>
            <h4>해석할 때 주의할 점</h4>
            <ul>
              {model.limitations.map((limitation) => (
                <li key={limitation}>{limitation}</li>
              ))}
            </ul>
          </div>
          <div>
            <h4>공식 출처</h4>
            <ul className="public-support__sources">
              {model.sources.map((source) => (
                <li key={source.id}>
                  <a href={source.url} target="_blank" rel="noreferrer">
                    {source.title}
                  </a>
                  <span>{source.publisher}</span>
                  <p>{source.description}</p>
                </li>
              ))}
            </ul>
          </div>
          <div className="public-support__legend" aria-label="자료 성격 범례">
            {(
              Object.entries(evidenceLabels) as [
                PublicSupportEvidenceKind,
                string
              ][]
            ).map(([kind, label]) => (
              <span key={kind}>
                <i className={`public-support__legend-mark--${kind}`} />
                {label}
              </span>
            ))}
          </div>
        </div>
      </details>
    </section>
  );
}
