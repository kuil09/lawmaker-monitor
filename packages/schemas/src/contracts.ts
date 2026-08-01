import { z } from "zod";

import {
  memberProfileSchema,
  memberPublicProfileSchema,
  normalizedBundleSchema,
  officialTallySchema,
  sourceStatusSchema,
  voteCodeSchema,
  voteVisibilitySchema
} from "./records.js";

const nonEmptyString = z.string().trim().min(1);
const dateLikeString = nonEmptyString.refine(
  (value) =>
    /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(
      value
    ) && !Number.isNaN(Date.parse(value)),
  "Expected an ISO date or date-time value"
);
const httpsUrlString = nonEmptyString
  .url()
  .refine(
    (value) => new URL(value).protocol === "https:",
    "Expected an HTTPS URL"
  );

export const datasetFileSchema = z.object({
  path: nonEmptyString,
  url: nonEmptyString.url(),
  checksumSha256: nonEmptyString,
  rowCount: z.number().int().nonnegative().optional()
});

export const currentAssemblySchema = z.object({
  assemblyNo: z.number().int().positive(),
  label: nonEmptyString,
  unitCd: nonEmptyString
});

const verifiedMemberSponsorshipAccountSchema = z
  .object({
    recordId: nonEmptyString,
    memberId: nonEmptyString,
    status: z.literal("verified"),
    sourceUrl: httpsUrlString,
    verifiedAt: dateLikeString,
    donationUrl: httpsUrlString.optional()
  })
  .strip();

const unverifiedMemberSponsorshipAccountSchema = z
  .object({
    recordId: nonEmptyString,
    memberId: nonEmptyString,
    status: z.literal("unverified"),
    sourceUrl: httpsUrlString,
    reviewedAt: dateLikeString,
    reason: nonEmptyString,
    donationUrl: httpsUrlString.optional()
  })
  .strip();

const supersededMemberSponsorshipAccountSchema = z
  .object({
    recordId: nonEmptyString,
    memberId: nonEmptyString,
    status: z.literal("superseded"),
    sourceUrl: httpsUrlString,
    verifiedAt: dateLikeString,
    supersededAt: dateLikeString,
    supersededReason: nonEmptyString,
    replacedByRecordId: nonEmptyString.optional(),
    donationUrl: httpsUrlString.optional()
  })
  .strip();

export const memberSponsorshipAccountSchema = z.discriminatedUnion("status", [
  verifiedMemberSponsorshipAccountSchema,
  unverifiedMemberSponsorshipAccountSchema,
  supersededMemberSponsorshipAccountSchema
]);

export const memberSponsorshipAccountsExportSchema = z
  .object({
    generatedAt: dateLikeString,
    snapshotId: nonEmptyString,
    assemblyNo: z.number().int().positive(),
    assemblyLabel: nonEmptyString,
    accounts: z.array(memberSponsorshipAccountSchema)
  })
  .strict()
  .superRefine((exportData, context) => {
    const recordIds = new Set<string>();
    const verifiedMemberIds = new Set<string>();
    const generatedTimestamp = Date.parse(exportData.generatedAt);

    exportData.accounts.forEach((account, index) => {
      if (recordIds.has(account.recordId)) {
        context.addIssue({
          code: "custom",
          message: "A sponsorship account recordId must be unique",
          path: ["accounts", index, "recordId"]
        });
      }
      recordIds.add(account.recordId);

      const reviewedTimestamp = Date.parse(
        account.status === "unverified"
          ? account.reviewedAt
          : account.verifiedAt
      );
      if (reviewedTimestamp > generatedTimestamp) {
        context.addIssue({
          code: "custom",
          message: "A sponsorship account cannot be reviewed in the future",
          path: [
            "accounts",
            index,
            account.status === "unverified" ? "reviewedAt" : "verifiedAt"
          ]
        });
      }

      if (
        account.status === "superseded" &&
        Date.parse(account.supersededAt) < Date.parse(account.verifiedAt)
      ) {
        context.addIssue({
          code: "custom",
          message: "supersededAt must not precede verifiedAt",
          path: ["accounts", index, "supersededAt"]
        });
      }

      if (account.status !== "verified") {
        return;
      }

      if (verifiedMemberIds.has(account.memberId)) {
        context.addIssue({
          code: "custom",
          message: "A member can have only one currently verified account",
          path: ["accounts", index, "memberId"]
        });
        return;
      }

      verifiedMemberIds.add(account.memberId);
    });
  });

const latestVoteMemberSchema = z.object({
  memberId: nonEmptyString.nullable().optional(),
  memberName: nonEmptyString,
  party: nonEmptyString,
  photoUrl: nonEmptyString.url().nullable().optional(),
  officialProfileUrl: nonEmptyString.url().nullable().optional(),
  officialExternalUrl: nonEmptyString.url().nullable().optional(),
  profile: memberPublicProfileSchema.optional(),
  voteCode: voteCodeSchema
});

