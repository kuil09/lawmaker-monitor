import { describe, expect, it } from "vitest";
import { analysisMemberSchema } from "@lawmaker-monitor/schemas";
import index from "../fixtures/contracts/member_analysis/index.json";
import {
  buildMemberDistances,
  compareMemberConditions,
  groupMemberDistances
} from "../../apps/web/src/lib/member-distance.js";

const reference = analysisMemberSchema.parse(index.members[0]);
const candidate = (overrides: Partial<typeof reference>) => ({
  ...reference,
  memberId: "other",
  ...overrides
});

describe("member condition distance", () => {
  it("places identical conditions at zero and all different conditions at 100", () => {
    expect(compareMemberConditions(reference, candidate({})).distance).toBe(0);
    expect(
      compareMemberConditions(
        reference,
        candidate({
          committees: ["다른위원회"],
          reelectionLabel: "재선",
          proportionalFlag: true
        })
      ).distance
    ).toBe(100);
    const partial = compareMemberConditions(
      reference,
      candidate({ committees: [reference.committees[0]!] })
    );
    expect(partial.distance).toBeCloseTo(100 / 6);
    expect(partial.sharedCommittees).toEqual([reference.committees[0]]);
  });
  it("does not classify unknown conditions, self, or another assembly as distant", () => {
    expect(
      buildMemberDistances(reference, [
        reference,
        candidate({ memberId: "missing-committees", committees: [] }),
        candidate({ memberId: "missing-term", reelectionLabel: null }),
        candidate({ memberId: "other-assembly", assemblyNo: 21 })
      ])
    ).toEqual([]);
  });
  it("is symmetric, ignores duplicated committees, and uses equal weights", () => {
    const other = candidate({
      committees: [reference.committees[0]!, reference.committees[0]!],
      reelectionLabel: "재선"
    });
    const forward = compareMemberConditions(reference, other);
    expect(forward.distance).toBeCloseTo(50);
    expect(forward.distance).toBe(
      compareMemberConditions(other, reference).distance
    );
    expect(forward.knownConditions).toBe(3);
  });
  it("preserves all tied people in plotted groups with stable identifiers", () => {
    const members = [
      candidate({ memberId: "c" }),
      candidate({ memberId: "b" }),
      candidate({ memberId: "a" })
    ];
    const ranked = buildMemberDistances(reference, members);
    expect(ranked.map((row) => row.member.memberId)).toEqual(["a", "b", "c"]);
    const grouped = groupMemberDistances(ranked);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.count).toBe(3);
    expect(grouped[0]?.rows).toHaveLength(3);
  });
});
