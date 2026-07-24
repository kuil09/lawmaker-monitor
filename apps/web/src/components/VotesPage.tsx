import { VoteCarousel } from "./VoteCarousel.js";
import { formatDateTime, getKoreanDateKey } from "../lib/format.js";
import "../styles/v3-evidence.css";

import type { LatestVotesExport } from "@lawmaker-monitor/schemas";

type VotesPageProps = {
  latestVotes: LatestVotesExport | null;
  loading: boolean;
  unavailable: boolean;
  assemblyLabel: string;
};

export function VotesPage({
  latestVotes,
  loading,
  unavailable,
  assemblyLabel
}: VotesPageProps) {
  const items = latestVotes?.items ?? [];
  const recordedDateCount = new Set(
    items.map((item) => getKoreanDateKey(item.voteDatetime))
  ).size;
  const confirmedSourceCount = items.filter(
    (item) => item.sourceStatus === "confirmed"
  ).length;

  return (
    <main className="v3-evidence-page v3-votes-page">
      <header className="v3-page-header">
        <div className="v3-page-header__copy">
          <p className="v3-kicker">PUBLIC VOTE RECORDS</p>
          <h1>{`${assemblyLabel} 최신 본회의 표결`}</h1>
          <p>
            날짜와 안건으로 기록을 좁히고, 반대·기권·불참 내역을 공식 출처와
            함께 검증합니다.
          </p>
        </div>
        <p className="v3-page-header__stamp">
          <span>데이터 생성 시각</span>
          <strong>
            {latestVotes?.generatedAt
              ? formatDateTime(latestVotes.generatedAt)
              : "수집 대기 중"}
          </strong>
        </p>
      </header>

      <dl className="v3-summary-strip" aria-label="최신 표결 데이터 요약">
        <div>
          <dt>공개 기록</dt>
          <dd>{loading ? "—" : `${items.length}건`}</dd>
          <small>현재 데이터셋</small>
        </div>
        <div>
          <dt>표결 날짜</dt>
          <dd>{loading ? "—" : `${recordedDateCount}일`}</dd>
          <small>대한민국 표준시</small>
        </div>
        <div>
          <dt>출처 확정</dt>
          <dd>{loading ? "—" : `${confirmedSourceCount}건`}</dd>
          <small>국회 공식 기록</small>
        </div>
        <div>
          <dt>데이터 상태</dt>
          <dd>{unavailable ? "준비 중" : loading ? "갱신 중" : "공개"}</dd>
          <small>원문 링크 제공</small>
        </div>
      </dl>

      <section
        className="v3-evidence-workbench"
        aria-labelledby="latest-vote-records-heading"
      >
        <div className="v3-section-heading">
          <div>
            <p className="v3-kicker">EVIDENCE TIMELINE</p>
            <h2 id="latest-vote-records-heading">표결 기록 탐색</h2>
          </div>
          <p>검색과 필터는 현재 공개된 기록에만 적용됩니다.</p>
        </div>
        <VoteCarousel
          items={latestVotes?.items ?? null}
          loading={loading}
          unavailable={unavailable}
        />
      </section>

      <aside className="v3-method-note" aria-label="표결 데이터 이용 안내">
        <strong>공식 기록 우선</strong>
        <p>
          각 안건의 숫자는 공개된 국회 기록을 그대로 표시합니다. 확정되지 않은
          출처나 무기명 표결은 해당 기록 안에서 별도로 표시합니다.
        </p>
      </aside>
    </main>
  );
}