export const latestVoteItemSchema = z.object({
  rollCallId: nonEmptyString,
  meetingId: nonEmptyString,
  agendaId: nonEmptyString.nullable().optional(),
  billName: nonEmptyString,
  committeeName: nonEmptyString.nullable().optional(),
  voteDatetime: nonEmptyString,
  voteVisibility: voteVisibilitySchema,
  sourceStatus: sourceStatusSchema,
  counts: z.object({
    yes: z.number().int().nonnegative(),
    no: z.number().int().nonnegative(),
    abstain: z.number().int().nonnegative(),
    absent: z.number().int().nonnegative().default(0),
    invalid: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative()
  }),
  highlightedVotes: z.array(latestVoteMemberSchema),
  absentVotes: z.array(latestVoteMemberSchema).default([]),
  absentListStatus: z.enum(["verified", "unavailable"]).optional(),
  memberVotes: z.array(latestVoteMemberSchema).default([]),
  memberVoteListStatus: z
    .enum(["verified", "partial", "unavailable"])
    .default("unavailable"),
  officialTally: officialTallySchema.optional(),
  summary: nonEmptyString.nullable().optional(),
  officialSourceUrl: nonEmptyString.url(),
  updatedAt: nonEmptyString,
  snapshotId: nonEmptyString,
  sourceHash: nonEmptyString
});

export const latestVotesExportSchema = z.object({
  generatedAt: nonEmptyString,
  snapshotId: nonEmptyString,
  assemblyNo: z.number().int().positive(),
  assemblyLabel: nonEmptyString,
  items: z.array(latestVoteItemSchema)
});

export const voteMinutesOpinionEvidenceSchema = z
  .object({
    statementId: nonEmptyString,
    documentId: nonEmptyString,
    memberId: nonEmptyString,
    name: nonEmptyString,
    party: nonEmptyString,
    voteCode: z.enum(["yes", "no", "abstain"]),
    summary: nonEmptyString,
    evidenceExcerpt: nonEmptyString,
    meetingTitle: nonEmptyString,
    meetingDate: nonEmptyString,
    agendaTitle: nonEmptyString,
    sourceUrl: nonEmptyString.url(),
    sourceFragment: nonEmptyString
  })
  .strict();

export const voteMinutesOpinionItemSchema = z
  .object({
    rollCallId: nonEmptyString,
    agendaId: nonEmptyString,
    billName: nonEmptyString,
    majorityVoteCode: z.enum(["yes", "no", "abstain"]).nullable(),
    matchMethod: z.literal("bill_id"),
    sourceMeetingCount: z.number().int().nonnegative(),
    sourceStatementCount: z.number().int().nonnegative(),
    latestMeetingDate: nonEmptyString,
    evidence: z.array(voteMinutesOpinionEvidenceSchema)
  })
  .strict();

export const voteMinutesOpinionsExportSchema = z
  .object({
    generatedAt: nonEmptyString,
    assemblyNo: z.number().int().positive(),
    assemblyLabel: nonEmptyString,
    modelId: nonEmptyString,
    promptVersion: nonEmptyString,
    items: z.array(voteMinutesOpinionItemSchema)
  })
  .strict();

export const accountabilitySummaryItemSchema = z.object({
  memberId: nonEmptyString,
  name: nonEmptyString,
  party: nonEmptyString,
  district: nonEmptyString.nullable().optional(),
  photoUrl: nonEmptyString.url().nullable().optional(),
  officialProfileUrl: nonEmptyString.url().nullable().optional(),
  officialExternalUrl: nonEmptyString.url().nullable().optional(),
  profile: memberPublicProfileSchema.optional(),
  assemblyNo: z.number().int().positive(),
  totalRecordedVotes: z.number().int().nonnegative(),
  noCount: z.number().int().nonnegative(),
  abstainCount: z.number().int().nonnegative(),
  absentCount: z.number().int().nonnegative().default(0),
  unresolvedCount: z.number().int().nonnegative().default(0),
  noRate: z.number().min(0).max(1),
  abstainRate: z.number().min(0).max(1),
  absentRate: z.number().min(0).max(1).default(0),
  partyLineOpportunityCount: z.number().int().nonnegative().default(0),
  partyLineParticipationCount: z.number().int().nonnegative().default(0),
  partyLineDefectionCount: z.number().int().nonnegative().default(0),
  partyLineDefectionRate: z.number().min(0).max(1).default(0),
  lastVoteAt: nonEmptyString.nullable().optional()
});

export const accountabilitySummaryExportSchema = z.object({
  generatedAt: nonEmptyString,
  snapshotId: nonEmptyString,
  assemblyNo: z.number().int().positive(),
  assemblyLabel: nonEmptyString,
  items: z.array(accountabilitySummaryItemSchema)
});

