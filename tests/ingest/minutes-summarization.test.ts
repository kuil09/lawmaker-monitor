import { describe, expect, it } from "vitest";

import { memberStatementSummariesExportSchema } from "../../packages/schemas/src/index.js";
import {
  buildMemberStatementSummaryExports,
  buildMinutesSummaryGroups,
  chunkMinutesText,
  resolveStatementAgendaItem,
  sanitizeModelSummary,
  summarizeMinutesGroup,
  type MinutesDocumentSummaryArtifact
} from "../../packages/ingest/src/minutes-summarization.js";
import { parseAssemblyMinutesViewerHtml } from "../../packages/ingest/src/minutes-transcript.js";

const viewerHtml = `
  <div id="header">
    <div class="tit">
      <h2>
        <strong>제22대국회 제430회 (임시회) 제2차 법제사법위원회</strong>
        <span class="date">(2025.08.01.)</span>
      </h2>
    </div>
  </div>
  <div class="minutes_body">
    <div id="spk_1" class="item0 speaker spk_mem" data-mem_id="1" data-name="김민수" data-pos="위원">
      <div class="talk"><div class="txt"><span class="spk_sub">개의를 선언합니다.</span></div></div>
    </div>
    <p><a id="item1" class="tit" href="https://likms.assembly.go.kr/bill/1">1. 인공지능책임법안(의안번호 2212345)</a></p>
    <div id="spk_2" class="item1 speaker spk_mem" data-mem_id="1" data-name="김민수" data-pos="위원">
      <div class="man"><a href="https://www.assembly.go.kr/members/22nd/KIM"></a></div>
      <div class="talk"><div class="txt">
        <span class="spk_sub">인공지능책임법안은 고위험 인공지능의 영향평가를 의무화해야 합니다.</span>
        <span class="spk_sub">중소기업에는 단계적 적용과 기술 지원이 필요합니다.</span>
      </div></div>
    </div>
    <div id="spk_3" class="item1 speaker spk_mem" data-mem_id="2" data-name="박영희" data-pos="위원">
      <div class="talk"><div class="txt"><span class="spk_sub">인공지능책임법안의 적용 범위를 더 명확히 해야 합니다.</span></div></div>
    </div>
  </div>
`;

