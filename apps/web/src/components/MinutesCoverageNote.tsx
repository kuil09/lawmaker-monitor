import { useEffect, useState } from "react";

import { loadMinutesSummaryCoverage } from "../lib/data.js";
import { formatDateTime } from "../lib/format.js";

import type { MinutesSummaryCoverage } from "@lawmaker-monitor/schemas";

export function MinutesCoverageNote() {
  const [coverage, setCoverage] = useState<MinutesSummaryCoverage | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    void loadMinutesSummaryCoverage()
      .then((result) => {
        if (active) setCoverage(result);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  if (!coverage)
    return error ? <p>회의록 처리 범위를 확인하지 못했습니다.</p> : null;
  return (
    <p className="vote-opinion-panel__notice">
      {`본문 추출 ${coverage.transcriptDocuments.toLocaleString("ko-KR")}건 중 요약 완료 ${coverage.summarizedDocuments.toLocaleString("ko-KR")}건 · 미완료 ${coverage.remainingDocuments.toLocaleString("ko-KR")}건. `}
      {`처리 현황 ${formatDateTime(coverage.updatedAt)} 기준. `}
      미완료 회의록의 발언은 아직 표시되지 않을 수 있습니다.
    </p>
  );
}