export const billProposalActivityItemSchema = z
  .object({
    memberId: nonEmptyString,
    name: nonEmptyString,
    party: nonEmptyString,
    district: nonEmptyString.nullable().optional(),
    leadProposalCount: z.number().int().nonnegative(),
    coSponsorProposalCount: z.number().int().nonnegative(),
    totalProposalCount: z.number().int().nonnegative(),
    leadResultAvailableProposalCount: z.number().int().nonnegative().default(0),
    leadPassedProposalCount: z.number().int().nonnegative().default(0),
    leadAlternativeReflectedProposalCount: z
      .number()
      .int()
      .nonnegative()
      .default(0),
    totalResultAvailableProposalCount: z
      .number()
      .int()
      .nonnegative()
      .default(0),
    totalPassedProposalCount: z.number().int().nonnegative().default(0),
    totalAlternativeReflectedProposalCount: z
      .number()
      .int()
      .nonnegative()
      .default(0),
    latestProposalAt: nonEmptyString.nullable().optional()
  })
  .refine(
    (item) =>
      item.totalProposalCount ===
      item.leadProposalCount + item.coSponsorProposalCount,
    {
      message:
        "totalProposalCount must equal leadProposalCount + coSponsorProposalCount",
      path: ["totalProposalCount"]
    }
  )
  .refine(
    (item) =>
      item.leadResultAvailableProposalCount <= item.leadProposalCount &&
      item.leadPassedProposalCount +
        item.leadAlternativeReflectedProposalCount <=
        item.leadResultAvailableProposalCount,
    {
      message:
        "lead outcome counts must not exceed representative proposal counts",
      path: ["leadResultAvailableProposalCount"]
    }
  )
  .refine(
    (item) =>
      item.totalResultAvailableProposalCount <= item.totalProposalCount &&
      item.totalPassedProposalCount +
        item.totalAlternativeReflectedProposalCount <=
        item.totalResultAvailableProposalCount,
    {
      message: "total outcome counts must not exceed proposal counts",
      path: ["totalResultAvailableProposalCount"]
    }
  )
  .refine(
    (item) =>
      item.leadResultAvailableProposalCount <=
        item.totalResultAvailableProposalCount &&
      item.leadPassedProposalCount <= item.totalPassedProposalCount &&
      item.leadAlternativeReflectedProposalCount <=
        item.totalAlternativeReflectedProposalCount,
    {
      message: "representative outcome counts must not exceed total outcomes",
      path: ["leadResultAvailableProposalCount"]
    }
  );

export const billProposalActivityExportSchema = z
  .object({
    generatedAt: nonEmptyString,
    snapshotId: nonEmptyString,
    assemblyNo: z.number().int().positive(),
    assemblyLabel: nonEmptyString,
    billCount: z.number().int().nonnegative(),
    outcomeDataAvailable: z.boolean().default(false),
    resultAvailableBillCount: z.number().int().nonnegative().default(0),
    passedBillCount: z.number().int().nonnegative().default(0),
    alternativeReflectedBillCount: z.number().int().nonnegative().default(0),
    proposerLinkCount: z.number().int().nonnegative(),
    matchedProposerLinkCount: z.number().int().nonnegative(),
    unmatchedProposerCount: z.number().int().nonnegative(),
    items: z.array(billProposalActivityItemSchema)
  })
  .refine(
    (data) =>
      data.resultAvailableBillCount <= data.billCount &&
      data.passedBillCount + data.alternativeReflectedBillCount <=
        data.resultAvailableBillCount,
    {
      message: "bill outcome counts must not exceed the exported bill count",
      path: ["resultAvailableBillCount"]
    }
  );

export const weeklyAssemblyTrendPointSchema = z.object({
  weekStart: nonEmptyString,
  weekEnd: nonEmptyString,
  yesCount: z.number().int().nonnegative(),
  noCount: z.number().int().nonnegative(),
  abstainCount: z.number().int().nonnegative(),
  absentCount: z.number().int().nonnegative(),
  unresolvedCount: z.number().int().nonnegative().default(0),
  eligibleVoteCount: z.number().int().nonnegative(),
  partyLineOpportunityCount: z.number().int().nonnegative().default(0),
  partyLineParticipationCount: z.number().int().nonnegative().default(0),
  partyLineDefectionCount: z.number().int().nonnegative().default(0)
});

export const accountabilityMoverWindowSchema = z.object({
  memberId: nonEmptyString,
  name: nonEmptyString,
  party: nonEmptyString,
  photoUrl: nonEmptyString.url().nullable().optional(),
  officialProfileUrl: nonEmptyString.url().nullable().optional(),
  profile: memberPublicProfileSchema.optional(),
  previousWindowEligibleCount: z.number().int().nonnegative(),
  previousWindowNoCount: z.number().int().nonnegative(),
  previousWindowAbstainCount: z.number().int().nonnegative(),
  previousWindowAbsentCount: z.number().int().nonnegative(),
  previousWindowUnresolvedCount: z.number().int().nonnegative().default(0),
  previousWindowPartyLineOpportunityCount: z
    .number()
    .int()
    .nonnegative()
    .default(0),
  previousWindowPartyLineParticipationCount: z
    .number()
    .int()
    .nonnegative()
    .default(0),
  previousWindowPartyLineDefectionCount: z
    .number()
    .int()
    .nonnegative()
    .default(0),
  currentWindowEligibleCount: z.number().int().nonnegative(),
  currentWindowNoCount: z.number().int().nonnegative(),
  currentWindowAbstainCount: z.number().int().nonnegative(),
  currentWindowAbsentCount: z.number().int().nonnegative(),
  currentWindowUnresolvedCount: z.number().int().nonnegative().default(0),
  currentWindowPartyLineOpportunityCount: z
    .number()
    .int()
    .nonnegative()
    .default(0),
  currentWindowPartyLineParticipationCount: z
    .number()
    .int()
    .nonnegative()
    .default(0),
  currentWindowPartyLineDefectionCount: z
    .number()
    .int()
    .nonnegative()
    .default(0)
});

