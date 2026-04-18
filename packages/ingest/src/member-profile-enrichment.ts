import type { MemberProfileAllRecord } from "./parsers.js";
import type { MemberProfile, MemberRecord } from "@lawmaker-monitor/schemas";

export type MemberProfileEnrichmentIssue = {
  key: string;
  reason:
    | "missing_profile_match"
    | "duplicate_profile_match"
    | "duplicate_member_match"
    | "unmatched_profile_record";
  name: string;
  party: string;
  district: string | null;
  assemblyNo: number;
  memberId?: string;
  naasCd?: string;
};

export type MemberProfileEnrichmentResult = {
  members: MemberRecord[];
  matchedCount: number;
  photoEnrichedCount: number;
  issues: MemberProfileEnrichmentIssue[];
};

function normalizeComparableText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function buildMatchKey(args: {
  name: string;
  party: string;
  district: string | null;
  assemblyNo: number;
}): string {
  return [
    args.assemblyNo,
    normalizeComparableText(args.name),
    normalizeComparableText(args.party),
    normalizeComparableText(args.district)
  ].join("|");
}

function mergeUniqueStrings(
  left: string[] = [],
  right: string[] = []
): string[] {
  return [...new Set([...left, ...right].filter(Boolean))];
}

function mergeMemberProfile(
  existing: MemberProfile | undefined,
  incoming: MemberProfile | undefined
): MemberProfile | undefined {
  if (!existing && !incoming) {
    return undefined;
  }

  return {
    nameHanja: incoming?.nameHanja ?? existing?.nameHanja ?? null,
    nameEnglish: incoming?.nameEnglish ?? existing?.nameEnglish ?? null,
    birthType: incoming?.birthType ?? existing?.birthType ?? null,
    birthDate: incoming?.birthDate ?? existing?.birthDate ?? null,
    roleName: incoming?.roleName ?? existing?.roleName ?? null,
    reelectionLabel:
      incoming?.reelectionLabel ?? existing?.reelectionLabel ?? null,
    electedAssembliesLabel:
      incoming?.electedAssembliesLabel ??
      existing?.electedAssembliesLabel ??
      null,
    gender: incoming?.gender ?? existing?.gender ?? null,
    representativeCommitteeName:
      incoming?.representativeCommitteeName ??
      existing?.representativeCommitteeName ??
      null,
    affiliatedCommitteeName:
      incoming?.affiliatedCommitteeName ??
      existing?.affiliatedCommitteeName ??
      null,
    briefHistory: incoming?.briefHistory ?? existing?.briefHistory ?? null,
    officeRoom: incoming?.officeRoom ?? existing?.officeRoom ?? null,
    officePhone: incoming?.officePhone ?? existing?.officePhone ?? null,
    email: incoming?.email ?? existing?.email ?? null,
    aideNames: mergeUniqueStrings(existing?.aideNames, incoming?.aideNames),
    chiefSecretaryNames: mergeUniqueStrings(
      existing?.chiefSecretaryNames,
      incoming?.chiefSecretaryNames
    ),
    secretaryNames: mergeUniqueStrings(
      existing?.secretaryNames,
      incoming?.secretaryNames
    )
  };
}

function mergeMemberWithProfile(
  member: MemberRecord,
  profile: MemberProfileAllRecord
): MemberRecord {
  return {
    ...member,
    committeeMemberships: [
      ...new Set([
        ...(member.committeeMemberships ?? []),
        ...(profile.committeeMemberships ?? [])
      ])
    ],
    photoUrl: profile.photoUrl ?? member.photoUrl ?? null,
    officialProfileUrl:
      profile.officialProfileUrl ?? member.officialProfileUrl ?? null,
    officialExternalUrl:
      profile.officialExternalUrl ?? member.officialExternalUrl ?? null,
    profile: mergeMemberProfile(member.profile, profile.profile),
    proportionalFlag: profile.proportionalFlag ?? member.proportionalFlag
  };
}

export function enrichMembersWithMemberProfileAll(args: {
  members: MemberRecord[];
  profiles: MemberProfileAllRecord[];
}): MemberProfileEnrichmentResult {
  const memberMatchesByKey = new Map<string, MemberRecord[]>();
  const profileMatchesByKey = new Map<string, MemberProfileAllRecord[]>();
  const issues: MemberProfileEnrichmentIssue[] = [];
  const issueKeys = new Set<string>();
  let matchedCount = 0;
  let photoEnrichedCount = 0;

  const pushIssue = (issue: MemberProfileEnrichmentIssue) => {
    const key = [
      issue.reason,
      issue.key,
      issue.memberId ?? "",
      issue.naasCd ?? ""
    ].join("|");
    if (issueKeys.has(key)) {
      return;
    }
    issueKeys.add(key);
    issues.push(issue);
  };

  for (const member of args.members) {
    const key = buildMatchKey({
      name: member.name,
      party: member.party,
      district: member.district ?? null,
      assemblyNo: member.assemblyNo
    });
    const items = memberMatchesByKey.get(key) ?? [];
    items.push(member);
    memberMatchesByKey.set(key, items);
  }

  for (const profile of args.profiles) {
    const key = buildMatchKey(profile);
    const items = profileMatchesByKey.get(key) ?? [];
    items.push(profile);
    profileMatchesByKey.set(key, items);
  }

  const members = args.members.map((member) => {
    const key = buildMatchKey({
      name: member.name,
      party: member.party,
      district: member.district ?? null,
      assemblyNo: member.assemblyNo
    });
    const memberMatches = memberMatchesByKey.get(key) ?? [];
    const profileMatches = profileMatchesByKey.get(key) ?? [];

    if (memberMatches.length > 1) {
      pushIssue({
        key,
        reason: "duplicate_member_match",
        memberId: member.memberId,
        name: member.name,
        party: member.party,
        district: member.district ?? null,
        assemblyNo: member.assemblyNo
      });
      return member;
    }

    if (profileMatches.length === 0) {
      pushIssue({
        key,
        reason: "missing_profile_match",
        memberId: member.memberId,
        name: member.name,
        party: member.party,
        district: member.district ?? null,
        assemblyNo: member.assemblyNo
      });
      return member;
    }

    if (profileMatches.length > 1) {
      pushIssue({
        key,
        reason: "duplicate_profile_match",
        memberId: member.memberId,
        name: member.name,
        party: member.party,
        district: member.district ?? null,
        assemblyNo: member.assemblyNo
      });
      return member;
    }

    const profile = profileMatches[0];
    if (!profile) {
      return member;
    }

    matchedCount += 1;
    const enriched = mergeMemberWithProfile(member, profile);
    if (profile.photoUrl && profile.photoUrl !== member.photoUrl) {
      photoEnrichedCount += 1;
    }
    return enriched;
  });

  for (const profile of args.profiles) {
    const key = buildMatchKey(profile);
    const memberMatches = memberMatchesByKey.get(key) ?? [];
    if (memberMatches.length === 0) {
      pushIssue({
        key,
        reason: "unmatched_profile_record",
        naasCd: profile.naasCd,
        name: profile.name,
        party: profile.party,
        district: profile.district ?? null,
        assemblyNo: profile.assemblyNo
      });
    }
  }

  return {
    members,
    matchedCount,
    photoEnrichedCount,
    issues
  };
}
