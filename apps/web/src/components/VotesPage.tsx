import { VoteCarousel } from "./VoteCarousel.js";

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
  return (
    <div className="page-wrapper">
      <div className="page-wrapper__header">
        <p className="section-label">최근 표결</p>
        <h1>{`${assemblyLabel} 최신 본회의 표결`}</h1>
        <p>공개 기록표결을 날짜별로 확인할 수 있습니다.</p>
      </div>

      <section className="feed-panel">
        <VoteCarousel
          items={latestVotes?.items ?? null}
          loading={loading}
          unavailable={unavailable}
        />
      </section>
    </div>
  );
}