export const accountabilityTrendsExportSchema = z.object({
  generatedAt: nonEmptyString,
  snapshotId: nonEmptyString,
  assemblyNo: z.number().int().positive(),
  assemblyLabel: nonEmptyString,
  weeks: z.array(weeklyAssemblyTrendPointSchema),
  movers: z.array(accountabilityMoverWindowSchema)
});

export const memberActivityDayStateSchema = z.object({
  date: nonEmptyString,
  yesCount: z.number().int().nonnegative(),
  noCount: z.number().int().nonnegative(),
  abstainCount: z.number().int().nonnegative(),
  absentCount: z.number().int().nonnegative().default(0),
  unknownCount: z.number().int().nonnegative(),
  totalRollCalls: z.number().int().nonnegative().default(0),
  state: z
    .enum(["yes", "no", "abstain", "absent", "unknown", "missing"])
    .transform((state) => (state === "missing" ? "unknown" : state))
});

export const memberActivityVoteRecordSchema = z.object({
  rollCallId: nonEmptyString,
  billName: nonEmptyString,
  committeeName: nonEmptyString.nullable().optional(),
  voteDatetime: nonEmptyString,
  voteCode: z.enum(["yes", "no", "abstain", "absent", "unknown"]),
  officialSourceUrl: nonEmptyString.url().nullable().optional()
});

export const memberActivityCommitteeSummarySchema = z.object({
  committeeName: nonEmptyString,
  eligibleRollCallCount: z.number().int().nonnegative(),
  participatedRollCallCount: z.number().int().nonnegative(),
  absentRollCallCount: z.number().int().nonnegative(),
  unresolvedRollCallCount: z.number().int().nonnegative().default(0),
  participationRate: z.number().min(0).max(1).nullable(),
  yesCount: z.number().int().nonnegative(),
  noCount: z.number().int().nonnegative(),
  abstainCount: z.number().int().nonnegative(),
  isCurrentCommittee: z.boolean().default(false),
  recentVoteRecords: z.array(memberActivityVoteRecordSchema).default([])
});

export const memberActivityHomeCommitteeAlertSchema = z.object({
  committeeName: nonEmptyString,
  participationRate: z.number().min(0).max(1),
  eligibleRollCallCount: z.number().int().nonnegative(),
  participatedRollCallCount: z.number().int().nonnegative(),
  message: nonEmptyString
});

const memberActivityCalendarMemberBaseSchema = z
  .object({
    memberId: nonEmptyString,
    name: nonEmptyString,
    party: nonEmptyString,
    photoUrl: nonEmptyString.url().nullable().optional(),
    officialProfileUrl: nonEmptyString.url().nullable().optional(),
    officialExternalUrl: nonEmptyString.url().nullable().optional(),
    profile: memberPublicProfileSchema.optional(),
    currentNegativeStreak: z.number().int().nonnegative(),
    currentNegativeOrAbsentStreak: z.number().int().nonnegative(),
    longestNegativeStreak: z.number().int().nonnegative(),
    longestNegativeOrAbsentStreak: z.number().int().nonnegative(),
    negativeDays: z.number().int().nonnegative(),
    absentDays: z.number().int().nonnegative(),
    unknownDays: z.number().int().nonnegative().default(0),
    committeeMemberships: z.array(nonEmptyString).default([]),
    committeeSummaries: z
      .array(memberActivityCommitteeSummarySchema)
      .default([]),
    homeCommitteeAlerts: z
      .array(memberActivityHomeCommitteeAlertSchema)
      .default([]),
    currentNegativeOrMissingStreak: z.number().int().nonnegative().optional(),
    longestNegativeOrMissingStreak: z.number().int().nonnegative().optional(),
    missingDays: z.number().int().nonnegative().optional(),
    dayStates: z.array(memberActivityDayStateSchema),
    voteRecordCount: z.number().int().nonnegative(),
    voteRecordsPath: nonEmptyString,
    voteRecords: z.array(memberActivityVoteRecordSchema).default([])
  })
  .transform(
    ({
      currentNegativeOrMissingStreak: _legacyCurrentNegativeOrMissingStreak,
      longestNegativeOrMissingStreak: _legacyLongestNegativeOrMissingStreak,
      missingDays: _legacyMissingDays,
      ...member
    }) => member
  );

