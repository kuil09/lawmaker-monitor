import { z } from "zod";

const nullableDate = z.string().nullable();
export const memberAffiliationPeriodsSchema = z.array(
  z
    .object({
      memberId: z.string().min(1),
      assemblyNo: z.number().int().positive(),
      party: z.string().min(1),
      startDate: z.string().date(),
      endDate: z.string().date(),
      sourceUrl: z.string().url(),
      sourceExcerpt: z.string().min(1),
      reviewedAt: z.string().datetime({ offset: true })
    })
    .refine(
      (row) => row.startDate <= row.endDate,
      "Affiliation period must have an ordered date range."
    )
);
export const memberObservationsSchema = z.array(
  z
    .object({
      memberId: z.string(),
      party: z.string(),
      role: z.string().nullable(),
      sourceUrl: z.string().url(),
      observedAt: z.string().datetime({ offset: true }),
      lastSeenAt: z.string().datetime({ offset: true })
    })
    .refine(
      (row) => Date.parse(row.observedAt) <= Date.parse(row.lastSeenAt),
      "Observation dates must be ordered."
    )
);
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
    verifiedPartyVotes: z.number().int().nonnegative().default(0),
    currentPartyObservedAt: z.string().nullable().default(null),
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
    "career",
    "affiliation"
  ]),
  label: z.string(),
  startDate: nullableDate,
  endDate: nullableDate,
  observedAt: z.string(),
  dateBasis: z.enum([
    "official_period",
    "observed",
    "biography_period",
    "biography_mention",
    "verified_affiliation"
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
      crossPartyVotes: z.number(),
      basis: z
        .enum(["current_roster", "verified_period"])
        .default("current_roster")
    })
  ),
  transitions: z.array(
    z.object({
      eventId: z.string(),
      label: z.string(),
      date: z.string(),
      basis: z
        .enum(["official_period", "party_observation_bounds"])
        .default("official_period"),
      beforeEndDate: z.string().nullable().default(null),
      afterStartDate: z.string().nullable().default(null),
      uncertainDays: z.number().int().nonnegative().default(0),
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
