import { describe, expect, it } from "vitest";

import {
  createMapSeverityScale,
  MAP_SEVERITY_BANDS
} from "../../apps/web/src/lib/map-severity.js";

describe("national map severity scale", () => {
  it("classifies values into explicit nationwide percentile bands", () => {
    const scale = createMapSeverityScale(
      Array.from({ length: 100 }, (_, index) => index + 1)
    );

    expect(scale.median).toBe(50.5);
    expect(scale.classify(20).key).toBe("low");
    expect(scale.classify(60).key).toBe("moderate");
    expect(scale.classify(80).key).toBe("caution");
    expect(scale.classify(95)).toMatchObject({
      key: "high",
      label: "높음",
      topShare: 6
    });
  });

  it("uses a stable midrank when multiple districts share a value", () => {
    const scale = createMapSeverityScale([0.01, 0.02, 0.02, 0.02, 0.08]);

    expect(scale.median).toBe(0.02);
    expect(scale.classify(0.02).percentile).toBe(50);
    expect(scale.classify(0.02).key).toBe("moderate");
  });

  it("publishes every non-color legend level", () => {
    expect(MAP_SEVERITY_BANDS.map((band) => band.label)).toEqual([
      "낮음",
      "보통",
      "주의",
      "높음"
    ]);
  });
});
