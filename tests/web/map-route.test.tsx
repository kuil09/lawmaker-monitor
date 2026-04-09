import { describe, expect, it } from "vitest";

import {
  buildMapHash,
  buildMapHref,
  parseMapRoute
} from "../../apps/web/src/lib/map-route.js";

describe("map-route", () => {
  it("parses district-first routes and preserves legacy province fallback", () => {
    expect(parseMapRoute("district=%EC%84%9C%EC%9A%B8%EC%A4%91%EA%B5%AC&metric=negative")).toEqual({
      province: null,
      district: "서울중구",
      metric: "negative"
    });

    expect(parseMapRoute("province=%EB%B6%80%EC%82%B0")).toEqual({
      province: "부산",
      district: null,
      metric: "absence"
    });
  });

  it("builds canonical map hashes with district priority", () => {
    expect(buildMapHash({ district: "서울중구", province: "서울", metric: "negative" })).toBe(
      "map?district=%EC%84%9C%EC%9A%B8%EC%A4%91%EA%B5%AC&metric=negative"
    );
    expect(buildMapHash({ province: "부산", metric: "absence" })).toBe(
      "map?province=%EB%B6%80%EC%82%B0"
    );
    expect(buildMapHref({ district: "부산남구", metric: "absence" })).toBe(
      "#map?district=%EB%B6%80%EC%82%B0%EB%82%A8%EA%B5%AC"
    );
  });
});
