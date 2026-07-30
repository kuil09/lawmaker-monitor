import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dataMocks = vi.hoisted(() => ({
  loadMemberStatementSummariesIndex: vi.fn(),
  loadMemberStatementSummaries: vi.fn(),
  buildDataUrl: vi.fn((path: string) => `https://data.example.test/${path}`)
}));

vi.mock("../../apps/web/src/lib/data.js", () => ({
  loadMemberStatementSummariesIndex:
    dataMocks.loadMemberStatementSummariesIndex,
  loadMemberStatementSummaries: dataMocks.loadMemberStatementSummaries,
  buildDataUrl: dataMocks.buildDataUrl
}));

import { MemberStatementSummarySection } from "../../apps/web/src/components/MemberStatementSummarySection.js";

describe("member statement summary section", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders AI disclosure, evidence, and official source links", async () => {
    dataMocks.loadMemberStatementSummariesIndex.mockResolvedValue({
      generatedAt: "2025-08-02T00:00:00.000Z",
      assemblyNo: 22,
      assemblyLabel: "제22대 국회",
      modelId: "Qwen/Qwen3-1.7B-GGUF:Q8_0",
      promptVersion: "minutes-summary-v6-extractive",
      members: [
        {
          memberId: "M001",
          name: "김민수",
          party: "테스트당",
          summaryCount: 1,
          path: "exports/member_statement_summaries/M001.json"
        }
      ]
    });
    dataMocks.loadMemberStatementSummaries.mockResolvedValue({
      generatedAt: "2025-08-02T00:00:00.000Z",
      assemblyNo: 22,
      assemblyLabel: "제22대 국회",
      memberId: "M001",
      name: "김민수",
      party: "테스트당",
      modelId: "Qwen/Qwen3-1.7B-GGUF:Q8_0",
      promptVersion: "minutes-summary-v6-extractive",
      summaries: [
        {
          statementId: "statement-1",
          documentId: "minutes-1",
          meetingTitle: "제2차 법제사법위원회",
          meetingDate: "2025-08-01",
          committeeName: "법제사법위원회",
          agendaTitle: "1. 인공지능책임법안(의안번호 2212345)",
          billIds: ["2212345"],
          speakerRole: "위원",
          summary: "고위험 인공지능의 영향평가를 의무화해야 합니다.",
          evidenceExcerpt: "고위험 인공지능의 영향평가를 의무화해야 합니다.",
          sourceUrl:
            "https://record.assembly.go.kr/assembly/viewer/minutes/xml.do?id=1&type=view",
          sourceFragment: "#spk_2",
          sourceDocumentPath: "raw/minutes-1/latest.html",
          sourceContentSha256: "hash",
          sourceKind: "official_minutes_transcript"
        }
      ]
    });

    render(<MemberStatementSummarySection memberId="M001" />);

    await waitFor(() => {
      expect(
        screen.getAllByText("고위험 인공지능의 영향평가를 의무화해야 합니다.")
      ).toHaveLength(2);
    });
    expect(screen.getByText("AI 선별 · 원문 인용형")).toBeInTheDocument();
    expect(
      screen.getByText(/경량 AI는 중요 문장 선택에만 사용/)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "국회 회의록에서 확인" })
    ).toHaveAttribute(
      "href",
      "https://record.assembly.go.kr/assembly/viewer/minutes/xml.do?id=1&type=view#spk_2"
    );
    expect(
      screen.getByRole("link", { name: "수집 회의록 원문" })
    ).toHaveAttribute(
      "href",
      "https://data.example.test/raw/minutes-1/latest.html"
    );
    expect(dataMocks.loadMemberStatementSummaries).toHaveBeenCalledWith(
      "exports/member_statement_summaries/M001.json"
    );
  });

  it("quarantines legacy generated summaries until they are regenerated", async () => {
    dataMocks.loadMemberStatementSummariesIndex.mockResolvedValue({
      generatedAt: "2026-07-23T00:00:00.000Z",
      assemblyNo: 22,
      assemblyLabel: "제22대 국회",
      modelId: "LGAI-EXAONE/EXAONE-4.0-1.2B-GGUF:Q8_0",
      promptVersion: "minutes-summary-v5",
      members: [
        {
          memberId: "1A82234K",
          name: "박은정",
          party: "조국혁신당",
          summaryCount: 1,
          path: "exports/member_statement_summaries/1A82234K.json"
        }
      ]
    });
    dataMocks.loadMemberStatementSummaries.mockResolvedValue({
      generatedAt: "2026-07-23T00:00:00.000Z",
      assemblyNo: 22,
      assemblyLabel: "제22대 국회",
      memberId: "1A82234K",
      name: "박은정",
      party: "조국혁신당",
      modelId: "LGAI-EXAONE/EXAONE-4.0-1.2B-GGUF:Q8_0",
      promptVersion: "minutes-summary-v5",
      summaries: [
        {
          statementId: "legacy-hallucination",
          documentId: "assembly-minutes-minutes-57033",
          meetingTitle: "제22대국회 제437회 (임시회) 제3차 법제사법위원회",
          meetingDate: "2026-07-22",
          committeeName: "법제사법위원회",
          agendaTitle: "1. 긴급현안질의",
          billIds: [],
          speakerRole: "위원",
          summary:
            "오펜하이머 시장 사건과 당협위 지시를 촉구했다고 요약했습니다.",
          evidenceExcerpt: "오세훈 사건도 신속하게 처리해 주시기 바랍니다.",
          sourceUrl:
            "https://record.assembly.go.kr/assembly/viewer/minutes/xml.do?id=57033&type=view",
          sourceFragment: "#spk_120",
          sourceDocumentPath:
            "raw/documents/assembly-minutes/2026/07/22/assembly-minutes-minutes-57033/latest.html",
          sourceContentSha256: "hash",
          sourceKind: "official_minutes_transcript"
        }
      ]
    });

    render(<MemberStatementSummarySection memberId="1A82234K" />);

    expect(
      await screen.findByText(/기존 생성형 요약은 사실 보존 검증을 강화/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/오펜하이머/)).not.toBeInTheDocument();
  });

  it("stays hidden when no summary artifact has been published", async () => {
    dataMocks.loadMemberStatementSummariesIndex.mockResolvedValue({
      generatedAt: "2025-08-02T00:00:00.000Z",
      assemblyNo: 22,
      assemblyLabel: "제22대 국회",
      modelId: "Qwen/Qwen3-1.7B-GGUF:Q8_0",
      promptVersion: "minutes-summary-v1",
      members: []
    });
    const { container } = render(
      <MemberStatementSummarySection memberId="M001" />
    );

    await waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
    expect(dataMocks.loadMemberStatementSummaries).not.toHaveBeenCalled();
  });
});
