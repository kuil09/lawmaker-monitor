import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);

export const voteVisibilitySchema = z.enum([
  "recorded",
  "named",
  "secret",
  "unknown"
]);

export const sourceStatusSchema = z.enum(["provisional", "confirmed"]);

export const voteCodeSchema = z.enum([
  "yes",
  "no",
  "abstain",
  "absent",
  "invalid",
  "unknown"
]);

export const officialTallySchema = z.object({
  registeredCount: z.number().int().nonnegative(),
  presentCount: z.number().int().nonnegative(),
  yesCount: z.number().int().nonnegative(),
  noCount: z.number().int().nonnegative(),
  abstainCount: z.number().int().nonnegative(),
  invalidCount: z.number().int().nonnegative().default(0)
});

export const memberPublicProfileSchema = z
  .object({
    nameHanja: nonEmptyString.nullable().optional(),
    nameEnglish: nonEmptyString.nullable().optional(),
    birthType: nonEmptyString.nullable().optional(),
    birthDate: nonEmptyString.nullable().optional(),
    roleName: nonEmptyString.nullable().optional(),
    reelectionLabel: nonEmptyString.nullable().optional(),
    electedAssembliesLabel: nonEmptyString.nullable().optional(),
    gender: nonEmptyString.nullable().optional(),
    representativeCommitteeName: nonEmptyString.nullable().optional(),
    affiliatedCommitteeName: nonEmptyString.nullable().optional(),
    briefHistory: nonEmptyString.nullable().optional(),
    officeRoom: nonEmptyString.nullable().optional()
  })
  .strict();

export const memberProfileSchema = memberPublicProfileSchema
  .extend({
    officePhone: nonEmptyString.nullable().optional(),
    email: nonEmptyString.nullable().optional(),
    aideNames: z.array(nonEmptyString).default([]),
    chiefSecretaryNames: z.array(nonEmptyString).default([]),
    secretaryNames: z.array(nonEmptyString).default([])
  })
  .strict();

export const memberSchema = z.object({
  memberId: nonEmptyString,
  name: nonEmptyString,
  party: nonEmptyString,
  district: nonEmptyString.nullable().optional(),
  committeeMemberships: z.array(nonEmptyString).default([]),
  photoUrl: nonEmptyString.url().nullable().optional(),
  officialProfileUrl: nonEmptyString.url().nullable().optional(),
  officialExternalUrl: nonEmptyString.url().nullable().optional(),
  profile: memberProfileSchema.optional(),
  isCurrentMember: z.boolean().default(false),
  proportionalFlag: z.boolean(),
  assemblyNo: z.number().int().positive()
});

export const rollCallSchema = z.object({
  rollCallId: nonEmptyString,
  assemblyNo: z.number().int().positive(),
  meetingId: nonEmptyString,
  agendaId: nonEmptyString.nullable().optional(),
  billId: nonEmptyString.nullable().optional(),
  billName: nonEmptyString,
  committeeName: nonEmptyString.nullable().optional(),
  voteDatetime: nonEmptyString,
  voteVisibility: voteVisibilitySchema,
  sourceStatus: sourceStatusSchema,
  officialSourceUrl: nonEmptyString.url(),
  officialTally: officialTallySchema.optional(),
  summary: nonEmptyString.nullable().optional(),
  snapshotId: nonEmptyString,
  sourceHash: nonEmptyString
});

export const voteFactSchema = z.object({
  rollCallId: nonEmptyString,
  memberId: nonEmptyString.nullable().optional(),
  memberName: nonEmptyString.nullable().optional(),
  party: nonEmptyString.nullable().optional(),
  voteCode: voteCodeSchema,
  publishedAt: nonEmptyString,
  retrievedAt: nonEmptyString,
  sourceHash: nonEmptyString
});

export const meetingSchema = z.object({
  meetingId: nonEmptyString,
  meetingType: nonEmptyString,
  sessionNo: z.number().int().nonnegative(),
  meetingNo: z.number().int().nonnegative(),
  meetingDate: nonEmptyString,
  isLive: z.boolean()
});

export const sourceRecordSchema = z.object({
  sourceUrl: nonEmptyString.url(),
  sourceSystem: nonEmptyString,
  retrievedAt: nonEmptyString,
  contentSha256: nonEmptyString
});

export const normalizedBundleSchema = z.object({
  members: z.array(memberSchema),
  rollCalls: z.array(rollCallSchema),
  voteFacts: z.array(voteFactSchema),
  meetings: z.array(meetingSchema),
  sources: z.array(sourceRecordSchema)
});

export type VoteVisibility = z.infer<typeof voteVisibilitySchema>;
export type SourceStatus = z.infer<typeof sourceStatusSchema>;
export type VoteCode = z.infer<typeof voteCodeSchema>;
export type OfficialTally = z.infer<typeof officialTallySchema>;
export type MemberPublicProfile = z.infer<typeof memberPublicProfileSchema>;
export type MemberProfile = z.infer<typeof memberProfileSchema>;
export type MemberRecord = z.infer<typeof memberSchema>;
export type RollCallRecord = z.infer<typeof rollCallSchema>;
export type VoteFactRecord = z.infer<typeof voteFactSchema>;
export type MeetingRecord = z.infer<typeof meetingSchema>;
export type SourceRecord = z.infer<typeof sourceRecordSchema>;
export type NormalizedBundle = z.infer<typeof normalizedBundleSchema>;
