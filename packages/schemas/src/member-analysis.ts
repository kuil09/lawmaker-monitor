import { z } from "zod";

const nullableDate = z.string().nullable();
export const careerClaimSchema = z.object({
  category: z.string(),
  label: z.string(),
  evidence: z.string(),
  sourceUrl: z.string().url(),
  startDate: nullableDate,
  endDate: nullableDate,
  precision: z.enum(["day", "month", "year", "unknown"]),
  dateBasis: z
    .enum(["stated_period", "dated_mention", "undated"])
    .default("undated"),
  dateText: z.string().nullable().default(null)
});
export const analysisMemberSchema = z.object({
  personId: z.string(),
  memberId: z.string(),
  assemblyNo: z.number(),
  name: z.string(),
  party: z.string(),
  district: z.string().nullable(),
  proportionalFlag: z.boolean(),
  reelectionLabel: z.string().nullable(),
  committees: z.array(z.string()),
  careerClaims: z.array(careerClaimSchema),
  sourceUrl: z.string().url(),
  detailPath: z.string()
});
export const memberAnalysisIndexSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string(),
  snapshotId: z.string(),
  engineVersion: z.string(),
  coverage: z.object({
    members: z.number(),
    careerMembers: z.number(),
    datedRoles: z.number(),
    statements: z.number(),
    firstActivityDate: nullableDate,
    lastActivityDate: nullableDate
  }),
  members: z.array(analysisMemberSchema)
});
export const analysisEventSchema = z.object({
  eventId: z.string(),
  kind: z.enum([
    "tenure",
    "committee",
    "party_observation",
    "role_observation",
    "career"
  ]),
  label: z.string(),
  startDate: nullableDate,
  endDate: nullableDate,
  observedAt: z.string(),
  dateBasis: z.enum([
    "official_period",
    "observed",
    "biography_period",
    "biography_mention"
  ]),
  dateLabel: z.string().nullable().optional(),
  sourceUrl: z.string().url()
});
export const activityTopicSchema = z.object({
  month: z.string(),
  topic: z.string(),
  kind: z.enum(["vote", "proposal", "statement"]),
  count: z.number(),
  sourceUrl: z.string().url()
});
export const analysisEvidenceSchema = z.object({
  date: z.string(),
  kind: z.enum(["vote", "proposal", "statement"]),
  title: z.string(),
  topic: z.string(),
  sourceUrl: z.string().url(),
  excerpt: z.string().nullable()
});
export const analysisMetricsSchema = z.object({
  eligibleVotes: z.number(),
  participatedVotes: z.number(),
  unknownVotes: z.number(),
  participationRate: z.number().nullable(),
  proposals: z.number(),
  statements: z.number()
});
export const memberAnalysisDetailSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string(),
  snapshotId: z.string(),
  memberId: z.string(),
  events: z.array(analysisEventSchema),
  topics: z.array(activityTopicSchema),
  evidence: z.array(analysisEvidenceSchema),
  metrics: analysisMetricsSchema,
  monthlyMetrics: z.array(
    z.object({ month: z.string(), metrics: analysisMetricsSchema })
  ),
  peers: z.array(
    z.object({
      memberId: z.string(),
      sharedCommittees: z.number(),
      sameElectionType: z.boolean(),
      sameReelectionLabel: z.boolean(),
      metrics: analysisMetricsSchema,
      monthlyMetrics: z.array(
        z.object({ month: z.string(), metrics: analysisMetricsSchema })
      )
    })
  ),
  coalitions: z.array(
    z.object({
      memberId: z.string(),
      topic: z.string(),
      sharedVotes: z.number(),
      sameVotes: z.number(),
      agreementRate: z.number(),
      crossPartyVotes: z.number()
    })
  ),
  transitions: z.array(
    z.object({
      eventId: z.string(),
      label: z.string(),
      date: z.string(),
      before: analysisMetricsSchema,
      after: analysisMetricsSchema,
      beforeObservedDays: z.number(),
      afterObservedDays: z.number()
    })
  ),
  assets: z.array(
    z.object({
      reportedAt: z.string(),
      currentAmount: z.number(),
      deltaAmount: z.number(),
      valueChangeAmount: z.number(),
      sourceUrl: z.string().url()
    })
  )
});
export type CareerClaim = z.infer<typeof careerClaimSchema>;
export type AnalysisMember = z.infer<typeof analysisMemberSchema>;
export type AnalysisEvent = z.infer<typeof analysisEventSchema>;
export type MemberAnalysisIndex = z.infer<typeof memberAnalysisIndexSchema>;
export type MemberAnalysisDetail = z.infer<typeof memberAnalysisDetailSchema>;
