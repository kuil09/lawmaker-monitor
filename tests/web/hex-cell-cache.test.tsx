import { describe, expect, it, vi } from "vitest";

import {
  buildHexCellStaticCacheKey,
  createHexCellCache,
  type HexCellStaticCacheEntry
} from "../../apps/web/src/lib/hex-cell-cache.js";

describe("hex-cell-cache", () => {
  it("builds stable province cache keys", () => {
    expect(buildHexCellStaticCacheKey("boundaries-2026-04-10", "abc123")).toBe(
      "boundaries-2026-04-10:abc123"
    );
  });

  it("reuses static entries from memory after the first store read and reuses hydrated metric arrays per snapshot and metric", async () => {
    const entry: HexCellStaticCacheEntry = {
      cacheKey: "boundaries-2026-04-10:abc123",
      provinceShortName: "부산",
      detailRes: 7,
      createdAt: 1,
      cells: [
        {
          h3Index: "8730c16f0ffffff",
          districtKey: "부산남구",
          districtLabel: "부산 남구",
          provinceShortName: "부산"
        }
      ]
    };

    const store = {
      get: vi.fn(async () => entry),
      set: vi.fn(async () => undefined)
    };
    const cache = createHexCellCache(store);

    const firstRead = await cache.readStatic(entry.cacheKey);
    const secondRead = await cache.readStatic(entry.cacheKey);

    expect(firstRead).toEqual({ entry, source: "indexeddb" });
    expect(secondRead).toEqual({ entry, source: "memory" });
    expect(store.get).toHaveBeenCalledTimes(1);

    const computeHydrated = vi.fn(() => [
      {
        h3Index: "8730c16f0ffffff",
        districtKey: "부산남구",
        districtLabel: "부산 남구",
        provinceShortName: "부산",
        party: "미래개혁당",
        metric: 0.5,
        memberCount: 1,
        memberNames: ["박민"],
        memberParties: ["미래개혁당"],
        memberIds: ["M002"]
      }
    ]);

    const hydratedAbsence = cache.getOrCreateHydratedCells({
      staticKey: entry.cacheKey,
      summarySnapshotId: "summary-1",
      metric: "absence",
      compute: computeHydrated
    });
    const hydratedAbsenceAgain = cache.getOrCreateHydratedCells({
      staticKey: entry.cacheKey,
      summarySnapshotId: "summary-1",
      metric: "absence",
      compute: computeHydrated
    });
    const hydratedNegative = cache.getOrCreateHydratedCells({
      staticKey: entry.cacheKey,
      summarySnapshotId: "summary-1",
      metric: "negative",
      compute: computeHydrated
    });

    expect(hydratedAbsenceAgain).toBe(hydratedAbsence);
    expect(hydratedNegative).not.toBe(hydratedAbsence);
    expect(computeHydrated).toHaveBeenCalledTimes(2);
  });
});