export const memberActivityCalendarMemberSchema = z.preprocess((input) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return input;
  }

  const record = input as Record<string, unknown>;
  const memberId =
    typeof record.memberId === "string" ? record.memberId.trim() : "";
  const voteRecords = Array.isArray(record.voteRecords)
    ? record.voteRecords
    : [];
  return {
    ...record,
    currentNegativeOrAbsentStreak:
      record.currentNegativeOrAbsentStreak ??
      record.currentNegativeOrMissingStreak,
    longestNegativeOrAbsentStreak:
      record.longestNegativeOrAbsentStreak ??
      record.longestNegativeOrMissingStreak,
    absentDays: record.absentDays ?? 0,
    unknownDays: record.unknownDays ?? record.missingDays ?? 0,
    voteRecordCount: record.voteRecordCount ?? voteRecords.length,
    voteRecordsPath:
      record.voteRecordsPath ??
      (memberId
        ? `exports/member_activity_calendar_members/${memberId}.json`
        : record.voteRecordsPath)
  };
}, memberActivityCalendarMemberBaseSchema);

export const memberActivityCalendarAssemblySchema = z.object({
  assemblyNo: z.number().int().positive(),
  label: nonEmptyString,
  startDate: nonEmptyString,
  endDate: nonEmptyString,
  votingDates: z.array(nonEmptyString),
  members: z.array(memberActivityCalendarMemberSchema)
});

export const memberActivityCalendarExportSchema = z.object({
  generatedAt: nonEmptyString,
  snapshotId: nonEmptyString,
  assemblyNo: z.number().int().positive(),
  assemblyLabel: nonEmptyString,
  assembly: memberActivityCalendarAssemblySchema
});

export const memberActivityCalendarMemberDetailExportSchema = z.object({
  generatedAt: nonEmptyString,
  snapshotId: nonEmptyString,
  assemblyNo: z.number().int().positive(),
  assemblyLabel: nonEmptyString,
  memberId: nonEmptyString,
  voteRecords: z.array(memberActivityVoteRecordSchema).default([])
});

export const memberStatementSummaryItemSchema = z
  .object({
    statementId: nonEmptyString,
    documentId: nonEmptyString,
    meetingTitle: nonEmptyString,
    meetingDate: nonEmptyString,
    committeeName: nonEmptyString.nullable(),
    agendaTitle: nonEmptyString,
    billIds: z.array(nonEmptyString),
    speakerRole: nonEmptyString.nullable(),
    summary: nonEmptyString,
    evidenceExcerpt: nonEmptyString,
    sourceUrl: nonEmptyString.url(),
    sourceFragment: nonEmptyString,
    sourceDocumentPath: nonEmptyString,
    sourceContentSha256: nonEmptyString,
    sourceKind: z
      .literal("official_minutes_transcript")
      .default("official_minutes_transcript")
  })
  .strict();

export const memberStatementSummariesExportSchema = z
  .object({
    generatedAt: nonEmptyString,
    assemblyNo: z.number().int().positive(),
    assemblyLabel: nonEmptyString,
    memberId: nonEmptyString,
    name: nonEmptyString,
    party: nonEmptyString,
    modelId: nonEmptyString,
    promptVersion: nonEmptyString,
    summaries: z.array(memberStatementSummaryItemSchema)
  })
  .strict();

export const memberStatementSummariesIndexItemSchema = z
  .object({
    memberId: nonEmptyString,
    name: nonEmptyString,
    party: nonEmptyString,
    summaryCount: z.number().int().positive(),
    path: nonEmptyString
  })
  .strict();

export const memberStatementSummariesIndexExportSchema = z
  .object({
    generatedAt: nonEmptyString,
    assemblyNo: z.number().int().positive(),
    assemblyLabel: nonEmptyString,
    modelId: nonEmptyString,
    promptVersion: nonEmptyString,
    members: z.array(memberStatementSummariesIndexItemSchema)
  })
  .strict();

export const memberAssetLatestSummarySchema = z
  .object({
    reportedAt: nonEmptyString,
    issueNo: nonEmptyString.nullable().optional(),
    previousAmount: z.number().int(),
    increaseAmount: z.number().int(),
    decreaseAmount: z.number().int(),
    currentAmount: z.number().int(),
    deltaAmount: z.number().int(),
    valueChangeAmount: z.number().int()
  })
  .strict();

export const memberAssetSeriesPointSchema = z
  .object({
    reportedAt: nonEmptyString,
    issueNo: nonEmptyString.nullable().optional(),
    previousAmount: z.number().int(),
    increaseAmount: z.number().int(),
    decreaseAmount: z.number().int(),
    currentAmount: z.number().int(),
    deltaAmount: z.number().int(),
    valueChangeAmount: z.number().int()
  })
  .strict();

