import { ChangeDocket } from "./ChangeDocket.js";
import { VisualizationOverview } from "./VisualizationOverview.js";
import "../styles/v3-evidence.css";

import type {
  AccountabilitySummaryExport,
  AccountabilityTrendsExport
} from "@lawmaker-monitor/schemas";

type TrendsPageProps = {
  accountabilityTrends: AccountabilityTrendsExport | null;
  accountabilitySummary: AccountabilitySummaryExport | null;
  assemblyLabel: string;
};

export function TrendsPage({
  accountabilityTrends,
  accountabilitySummary,
  assemblyLabel
}: TrendsPageProps) {
  const observedWeekCount = accountabilityTrends?.weeks.length ?? 0;

  return (
    <main className="v3-evidence-page v3-trends-page">
      <header className="v3-page-header">
        <div className="v3-page-header__copy">
          <p className="v3-kicker">ACCOUNTABILITY TRENDS</p>
          <h1>변화 전후 책임 원장</h1>
          <p>
            잘한 변화와 추가 확인이 필요한 변화를 같은 기간·같은 분모로 비교하고
            원자료까지 추적합니다.
          </p>
        </div>
        <p className="v3-page-header__stamp">
          <span>현재 관측 범위</span>
          <strong>
            {observedWeekCount > 0
              ? `최근 ${observedWeekCount}주`
              : "집계 대기 중"}
          </strong>
        </p>
      </header>

      <ChangeDocket
        accountabilityTrends={accountabilityTrends}
        accountabilitySummary={accountabilitySummary}
      />

      <VisualizationOverview
        accountabilityTrends={accountabilityTrends}
        assemblyLabel={assemblyLabel}
      />

      <aside className="v3-method-note" aria-label="추세 데이터 해석 안내">
        <strong>0과 미관측을 구분합니다</strong>
        <p>
          표결 또는 당 기준이 성립하지 않은 주간은 0으로 채우지 않고 빈 구간으로
          유지합니다. 그래프와 표는 같은 집계값을 사용합니다.
        </p>
      </aside>
    </main>
  );
}
