import { MemberSearchField } from "./MemberSearchField.js";
import { formatNumber } from "../lib/format.js";

import type {
  DistributionBehaviorFilter,
  DistributionBehaviorSummary
} from "../lib/distribution.js";
import type { ReactNode } from "react";

type HomeSearchOption = {
  id: string;
  label: string;
};

type HomePageProps = {
  currentAssemblyLabel: string;
  freshnessText: string;
  homeStatusMessages: string[];
  homeSearchOptions: HomeSearchOption[];
  homeBehaviorSummaries: DistributionBehaviorSummary[];
  selectedSearchMemberId: string | null;
  onSelectSearchMemberId: (memberId: string | null) => void;
  onSubmitSearch: () => void;
  onOpenDistribution: () => void;
  onOpenDistributionBehavior: (
    behaviorFilter: DistributionBehaviorFilter
  ) => void;
  leaderboardContent: ReactNode;
};

export function HomePage({
  currentAssemblyLabel,
  freshnessText,
  homeStatusMessages,
  homeSearchOptions,
  homeBehaviorSummaries,
  selectedSearchMemberId,
  onSelectSearchMemberId,
  onSubmitSearch,
  onOpenDistribution,
  onOpenDistributionBehavior,
  leaderboardContent
}: HomePageProps) {
  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="hero-panel__masthead">
          <div className="hero-panel__context">
            <p className="section-label">국회 책임성 모니터</p>
            <div className="hero-panel__chips">
              <span className="context-chip">{currentAssemblyLabel}</span>
              <span className="context-chip">공개 기록표결 기준</span>
            </div>
          </div>
          <span className="freshness-indicator">{freshnessText}</span>
        </div>
        <div className="hero-panel__headline">
          <h1>국회 책임성 모니터</h1>
          <p className="hero-panel__lede">
            공개 기록표결 기준으로 의원 활동을 추적합니다.
          </p>
        </div>
      </section>

      {homeStatusMessages.length > 0 ? (
        <section className="status-panel" role="status" aria-live="polite">
          <p className="section-label">상태 안내</p>
          <ul>
            {homeStatusMessages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="search-panel">
        <div className="search-panel__layout">
          <div className="search-panel__command">
            <p className="section-label">의원 직접 검색</p>
            <form
              className="search-panel__form"
              onSubmit={(event) => {
                event.preventDefault();
                onSubmitSearch();
              }}
            >
              <MemberSearchField
                label="의원 검색"
                options={homeSearchOptions}
                selectedId={selectedSearchMemberId}
                onSelect={onSelectSearchMemberId}
                placeholder="의원 이름 또는 정당을 입력하세요"
                className="search-panel__field"
                disabled={homeSearchOptions.length === 0}
              />
              <button
                type="submit"
                className="search-panel__submit"
                disabled={!selectedSearchMemberId}
              >
                활동 캘린더 열기
              </button>
            </form>
          </div>
          <aside className="search-panel__explore" aria-label="분포 탐색">
            <p className="section-label">전체 분포</p>
            <p className="search-panel__explore-copy">
              정당 평균과 함께 전체 위치를 먼저 훑어볼 수 있습니다.
            </p>
            <button
              type="button"
              className="search-panel__explore-action"
              onClick={onOpenDistribution}
            >
              국회 전체 분포 보기
            </button>
            <ul className="search-panel__browse-list">
              {homeBehaviorSummaries.map((summary) => (
                <li key={summary.key}>
                  <button
                    type="button"
                    className="search-panel__browse-button"
                    aria-label={summary.ctaLabel}
                    onClick={() => onOpenDistributionBehavior(summary.key)}
                    disabled={summary.count === 0}
                  >
                    <strong>{summary.label}</strong>
                    <small>{`${formatNumber(summary.count)}명`}</small>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </section>

      {leaderboardContent}

      <footer className="info-panel">
        <p className="info-panel__body">
          {`${currentAssemblyLabel} 공개 기록표결 기준, 현직 의원만 집계합니다. 데이터는 평일 하루 3회 갱신됩니다.`}
        </p>
      </footer>
    </main>
  );
}
