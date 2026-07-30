import { describe, expect, it } from "vitest";

import { buildVoteMinutesOpinionsExport } from "../../packages/ingest/src/vote-minutes-opinions.js";

import type { MinutesDocumentSummaryArtifact } from "../../packages/ingest/src/minutes-summarization.js";
import type {
  LatestVotesExport,
  MemberActivityCalendarMemberDetailExport
} from "@lawmaker-monitor/schemas";

const latestVotes: LatestVotesExport = {
  generatedAt: "2026-07-30T09:00:00+09:00",
  snapshotId: "snapshot-1",
  assemblyNo: 22,
  assemblyLabel: "제22대 국회",
  items: [
    {
      rollCallId: "roll-call-1",
      meetingId: "meeting-1",
      agendaId: "2200001",
      billName: "공개기록법 일부개정법률안",
      voteDatetime: "2026-07-29T14:00:00+09:00",
      voteVisibility: "recorded",
      sourceStatus: "confirmed",
      counts: {
        yes: 2,
        no: 1,
        abstain: 1,
        absent: 1,
        invalid: 0,
        unknown: 0
      },
      highlightedVotes: [
        {
          memberId: "member-no",
          memberName: "반대의원",
          party: "가상정당",
          voteCode: "no"
        },
        {
          memberId: "member-abstain",
          memberName: "기권의원",
          party: "가상정당",
          voteCode: "abstain"
        }
      ],
      absentVotes: [
        {
          memberId: "member-absent",
          memberName: "불참의원",
          party: "가상정당",
          voteCode: "absent"
        }
      ],
      officialSourceUrl: "https://example.com/votes/1",
      updatedAt: "2026-07-29T14:10:00+09:00",
      snapshotId: "snapshot-1",
      sourceHash: "hash-1"
    }
  ]
};

function createSummary(
  memberId: string,
  name: string
): MinutesDocumentSummaryArtifact["summaries"][number] {
  return {
    statementId: `statement-${memberId}`,
    documentId: "minutes-1",
    meetingTitle: "제1차 본회의",
    meetingDate: "2026-07-29",
    committeeName: null,
    agendaTitle: "공개기록법 일부개정법률안",
    billIds: ["2200001"],
    speakerRole: "의원",
    summary: `${name} 의원은 공개 기록의 검증 가능성을 높여야 한다고 말했다.`,
    evidenceExcerpt: `${name} 의원 발언 원문입니다.`,
    sourceUrl:
      "https://record.assembly.go.kr/assembly/viewer/minutes/xml.do?id=1&type=view",
    sourceFragment: `#statement-${memberId}`,
    sourceDocumentPath: "raw/minutes-1/latest.html",
    sourceContentSha256: "source-hash",
    sourceKind: "official_minutes_transcript",
    memberId,
    name,
    party: "가상정당"
  };
}

const artifact: MinutesDocumentSummaryArtifact = {
  schemaVersion: 1,
  sourceKind: "official_minutes_transcript",
  generatedAt: "2026-07-30T09:00:00+09:00",
  documentId: "minutes-1",
  sourceContentSha256: "source-hash",
  sourceTranscriptPath: "raw/minutes-1/latest.transcript.json",
  sourceDocumentPath: "raw/minutes-1/latest.html",
  sourceUrl:
    "https://record.assembly.go.kr/assembly/viewer/minutes/xml.do?id=1&type=view",
  modelId: "test-model",
  promptVersion: "test-prompt",
  summaryGroupCount: 4,
  complete: true,
  summaries: [
    createSummary("member-yes", "찬성의원"),
    createSummary("member-no", "반대의원"),
    createSummary("member-abstain", "기권의원"),
    createSummary("member-absent", "불참의원")
  ]
};

function createMemberDetail(
  memberId: string,
  voteCode: "yes" | "no" | "abstain" | "absent"
): MemberActivityCalendarMemberDetailExport {
  return {
    generatedAt: "2026-07-30T09:00:00+09:00",
    snapshotId: "snapshot-1",
    assemblyNo: 22,
    assemblyLabel: "제22대 국회",
    memberId,
    voteRecords: [
      {
        rollCallId: "roll-call-1",
        billName: "공개기록법 일부개정법률안",
        voteDatetime: "2026-07-29T14:00:00+09:00",
        voteCode,
        officialSourceUrl: "https://example.com/votes/1"
      }
    ]
  };
}

describe("vote minutes opinions", () => {
  it("matches official minutes by bill id and groups only participating speakers", () => {
    const payload = buildVoteMinutesOpinionsExport({
      generatedAt: "2026-07-30T09:30:00+09:00",
      latestVotes,
      modelId: "test-model",
      promptVersion: "test-prompt",
      artifacts: [artifact],
      voteRecordsByMemberId: new Map([
        ["member-yes", createMemberDetail("member-yes", "yes").voteRecords],
        [
          "member-absent",
          createMemberDetail("member-absent", "absent").voteRecords
        ]
      ])
    });

    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]).toMatchObject({
      rollCallId: "roll-call-1",
      agendaId: "2200001",
      majorityVoteCode: "yes",
      matchMethod: "bill_id",
      sourceMeetingCount: 1,
      sourceStatementCount: 3
    });
    expect(
      payload.items[0]?.evidence.map((item) => [item.name, item.voteCode])
    ).toEqual([
      ["기권의원", "abstain"],
      ["반대의원", "no"],
      ["찬성의원", "yes"]
    ]);
    expect(
      payload.items[0]?.evidence.some(
        (item) => item.memberId === "member-absent"
      )
    ).toBe(false);
  });

  it("does not infer an opinion when the bill id does not match", () => {
    const mismatchedArtifact = {
      ...artifact,
      summaries: artifact.summaries.map((summary) => ({
        ...summary,
        billIds: ["2299999"]
      }))
    };

    const payload = buildVoteMinutesOpinionsExport({
      generatedAt: "2026-07-30T09:30:00+09:00",
      latestVotes,
      modelId: "test-model",
      promptVersion: "test-prompt",
      artifacts: [mismatchedArtifact],
      voteRecordsByMemberId: new Map()
    });

    expect(payload.items).toEqual([]);
  });
});
