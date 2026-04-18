import {
  buildMemberTenureIndex,
  getCurrentMembersMissingTenure,
  type MemberTenureRecord
} from "./tenure.js";

import type { MemberRecord } from "@lawmaker-monitor/schemas";

export type MissingCurrentMemberTenure = {
  memberId: string;
  memberName: string;
};

export type MemberHistorySupplementalTarget = MissingCurrentMemberTenure & {
  relativePath: string;
  metadata: Record<string, string>;
};

export function buildMemberHistorySupplementalRelativePath(
  memberId: string
): string {
  const normalized = memberId.replace(/[^A-Za-z0-9._-]/g, "_");
  return `official/member_history/by-member/${normalized}.xml`;
}

export function findMissingCurrentMemberTenures(args: {
  members: MemberRecord[];
  tenures: MemberTenureRecord[];
  assemblyNo: number;
}): MissingCurrentMemberTenure[] {
  const tenureIndex = buildMemberTenureIndex({
    members: args.members,
    tenures: args.tenures,
    assemblyNo: args.assemblyNo
  });

  return getCurrentMembersMissingTenure({
    members: args.members,
    assemblyNo: args.assemblyNo,
    tenureIndex
  })
    .map((member) => ({
      memberId: member.memberId,
      memberName: member.name
    }))
    .sort((left, right) => left.memberId.localeCompare(right.memberId));
}

export function buildMemberHistorySupplementalTargets(args: {
  members: MemberRecord[];
  tenures: MemberTenureRecord[];
  assemblyNo: number;
  assemblyLabel: string;
  unitCd: string;
}): MemberHistorySupplementalTarget[] {
  return findMissingCurrentMemberTenures(args).map((member) => ({
    ...member,
    relativePath: buildMemberHistorySupplementalRelativePath(member.memberId),
    metadata: {
      assemblyNo: String(args.assemblyNo),
      assemblyLabel: args.assemblyLabel,
      unitCd: args.unitCd,
      memberId: member.memberId,
      memberName: member.memberName,
      queryType: "monaCd"
    }
  }));
}
