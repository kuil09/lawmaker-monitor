import { describe, expect, it } from "vitest";

import {
  buildHashForRoute,
  parseHashRoute
} from "../../apps/web/src/lib/route-state.js";

describe("route-state helpers", () => {
  it("parses calendar deep links with compare mode", () => {
    expect(
      parseHashRoute("#calendar?member=M001&compare=M002&view=compare")
    ).toEqual({
      route: "calendar",
      memberId: "M001",
      compareMemberId: "M002",
      view: "compare"
    });
  });

  it("parses distribution filters and map metrics while preserving existing hash shapes", () => {
    expect(
      parseHashRoute("#distribution?behavior=high-absence&member=M001")
    ).toEqual({
      route: "distribution",
      memberId: "M001",
      behaviorFilter: "high-absence"
    });
    expect(
      parseHashRoute("#map?province=%EC%84%9C%EC%9A%B8&metric=realEstate")
    ).toEqual({
      route: "map",
      province: "서울",
      district: null,
      metric: "realEstate"
    });
  });

  it("round-trips route state back into the existing hash format", () => {
    expect(
      buildHashForRoute({
        route: "calendar",
        memberId: "M001",
        compareMemberId: "M002",
        view: "compare"
      })
    ).toBe("calendar?member=M001&compare=M002&view=compare");
    expect(
      buildHashForRoute({
        route: "distribution",
        memberId: "M001",
        behaviorFilter: "committee-risk"
      })
    ).toBe("distribution?behavior=committee-risk&member=M001");
    expect(
      buildHashForRoute({
        route: "map",
        province: "서울",
        district: null,
        metric: "realEstate"
      })
    ).toBe("map?province=%EC%84%9C%EC%9A%B8&metric=realEstate");
  });
});
