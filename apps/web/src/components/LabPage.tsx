import type { Manifest } from "@lawmaker-monitor/schemas";

type LabPageProps = {
  manifest: Manifest | null;
  accountabilitySummary: unknown;
  assemblyLabel: string;
};

export function LabPage({ assemblyLabel }: LabPageProps) {
  return (
    <div className="lab-page">
      <div className="lab-page__header">
        <h1 className="lab-page__title">실험실</h1>
        <p className="lab-page__subtitle">{assemblyLabel} · 실험적 기능 테스트 공간</p>
      </div>
      <p className="lab-disclaimer">
        헥사곤 지도 실험은{" "}
        <a href="#map" style={{ color: "inherit", fontWeight: 600 }}>지도 페이지</a>로
        이동했습니다.
      </p>
    </div>
  );
}
