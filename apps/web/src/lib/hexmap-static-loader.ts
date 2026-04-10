import type {
  ConstituencyBoundariesIndexExport,
  HexmapStaticIndexExport,
  Manifest
} from "@lawmaker-monitor/schemas";
import { hexmapStaticProvinceArtifactSchema } from "@lawmaker-monitor/schemas";

import type { ConstituencyBoundaryTopology } from "./constituency-map.js";
import {
  buildDataUrl,
  getConstituencyBoundariesIndexPath,
  getHexmapStaticIndexPath,
  loadConstituencyBoundariesIndex,
  loadConstituencyProvinceTopology,
  loadHexmapStaticIndex
} from "./data.js";
import {
  buildHexCellStaticCacheKey,
  getSharedHexCellCache,
  type HexCellStaticCacheEntry
} from "./hex-cell-cache.js";
import { endPerformanceSpan, startPerformanceSpan } from "./hex-cells.js";
import { getSharedHexCellsWorkerClient } from "./hex-cells-worker.js";
import { extractReprojectedFeatures } from "./geo-utils.js";

type HexmapLoadSource = "home" | "map";
type Listener = (state: HexmapStaticState) => void;
type IdleHandle = number;
type IdleCallback = (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void;
type PrimaryHexmapIndex =
  | { kind: "precomputed"; index: HexmapStaticIndexExport }
  | { kind: "boundary"; index: ConstituencyBoundariesIndexExport };
type BoundaryProvince = ConstituencyBoundariesIndexExport["provinces"][number];
type ProvinceWorkItem = {
  cacheKey: string;
  provinceShortName: string;
  precomputedPath: string | null;
  boundaryProvince: BoundaryProvince | null;
};

const MAP_LOAD_CONCURRENCY = 4;
const LOW_ZOOM_DISTRICT_STEP = 6;

export type HexmapStaticState = {
  sessionKey: string;
  snapshotId: string | null;
  entries: HexCellStaticCacheEntry[];
  total: number;
  done: number;
  isLoading: boolean;
  error: string | null;
};

type Session = {
  key: string;
  state: HexmapStaticState;
  listeners: Set<Listener>;
  completedProvinceKeys: Set<string>;
  entryByCacheKey: Map<string, HexCellStaticCacheEntry>;
  provincePromises: Map<string, Promise<HexCellStaticCacheEntry | null>>;
  boundaryIndexPromise: Promise<ConstituencyBoundariesIndexExport | null> | null;
  runPromise: Promise<void> | null;
  scheduledPrewarm: { cancel: () => void } | null;
  activeSource: HexmapLoadSource | null;
  homeFirstProvinceMarked: boolean;
};

const sessions = new Map<string, Session>();

function markInstant(label: string): void {
  const span = startPerformanceSpan(label);
  endPerformanceSpan(span);
}

function createInitialState(sessionKey: string): HexmapStaticState {
  return {
    sessionKey,
    snapshotId: null,
    entries: [],
    total: 0,
    done: 0,
    isLoading: false,
    error: null
  };
}

function createSession(sessionKey: string): Session {
  return {
    key: sessionKey,
    state: createInitialState(sessionKey),
    listeners: new Set(),
    completedProvinceKeys: new Set(),
    entryByCacheKey: new Map(),
    provincePromises: new Map(),
    boundaryIndexPromise: null,
    runPromise: null,
    scheduledPrewarm: null,
    activeSource: null,
    homeFirstProvinceMarked: false
  };
}

function getSession(manifest?: Manifest | null): Session {
  const sessionKey = getHexmapStaticSessionKey(manifest);
  const existing = sessions.get(sessionKey);
  if (existing) {
    return existing;
  }

  const created = createSession(sessionKey);
  sessions.set(sessionKey, created);
  return created;
}

function emit(session: Session): void {
  session.state = {
    ...session.state,
    entries: [...session.state.entries]
  };

  for (const listener of session.listeners) {
    listener(session.state);
  }
}

function resetSessionForSnapshot(session: Session, snapshotId: string): void {
  session.completedProvinceKeys.clear();
  session.entryByCacheKey.clear();
  session.provincePromises.clear();
  session.boundaryIndexPromise = null;
  session.homeFirstProvinceMarked = false;
  session.state = {
    ...createInitialState(session.key),
    snapshotId
  };
  emit(session);
}

function syncSessionSnapshot(session: Session, snapshotId: string, total: number): void {
  if (session.state.snapshotId !== snapshotId) {
    resetSessionForSnapshot(session, snapshotId);
  }

  if (session.state.total !== total) {
    session.state = {
      ...session.state,
      total,
      done: session.completedProvinceKeys.size
    };
    emit(session);
  }
}

async function ensurePrimaryIndex(
  session: Session,
  manifest?: Manifest | null
): Promise<PrimaryHexmapIndex | null> {
  const precomputedIndex = await loadHexmapStaticIndex(manifest);
  if (precomputedIndex) {
    syncSessionSnapshot(session, precomputedIndex.snapshotId, precomputedIndex.provinces.length);
    return { kind: "precomputed", index: precomputedIndex };
  }

  const boundaryIndex = await ensureBoundaryIndex(session, manifest);
  if (!boundaryIndex) {
    return null;
  }

  syncSessionSnapshot(session, boundaryIndex.snapshotId, boundaryIndex.provinces.length);
  return { kind: "boundary", index: boundaryIndex };
}

async function ensureBoundaryIndex(
  session: Session,
  manifest?: Manifest | null
): Promise<ConstituencyBoundariesIndexExport | null> {
  if (!session.boundaryIndexPromise) {
    session.boundaryIndexPromise = loadConstituencyBoundariesIndex(manifest).catch((error) => {
      session.boundaryIndexPromise = null;
      throw error;
    });
  }

  const boundaryIndex = await session.boundaryIndexPromise;
  if (boundaryIndex) {
    syncSessionSnapshot(session, boundaryIndex.snapshotId, boundaryIndex.provinces.length);
  }

  return boundaryIndex;
}

async function resolveBoundaryProvince(
  session: Session,
  manifest: Manifest | null | undefined,
  provinceShortName: string
): Promise<BoundaryProvince | null> {
  const boundaryIndex = await ensureBoundaryIndex(session, manifest);
  if (!boundaryIndex) {
    return null;
  }

  return (
    boundaryIndex.provinces.find(
      (province) => province.provinceShortName === provinceShortName
    ) ?? null
  );
}

async function loadPrecomputedProvinceEntry(args: {
  cacheKey: string;
  path: string;
  provinceShortName: string;
}): Promise<HexCellStaticCacheEntry | null> {
  const fetchSpan = startPerformanceSpan(`hexmap:${args.provinceShortName}:precomputedFetch`);
  const response = await fetch(buildDataUrl(args.path));
  endPerformanceSpan(fetchSpan);

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`데이터 요청에 실패했습니다 (${response.status}).`);
  }

  const parseSpan = startPerformanceSpan(`hexmap:${args.provinceShortName}:precomputedParse`);
  const artifact = hexmapStaticProvinceArtifactSchema.parse(await response.json());
  endPerformanceSpan(parseSpan);

  if (artifact.provinceShortName !== args.provinceShortName) {
    throw new Error(
      `Province artifact mismatch for ${args.provinceShortName}: received ${artifact.provinceShortName}.`
    );
  }

  return {
    cacheKey: args.cacheKey,
    provinceShortName: artifact.provinceShortName,
    detailRes: artifact.detailRes,
    createdAt: Date.now(),
    cells: artifact.cells,
    districts: artifact.districts
  };
}