describe("minutes transcript summarization", () => {
  it("extracts official agenda, bill, speaker, and source anchors", () => {
    const transcript = parseAssemblyMinutesViewerHtml({
      documentId: "minutes-1",
      sourceUrl:
        "https://record.assembly.go.kr/assembly/viewer/minutes/xml.do?id=1&type=view",
      fallbackMeetingDate: "2025-08-01",
      fallbackTitle: "Fallback minutes",
      html: viewerHtml
    });

    expect(transcript.meetingDate).toBe("2025-08-01");
    expect(transcript.committeeName).toBe("법제사법위원회");
    expect(transcript.agendaItems[0]?.billIds).toEqual(["2212345"]);
    expect(transcript.statements[1]).toMatchObject({
      agendaItemId: "item1",
      speakerName: "김민수",
      speakerRole: "위원",
      sourceFragment: "#spk_2"
    });
  });

  it("builds bill-scoped groups only for unambiguous current members", () => {
    const transcript = parseAssemblyMinutesViewerHtml({
      documentId: "minutes-1",
      sourceUrl:
        "https://record.assembly.go.kr/assembly/viewer/minutes/xml.do?id=1&type=view",
      fallbackMeetingDate: "2025-08-01",
      fallbackTitle: "Fallback minutes",
      html: viewerHtml
    });
    const groups = buildMinutesSummaryGroups({
      transcript,
      members: [
        { memberId: "member-1", name: "김민수", party: "테스트당" },
        { memberId: "member-2", name: "박영희", party: "테스트당" }
      ]
    });

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      member: { memberId: "member-1" },
      billIds: ["2212345"],
      sourceFragment: "#spk_2"
    });
    expect(groups[0]?.text).toContain("단계적 적용");
    expect(groups.some((group) => group.agendaTitle === "개의")).toBe(false);
  });

  it("reassigns a statement only when its bill reference is unambiguous", () => {
    const agendaItems = [
      {
        agendaItemId: "item18",
        title: "15. 경찰관 직무집행법 일부개정법률안(의안번호 2208201)",
        billIds: ["2208201"],
        billDetailUrl: null
      },
      {
        agendaItemId: "item20",
        title:
          "17. 의용소방대 설치 및 운영에 관한 법률 일부개정법률안(의안번호 2207948)",
        billIds: ["2207948"],
        billDetailUrl: null
      }
    ];

    expect(
      resolveStatementAgendaItem({
        statement: {
          statementId: "spk_50",
          agendaItemId: "item20",
          speakerName: "손솔",
          speakerRole: "의원",
          sourceMemberId: null,
          officialProfileUrl: null,
          paragraphs: [
            "경찰관 직무집행법 일부개정법률안에 대한 반대 의견이 있습니다."
          ],
          sourceFragment: "#spk_50"
        },
        agendaItems
      })?.agendaItemId
    ).toBe("item18");

    expect(
      resolveStatementAgendaItem({
        statement: {
          statementId: "spk_48",
          agendaItemId: "item20",
          speakerName: "이성권",
          speakerRole: "행정안전위원장대리",
          sourceMemberId: null,
          officialProfileUrl: null,
          paragraphs: [
            "경찰관 직무집행법 일부개정법률안과 의용소방대 설치 및 운영에 관한 법률 일부개정법률안을 보고드립니다."
          ],
          sourceFragment: "#spk_48"
        },
        agendaItems
      })
    ).toBeNull();
  });

  it("uses a single-bill committee agenda for a member statement", () => {
    const agendaItems = [
      {
        agendaItemId: "item3",
        title: "3. 농어업재해대책법 일부개정법률안(의안번호 2209001)",
        billIds: ["2209001"],
        billDetailUrl: null
      }
    ];

    expect(
      resolveStatementAgendaItem({
        statement: {
          statementId: "spk_12",
          agendaItemId: "item3",
          speakerName: "김농정",
          speakerRole: "위원",
          sourceMemberId: null,
          officialProfileUrl: null,
          paragraphs: ["피해 농가의 지원 기준을 현실화할 필요가 있습니다."],
          sourceFragment: "#spk_12"
        },
        agendaItems
      })?.agendaItemId
    ).toBe("item3");

    expect(
      resolveStatementAgendaItem({
        statement: {
          statementId: "spk_13",
          agendaItemId: "item3",
          speakerName: "김농정",
          speakerRole: "위원장",
          sourceMemberId: null,
          officialProfileUrl: null,
          paragraphs: ["이 법안을 상정합니다."],
          sourceFragment: "#spk_13"
        },
        agendaItems
      })
    ).toBeNull();
  });

  it("removes thinking traces and supports deterministic summary injection", async () => {
    expect(
      sanitizeModelSummary(
        "<think>internal reasoning</think>\n요약: 영향평가 의무화와 중소기업 지원을 제안했습니다."
      )
    ).toBe("영향평가 의무화와 중소기업 지원을 제안했습니다.");

    const transcript = parseAssemblyMinutesViewerHtml({
      documentId: "minutes-1",
      sourceUrl:
        "https://record.assembly.go.kr/assembly/viewer/minutes/xml.do?id=1&type=view",
      fallbackMeetingDate: "2025-08-01",
      fallbackTitle: "Fallback minutes",
      html: viewerHtml
    });
    const [group] = buildMinutesSummaryGroups({
      transcript,
      members: [{ memberId: "member-1", name: "김민수", party: "테스트당" }]
    });
    expect(group).toBeDefined();

    const summary = await summarizeMinutesGroup({
      group: group!,
      summarize: async () =>
        "고위험 인공지능 영향평가를 의무화하고 중소기업을 단계적으로 지원하자고 제안했습니다."
    });
    expect(summary).toContain("영향평가");
  });

  it("keeps the complete source when bounding long statements", () => {
    const source = `${"가".repeat(6_000)}\n${"나".repeat(6_000)}\n마지막 근거`;
    const chunks = chunkMinutesText(source, 5_000, 2);

    expect(chunks.length).toBeLessThanOrEqual(2);
    expect(chunks.join("\n")).toContain("마지막 근거");
    expect(chunks.join("\n").replaceAll("\n", "")).toBe(
      source.replaceAll("\n", "")
    );
  });

  it("builds schema-valid member exports from cached document artifacts", () => {
    const artifact: MinutesDocumentSummaryArtifact = {
      schemaVersion: 1,
      generatedAt: "2025-08-02T00:00:00.000Z",
      documentId: "minutes-1",
      sourceContentSha256: "hash",
      sourceTranscriptPath: "raw/minutes-1/latest.transcript.json",
      sourceDocumentPath: "raw/minutes-1/latest.pdf",
      sourceUrl:
        "https://record.assembly.go.kr/assembly/viewer/minutes/xml.do?id=1&type=view",
      modelId: "Qwen/Qwen3-1.7B-GGUF:Q8_0",
      promptVersion: "minutes-summary-v1",
      summaryGroupCount: 1,
      complete: true,
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
          summary: "영향평가 의무화를 제안했습니다.",
          evidenceExcerpt: "고위험 인공지능의 영향평가를 의무화해야 합니다.",
          sourceUrl:
            "https://record.assembly.go.kr/assembly/viewer/minutes/xml.do?id=1&type=view",
          sourceFragment: "#spk_2",
          sourceDocumentPath: "raw/minutes-1/latest.pdf",
          sourceContentSha256: "hash",
          memberId: "member-1",
          name: "김민수",
          party: "테스트당"
        }
      ]
    };
    const [payload] = buildMemberStatementSummaryExports({
      generatedAt: "2025-08-02T00:00:00.000Z",
      assemblyNo: 22,
      assemblyLabel: "제22대 국회",
      modelId: artifact.modelId,
      promptVersion: artifact.promptVersion,
      members: [{ memberId: "member-1", name: "김민수", party: "테스트당" }],
      artifacts: [artifact]
    });

    expect(
      memberStatementSummariesExportSchema.parse(payload).summaries
    ).toHaveLength(1);
  });
});
