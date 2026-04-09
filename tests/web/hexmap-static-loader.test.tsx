import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  loadIndexMock: vi.fn(),
  loadTopologyMock: vi.fn(),
  computeStaticMock: vi.fn(),
  idleCallback: null as ((deadline: { didTimeout: boolean; timeRemaining: () => number }) => void) | null,
  cacheStoreData: new Map<string, unknown>()
}));

vi.mock("../../apps/web/src/lib/data.js", () => ({
  getConstituencyBoundariesIndexPath: (manifest?: {
    exports?: { constituencyBoundariesIndex?: { path?: string } };
  } | null) =>
    manifest?.exports?.constituencyBoundariesIndex?.path ?? "exports/constituency_boundaries/index.json",
  loadConstituencyBoundariesIndex: testState.loadIndexMock,
  loadConstituencyProvinceTopology: testState.loadTopologyMock
}));

import {
  createHexCellCache,
  setSharedHexCellCacheForTests,
  type HexCellStaticCacheEntry
} from "../../apps/web/src/lib/hex-cell-cache.js";
import { setSharedHexCellsWorkerClientForTests } from "../../apps/web/src/lib/hex-cells-worker.js";
import {
  ensureHexmapStaticLoad,
  getHexmapStaticState,
  resetHexmapStaticLoaderForTests,
  scheduleHexmapPrewarm
} from "../../apps/web/src/lib/hexmap-static-loader.js";

const fixturesDir = resolve(process.cwd(), "tests/fixtures/contracts");
const baseManifestFixture = JSON.parse(readFileSync(resolve(fixturesDir, "manifest.json"), "utf8"));
const constituencyBoundariesIndexFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, "constituency_boundaries_index.json"), "utf8")
);
const constituencyProvinceFixtures = {
  "exports/constituency_boundaries/provinces/부산.topo.json": JSON.parse(
    readFileSync(resolve(fixturesDir, "constituency_province_busan.topo.json"), "utf8")
  ),
  "exports/constituency_boundaries/provinces/서울.topo.json": JSON.parse(
    readFileSync(resolve(fixturesDir, "constituency_province_seoul.topo.json"), "utf8")
  )
};

const manifestFixture = {
  ...baseManifestFixture,
  exports: {
    ...baseManifestFixture.exports,
    constituencyBoundariesIndex: {
      path: "exports/constituency_boundaries/index.json",
      url: "https://data.example.test/lawmaker-monitor/exports/constituency_boundaries/index.json",
      checksumSha256: "constituency-index-checksum",
      rowCount: 2
    }
  }
};

function createStaticEntry(cacheKey: string, provinceShortName: "부산" | "서울") {
  return {
    cells: [
      {
        h3Index: provinceShortName === "부산" ? "8730c16f0ffffff" : "8730e1d88ffffff",
        districtKey: provinceShortName === "부산" ? "부산남구" : "서울중구",
        districtLabel: provinceShortName === "부산" ? "부산 남구" : "서울 중구",
        provinceShortName
      }
    ],
    detailRes: 7,
    timings: {
      reducedFeaturesMs: 1,
      fullFeaturesMs: 1,
      polygonToCellsMs: 1,
      staticHexComputeMs: 3
    },
    cacheKey
  };
}