async function loadFallbackProvinceEntry(
  session: Session,
  manifest: Manifest | null | undefined,
  workItem: ProvinceWorkItem
): Promise<HexCellStaticCacheEntry | null> {
  const boundaryProvince =
    workItem.boundaryProvince ??
    (await resolveBoundaryProvince(session, manifest, workItem.provinceShortName));
  if (!boundaryProvince) {
    return null;
  }

  const topologySpan = startPerformanceSpan(`hexmap:${workItem.provinceShortName}:topologyFetch`);
  const topology = await loadConstituencyProvinceTopology<ConstituencyBoundaryTopology>(
    boundaryProvince.path
  );
  endPerformanceSpan(topologySpan);

  if (!topology) {
    return null;
  }

  const districts = extractReprojectedFeatures(topology, LOW_ZOOM_DISTRICT_STEP);
  const fallbackSpan = startPerformanceSpan(`hexmap:${workItem.provinceShortName}:fallbackCompute`);
  const computed = await getSharedHexCellsWorkerClient().computeStatic(
    topology,
    workItem.provinceShortName
  );
  endPerformanceSpan(fallbackSpan);

  return {
    cacheKey: workItem.cacheKey,
    provinceShortName: workItem.provinceShortName,
    detailRes: computed.detailRes,
    createdAt: Date.now(),
    cells: computed.cells,
    districts
  };
}

