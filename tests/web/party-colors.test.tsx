import { describe, expect, it } from "vitest";

import {
  getPartyColor,
  getPartyCssColor,
  getSequentialMetricColor
} from "../../apps/web/src/lib/geo-utils.js";

describe("party visualization colors", () => {
  it("uses a distinct magenta for the Progressive Party", () => {
    const progressive = getPartyColor("진보당");
    const peoplePower = getPartyColor("국민의힘");

    expect(progressive).toEqual([192, 42, 138, 230]);
    expect(progressive).not.toEqual(peoplePower);
    expect(getPartyCssColor("진보당")).toBe("rgb(192 42 138)");
  });

  it("uses neutral gray for an unknown party instead of a major-party color", () => {
    expect(getPartyColor("알 수 없는 정당")).toEqual([130, 130, 130, 230]);
    expect(getPartyCssColor("알 수 없는 정당")).toBe("rgb(130 130 130)");
  });

  it("uses a party-independent sequential scale for geographic metrics", () => {
    expect(getSequentialMetricColor(0)).toEqual([222, 215, 201, 235]);
    expect(getSequentialMetricColor(1)).toEqual([165, 42, 34, 245]);
    expect(getSequentialMetricColor(-1)).toEqual(getSequentialMetricColor(0));
    expect(getSequentialMetricColor(2)).toEqual(getSequentialMetricColor(1));
  });
});
