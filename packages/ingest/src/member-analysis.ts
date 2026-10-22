import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  memberStatementSummariesExportSchema,
  memberAffiliationPeriodsSchema,
  memberObservationsSchema
} from "@lawmaker-monitor/schemas";

import { splitCareerClauses } from "./career-dates.js";
import { writeNdjsonDataset } from "./dataset-writer.js";
import { isDateWithinTenure } from "./tenure.js";

import type { BillProposalRecord } from "./parsers/types.js";
import type { MemberTenureIndex, MemberTenureRecord } from "./tenure.js";
import type {
  AnalysisEvent,
  CareerClaim,
  MemberRecord,
  NormalizedBundle
} from "@lawmaker-monitor/schemas";

const careerRules = [
  [
    "medicine",
    "의료",
    /(?:의사|간호사|약사|한의사|치과의사)(?:\s|[·,()\n]|출신|로|$)|(?:전문의|병원장|의료원장)/
  ],
  ["education", "교육·연구", /교수|교사|교장|교육감|연구원|연구위원/],
  ["law", "법률", /변호사|판사|검사|법무관/],
  ["business", "기업·산업", /대표이사|기업인|기업가|창업자|경영인/],
  ["labor", "노동", /노동조합|노조위원장|노조 위원장|노동운동/],
  ["administration", "행정", /공무원|차관|장관|시장|군수|구청장|도지사/],
  ["media", "언론", /기자|언론인|아나운서|편집국장/],
  ["civic", "시민사회", /시민단체|시민운동|시민연대|시민사회/]
] as const;