describe("hexmap-static-loader", () => {
  beforeEach(() => {
    resetHexmapStaticLoaderForTests();
    testState.loadIndexMock.mockReset();
    testState.loadTopologyMock.mockReset();
    testState.computeStaticMock.mockReset();
    testState.cacheStoreData.clear();
    testState.idleCallback = null;

    setSharedHexCellCacheForTests(createHexCellCache({
      get: vi.fn(async (cacheKey: string) =>
        (testState.cacheStoreData.get(cacheKey) as HexCellStaticCacheEntry | undefined) ?? null
      ),
      set: vi.fn(async (entry: HexCellStaticCacheEntry) => {
        testState.cacheStoreData.set(entry.cacheKey, entry);
      })
    }));
    setSharedHexCellsWorkerClientForTests({
      computeStatic: testState.computeStaticMock
    });

    testState.loadIndexMock.mockResolvedValue(constituencyBoundariesIndexFixture);
    testState.loadTopologyMock.mockImplementation(async (path: string) => {
      return constituencyProvinceFixtures[path as keyof typeof constituencyProvinceFixtures] ?? null;
    });
    testState.computeStaticMock.mockImplementation(async (_topology: unknown, provinceShortName: "부산" | "서울") => {
      const cacheKey = `${constituencyBoundariesIndexFixture.snapshotId}:${
        provinceShortName === "부산"
          ? constituencyBoundariesIndexFixture.provinces[0].checksumSha256
          : constituencyBoundariesIndexFixture.provinces[1].checksumSha256
      }`;
      const result = createStaticEntry(cacheKey, provinceShortName);
      return {
        cells: result.cells,
        detailRes: result.detailRes,
        timings: result.timings
      };
    });

    vi.stubGlobal("requestIdleCallback", vi.fn((callback) => {
      testState.idleCallback = callback;
      return 1;
    }));
    vi.stubGlobal("cancelIdleCallback", vi.fn());
  });

  it("schedules home prewarm once and fills the shared static state when idle fires", async () => {
    scheduleHexmapPrewarm(manifestFixture);
    scheduleHexmapPrewarm(manifestFixture);

    expect(globalThis.requestIdleCallback).toHaveBeenCalledTimes(1);
    expect(testState.idleCallback).toBeTypeOf("function");

    testState.idleCallback?.({ didTimeout: false, timeRemaining: () => 50 });

    await waitFor(() => {
      expect(testState.loadIndexMock).toHaveBeenCalledTimes(1);
      expect(testState.loadTopologyMock).toHaveBeenCalledTimes(2);
      expect(testState.computeStaticMock).toHaveBeenCalledTimes(2);
      expect(getHexmapStaticState(manifestFixture).done).toBe(2);
    });

    expect(getHexmapStaticState(manifestFixture)).toMatchObject({
      total: 2,
      done: 2,
      isLoading: false
    });
    expect(getHexmapStaticState(manifestFixture).entries).toHaveLength(2);
  });

  it("lets map loading join an in-flight home prewarm without duplicate topology or worker work", async () => {
    let resolveBusan: ((value: ReturnType<typeof createStaticEntry>) => void) | null = null;

    testState.computeStaticMock.mockImplementationOnce(
      async () =>
        await new Promise((resolve) => {
          resolveBusan = resolve as (value: ReturnType<typeof createStaticEntry>) => void;
        })
    );

    const homePromise = ensureHexmapStaticLoad(manifestFixture, { source: "home" });
    await waitFor(() => {
      expect(testState.loadIndexMock).toHaveBeenCalledTimes(1);
      expect(testState.computeStaticMock).toHaveBeenCalledTimes(1);
    });

    const mapPromise = ensureHexmapStaticLoad(manifestFixture, { source: "map" });

    expect(testState.loadIndexMock).toHaveBeenCalledTimes(1);
    expect(testState.loadTopologyMock).toHaveBeenCalledTimes(1);
    expect(testState.computeStaticMock).toHaveBeenCalledTimes(1);

    resolveBusan?.(
      createStaticEntry(
        `${constituencyBoundariesIndexFixture.snapshotId}:${constituencyBoundariesIndexFixture.provinces[0].checksumSha256}`,
        "부산"
      )
    );

    await Promise.all([homePromise, mapPromise]);

    expect(testState.loadTopologyMock).toHaveBeenCalledTimes(2);
    expect(testState.computeStaticMock).toHaveBeenCalledTimes(2);
    expect(getHexmapStaticState(manifestFixture).done).toBe(2);
  });

  it("reuses warm static geometry on later map entry without recomputing provinces", async () => {
    await ensureHexmapStaticLoad(manifestFixture, { source: "home" });

    testState.loadTopologyMock.mockClear();
    testState.computeStaticMock.mockClear();

    await ensureHexmapStaticLoad(manifestFixture, { source: "map" });

    expect(testState.loadTopologyMock).not.toHaveBeenCalled();
    expect(testState.computeStaticMock).not.toHaveBeenCalled();
  });

  it("misses the previous static cache when snapshot ids or province checksums change", async () => {
    await ensureHexmapStaticLoad(manifestFixture, { source: "home" });
    resetHexmapStaticLoaderForTests();

    const changedSnapshotIndex = {
      ...constituencyBoundariesIndexFixture,
      snapshotId: "boundaries-2"
    };
    testState.loadIndexMock.mockResolvedValueOnce(changedSnapshotIndex);

    await ensureHexmapStaticLoad(manifestFixture, { source: "map" });
    expect(testState.computeStaticMock).toHaveBeenCalledTimes(4);

    resetHexmapStaticLoaderForTests();

    const changedChecksumIndex = {
      ...constituencyBoundariesIndexFixture,
      provinces: constituencyBoundariesIndexFixture.provinces.map((province: (typeof constituencyBoundariesIndexFixture.provinces)[number], index: number) => ({
        ...province,
        checksumSha256: `${province.checksumSha256}-v${index + 2}`
      }))
    };
    testState.loadIndexMock.mockResolvedValueOnce(changedChecksumIndex);

    await ensureHexmapStaticLoad(manifestFixture, { source: "map" });
    expect(testState.computeStaticMock).toHaveBeenCalledTimes(6);
  });
});