async function loadProvinceEntry(
  session: Session,
  manifest: Manifest | null | undefined,
  workItem: ProvinceWorkItem
): Promise<HexCellStaticCacheEntry | null> {
  const existingPromise = session.provincePromises.get(workItem.cacheKey);
  if (existingPromise) {
    return existingPromise;
  }

  const cache = getSharedHexCellCache();

  const provincePromise = (async () => {
    const idbSpan = startPerformanceSpan(`hexmap:${workItem.provinceShortName}:idbRead`);
    const cached = await cache.readStatic(workItem.cacheKey);
    endPerformanceSpan(idbSpan);

    if (cached.entry && (cached.entry.districts?.length ?? 0) > 0) {
      return cached.entry;
    }

    let entry: HexCellStaticCacheEntry | null = null;

    if (workItem.precomputedPath) {
      try {
        entry = await loadPrecomputedProvinceEntry({
          cacheKey: workItem.cacheKey,
          path: workItem.precomputedPath,
          provinceShortName: workItem.provinceShortName
        });
      } catch {
        entry = null;
      }
    }

    if (!entry) {
      entry = await loadFallbackProvinceEntry(session, manifest, workItem);
    }

    if (!entry) {
      return null;
    }

    await cache.writeStatic(entry);
    return entry;
  })();

  session.provincePromises.set(workItem.cacheKey, provincePromise);

  try {
    return await provincePromise;
  } finally {
    session.provincePromises.delete(workItem.cacheKey);
  }
}

function buildProvinceWorkItem(primaryIndex: PrimaryHexmapIndex, provinceIndex: number): ProvinceWorkItem {
  if (primaryIndex.kind === "precomputed") {
    const province = primaryIndex.index.provinces[provinceIndex];
    if (!province) {
      throw new Error(`Missing province at index ${provinceIndex}.`);
    }

    return {
      cacheKey: buildHexCellStaticCacheKey(
        primaryIndex.index.snapshotId,
        province.checksumSha256
      ),
      provinceShortName: province.provinceShortName,
      precomputedPath: province.path,
      boundaryProvince: null
    };
  }

  const province = primaryIndex.index.provinces[provinceIndex];
  if (!province) {
    throw new Error(`Missing province at index ${provinceIndex}.`);
  }

  return {
    cacheKey: buildHexCellStaticCacheKey(primaryIndex.index.snapshotId, province.checksumSha256),
    provinceShortName: province.provinceShortName,
    precomputedPath: null,
    boundaryProvince: province
  };
}

function getPrimaryProvinceCount(primaryIndex: PrimaryHexmapIndex): number {
  return primaryIndex.index.provinces.length;
}

async function runHexmapStaticLoad(
  session: Session,
  manifest: Manifest | null | undefined,
  source: HexmapLoadSource
): Promise<void> {
  if (source === "home") {
    markInstant("hexmap:homePrewarmStarted");
  }

  session.activeSource = source;
  session.state = {
    ...session.state,
    isLoading: true,
    error: null
  };
  emit(session);

  try {
    const primaryIndex = await ensurePrimaryIndex(session, manifest);
    if (!primaryIndex || getPrimaryProvinceCount(primaryIndex) === 0) {
      throw new Error("선거구 경계 데이터를 불러오지 못했습니다.");
    }

    const totalProvinces = getPrimaryProvinceCount(primaryIndex);
    const concurrency =
      source === "map" ? Math.min(MAP_LOAD_CONCURRENCY, totalProvinces) : 1;
    let nextProvinceIndex = 0;
    const inFlight = new Set<Promise<void>>();

    const consumeProvince = async (provinceIndex: number): Promise<void> => {
      const workItem = buildProvinceWorkItem(primaryIndex, provinceIndex);

      if (session.completedProvinceKeys.has(workItem.cacheKey)) {
        return;
      }

      const entry = await loadProvinceEntry(session, manifest, workItem);
      if (entry && !session.entryByCacheKey.has(workItem.cacheKey)) {
        session.entryByCacheKey.set(workItem.cacheKey, entry);
        session.state = {
          ...session.state,
          entries: [...session.state.entries, entry]
        };

        if (source === "home" && !session.homeFirstProvinceMarked) {
          session.homeFirstProvinceMarked = true;
          markInstant("hexmap:homePrewarmFirstProvinceReady");
        }
      }

      session.completedProvinceKeys.add(workItem.cacheKey);
      session.state = {
        ...session.state,
        done: session.completedProvinceKeys.size
      };
      emit(session);
    };

    const startMoreWork = (): void => {
      while (nextProvinceIndex < totalProvinces && inFlight.size < concurrency) {
        const currentProvinceIndex = nextProvinceIndex++;
        const task = consumeProvince(currentProvinceIndex).finally(() => {
          inFlight.delete(task);
        });
        inFlight.add(task);
      }
    };

    startMoreWork();

    while (inFlight.size > 0) {
      await Promise.race(inFlight);
      startMoreWork();
    }

    session.state = {
      ...session.state,
      done: totalProvinces,
      total: totalProvinces,
      isLoading: false,
      error: null
    };
    emit(session);

    if (source === "home") {
      markInstant("hexmap:homePrewarmComplete");
    }
  } catch (error) {
    session.state = {
      ...session.state,
      isLoading: false,
      error: (error as Error).message ?? "Failed to load hexmap data."
    };
    emit(session);
  } finally {
    session.activeSource = null;
    session.runPromise = null;
  }
}

