import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  loadHexmapStaticIndexMock: vi.fn(),
  loadBoundaryIndexMock: vi.fn(),
  loadTopologyMock: vi.fn(),
  computeStaticMock: vi.fn(),
  fetchMock: vi.fn(),
  idleCallback: null as ((deadline: { didTimeout: boolean; timeRemaining: () => number }) => void) | null,
  cacheStoreData: new Map<string, unknown>()
}));

vi.mock("../../apps/web/src/lib/data.js", () => ({
  buildDataUrl: (path: string) => `https://data.example.test/lawmaker-monitor/${path}`,
  getConstituencyBoundariesIndexPath: (manifest?: {
    exports?: { constituencyBoundariesIndex?: { path?: string } };
  } | null) =>
    manifest?.exports?.constituencyBoundariesIndex?.path ??
    "exports/constituency_boundaries/index.json",
  getHexmapStaticIndexPath: (manifest?: {
    exports?: { hexmapStaticIndex?: { path?: string } };
  } | null) =>
    manifest?.exports?.hexmapStaticIndex?.path ?? "exports/hexmap_static/index.json",
  loadConstituencyBoundariesIndex: testState.loadBoundaryIndexMock,
  loadConstituencyProvinceTopology: testState.loadTopologyMock,
  loadHexmapStaticIndex: testState.loadHexmapStaticIndexMock
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

const hexmapStaticIndexFixture = {
  generatedAt: "2026-03-22T11:45:00+09:00",
  snapshotId: constituencyBoundariesIndexFixture.snapshotId,
  provinces: [
    {
      provinceShortName: "부산",
      path: "exports/hexmap_static/provinces/부산.json",
      checksumSha256: "hexmap-busan-v1",
      detailRes: 7,
      cellCount: 1,
      districtCount: 1
    },
    {
      provinceShortName: "서울",
      path: "exports/hexmap_static/provinces/서울.json",
      checksumSha256: "hexmap-seoul-v1",
      detailRes: 7,
      cellCount: 1,
      districtCount: 1
    }
  ]
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
    },
    hexmapStaticIndex: {
      path: "exports/hexmap_static/index.json",
      url: "https://data.example.test/lawmaker-monitor/exports/hexmap_static/index.json",
      checksumSha256: "hexmap-static-index-v1",
      rowCount: 2
    }
  }
};

const manifestWithoutPrecomputedFixture = {
  ...manifestFixture,
  exports: {
    ...manifestFixture.exports,
    hexmapStaticIndex: undefined
  }
};

function createPrecomputedArtifact(provinceShortName: "부산" | "서울") {
  return {
    provinceShortName,
    detailRes: 7,
    districts: [
      {
        type: "Feature" as const,
        geometry: {
          type: "Polygon" as const,
          coordinates: [[
            provinceShortName === "부산" ? [129.08, 35.09] : [126.98, 37.55],
            provinceShortName === "부산" ? [129.15, 35.09] : [127.04, 37.55],
            provinceShortName === "부산" ? [129.15, 35.14] : [127.04, 37.61],
            provinceShortName === "부산" ? [129.08, 35.14] : [126.98, 37.61],
            provinceShortName === "부산" ? [129.08, 35.09] : [126.98, 37.55]
          ]]
        },
        properties: {
          districtKey: provinceShortName === "부산" ? "부산남구" : "서울중구",
          label: provinceShortName === "부산" ? "부산 남구" : "서울 중구"
        }
      }
    ],
    cells: [
      {
        h3Index: provinceShortName === "부산" ? "8730c16f0ffffff" : "8730e1d88ffffff",
        districtKey: provinceShortName === "부산" ? "부산남구" : "서울중구",
        districtLabel: provinceShortName === "부산" ? "부산 남구" : "서울 중구",
        provinceShortName
      }
    ]
  };
}

const precomputedProvinceFixtures = {
  "exports/hexmap_static/provinces/부산.json": createPrecomputedArtifact("부산"),
  "exports/hexmap_static/provinces/서울.json": createPrecomputedArtifact("서울")
};

function createStaticEntry(cacheKey: string, provinceShortName: "부산" | "서울"): HexCellStaticCacheEntry {
  const artifact = createPrecomputedArtifact(provinceShortName);
  return {
    cacheKey,
    provinceShortName,
    detailRes: artifact.detailRes,
    createdAt: Date.now(),
    cells: artifact.cells,
    districts: artifact.districts
  };
}

function createWorkerResult(provinceShortName: "부산" | "서울") {
  const artifact = createPrecomputedArtifact(provinceShortName);
  return {
    cells: artifact.cells,
    detailRes: artifact.detailRes,
    timings: {
      reducedFeaturesMs: 1,
      fullFeaturesMs: 1,
      polygonToCellsMs: 1,
      staticHexComputeMs: 3
    }
  };
}

function createJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

describe("hexmap-static-loader", () => {
  beforeEach(() => {
    resetHexmapStaticLoaderForTests();
    testState.loadHexmapStaticIndexMock.mockReset();
    testState.loadBoundaryIndexMock.mockReset();
    testState.loadTopologyMock.mockReset();
    testState.computeStaticMock.mockReset();
    testState.fetchMock.mockReset();
    testState.cacheStoreData.clear();
    testState.idleCallback = null;

    setSharedHexCellCacheForTests(
      createHexCellCache({
        get: vi.fn(async (cacheKey: string) =>
          (testState.cacheStoreData.get(cacheKey) as HexCellStaticCacheEntry | undefined) ?? null
        ),
        set: vi.fn(async (entry: HexCellStaticCacheEntry) => {
          testState.cacheStoreData.set(entry.cacheKey, entry);
        })
      })
    );
    setSharedHexCellsWorkerClientForTests({
      computeStatic: testState.computeStaticMock
    });

    testState.loadHexmapStaticIndexMock.mockResolvedValue(hexmapStaticIndexFixture);
    testState.loadBoundaryIndexMock.mockResolvedValue(constituencyBoundariesIndexFixture);
    testState.loadTopologyMock.mockImplementation(async (path: string) => {
      return constituencyProvinceFixtures[path as keyof typeof constituencyProvinceFixtures] ?? null;
    });
    testState.computeStaticMock.mockImplementation(
      async (_topology: unknown, provinceShortName: "부산" | "서울") =>
        createWorkerResult(provinceShortName)
    );
    testState.fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = input.toString();
      const path = url.replace("https://data.example.test/lawmaker-monitor/", "");
      const payload =
        precomputedProvinceFixtures[path as keyof typeof precomputedProvinceFixtures];
      return payload ? createJsonResponse(payload) : createJsonResponse({ error: "Not found" }, 404);
    });

    vi.stubGlobal("fetch", testState.fetchMock);
    vi.stubGlobal(
      "requestIdleCallback",
      vi.fn((callback) => {
        testState.idleCallback = callback;
        return 1;
      })
    );
    vi.stubGlobal("cancelIdleCallback", vi.fn());
  });

  it("schedules home prewarm once and fills the shared static state from precomputed artifacts", async () => {
    scheduleHexmapPrewarm(manifestFixture);
    scheduleHexmapPrewarm(manifestFixture);

    expect(globalThis.requestIdleCallback).toHaveBeenCalledTimes(1);
    expect(testState.idleCallback).toBeTypeOf("function");

    testState.idleCallback?.({ didTimeout: false, timeRemaining: () => 50 });

    await waitFor(() => {
      expect(testState.loadHexmapStaticIndexMock).toHaveBeenCalledTimes(1);
      expect(testState.fetchMock).toHaveBeenCalledTimes(2);
      expect(testState.loadTopologyMock).not.toHaveBeenCalled();
      expect(testState.computeStaticMock).not.toHaveBeenCalled();
      expect(getHexmapStaticState(manifestFixture).done).toBe(2);
    });

    expect(getHexmapStaticState(manifestFixture)).toMatchObject({
      total: 2,
      done: 2,
      isLoading: false
    });
    expect(getHexmapStaticState(manifestFixture).entries).toHaveLength(2);
  });

  it("lets map loading join an in-flight home prewarm without duplicate precomputed fetches", async () => {
    let resolveBusan: ((value: Response) => void) | null = null;

    testState.fetchMock.mockImplementationOnce(
      async () =>
        await new Promise((resolve) => {
          resolveBusan = resolve as (value: Response) => void;
        })
    );

    const homePromise = ensureHexmapStaticLoad(manifestFixture, { source: "home" });
    await waitFor(() => {
      expect(testState.loadHexmapStaticIndexMock).toHaveBeenCalledTimes(1);
      expect(testState.fetchMock).toHaveBeenCalledTimes(1);
    });

    const mapPromise = ensureHexmapStaticLoad(manifestFixture, { source: "map" });

    expect(testState.loadHexmapStaticIndexMock).toHaveBeenCalledTimes(1);
    expect(testState.fetchMock).toHaveBeenCalledTimes(1);
    expect(testState.loadTopologyMock).not.toHaveBeenCalled();
    expect(testState.computeStaticMock).not.toHaveBeenCalled();

    resolveBusan?.(createJsonResponse(precomputedProvinceFixtures["exports/hexmap_static/provinces/부산.json"]));

    await Promise.all([homePromise, mapPromise]);

    expect(testState.fetchMock).toHaveBeenCalledTimes(2);
    expect(getHexmapStaticState(manifestFixture).done).toBe(2);
  });

  it("reuses warm static geometry on later map entry without refetching provinces or recomputing", async () => {
    await ensureHexmapStaticLoad(manifestFixture, { source: "home" });

    testState.fetchMock.mockClear();
    testState.loadTopologyMock.mockClear();
    testState.computeStaticMock.mockClear();

    await ensureHexmapStaticLoad(manifestFixture, { source: "map" });

    expect(testState.fetchMock).not.toHaveBeenCalled();
    expect(testState.loadTopologyMock).not.toHaveBeenCalled();
    expect(testState.computeStaticMock).not.toHaveBeenCalled();
  });

  it("starts multiple precomputed province fetches in parallel for direct map entry", async () => {
    const pendingResolvers = new Map<"부산" | "서울", (value: Response) => void>();

    testState.fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = input.toString();
      const path = url.replace("https://data.example.test/lawmaker-monitor/", "");
      const provinceShortName = path.includes("부산") ? "부산" : "서울";

      return await new Promise((resolve) => {
        pendingResolvers.set(provinceShortName, resolve as (value: Response) => void);
      });
    });

    const mapPromise = ensureHexmapStaticLoad(manifestFixture, { source: "map" });

    await waitFor(() => {
      expect(testState.loadHexmapStaticIndexMock).toHaveBeenCalledTimes(1);
      expect(testState.fetchMock).toHaveBeenCalledTimes(2);
    });

    pendingResolvers
      .get("부산")
      ?.(
        createJsonResponse(precomputedProvinceFixtures["exports/hexmap_static/provinces/부산.json"])
      );
    pendingResolvers
      .get("서울")
      ?.(
        createJsonResponse(precomputedProvinceFixtures["exports/hexmap_static/provinces/서울.json"])
      );

    await mapPromise;

    expect(testState.loadTopologyMock).not.toHaveBeenCalled();
    expect(testState.computeStaticMock).not.toHaveBeenCalled();
    expect(getHexmapStaticState(manifestFixture).done).toBe(2);
  });

  it("falls back to topology and worker compute when the precomputed export is unavailable", async () => {
    testState.loadHexmapStaticIndexMock.mockResolvedValueOnce(null);

    await ensureHexmapStaticLoad(manifestWithoutPrecomputedFixture, { source: "map" });

    expect(testState.loadBoundaryIndexMock).toHaveBeenCalledTimes(1);
    expect(testState.loadTopologyMock).toHaveBeenCalledTimes(2);
    expect(testState.computeStaticMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to topology and worker compute when a province artifact returns 404", async () => {
    testState.fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = input.toString();
      const path = url.replace("https://data.example.test/lawmaker-monitor/", "");
      if (path === "exports/hexmap_static/provinces/부산.json") {
        return createJsonResponse({ error: "Not found" }, 404);
      }

      const payload =
        precomputedProvinceFixtures[path as keyof typeof precomputedProvinceFixtures];
      return payload ? createJsonResponse(payload) : createJsonResponse({ error: "Not found" }, 404);
    });

    await ensureHexmapStaticLoad(manifestFixture, { source: "map" });

    expect(testState.fetchMock).toHaveBeenCalledTimes(2);
    expect(testState.loadTopologyMock).toHaveBeenCalledTimes(1);
    expect(testState.computeStaticMock).toHaveBeenCalledTimes(1);
  });

  it("reuses unchanged precomputed cache entries and refetches only provinces whose artifact checksum changed", async () => {
    await ensureHexmapStaticLoad(manifestFixture, { source: "home" });

    const changedIndex = {
      ...hexmapStaticIndexFixture,
      provinces: [
        hexmapStaticIndexFixture.provinces[0],
        {
          ...hexmapStaticIndexFixture.provinces[1],
          checksumSha256: "hexmap-seoul-v2"
        }
      ]
    };
    const changedManifest = {
      ...manifestFixture,
      exports: {
        ...manifestFixture.exports,
        hexmapStaticIndex: {
          ...manifestFixture.exports.hexmapStaticIndex,
          checksumSha256: "hexmap-static-index-v2"
        }
      }
    };

    testState.loadHexmapStaticIndexMock.mockReset();
    testState.loadHexmapStaticIndexMock.mockResolvedValueOnce(changedIndex);
    testState.fetchMock.mockClear();
    testState.loadTopologyMock.mockClear();
    testState.computeStaticMock.mockClear();

    await ensureHexmapStaticLoad(changedManifest, { source: "map" });

    expect(testState.fetchMock).toHaveBeenCalledTimes(1);
    expect(testState.loadTopologyMock).not.toHaveBeenCalled();
    expect(testState.computeStaticMock).not.toHaveBeenCalled();
    expect(getHexmapStaticState(changedManifest).done).toBe(2);
  });
});