export function extractCareerClaims(
  text: string | null | undefined,
  sourceUrl: string
): CareerClaim[] {
  if (!text) return [];
  const lines = text
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .split(/[\n\r;]+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const clauses = lines.flatMap(splitCareerClauses);
  return careerRules.flatMap(([category, label, rule]) =>
    clauses
      .filter((clause) => rule.test(clause.evidence))
      .map(({ evidence, dates }) => {
        const degree = /졸업|학위|학사|석사|박사/.exec(evidence);
        const role = rule.exec(evidence);
        const safeDates =
          degree && role && degree.index < role.index
            ? {
                startDate: null,
                endDate: null,
                precision: "unknown" as const,
                dateBasis: "undated" as const,
                dateText: null
              }
            : dates;
        return { category, label, evidence, sourceUrl, ...safeDates };
      })
  );
}

const topicRules = [
  ["보건·복지", /보건|의료|건강|병원|약사|복지|연금|장애인|돌봄/],
  ["교육·연구", /교육|학교|대학|교원|학생|학술/],
  ["노동·고용", /노동|근로|고용|임금|산업재해/],
  ["주거·국토", /주택|부동산|건축|국토|교통|철도|임대/],
  ["경제·산업", /기업|산업|금융|은행|조세|세법|상법|시장|무역/],
  ["환경·에너지", /환경|기후|탄소|에너지|전력|폐기물/],
  ["법률·행정", /법원|검찰|형법|민법|행정|정부|공무원|선거/],
  ["외교·안보", /외교|국방|군인|병역|통일|보훈/],
  ["과학·디지털", /과학|연구|정보|통신|디지털|인공지능|데이터/],
  ["문화·농림", /문화|체육|관광|농업|농촌|수산|해양/]
] as const;
export function classifyActivityTopic(title: string): string {
  return topicRules.find(([, rule]) => rule.test(title))?.[0] ?? "기타·미분류";
}

type Observation = {
  memberId: string;
  party: string;
  role: string | null;
  observedAt: string;
  lastSeenAt: string;
  sourceUrl: string;
};
async function readOptionalJson(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
function key(...parts: unknown[]): string {
  return createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex")
    .slice(0, 24);
}
export function buildHistoryEvents(args: {
  member: MemberRecord;
  tenures: Array<MemberTenureRecord & { sourceUrl?: string }>;
  committees: Array<{
    memberId: string;
    committeeName: string;
    startDate: string;
    endDate: string | null;
    sourceUrl?: string;
  }>;
  observations: Observation[];
  observedAt: string;
  sourceUrl: string;
}): AnalysisEvent[] {
  const { member, sourceUrl, observedAt } = args;
  const events: AnalysisEvent[] = args.tenures
    .filter((tenure) => tenure.memberId === member.memberId)
    .map((tenure) => ({
      eventId: key(
        member.memberId,
        "tenure",
        tenure.assemblyNo,
        tenure.startDate
      ),
      kind: "tenure",
      label: `제${tenure.assemblyNo}대 국회 재임`,
      startDate: tenure.startDate,
      endDate: tenure.endDate,
      observedAt,
      dateBasis: "official_period",
      sourceUrl: tenure.sourceUrl ?? sourceUrl
    }));
  for (const claim of extractCareerClaims(
    member.profile?.briefHistory,
    member.officialProfileUrl ?? sourceUrl
  )) {
    if (!claim.startDate && !claim.endDate) continue;
    events.push({
      eventId: key(member.memberId, "career", claim.category, claim.evidence),
      kind: "career",
      label: `${claim.label} 경력`,
      startDate: claim.startDate ?? claim.endDate,
      endDate: claim.endDate,
      observedAt,
      dateBasis:
        claim.dateBasis === "stated_period"
          ? "biography_period"
          : "biography_mention",
      dateLabel: `${claim.dateText} (약력·${claim.precision === "year" ? "연" : claim.precision === "month" ? "월" : "일"} 단위)`,
      sourceUrl: claim.sourceUrl
    });
  }
  for (const role of args.committees.filter(
    (role) => role.memberId === member.memberId
  ))
    events.push({
      eventId: key(
        member.memberId,
        "committee",
        role.committeeName,
        role.startDate
      ),
      kind: "committee",
      label: role.committeeName,
      startDate: role.startDate,
      endDate: role.endDate,
      observedAt,
      dateBasis: "official_period",
      sourceUrl: role.sourceUrl ?? sourceUrl
    });
  for (const row of args.observations.filter(
    (row) => row.memberId === member.memberId
  )) {
    events.push({
      eventId: key(member.memberId, "party", row.observedAt),
      kind: "party_observation",
      label: row.party,
      startDate: row.observedAt.slice(0, 10),
      endDate: row.lastSeenAt.slice(0, 10),
      observedAt: row.observedAt,
      dateBasis: "observed",
      sourceUrl: row.sourceUrl
    });
    if (row.role)
      events.push({
        eventId: key(member.memberId, "role", row.observedAt),
        kind: "role_observation",
        label: row.role,
        startDate: row.observedAt.slice(0, 10),
        endDate: row.lastSeenAt.slice(0, 10),
        observedAt: row.observedAt,
        dateBasis: "observed",
        sourceUrl: row.sourceUrl
      });
  }
  return [...new Map(events.map((event) => [event.eventId, event])).values()];
}

export async function writeMemberAnalysisInputs(args: {
  outputDir: string;
  dataRepoDir: string;
  bundle: NormalizedBundle;
  billProposals: BillProposalRecord[];
  tenures: Array<MemberTenureRecord & { sourceUrl?: string }>;
  tenureIndex: MemberTenureIndex;
  committees: Array<{
    memberId: string;
    committeeName: string;
    startDate: string;
    endDate: string | null;
    sourceUrl?: string;
  }>;
  snapshotId: string;
  observedAt: string;
  historySourceUrl: string;
  committeeSourceUrl: string;
}): Promise<void> {
  const dir = join(args.outputDir, "analysis-input");
  await mkdir(dir, { recursive: true });
  const members = args.bundle.members.filter(
    (member) => member.isCurrentMember
  );
  const memberIds = new Set(members.map((member) => member.memberId));
  const periodPayload = await readOptionalJson(
    join(args.dataRepoDir, "manifests/member_affiliation_periods.json")
  );
  const periods = memberAffiliationPeriodsSchema.parse(periodPayload ?? []);
  const periodsByMember = new Map(
    members.map((member) => [
      member.memberId,
      periods.filter(
        (period) =>
          period.memberId === member.memberId &&
          period.assemblyNo === member.assemblyNo
      )
    ])
  );
  const old = await readOptionalJson(
    join(args.dataRepoDir, "exports/member_analysis/observations.json")
  );
  const observations = memberObservationsSchema.parse(old ?? []);
  for (const member of members) {
    const last = observations
      .filter((row) => row.memberId === member.memberId)
      .at(-1);
    const role = member.profile?.roleName ?? null;
    if (last && Date.parse(last.lastSeenAt) > Date.parse(args.observedAt))
      throw new Error(
        "An older snapshot cannot overwrite newer affiliation observations."
      );
    if (last && last.party === member.party && last.role === role)
      last.lastSeenAt = args.observedAt;
    else
      observations.push({
        memberId: member.memberId,
        party: member.party,
        role,
        observedAt: args.observedAt,
        lastSeenAt: args.observedAt,
        sourceUrl: member.officialProfileUrl ?? args.historySourceUrl
      });
  }
  await mkdir(join(args.outputDir, "exports/member_analysis"), {
    recursive: true
  });
  await writeFile(
    join(args.outputDir, "exports/member_analysis/observations.json"),
    JSON.stringify(observations)
  );
  const people = members.map((member) => ({
    personId: `assembly-person:${member.memberId}`,
    memberId: member.memberId,
    assemblyNo: member.assemblyNo,
    name: member.name,
    party: member.party,
    district: member.district ?? null,
    proportionalFlag: member.proportionalFlag,
    reelectionLabel: member.profile?.reelectionLabel ?? null,
    committees: member.committeeMemberships,
    careerClaims: extractCareerClaims(
      member.profile?.briefHistory,
      member.officialProfileUrl ?? args.historySourceUrl
    ),
    sourceUrl: member.officialProfileUrl ?? args.historySourceUrl,
    detailPath: `exports/member_analysis/${encodeURIComponent(member.memberId)}.json`,
    // Public profile fields only; private contact and staff fields are omitted.
    profileRaw: {
      briefHistory: member.profile?.briefHistory ?? null,
      electedAssembliesLabel: member.profile?.electedAssembliesLabel ?? null
    }
  }));
  const events = members.flatMap((member) =>
    buildHistoryEvents({
      member,
      tenures: args.tenures,
      committees: args.committees,
      observations,
      observedAt: args.observedAt,
      sourceUrl: args.historySourceUrl
    }).map((event) => ({
      memberId: member.memberId,
      ...event,
      sourceUrl:
        event.kind === "committee" && event.sourceUrl === args.historySourceUrl
          ? args.committeeSourceUrl
          : event.sourceUrl
    }))
  );
  for (const period of periods)
    if (memberIds.has(period.memberId))
      events.push({
        memberId: period.memberId,
        eventId: key(
          period.memberId,
          period.party,
          period.startDate,
          period.endDate
        ),
        kind: "affiliation",
        label: `${period.party} (검증 기간)`,
        startDate: period.startDate,
        endDate: period.endDate,
        dateBasis: "verified_affiliation",
        observedAt: period.reviewedAt,
        sourceUrl: period.sourceUrl
      });
  const activity: Array<Record<string, unknown>> = [];
  const votes = new Map(
    args.bundle.voteFacts
      .filter((vote) => vote.memberId)
      .map((vote) => [`${vote.rollCallId}|${vote.memberId}`, vote])
  );
  for (const call of args.bundle.rollCalls) {
    if (!["recorded", "named"].includes(call.voteVisibility)) continue;
    for (const member of members) {
      if (
        !isDateWithinTenure(
          call.voteDatetime.slice(0, 10),
          args.tenureIndex.get(member.memberId) ?? []
        )
      )
        continue;
      const vote = votes.get(`${call.rollCallId}|${member.memberId}`);
      const datedParties = (periodsByMember.get(member.memberId) ?? []).filter(
        (period) =>
          period.startDate <= call.voteDatetime.slice(0, 10) &&
          period.endDate >= call.voteDatetime.slice(0, 10)
      );
      if (new Set(datedParties.map((period) => period.party)).size > 1)
        throw new Error(
          `Conflicting dated affiliation sources for ${member.memberId}.`
        );
      activity.push({
        activityId: call.rollCallId,
        memberId: member.memberId,
        kind: "vote",
        date: call.voteDatetime.slice(0, 10),
        title: call.billName,
        topic: classifyActivityTopic(call.billName),
        voteCode: vote?.voteCode ?? "unknown",
        partyAtVote: datedParties[0]?.party ?? null,
        partySourceUrl: datedParties[0]?.sourceUrl ?? null,
        sourcePartyLabel: vote?.recordedParty ?? null,
        sourceUrl: call.officialSourceUrl,
        excerpt: null
      });
    }
  }
  for (const proposal of args.billProposals) {
    if (!proposal.proposedAt) continue;
    for (const memberId of new Set(proposal.leadMemberIds))
      if (memberIds.has(memberId))
        activity.push({
          activityId: proposal.billId,
          memberId,
          kind: "proposal",
          date: proposal.proposedAt.slice(0, 10),
          title: proposal.billName,
          topic: classifyActivityTopic(proposal.billName),
          voteCode: null,
          partyAtVote: null,
          sourceUrl: `https://likms.assembly.go.kr/bill/billDetail.do?billId=${encodeURIComponent(proposal.billId)}`,
          excerpt: null
        });
  }
  for (const member of members) {
    const raw = await readOptionalJson(
      join(
        args.dataRepoDir,
        `exports/member_statement_summaries/${encodeURIComponent(member.memberId)}.json`
      )
    );
    if (!raw) continue;
    const statements = memberStatementSummariesExportSchema.parse(raw);
    if (statements.memberId !== member.memberId)
      throw new Error("Statement member identity mismatch.");
    for (const statement of statements.summaries)
      activity.push({
        activityId: statement.statementId,
        memberId: member.memberId,
        kind: "statement",
        date: statement.meetingDate,
        title: statement.agendaTitle,
        topic: classifyActivityTopic(
          `${statement.agendaTitle} ${statement.evidenceExcerpt}`
        ),
        voteCode: null,
        partyAtVote: null,
        sourceUrl: statement.sourceUrl,
        excerpt: statement.evidenceExcerpt
      });
  }
  const meta = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    observedAt: args.observedAt,
    snapshotId: args.snapshotId
  };
  await writeFile(join(dir, "meta.json"), JSON.stringify(meta));
  for (const [name, rows] of Object.entries({
    members: people,
    events,
    activities: activity
  }))
    await writeNdjsonDataset(join(dir, `${name}.ndjson`), rows);
}
