import type { AnalysisMember } from "@lawmaker-monitor/schemas";

export type MemberDistance = {
  member: AnalysisMember;
  distance: number;
  sharedCommittees: string[];
  sameElectionType: boolean;
  sameReelection: boolean | null;
  knownConditions: number;
};

export function compareMemberConditions(
  reference: AnalysisMember,
  member: AnalysisMember
): MemberDistance {
  const a = new Set(reference.committees.filter(Boolean));
  const b = new Set(member.committees.filter(Boolean));
  const sharedCommittees = [...a].filter((name) => b.has(name));
  const sameElectionType =
    reference.proportionalFlag === member.proportionalFlag;
  const sameReelection =
    reference.reelectionLabel && member.reelectionLabel
      ? reference.reelectionLabel === member.reelectionLabel
      : null;
  const differences = [Number(!sameElectionType)];
  if (a.size && b.size)
    differences.push(1 - sharedCommittees.length / new Set([...a, ...b]).size);
  if (sameReelection !== null) differences.push(Number(!sameReelection));
  return {
    member,
    distance:
      (100 * differences.reduce((sum, value) => sum + value, 0)) /
      differences.length,
    sharedCommittees,
    sameElectionType,
    sameReelection,
    knownConditions: differences.length
  };
}

export function buildMemberDistances(
  reference: AnalysisMember,
  members: AnalysisMember[]
) {
  return (
    members
      .filter(
        (member) =>
          member.memberId !== reference.memberId &&
          member.assemblyNo === reference.assemblyNo
      )
      .map((member) => compareMemberConditions(reference, member))
      // Both ends of the scale use the same complete evidence, never imputed gaps.
      .filter((row) => row.knownConditions === 3)
      .sort(
        (a, b) =>
          a.distance - b.distance ||
          a.member.memberId.localeCompare(b.member.memberId)
      )
  );
}

export function groupMemberDistances(rows: MemberDistance[]) {
  const groups = new Map<
    string,
    {
      key: string;
      distance: number;
      shared: number;
      count: number;
      rows: MemberDistance[];
    }
  >();
  for (const row of rows) {
    const key = `${row.distance.toFixed(8)}:${row.sharedCommittees.length}`;
    const group = groups.get(key) ?? {
      key,
      distance: row.distance,
      shared: row.sharedCommittees.length,
      count: 0,
      rows: []
    };
    group.rows.push(row);
    group.count++;
    groups.set(key, group);
  }
  return [...groups.values()];
}