export const memberAssetCategoryPointSchema = z
  .object({
    reportedAt: nonEmptyString,
    issueNo: nonEmptyString.nullable().optional(),
    previousAmount: z.number().int(),
    increaseAmount: z.number().int(),
    decreaseAmount: z.number().int(),
    currentAmount: z.number().int()
  })
  .strict();

export const memberAssetCategorySeriesSchema = z
  .object({
    categoryKey: nonEmptyString,
    categoryLabel: nonEmptyString,
    points: z.array(memberAssetCategoryPointSchema)
  })
  .strict();

export const memberAssetScopedHistorySchema = z
  .object({
    series: z.array(memberAssetSeriesPointSchema),
    categorySeries: z.array(memberAssetCategorySeriesSchema),
    latestSummary: memberAssetLatestSummarySchema
  })
  .strict();

export const memberAssetsIndexItemSchema = z
  .object({
    memberId: nonEmptyString,
    name: nonEmptyString,
    party: nonEmptyString,
    district: nonEmptyString.nullable().optional(),
    photoUrl: nonEmptyString.url().nullable().optional(),
    officialProfileUrl: nonEmptyString.url().nullable().optional(),
    officialExternalUrl: nonEmptyString.url().nullable().optional(),
    profile: memberProfileSchema.optional(),
    firstDisclosureDate: nonEmptyString,
    latestDisclosureDate: nonEmptyString,
    latestTotal: z.number().int(),
    latestRealEstateTotal: z.number().int().optional(),
    latestDebtTotal: z.number().int().nonnegative().optional(),
    totalDelta: z.number().int(),
    historyPath: nonEmptyString,
    latestSummary: memberAssetLatestSummarySchema
  })
  .strict();

export const memberAssetsIndexExportSchema = z
  .object({
    generatedAt: nonEmptyString,
    snapshotId: nonEmptyString,
    assemblyNo: z.number().int().positive(),
    assemblyLabel: nonEmptyString,
    members: z.array(memberAssetsIndexItemSchema)
  })
  .strict();

export const memberAssetsHistoryExportSchema = z
  .object({
    generatedAt: nonEmptyString,
    snapshotId: nonEmptyString,
    assemblyNo: z.number().int().positive(),
    assemblyLabel: nonEmptyString,
    memberId: nonEmptyString,
    series: z.array(memberAssetSeriesPointSchema),
    categorySeries: z.array(memberAssetCategorySeriesSchema),
    latestSummary: memberAssetLatestSummarySchema,
    selfOnly: memberAssetScopedHistorySchema.optional()
  })
  .strict();

const geoJsonPositionSchema = z.tuple([z.number(), z.number()]);

const geoJsonLinearRingSchema = z.array(geoJsonPositionSchema).min(4);

export const geoJsonPolygonSchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(geoJsonLinearRingSchema).min(1)
});

export const geoJsonMultiPolygonSchema = z.object({
  type: z.literal("MultiPolygon"),
  coordinates: z.array(z.array(geoJsonLinearRingSchema).min(1)).min(1)
});

export const constituencyBoundarySourceSchema = z
  .object({
    sourceId: nonEmptyString,
    title: nonEmptyString,
    sourcePageUrl: nonEmptyString.url().optional(),
    downloadUrl: nonEmptyString.url(),
    requestMethod: z.enum(["GET", "POST"]).optional(),
    requestBody: nonEmptyString.optional(),
    encoding: nonEmptyString.optional(),
    checksumSha256: nonEmptyString,
    retrievedAt: nonEmptyString,
    rowCount: z.number().int().positive().optional()
  })
  .strict();

export const constituencyBoundaryPropertiesSchema = z
  .object({
    constituencyId: nonEmptyString,
    lawDistrictName: nonEmptyString,
    districtName: nonEmptyString,
    memberDistrictLabel: nonEmptyString,
    memberDistrictKey: nonEmptyString,
    provinceName: nonEmptyString,
    provinceShortName: nonEmptyString,
    areaText: nonEmptyString,
    aliases: z.array(nonEmptyString).default([]),
    sigunguCodes: z.array(nonEmptyString),
    sigunguNames: z.array(nonEmptyString),
    emdCodes: z.array(nonEmptyString),
    emdNames: z.array(nonEmptyString)
  })
  .strict();

export const constituencyBoundaryFeatureSchema = z
  .object({
    type: z.literal("Feature"),
    properties: constituencyBoundaryPropertiesSchema,
    geometry: z.union([geoJsonPolygonSchema, geoJsonMultiPolygonSchema])
  })
  .strict();

export const constituencyBoundaryExportSchema = z
  .object({
    type: z.literal("FeatureCollection"),
    generatedAt: nonEmptyString,
    lawEffectiveDate: nonEmptyString,
    lawSourceUrl: nonEmptyString.url(),
    sources: z.array(constituencyBoundarySourceSchema).min(2),
    features: z.array(constituencyBoundaryFeatureSchema).min(1)
  })
  .strict();

