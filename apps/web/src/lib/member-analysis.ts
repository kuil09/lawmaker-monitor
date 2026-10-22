import type { MemberAnalysisDetail } from "@lawmaker-monitor/schemas";

export function aggregatePeriodMetrics(
  rows: MemberAnalysisDetail["monthlyMetrics"],
  from: string,
  to: string
): MemberAnalysisDetail["metrics"] {
  const result: MemberAnalysisDetail["metrics"] = {
    eligibleVotes: 0,
    participatedVotes: 0,
    unknownVotes: 0,
    participationRate: null,
    proposals: 0,
    statements: 0
  };
  for (const row of rows) {
    if (row.month < from || row.month > to) continue;
    for (const key of [
      "eligibleVotes",
      "participatedVotes",
      "unknownVotes",
      "proposals",
      "statements"
    ] as const)
      result[key] += row.metrics[key];
  }
  result.participationRate = result.eligibleVotes
    ? result.participatedVotes / result.eligibleVotes
    : null;
  return result;
}
