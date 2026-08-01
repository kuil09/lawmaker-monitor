import type { MinutesDocumentSummaryArtifact } from "./minutes-summarization.js";
import type {
  LatestVoteItem,
  LatestVotesExport,
  MemberActivityCalendarMemberDetailExport,
  VoteCode,
  VoteMinutesOpinionEvidence,
  VoteMinutesOpinionsExport
} from "@lawmaker-monitor/schemas";

type MemberVoteRecordsByMemberId = Map<
  string,
  MemberActivityCalendarMemberDetailExport["voteRecords"]
>;

function resolveMajorityVoteCode(
  counts: LatestVoteItem["counts"]
): "yes" | "no" | "abstain" | null {
  const ranked: Array<readonly ["yes" | "no" | "abstain", number]> = [
    ["yes", counts.yes],
    ["no", counts.no],
    ["abstain", counts.abstain]
  ];
  ranked.sort((left, right) => right[1] - left[1]);
  const first = ranked[0];
  const second = ranked[1];

  if (!first || first[1] === 0 || first[1] === second?.[1]) {
    return null;
  }

  return first[0];
}

function resolveMemberVoteCode(args: {
  item: LatestVoteItem;
  memberId: string;
  voteRecordsByMemberId: MemberVoteRecordsByMemberId;
}): VoteCode | null {
  const highlightedVote = args.item.highlightedVotes.find(
    (vote) => vote.memberId === args.memberId
  );
  if (highlightedVote) {
    return highlightedVote.voteCode;
  }

  if (args.item.absentVotes.some((vote) => vote.memberId === args.memberId)) {
    return "absent";
  }

  return (
    args.voteRecordsByMemberId
      .get(args.memberId)
      ?.find((record) => record.rollCallId === args.item.rollCallId)
      ?.voteCode ?? null
  );
}

export function buildVoteMinutesOpinionsExport(args: {
  generatedAt: string;
  latestVotes: LatestVotesExport;
  modelId: string;
  promptVersion: string;
  artifacts: MinutesDocumentSummaryArtifact[];
  voteRecordsByMemberId: MemberVoteRecordsByMemberId;
}): VoteMinutesOpinionsExport {
  const summariesByBillId = new Map<
    string,
    MinutesDocumentSummaryArtifact["summaries"]
  >();

  for (const artifact of args.artifacts) {
    if (
      artifact.modelId !== args.modelId ||
      artifact.promptVersion !== args.promptVersion
    ) {
      continue;
    }

    for (const summary of artifact.summaries) {
      for (const billId of summary.billIds) {
        summariesByBillId.set(billId, [
          ...(summariesByBillId.get(billId) ?? []),
          summary
        ]);
      }
    }
  }

  const items = args.latestVotes.items.flatMap((item) => {
    const agendaId = item.agendaId?.trim();
    if (!agendaId) {
      return [];
    }

    const summaries = summariesByBillId.get(agendaId) ?? [];
    const evidence = summaries
      .flatMap((summary): VoteMinutesOpinionEvidence[] => {
        const voteCode = resolveMemberVoteCode({
          item,
          memberId: summary.memberId,
          voteRecordsByMemberId: args.voteRecordsByMemberId
        });
        if (voteCode !== "yes" && voteCode !== "no" && voteCode !== "abstain") {
          return [];
        }

        return [
          {
            statementId: summary.statementId,
            documentId: summary.documentId,
            memberId: summary.memberId,
            name: summary.name,
            party: summary.party,
            voteCode,
            summary: summary.summary,
            evidenceExcerpt: summary.evidenceExcerpt,
            meetingTitle: summary.meetingTitle,
            meetingDate: summary.meetingDate,
            agendaTitle: summary.agendaTitle,
            sourceUrl: summary.sourceUrl,
            sourceFragment: summary.sourceFragment
          }
        ];
      })
      .sort((left, right) => {
        const byDate = right.meetingDate.localeCompare(left.meetingDate);
        return byDate !== 0
          ? byDate
          : left.name.localeCompare(right.name, "ko-KR");
      });

    if (evidence.length === 0) {
      return [];
    }

    return [
      {
        rollCallId: item.rollCallId,
        agendaId,
        billName: item.billName,
        majorityVoteCode: resolveMajorityVoteCode(item.counts),
        matchMethod: "bill_id" as const,
        sourceMeetingCount: new Set(evidence.map((entry) => entry.documentId))
          .size,
        sourceStatementCount: evidence.length,
        latestMeetingDate: evidence[0]?.meetingDate ?? item.voteDatetime,
        evidence
      }
    ];
  });

  return {
    generatedAt: args.generatedAt,
    assemblyNo: args.latestVotes.assemblyNo,
    assemblyLabel: args.latestVotes.assemblyLabel,
    modelId: args.modelId,
    promptVersion: args.promptVersion,
    items
  };
}
