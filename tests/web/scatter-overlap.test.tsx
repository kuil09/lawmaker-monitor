import { describe, expect, it } from "vitest";

import { spreadPercentageScatterPoints } from "../../apps/web/src/lib/scatter-overlap.js";

describe("scatter overlap spreading", () => {
  it("gives coincident boundary points unique in-domain plot positions", () => {
    const points = Array.from({ length: 14 }, (_, index) => ({
      memberId: `member-${String(index).padStart(2, "0")}`,
      x: 0,
      y: 100
    }));

    const result = spreadPercentageScatterPoints(points);
    const positions = new Set(
      result.map((point) => `${point.plotX}:${point.plotY}`)
    );

    expect(positions.size).toBe(points.length);
    expect(
      result.every(
        (point) =>
          point.plotX > 0 &&
          point.plotX < 100 &&
          point.plotY > 0 &&
          point.plotY < 100
      )
    ).toBe(true);
    expect(result.every((point) => point.overlapCount === 14)).toBe(true);
    expect(result.every((point) => point.x === 0 && point.y === 100)).toBe(
      true
    );
    const plotRows = [...new Set(result.map((point) => point.plotY))].sort(
      (left, right) => right - left
    );
    expect(plotRows[0]! - plotRows[1]!).toBeGreaterThanOrEqual(5.3);
  });

  it("keeps isolated interior points at their true position", () => {
    const [point] = spreadPercentageScatterPoints([
      { memberId: "member-a", x: 42.5, y: 67.25 }
    ]);

    expect(point).toMatchObject({
      plotX: 42.5,
      plotY: 67.25,
      overlapCount: 1,
      plotAdjusted: false
    });
  });

  it("scales overlap spreading to a narrow independent y-domain", () => {
    const result = spreadPercentageScatterPoints(
      [
        { memberId: "member-a", x: 52, y: 4 },
        { memberId: "member-b", x: 52, y: 4 },
        { memberId: "member-c", x: 52, y: 4 },
        { memberId: "member-d", x: 52, y: 4 }
      ],
      { xDomain: [0, 100], yDomain: [0, 18] }
    );

    expect(new Set(result.map((point) => point.plotY)).size).toBe(2);
    expect(result.every((point) => point.plotY >= 0 && point.plotY <= 18)).toBe(
      true
    );
    expect(Math.max(...result.map((point) => point.plotY))).toBeLessThan(6);
  });

  it("does not collapse distinct points near a boundary", () => {
    const result = spreadPercentageScatterPoints([
      { memberId: "member-a", x: 99, y: 0 },
      { memberId: "member-b", x: 99.5, y: 0 },
      { memberId: "member-c", x: 100, y: 0 }
    ]);

    expect(result.map((point) => point.plotX)).toEqual([99, 99.5, 100]);
    expect(result.every((point) => point.plotY === 0)).toBe(true);
    expect(result.every((point) => !point.plotAdjusted)).toBe(true);
  });
});
