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
  highlightedVotes: z.array(
    z.object({
      memberId: nonEmptyString.nullable().optional(),
      memberName: nonEmptyString,
      party: nonEmptyString,
      photoUrl: nonEmptyString.url().nullable().optional(),
      officialProfileUrl: nonEmptyString.url().nullable().optional(),
      officialExternalUrl: nonEmptyString.url().nullable().optional(),
      profile: memberPublicProfileSchema.optional(),
      voteCode: voteCodeSchema
    })
  ),
  absentVotes: z.array(
    z.object({
      memberId: nonEmptyString.nullable().optional(),
      memberName: nonEmptyString,
      party: nonEmptyString,
      photoUrl: nonEmptyString.url().nullable().optional(),
      officialProfileUrl: nonEmptyString.url().nullable().optional(),
      officialExternalUrl: nonEmptyString.url().nullable().optional(),
      profile: memberPublicProfileSchema.optional(),
      voteCode: voteCodeSchema
    })
  ).default([]),
  absentListStatus: z.enum(["verified", "unavailable"]).optional(),
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
  noRate: z.number().min(0).max(1),
  abstainRate: z.number().min(0).max(1),
  absentRate: z.number().min(0).max(1).default(0),
  lastVoteAt: nonEmptyString.nullable().optional()
});

export const accountabilitySummaryExportSchema = z.object({
  generatedAt: nonEmptyString,
  snapshotId: nonEmptyString,
  assemblyNo: z.number().int().positive(),
  assemblyLabel: nonEmptyString,
  items: z.array(accountabilitySummaryItemSchema)
});

export const weeklyAssemblyTrendPointSchema = z.object({
  weekStart: nonEmptyString,
  weekEnd: nonEmptyString,
  yesCount: z.number().int().nonnegative(),
  noCount: z.number().int().nonnegative(),
  abstainCount: z.number().int().nonnegative(),
  absentCount: z.number().int().nonnegative(),
  eligibleVoteCount: z.number().int().nonnegative()
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
  currentWindowEligibleCount: z.number().int().nonnegative(),
  currentWindowNoCount: z.number().int().nonnegative(),
  currentWindowAbstainCount: z.number().int().nonnegative(),
  currentWindowAbsentCount: z.number().int().nonnegative()
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
    .transform((state) => (state === "missing" ? "absent" : state))
});

export const memberActivityVoteRecordSchema = z.object({
  rollCallId: nonEmptyString,
  billName: nonEmptyString,
  committeeName: nonEmptyString.nullable().optional(),
  voteDatetime: nonEmptyString,
  voteCode: z.enum(["yes", "no", "abstain", "absent"]),
  officialSourceUrl: nonEmptyString.url().nullable().optional()
});

export const memberActivityCommitteeSummarySchema = z.object({
  committeeName: nonEmptyString,
  eligibleRollCallCount: z.number().int().nonnegative(),
  participatedRollCallCount: z.number().int().nonnegative(),
  absentRollCallCount: z.number().int().nonnegative(),
  participationRate: z.number().min(0).max(1),
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

const memberActivityCalendarMemberBaseSchema = z.object({
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
  committeeMemberships: z.array(nonEmptyString).default([]),
  committeeSummaries: z.array(memberActivityCommitteeSummarySchema).default([]),
  homeCommitteeAlerts: z.array(memberActivityHomeCommitteeAlertSchema).default([]),
  currentNegativeOrMissingStreak: z.number().int().nonnegative().optional(),
  longestNegativeOrMissingStreak: z.number().int().nonnegative().optional(),
  missingDays: z.number().int().nonnegative().optional(),
  dayStates: z.array(memberActivityDayStateSchema),
  voteRecordCount: z.number().int().nonnegative(),
  voteRecordsPath: nonEmptyString,
  voteRecords: z.array(memberActivityVoteRecordSchema).default([])
}).transform(
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
  const memberId = typeof record.memberId === "string" ? record.memberId.trim() : "";
  const voteRecords = Array.isArray(record.voteRecords) ? record.voteRecords : [];
  return {
    ...record,
    currentNegativeOrAbsentStreak:
      record.currentNegativeOrAbsentStreak ?? record.currentNegativeOrMissingStreak,
    longestNegativeOrAbsentStreak:
      record.longestNegativeOrAbsentStreak ?? record.longestNegativeOrMissingStreak,
    absentDays: record.absentDays ?? record.missingDays,
    voteRecordCount: record.voteRecordCount ?? voteRecords.length,
    voteRecordsPath:
      record.voteRecordsPath ??
      (memberId ? `exports/member_activity_calendar_members/${memberId}.json` : record.voteRecordsPath)
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
    constituencyBoundariesIndex: datasetFileSchema.optional(),
    hexmapStaticIndex: datasetFileSchema.optional(),
    memberAssetsIndex: datasetFileSchema.optional()
  })
});

