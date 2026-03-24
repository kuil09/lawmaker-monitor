import { describe, expect, it } from "vitest";

import { enrichMembersWithMemberProfileAll } from "../../packages/ingest/src/member-profile-enrichment.js";
import type { MemberRecord } from "../../packages/schemas/src/index.js";
import type { MemberProfileAllRecord } from "../../packages/ingest/src/parsers.js";

function memberFixture(args: Partial<MemberRecord> & Pick<MemberRecord, "memberId" | "name">): MemberRecord {
  return {
    memberId: args.memberId,
    name: args.name,
    party: args.party ?? "미래개혁당",
    district: args.district ?? "서울 중구",
    committeeMemberships: args.committeeMemberships ?? [],
    photoUrl: args.photoUrl ?? null,
    officialProfileUrl: args.officialProfileUrl ?? null,
    officialExternalUrl: args.officialExternalUrl ?? null,
    profile: args.profile,
    isCurrentMember: args.isCurrentMember ?? true,
    proportionalFlag: args.proportionalFlag ?? false,
    assemblyNo: args.assemblyNo ?? 22
  };
}

function profileFixture(
  args: Partial<MemberProfileAllRecord> &
    Pick<MemberProfileAllRecord, "naasCd" | "name" | "party" | "assemblyNo">
): MemberProfileAllRecord {
  return {
    naasCd: args.naasCd,
    name: args.name,
    party: args.party,
    district: args.district ?? "서울 중구",
    assemblyNo: args.assemblyNo,
    committeeMemberships: args.committeeMemberships ?? [],
    photoUrl: args.photoUrl ?? null,
    officialProfileUrl: args.officialProfileUrl ?? null,
    officialExternalUrl: args.officialExternalUrl ?? null,
    profile: args.profile,
    proportionalFlag: args.proportionalFlag ?? false
  };
}

describe("member profile enrichment", () => {
  it("merges ALLNAMEMBER profile data onto the incumbent roster using name+party+district+assembly", () => {
    const result = enrichMembersWithMemberProfileAll({
      members: [memberFixture({ memberId: "M001", name: "김아라" })],
      profiles: [
        profileFixture({
          naasCd: "NAAS001",
          name: "김아라",
          party: "미래개혁당",
          assemblyNo: 22,
          photoUrl: "https://example.test/member-m001.jpg",
          officialExternalUrl: "https://blog.example.kr/kim-ara",
          profile: {
            nameEnglish: "KIM ARA",
            nameHanja: "金아라",
            birthType: null,
            birthDate: null,
            roleName: null,
            reelectionLabel: null,
            electedAssembliesLabel: null,
            gender: null,
            representativeCommitteeName: null,
            affiliatedCommitteeName: null,
            briefHistory: null,
            officeRoom: null,
            officePhone: "02-784-0001",
            email: null,
            aideNames: ["나보좌"],
            chiefSecretaryNames: [],
            secretaryNames: []
          }
        })
      ]
    });

    expect(result.matchedCount).toBe(1);
    expect(result.photoEnrichedCount).toBe(1);
    expect(result.issues).toEqual([]);
    expect(result.members[0]).toMatchObject({
      memberId: "M001",
      photoUrl: "https://example.test/member-m001.jpg",
      officialExternalUrl: "https://blog.example.kr/kim-ara",
      profile: {
        nameEnglish: "KIM ARA",
        officePhone: "02-784-0001",
        aideNames: ["나보좌"]
      }
    });
  });

  it("keeps current members without enrichment and warns when no ALLNAMEMBER match exists", () => {
    const result = enrichMembersWithMemberProfileAll({
      members: [memberFixture({ memberId: "M001", name: "김아라" })],
      profiles: []
    });

    expect(result.members[0]).toMatchObject({
      memberId: "M001",
      photoUrl: null
    });
    expect(result.issues).toEqual([
      expect.objectContaining({
        reason: "missing_profile_match",
        memberId: "M001"
      })
    ]);
  });

  it("ignores profile-only former lawmakers while warning about unmatched profile rows", () => {
    const result = enrichMembersWithMemberProfileAll({
      members: [memberFixture({ memberId: "M001", name: "김아라" })],
      profiles: [
        profileFixture({
          naasCd: "NAAS999",
          name: "퇴직의원",
          party: "미래개혁당",
          district: "서울 종로구",
          assemblyNo: 22,
          photoUrl: "https://example.test/former.jpg"
        })
      ]
    });

    expect(result.members).toHaveLength(1);
    expect(result.members[0]?.memberId).toBe("M001");
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "missing_profile_match",
          memberId: "M001"
        }),
        expect.objectContaining({
          reason: "unmatched_profile_record",
          naasCd: "NAAS999",
          name: "퇴직의원"
        })
      ])
    );
  });
});
