import { VisualizationOverview } from "./VisualizationOverview.js";

import type { AccountabilityTrendsExport } from "@lawmaker-monitor/schemas";

type TrendsPageProps = {
  accountabilityTrends: AccountabilityTrendsExport | null;
  assemblyLabel: string;
};

export function TrendsPage({
  accountabilityTrends,
  assemblyLabel
}: TrendsPageProps) {
  return (
    <div className="page-wrapper">
      <div className="page-wrapper__header">
        <p className="section-label">추세 분석</p>
        <h1>출석과 당내 이탈 흐름</h1>
        <p>
          주간 단위로 참여·불참 구성을 보고, 당 기준이 성립한 표결에서 실제
          참여한 선택이 얼마나 달라졌는지도 함께 확인합니다.
        </p>
      </div>

      <VisualizationOverview
        accountabilityTrends={accountabilityTrends}
        assemblyLabel={assemblyLabel}
      />
    </div>
  );
}