export function getHexmapStaticSessionKey(manifest?: Manifest | null): string {
  const hexmapStaticToken = manifest?.exports.hexmapStaticIndex
    ? `${manifest.exports.hexmapStaticIndex.path}:${manifest.exports.hexmapStaticIndex.checksumSha256}`
    : getHexmapStaticIndexPath(manifest);
  const boundaryToken = manifest?.exports.constituencyBoundariesIndex
    ? `${manifest.exports.constituencyBoundariesIndex.path}:${manifest.exports.constituencyBoundariesIndex.checksumSha256}`
    : getConstituencyBoundariesIndexPath(manifest);

  return `${hexmapStaticToken}::${boundaryToken}`;
}

export function getHexmapStaticState(manifest?: Manifest | null): HexmapStaticState {
  return getSession(manifest).state;
}

export function subscribeHexmapStaticState(
  manifest: Manifest | null | undefined,
  listener: Listener
): () => void {
  const session = getSession(manifest);
  session.listeners.add(listener);
  listener(session.state);

  return () => {
    session.listeners.delete(listener);
  };
}

export async function ensureHexmapStaticLoad(
  manifest: Manifest | null | undefined,
  options: { source: HexmapLoadSource }
): Promise<void> {
  const session = getSession(manifest);
  const isComplete =
    session.state.total > 0 && session.state.done >= session.state.total && !session.state.isLoading;

  if (options.source === "map" && isComplete) {
    markInstant("hexmap:mapReuseWarmCache");
    return;
  }

  if (options.source === "map" && session.runPromise && session.activeSource === "home") {
    markInstant("hexmap:mapJoinedInFlightPrewarm");
  }

  if (session.runPromise) {
    return session.runPromise;
  }

  session.runPromise = runHexmapStaticLoad(session, manifest, options.source);
  return session.runPromise;
}

export function scheduleHexmapPrewarm(manifest: Manifest | null | undefined): () => void {
  const session = getSession(manifest);
  const isComplete =
    session.state.total > 0 && session.state.done >= session.state.total && !session.state.isLoading;

  if (isComplete || session.runPromise || session.scheduledPrewarm) {
    return () => {};
  }

  markInstant("hexmap:homePrewarmScheduled");

  const globalWindow = globalThis as typeof globalThis & {
    requestIdleCallback?: (callback: IdleCallback) => IdleHandle;
    cancelIdleCallback?: (handle: IdleHandle) => void;
  };

  let started = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let idleHandle: IdleHandle | null = null;

  const start = () => {
    if (started) {
      return;
    }

    started = true;
    session.scheduledPrewarm = null;
    void ensureHexmapStaticLoad(manifest, { source: "home" });
  };

  if (typeof globalWindow.requestIdleCallback === "function") {
    idleHandle = globalWindow.requestIdleCallback(() => {
      start();
    });
  } else {
    timeoutHandle = setTimeout(start, 120);
  }

  const cancel = () => {
    if (started) {
      return;
    }

    if (idleHandle !== null && typeof globalWindow.cancelIdleCallback === "function") {
      globalWindow.cancelIdleCallback(idleHandle);
    }

    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
    }

    session.scheduledPrewarm = null;
  };

  session.scheduledPrewarm = { cancel };
  return cancel;
}

export function resetHexmapStaticLoaderForTests(): void {
  sessions.clear();
}