export const constituencyBoundariesIndexProvinceSchema = z
  .object({
    provinceName: nonEmptyString,
    provinceShortName: nonEmptyString,
    featureCount: z.number().int().positive(),
    path: nonEmptyString,
    checksumSha256: nonEmptyString
  })
  .strict();

export const constituencyBoundariesIndexExportSchema = z
  .object({
    generatedAt: nonEmptyString,
    snapshotId: nonEmptyString,
    lawEffectiveDate: nonEmptyString,
    lawSourceUrl: nonEmptyString.url(),
    sourceGeneratedAt: nonEmptyString,
    sourceFeatureCount: z.number().int().positive(),
    sources: z.array(constituencyBoundarySourceSchema).min(2),
    provinces: z.array(constituencyBoundariesIndexProvinceSchema).min(1)
  })
  .strict();

export const hexmapStaticDistrictSchema = z
  .object({
    type: z.literal("Feature"),
    geometry: z.union([geoJsonPolygonSchema, geoJsonMultiPolygonSchema]),
    properties: z
      .object({
        districtKey: nonEmptyString,
        label: nonEmptyString
      })
      .strict()
  })
  .strict();

export const hexmapStaticCellSchema = z
  .object({
    h3Index: nonEmptyString,
    districtKey: nonEmptyString,
    districtLabel: nonEmptyString,
    provinceShortName: nonEmptyString
  })
  .strict();

export const hexmapStaticIndexProvinceSchema = z
  .object({
    provinceShortName: nonEmptyString,
    path: nonEmptyString,
    checksumSha256: nonEmptyString,
    detailRes: z.number().int().positive(),
    cellCount: z.number().int().nonnegative(),
    districtCount: z.number().int().positive()
  })
  .strict();

export const hexmapStaticIndexExportSchema = z
  .object({
    generatedAt: nonEmptyString,
    snapshotId: nonEmptyString,
    provinces: z.array(hexmapStaticIndexProvinceSchema).min(1)
  })
  .strict();

export const hexmapStaticProvinceArtifactSchema = z
  .object({
    provinceShortName: nonEmptyString,
    detailRes: z.number().int().positive(),
    districts: z.array(hexmapStaticDistrictSchema).min(1),
    cells: z.array(hexmapStaticCellSchema)
  })
  .strict();

export const manifestSchema = z.object({
  schemaVersion: nonEmptyString,
  snapshotId: nonEmptyString,
  updatedAt: nonEmptyString,
  dataRepoBaseUrl: nonEmptyString.url(),
  currentAssembly: currentAssemblySchema,
  datasets: z.object({
    members: datasetFileSchema,
    rollCalls: datasetFileSchema,
    voteFacts: datasetFileSchema,
    meetings: datasetFileSchema,
    sources: datasetFileSchema,
    assetDisclosures: datasetFileSchema.optional(),
    assetDisclosureRecords: datasetFileSchema.optional(),
    assetDisclosureCategories: datasetFileSchema.optional(),
    assetDisclosureItems: datasetFileSchema.optional()
  }),
  exports: z.object({
    latestVotes: datasetFileSchema,
    accountabilitySummary: datasetFileSchema.optional(),
    memberActivityCalendar: datasetFileSchema.optional(),
    accountabilityTrends: datasetFileSchema.optional(),
    billProposalActivity: datasetFileSchema.optional(),
    constituencyBoundariesIndex: datasetFileSchema.optional(),
    hexmapStaticIndex: datasetFileSchema.optional(),
    memberAssetsIndex: datasetFileSchema.optional(),
    memberSponsorshipAccounts: datasetFileSchema.optional()
  })
});

export const publishBundleSchema = z.object({
  normalized: normalizedBundleSchema,
  latestVotes: latestVotesExportSchema,
  accountabilitySummary: accountabilitySummaryExportSchema,
  accountabilityTrends: accountabilityTrendsExportSchema.optional(),
  billProposalActivity: billProposalActivityExportSchema.optional(),
  constituencyBoundariesIndex:
    constituencyBoundariesIndexExportSchema.optional(),
  hexmapStaticIndex: hexmapStaticIndexExportSchema.optional(),
  memberActivityCalendar: memberActivityCalendarExportSchema,
  memberActivityCalendarMemberDetails: z
    .array(memberActivityCalendarMemberDetailExportSchema)
    .optional(),
  memberAssetsIndex: memberAssetsIndexExportSchema.optional(),
  memberAssetsHistory: z.array(memberAssetsHistoryExportSchema).optional(),
  memberSponsorshipAccounts: memberSponsorshipAccountsExportSchema.optional(),
  manifest: manifestSchema
});

export type DatasetFile = z.infer<typeof datasetFileSchema>;
export type CurrentAssembly = z.infer<typeof currentAssemblySchema>;
export type MemberSponsorshipAccount = z.infer<
  typeof memberSponsorshipAccountSchema
>;
export type VerifiedMemberSponsorshipAccount = Extract<
  MemberSponsorshipAccount,
  { status: "verified" }
