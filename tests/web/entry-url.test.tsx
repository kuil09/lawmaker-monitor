import { describe, expect, it } from "vitest";

import { buildEntryUrlWithoutUiParameter } from "../../apps/web/src/lib/entry-url.js";

describe("entry URL normalization", () => {
  it("leaves canonical URLs unchanged", () => {
    expect(
      buildEntryUrlWithoutUiParameter(
        "https://kuil09.github.io/lawmaker-monitor/#votes"
      )
    ).toBeNull();
  });

  it("removes the obsolete UI parameter", () => {
    expect(
      buildEntryUrlWithoutUiParameter(
        "https://kuil09.github.io/lawmaker-monitor/?ui=v2"
      )
    ).toBe("/lawmaker-monitor/");
  });

  it("preserves other query parameters and hash routes", () => {
    expect(
      buildEntryUrlWithoutUiParameter(
        "https://kuil09.github.io/lawmaker-monitor/?ui=v1&deploy=abc123#map?province=%EC%84%9C%EC%9A%B8"
      )
    ).toBe(
      "/lawmaker-monitor/?deploy=abc123#map?province=%EC%84%9C%EC%9A%B8"
    );
  });
});
