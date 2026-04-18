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
        <p className="section-label">출석 추이</p>
        <h1>출석 대비 불참 흐름</h1>
        <p>주간 단위로 찬성, 반대, 기권, 불참 비율 변화를 확인합니다.</p>
      </div>

      <VisualizationOverview
        accountabilityTrends={accountabilityTrends}
        assemblyLabel={assemblyLabel}
      />
    </div>
  );
}