>;
export type MemberSponsorshipAccountsExport = z.infer<
  typeof memberSponsorshipAccountsExportSchema
>;
export type LatestVoteItem = z.infer<typeof latestVoteItemSchema>;
export type LatestVotesExport = z.infer<typeof latestVotesExportSchema>;
export type VoteMinutesOpinionEvidence = z.infer<
  typeof voteMinutesOpinionEvidenceSchema
>;
export type VoteMinutesOpinionItem = z.infer<
  typeof voteMinutesOpinionItemSchema
>;
export type VoteMinutesOpinionsExport = z.infer<
  typeof voteMinutesOpinionsExportSchema
>;
export type AccountabilitySummaryItem = z.infer<
  typeof accountabilitySummaryItemSchema
>;
export type AccountabilitySummaryExport = z.infer<
  typeof accountabilitySummaryExportSchema
>;
export type BillProposalActivityItem = z.infer<
  typeof billProposalActivityItemSchema
>;
export type BillProposalActivityExport = z.infer<
  typeof billProposalActivityExportSchema
>;
export type WeeklyAssemblyTrendPoint = z.infer<
  typeof weeklyAssemblyTrendPointSchema
>;
export type AccountabilityMoverWindow = z.infer<
  typeof accountabilityMoverWindowSchema
>;
export type AccountabilityTrendsExport = z.infer<
  typeof accountabilityTrendsExportSchema
>;
export type MemberActivityDayState = z.infer<
  typeof memberActivityDayStateSchema
>;
export type MemberActivityVoteRecord = z.infer<
  typeof memberActivityVoteRecordSchema
>;
export type MemberActivityCalendarMember = z.infer<
  typeof memberActivityCalendarMemberSchema
>;
export type MemberActivityCalendarAssembly = z.infer<
  typeof memberActivityCalendarAssemblySchema
>;
export type MemberActivityCalendarExport = z.infer<
  typeof memberActivityCalendarExportSchema
>;
export type MemberActivityCalendarMemberDetailExport = z.infer<
  typeof memberActivityCalendarMemberDetailExportSchema
>;
export type MemberStatementSummaryItem = z.infer<
  typeof memberStatementSummaryItemSchema
>;
export type MemberStatementSummariesExport = z.infer<
  typeof memberStatementSummariesExportSchema
>;
export type MemberStatementSummariesIndexItem = z.infer<
  typeof memberStatementSummariesIndexItemSchema
>;
export type MemberStatementSummariesIndexExport = z.infer<
  typeof memberStatementSummariesIndexExportSchema
>;
export type MemberAssetLatestSummary = z.infer<
  typeof memberAssetLatestSummarySchema
>;
export type MemberAssetSeriesPoint = z.infer<
  typeof memberAssetSeriesPointSchema
>;
export type MemberAssetCategoryPoint = z.infer<
  typeof memberAssetCategoryPointSchema
>;
export type MemberAssetCategorySeries = z.infer<
  typeof memberAssetCategorySeriesSchema
>;
export type MemberAssetScopedHistory = z.infer<
  typeof memberAssetScopedHistorySchema
>;
export type MemberAssetsIndexItem = z.infer<typeof memberAssetsIndexItemSchema>;
export type MemberAssetsIndexExport = z.infer<
  typeof memberAssetsIndexExportSchema
>;
export type MemberAssetsHistoryExport = z.infer<
  typeof memberAssetsHistoryExportSchema
>;
export type GeoJsonPolygon = z.infer<typeof geoJsonPolygonSchema>;
export type GeoJsonMultiPolygon = z.infer<typeof geoJsonMultiPolygonSchema>;
export type ConstituencyBoundarySource = z.infer<
  typeof constituencyBoundarySourceSchema
>;
export type ConstituencyBoundaryProperties = z.infer<
  typeof constituencyBoundaryPropertiesSchema
>;
export type ConstituencyBoundaryFeature = z.infer<
  typeof constituencyBoundaryFeatureSchema
>;
export type ConstituencyBoundaryExport = z.infer<
  typeof constituencyBoundaryExportSchema
>;
export type ConstituencyBoundariesIndexProvince = z.infer<
  typeof constituencyBoundariesIndexProvinceSchema
>;
export type ConstituencyBoundariesIndexExport = z.infer<
  typeof constituencyBoundariesIndexExportSchema
>;
export type HexmapStaticDistrict = z.infer<typeof hexmapStaticDistrictSchema>;
export type HexmapStaticCell = z.infer<typeof hexmapStaticCellSchema>;
export type HexmapStaticIndexProvince = z.infer<
  typeof hexmapStaticIndexProvinceSchema
>;
export type HexmapStaticIndexExport = z.infer<
  typeof hexmapStaticIndexExportSchema
>;
export type HexmapStaticProvinceArtifact = z.infer<
  typeof hexmapStaticProvinceArtifactSchema
>;
export type Manifest = z.infer<typeof manifestSchema>;
export type PublishBundle = z.infer<typeof publishBundleSchema>;
