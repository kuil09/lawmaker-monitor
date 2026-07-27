import { afterEach, describe, expect, it, vi } from "vitest";

import { memberStatementSummariesExportSchema } from "../../packages/schemas/src/index.js";
import {
  buildMemberStatementSummaryExports,
  buildMinutesSummaryGroups,
  chunkMinutesText,
  createLlamaServerSummarizer,
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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it("keeps trusted catalog metadata when the viewer header is inconsistent", () => {
    const transcript = parseAssemblyMinutesViewerHtml({
      documentId: "minutes-stale-header",
      sourceUrl:
        "https://record.assembly.go.kr/assembly/viewer/minutes/xml.do?id=52038&type=view",
      fallbackMeetingDate: "2024-06-05",
      fallbackTitle: "제22대국회 제415회 국회본회의 회의록",
      html: viewerHtml.replace(
        "제22대국회 제430회 (임시회) 제2차 법제사법위원회",
        "제22대국회 제434회 (임시회) 제1차 국정조사특별위원회"
      )
    });

    expect(transcript.meetingDate).toBe("2024-06-05");
    expect(transcript.meetingTitle).toBe(
      "제22대국회 제415회 국회본회의 회의록"
    );
    expect(transcript.committeeName).toBe("국회본회의");
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

  it("keeps substantive member statements that are not tied to a bill", () => {
    const transcript = parseAssemblyMinutesViewerHtml({
      documentId: "minutes-general",
      sourceUrl:
        "https://record.assembly.go.kr/assembly/viewer/minutes/xml.do?id=2&type=view",
      fallbackMeetingDate: "2025-08-01",
      fallbackTitle: "Fallback minutes",
      html: `
        <div id="header">
          <div class="tit"><h2><strong>제2차 운영위원회</strong><span class="date">(2025.08.01.)</span></h2></div>
        </div>
        <div class="minutes_body">
          <p><a id="item4" class="tit">4. 현안질의</a></p>
          <div id="spk_4" class="item4 speaker spk_mem" data-name="김민수" data-pos="위원">
            <div class="talk"><div class="txt">
              <span class="spk_sub">정부의 자료 제출이 지연된 이유와 향후 제출 일정을 구체적으로 밝혀 주시기 바랍니다.</span>
            </div></div>
          </div>
        </div>
      `
    });

    const groups = buildMinutesSummaryGroups({
      transcript,
      members: [{ memberId: "member-1", name: "김민수", party: "테스트당" }]
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      member: { memberId: "member-1" },
      agendaTitle: "4. 현안질의",
      billIds: []
    });
  });

  it("uses the official member profile URL to resolve duplicate names", () => {
    const transcript = parseAssemblyMinutesViewerHtml({
      documentId: "minutes-duplicate-name",
      sourceUrl:
        "https://record.assembly.go.kr/assembly/viewer/minutes/xml.do?id=3&type=view",
      fallbackMeetingDate: "2025-08-01",
      fallbackTitle: "Fallback minutes",
      html: `
        <div id="header">
          <div class="tit"><h2><strong>제2차 운영위원회</strong><span class="date">(2025.08.01.)</span></h2></div>
        </div>
        <div class="minutes_body">
          <p><a id="item4" class="tit">4. 현안질의</a></p>
          <div id="spk_4" class="item4 speaker spk_mem" data-name="김민수" data-pos="위원">
            <div class="man"><a href="https://www.assembly.go.kr/members/22nd/KIM-B"></a></div>
            <div class="talk"><div class="txt">
              <span class="spk_sub">중복된 이름이 있어도 공식 의원 프로필을 기준으로 해당 의원의 발언을 연결해야 합니다.</span>
            </div></div>
          </div>
        </div>
      `
    });

    const groups = buildMinutesSummaryGroups({
      transcript,
      members: [
        {
          memberId: "member-a",
          name: "김민수",
          party: "가당",
          officialProfileUrl: "https://www.assembly.go.kr/members/22nd/KIM-A"
        },
        {
          memberId: "member-b",
          name: "김민수",
          party: "나당",
          officialProfileUrl: "https://www.assembly.go.kr/members/22nd/KIM-B"
        }
      ]
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.member.memberId).toBe("member-b");
  });

  it("rejects search pages as summary source documents", () => {
    expect(() =>
      buildMinutesSummaryGroups({
        transcript: {
          schemaVersion: 1,
          documentId: "search-page",
          sourceUrl:
            "https://record.assembly.go.kr/assembly/mnts/search/search.do",
          meetingTitle: "검색 결과",
          meetingDate: "2025-08-01",
          committeeName: null,
          agendaItems: [],
          statements: []
        },
        members: []
      })
    ).toThrow("individual official minutes document URL");
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
    expect(() =>
      sanitizeModelSummary(
        "문대림委员主张 해양 시추 계획을 추진해야 한다고 밝혔습니다."
      )
    ).toThrow("non-Korean CJK script");
    expect(
      sanitizeModelSummary(
        "문대림 의원은 해양 시추 계획을 추진해야 한다고 밝혔습니다"
      )
    ).toBe("문대림 의원은 해양 시추 계획을 추진해야 한다고 밝혔습니다.");
    expect(() =>
      sanitizeModelSummary("문대림 의원은 해양 시추 계획을 추진")
    ).toThrow("unfinished summary");
    expect(() =>
      sanitizeModelSummary(
        "문대림 의원은 해양 시추 계획을 추진해야 한다고 밝혔습니다..."
      )
    ).toThrow("unfinished summary");
    expect(
      sanitizeModelSummary(
        "문대림 의원은 해양 시추 계획을 검토했습니다. 추가 협의를 진행",
        { allowTrailingFragment: true }
      )
    ).toBe("문대림 의원은 해양 시추 계획을 검토했습니다.");

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
    const chunks = chunkMinutesText(source, 5_000);

    expect(chunks).toHaveLength(3);
    expect(chunks.every((chunk) => chunk.length <= 5_000)).toBe(true);
    expect(chunks.join("\n")).toContain("마지막 근거");
    expect(chunks.join("\n").replaceAll("\n", "")).toBe(
      source.replaceAll("\n", "")
    );
  });

  it("keeps every local-model request within the text context boundary", async () => {
    const observedLengths: number[] = [];
    const summary = await summarizeMinutesGroup({
      group: {
        groupId: "long-group",
        member: {
          memberId: "member-1",
          name: "김민수",
          party: "테스트당"
        },
        documentId: "minutes-long",
        meetingTitle: "긴 회의록",
        meetingDate: "2025-08-01",
        committeeName: "법제사법위원회",
        agendaTitle: "긴 발언 안건",
        billIds: [],
        speakerRole: "위원",
        text: "긴 발언입니다. ".repeat(9_000),
        statementIds: ["statement-1"],
        sourceUrl:
          "https://record.assembly.go.kr/assembly/viewer/minutes/xml.do?id=1&type=view",
        sourceFragment: "#statement-1"
      },
      summarize: async (input) => {
        observedLengths.push(input.text.length);
        return "김민수 의원은 해당 안건에 관한 의견을 제시했습니다.";
      }
    });

    expect(summary).toBe("김민수 의원은 해당 안건에 관한 의견을 제시했습니다.");
    expect(Math.max(...observedLengths)).toBeLessThanOrEqual(5_000);
    expect(observedLengths.length).toBeGreaterThan(4);
  });

  it("retries token-limited local-model output with a fresh larger request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "김민수 의원은 제도 개선 필요성을 강조하며"
                },
                finish_reason: "length"
              }
            ]
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "김민수 의원은 제도 개선 필요성을 강조했습니다."
                },
                finish_reason: "stop"
              }
            ]
          }),
          { status: 200 }
        )
      );
    vi.stubGlobal("fetch", fetchMock);
    const summarize = createLlamaServerSummarizer({
      endpoint: "http://127.0.0.1:8080/v1/chat/completions",
      modelId: "test-model"
    });

    await expect(
      summarize({
        group: {
          groupId: "group-1",
          member: {
            memberId: "member-1",
            name: "김민수",
            party: "테스트당"
          },
          documentId: "minutes-1",
          meetingTitle: "테스트 회의",
          meetingDate: "2025-08-01",
          committeeName: "법제사법위원회",
          agendaTitle: "테스트 안건",
          billIds: [],
          speakerRole: "위원",
          text: "제도 개선이 필요합니다.",
          statementIds: ["statement-1"],
          sourceUrl:
            "https://record.assembly.go.kr/assembly/viewer/minutes/xml.do?id=1&type=view",
          sourceFragment: "#statement-1"
        },
        text: "제도 개선이 필요합니다."
      })
    ).resolves.toBe("김민수 의원은 제도 개선 필요성을 강조했습니다.");

    const requestBodies = fetchMock.mock.calls.map((call) =>
      JSON.parse(String((call[1] as RequestInit).body))
    );
    expect(requestBodies.map((body) => body.max_tokens)).toEqual([384, 512]);
    expect(requestBodies.every((body) => body.messages.length === 2)).toBe(
      true
    );
  });

  it("builds schema-valid member exports from cached document artifacts", () => {
    const artifact: MinutesDocumentSummaryArtifact = {
      schemaVersion: 1,
      sourceKind: "official_minutes_transcript",
      generatedAt: "2025-08-02T00:00:00.000Z",
      documentId: "minutes-1",
      sourceContentSha256: "hash",
      sourceTranscriptPath: "raw/minutes-1/latest.transcript.json",
      sourceDocumentPath: "raw/minutes-1/latest.html",
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
          sourceDocumentPath: "raw/minutes-1/latest.html",
          sourceContentSha256: "hash",
          sourceKind: "official_minutes_transcript",
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

  it("publishes only artifacts from the active model and prompt version", () => {
    const createArtifact = (
      overrides: Partial<MinutesDocumentSummaryArtifact>
    ): MinutesDocumentSummaryArtifact => ({
      schemaVersion: 1,
      sourceKind: "official_minutes_transcript",
      generatedAt: "2025-08-02T00:00:00.000Z",
      documentId: "minutes-current",
      sourceContentSha256: "hash-current",
      sourceTranscriptPath: "raw/minutes-current/latest.transcript.json",
      sourceDocumentPath: "raw/minutes-current/latest.html",
      sourceUrl:
        "https://record.assembly.go.kr/assembly/viewer/minutes/xml.do?id=current&type=view",
      modelId: "Qwen/Qwen3-1.7B-GGUF:Q8_0",
      promptVersion: "minutes-summary-v4",
      summaryGroupCount: 1,
      complete: true,
      summaries: [
        {
          statementId: "statement-current",
          documentId: "minutes-current",
          meetingTitle: "제2차 법제사법위원회",
          meetingDate: "2025-08-01",
          committeeName: "법제사법위원회",
          agendaTitle: "1. 인공지능책임법안(의안번호 2212345)",
          billIds: ["2212345"],
          speakerRole: "위원",
          summary: "현재 버전 요약입니다.",
          evidenceExcerpt: "현재 버전의 공식 회의록 근거입니다.",
          sourceUrl:
            "https://record.assembly.go.kr/assembly/viewer/minutes/xml.do?id=current&type=view",
          sourceFragment: "#spk_current",
          sourceDocumentPath: "raw/minutes-current/latest.html",
          sourceContentSha256: "hash-current",
          sourceKind: "official_minutes_transcript",
          memberId: "member-1",
          name: "김민수",
          party: "테스트당"
        }
      ],
      ...overrides
    });
    const currentArtifact = createArtifact({});
    const stalePromptArtifact = createArtifact({
      documentId: "minutes-stale-prompt",
      promptVersion: "minutes-summary-v3",
      summaries: [
        {
          ...currentArtifact.summaries[0]!,
          statementId: "statement-stale-prompt",
          documentId: "minutes-stale-prompt",
          summary: "이전 프롬프트 요약입니다."
        }
      ]
    });
    const staleModelArtifact = createArtifact({
      documentId: "minutes-stale-model",
      modelId: "stale-model",
      summaries: [
        {
          ...currentArtifact.summaries[0]!,
          statementId: "statement-stale-model",
          documentId: "minutes-stale-model",
          summary: "이전 모델 요약입니다."
        }
      ]
    });

    const [payload] = buildMemberStatementSummaryExports({
      generatedAt: "2025-08-02T00:00:00.000Z",
      assemblyNo: 22,
      assemblyLabel: "제22대 국회",
      modelId: currentArtifact.modelId,
      promptVersion: currentArtifact.promptVersion,
      members: [{ memberId: "member-1", name: "김민수", party: "테스트당" }],
      artifacts: [stalePromptArtifact, currentArtifact, staleModelArtifact]
    });

    expect(payload?.summaries).toHaveLength(1);
    expect(payload?.summaries[0]?.statementId).toBe("statement-current");
  });
});
