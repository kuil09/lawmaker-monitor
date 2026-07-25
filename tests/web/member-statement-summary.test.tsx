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
      promptVersion: "minutes-summary-v1",
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
      promptVersion: "minutes-summary-v1",
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
          summary: "고위험 인공지능 영향평가 의무화를 제안했습니다.",
          evidenceExcerpt: "고위험 인공지능의 영향평가를 의무화해야 합니다.",
          sourceUrl:
            "https://record.assembly.go.kr/assembly/viewer/minutes/xml.do?id=1&type=view",
          sourceFragment: "#spk_2",
          sourceDocumentPath: "raw/minutes-1/latest.pdf",
          sourceContentSha256: "hash"
        }
      ]
    });

    render(<MemberStatementSummarySection memberId="M001" />);

    await waitFor(() => {
      expect(
        screen.getByText("고위험 인공지능 영향평가 의무화를 제안했습니다.")
      ).toBeInTheDocument();
    });
    expect(screen.getByText("경량 AI 요약")).toBeInTheDocument();
    expect(screen.getByText(/AI가 생성한 참고용 요약/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "국회 회의록에서 확인" })
    ).toHaveAttribute(
      "href",
      "https://record.assembly.go.kr/assembly/viewer/minutes/xml.do?id=1&type=view#spk_2"
    );
    expect(screen.getByRole("link", { name: "원문 PDF" })).toHaveAttribute(
      "href",
      "https://data.example.test/raw/minutes-1/latest.pdf"
    );
    expect(dataMocks.loadMemberStatementSummaries).toHaveBeenCalledWith(
      "exports/member_statement_summaries/M001.json"
    );
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
