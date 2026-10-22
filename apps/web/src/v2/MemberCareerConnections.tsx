import type {
  AnalysisMember,
  CareerClaim,
  MemberAnalysisDetail
} from "@lawmaker-monitor/schemas";

const careerTopics: Record<string, string[]> = {
  medicine: ["보건·복지"],
  education: ["교육·연구", "과학·디지털"],
  law: ["법률·행정"],
  business: ["경제·산업"],
  labor: ["노동·고용"],
  administration: ["법률·행정"],
  media: ["과학·디지털", "문화·농림"],
  civic: ["환경·에너지", "보건·복지", "노동·고용"]
};
const kindNames = {
  vote: "표결 참여",
  proposal: "대표발의",
  statement: "발언"
};

export function MemberCareerConnections({
  member,
  detail,
  from,
  to,
  onCareerSelect,
  onPeriodSelect
}: {
  member: AnalysisMember;
  detail: MemberAnalysisDetail;
  from: string;
  to: string;
  onCareerSelect: (category: string) => void;
  onPeriodSelect: (claim: CareerClaim) => void;
}) {
  const groups = new Map<string, CareerClaim[]>();
  for (const claim of member.careerClaims)
    groups.set(claim.category, [...(groups.get(claim.category) ?? []), claim]);
  function evidence(claim: CareerClaim, i: number) {
    return (
      <div key={`${claim.evidence}-${i}`}>
        <blockquote>{claim.evidence}</blockquote>
        <p>
          {claim.dateText ?? "기간 미확인"}
          {claim.precision !== "unknown"
            ? ` (${claim.precision === "year" ? "연" : claim.precision === "month" ? "월" : "일"} 단위)`
            : ""}{" "}
          ·{" "}
          <a href={claim.sourceUrl} target="_blank" rel="noreferrer">
            약력 근거 ↗
          </a>
        </p>
        {claim.startDate || claim.endDate ? (
          <button type="button" onClick={() => onPeriodSelect(claim)}>
            경력 기간을 연표에서 보기
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <section className="analysis-section" aria-labelledby="analysis-career">
      <h3 id="analysis-career">경력에서 활동으로</h3>
      {groups.size ? (
        <ul className="analysis-career-claims">
          {[...groups].map(([category, claims]) => {
            const related = detail.topics.filter(
              (row) =>
                row.month >= from &&
                row.month <= to &&
                (careerTopics[category] ?? []).includes(row.topic)
            );
            return (
              <li key={category}>
                <strong>{claims[0]!.label}</strong>
                {evidence(claims[0]!, 0)}
                {claims.length > 1 ? (
                  <details>
                    <summary>
                      같은 분야 경력 {claims.length - 1}건 더 보기
                    </summary>
                    {claims.slice(1).map(evidence)}
                  </details>
                ) : null}
                <div className="analysis-career-links">
                  {Object.entries(kindNames).map(([kind, label]) => (
                    <span key={kind}>
                      {label}{" "}
                      {related
                        .filter((row) => row.kind === kind)
                        .reduce((sum, row) => sum + row.count, 0)}
                      건
                    </span>
                  ))}
                </div>
                <p>
                  연결 의제: {(careerTopics[category] ?? []).join(" · ")} ·
                  선택한 기간의 수록 자료 기준
                </p>
                <button type="button" onClick={() => onCareerSelect(category)}>
                  같은 경력의 의원 찾기
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p>
          약력에서 분류 기준에 맞는 직업·직책을 확인하지 못했습니다. 공식 소개
          원문을 확인해 주세요.
        </p>
      )}
    </section>
  );
}