export const publishBundleSchema = z.object({
  normalized: normalizedBundleSchema,
  latestVotes: latestVotesExportSchema,
  accountabilitySummary: accountabilitySummaryExportSchema,
  accountabilityTrends: accountabilityTrendsExportSchema.optional(),
  constituencyBoundariesIndex: constituencyBoundariesIndexExportSchema.optional(),
  hexmapStaticIndex: hexmapStaticIndexExportSchema.optional(),
  memberActivityCalendar: memberActivityCalendarExportSchema,
  memberActivityCalendarMemberDetails: z
    .array(memberActivityCalendarMemberDetailExportSchema)
    .optional(),
  memberAssetsIndex: memberAssetsIndexExportSchema.optional(),
  memberAssetsHistory: z.array(memberAssetsHistoryExportSchema).optional(),
  manifest: manifestSchema
});

export type DatasetFile = z.infer<typeof datasetFileSchema>;
export type CurrentAssembly = z.infer<typeof currentAssemblySchema>;
export type LatestVoteItem = z.infer<typeof latestVoteItemSchema>;
export type LatestVotesExport = z.infer<typeof latestVotesExportSchema>;
export type AccountabilitySummaryItem = z.infer<typeof accountabilitySummaryItemSchema>;
export type AccountabilitySummaryExport = z.infer<typeof accountabilitySummaryExportSchema>;
export type WeeklyAssemblyTrendPoint = z.infer<typeof weeklyAssemblyTrendPointSchema>;
export type AccountabilityMoverWindow = z.infer<typeof accountabilityMoverWindowSchema>;
export type AccountabilityTrendsExport = z.infer<typeof accountabilityTrendsExportSchema>;
export type MemberActivityDayState = z.infer<typeof memberActivityDayStateSchema>;
export type MemberActivityVoteRecord = z.infer<typeof memberActivityVoteRecordSchema>;
export type MemberActivityCalendarMember = z.infer<typeof memberActivityCalendarMemberSchema>;
export type MemberActivityCalendarAssembly = z.infer<typeof memberActivityCalendarAssemblySchema>;
export type MemberActivityCalendarExport = z.infer<typeof memberActivityCalendarExportSchema>;
export type MemberActivityCalendarMemberDetailExport = z.infer<
  typeof memberActivityCalendarMemberDetailExportSchema
>;
export type MemberAssetLatestSummary = z.infer<typeof memberAssetLatestSummarySchema>;
export type MemberAssetSeriesPoint = z.infer<typeof memberAssetSeriesPointSchema>;
export type MemberAssetCategoryPoint = z.infer<typeof memberAssetCategoryPointSchema>;
export type MemberAssetCategorySeries = z.infer<typeof memberAssetCategorySeriesSchema>;
export type MemberAssetScopedHistory = z.infer<typeof memberAssetScopedHistorySchema>;
export type MemberAssetsIndexItem = z.infer<typeof memberAssetsIndexItemSchema>;
export type MemberAssetsIndexExport = z.infer<typeof memberAssetsIndexExportSchema>;
export type MemberAssetsHistoryExport = z.infer<typeof memberAssetsHistoryExportSchema>;
export type GeoJsonPolygon = z.infer<typeof geoJsonPolygonSchema>;
export type GeoJsonMultiPolygon = z.infer<typeof geoJsonMultiPolygonSchema>;
export type ConstituencyBoundarySource = z.infer<typeof constituencyBoundarySourceSchema>;
export type ConstituencyBoundaryProperties = z.infer<typeof constituencyBoundaryPropertiesSchema>;
export type ConstituencyBoundaryFeature = z.infer<typeof constituencyBoundaryFeatureSchema>;
export type ConstituencyBoundaryExport = z.infer<typeof constituencyBoundaryExportSchema>;
export type ConstituencyBoundariesIndexProvince = z.infer<
  typeof constituencyBoundariesIndexProvinceSchema
>;
export type ConstituencyBoundariesIndexExport = z.infer<
  typeof constituencyBoundariesIndexExportSchema
>;
export type HexmapStaticDistrict = z.infer<typeof hexmapStaticDistrictSchema>;
export type HexmapStaticCell = z.infer<typeof hexmapStaticCellSchema>;
export type HexmapStaticIndexProvince = z.infer<typeof hexmapStaticIndexProvinceSchema>;
export type HexmapStaticIndexExport = z.infer<typeof hexmapStaticIndexExportSchema>;
export type HexmapStaticProvinceArtifact = z.infer<typeof hexmapStaticProvinceArtifactSchema>;
export type Manifest = z.infer<typeof manifestSchema>;
export type PublishBundle = z.infer<typeof publishBundleSchema>;
