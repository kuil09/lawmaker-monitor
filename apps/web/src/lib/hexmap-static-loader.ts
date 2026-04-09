import type { ConstituencyBoundariesIndexExport, Manifest } from "@lawmaker-monitor/schemas";

import type { ConstituencyBoundaryTopology } from "./constituency-map.js";
import {
  getConstituencyBoundariesIndexPath,
  loadConstituencyBoundariesIndex,
  loadConstituencyProvinceTopology
} from "./data.js";
import {
  buildHexCellStaticCacheKey,
  getSharedHexCellCache,
  type HexCellStaticCacheEntry
} from "./hex-cell-cache.js";
import { endPerformanceSpan, startPerformanceSpan } from "./hex-cells.js";
import { getSharedHexCellsWorkerClient } from "./hex-cells-worker.js";

type HexmapLoadSource = "home" | "map";
type Listener = (state: HexmapStaticState) => void;
type IdleHandle = number;
type IdleCallback = (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void;

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
  session.homeFirstProvinceMarked = false;
  session.state = {
    ...createInitialState(session.key),
    snapshotId
  };
  emit(session);
}

async function ensureIndex(
  session: Session,
  manifest?: Manifest | null
): Promise<ConstituencyBoundariesIndexExport | null> {
  const index = await loadConstituencyBoundariesIndex(manifest);
  if (!index) {
    return null;
  }

  if (session.state.snapshotId !== index.snapshotId) {
    resetSessionForSnapshot(session, index.snapshotId);
  }

  if (session.state.total !== index.provinces.length) {
    session.state = {
      ...session.state,
      total: index.provinces.length,
      done: session.completedProvinceKeys.size
    };
    emit(session);
  }

  return index;
}

async function loadProvinceEntry(
  session: Session,
  province: ConstituencyBoundariesIndexExport["provinces"][number],
  snapshotId: string
): Promise<HexCellStaticCacheEntry | null> {
  const cacheKey = buildHexCellStaticCacheKey(snapshotId, province.checksumSha256);
  const existingPromise = session.provincePromises.get(cacheKey);
  if (existingPromise) {
    return existingPromise;
  }

  const cache = getSharedHexCellCache();
  const workerClient = getSharedHexCellsWorkerClient();

  const provincePromise = (async () => {
    const idbSpan = startPerformanceSpan(`hexmap:${province.provinceShortName}:idbRead`);
    const cached = await cache.readStatic(cacheKey);
    endPerformanceSpan(idbSpan);

    if (cached.entry) {
      return cached.entry;
    }

    const topologySpan = startPerformanceSpan(`hexmap:${province.provinceShortName}:topologyFetch`);
    const topology = await loadConstituencyProvinceTopology<ConstituencyBoundaryTopology>(
      province.path
    );
    endPerformanceSpan(topologySpan);

    if (!topology) {
      return null;
    }

    const computed = await workerClient.computeStatic(topology, province.provinceShortName);
    const entry: HexCellStaticCacheEntry = {
      cacheKey,
      provinceShortName: province.provinceShortName,
      detailRes: computed.detailRes,
      createdAt: Date.now(),
      cells: computed.cells
    };

    await cache.writeStatic(entry);
    return entry;
  })();

  session.provincePromises.set(cacheKey, provincePromise);

  try {
    return await provincePromise;
  } finally {
    session.provincePromises.delete(cacheKey);
  }
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
    const index = await ensureIndex(session, manifest);
    if (!index || index.provinces.length === 0) {
      throw new Error("선거구 경계 데이터를 불러오지 못했습니다.");
    }

    for (const province of index.provinces) {
      const cacheKey = buildHexCellStaticCacheKey(index.snapshotId, province.checksumSha256);

      if (!session.completedProvinceKeys.has(cacheKey)) {
        const entry = await loadProvinceEntry(session, province, index.snapshotId);
        if (entry && !session.entryByCacheKey.has(cacheKey)) {
          session.entryByCacheKey.set(cacheKey, entry);
          session.state = {
            ...session.state,
            entries: [...session.state.entries, entry]
          };

          if (source === "home" && !session.homeFirstProvinceMarked) {
            session.homeFirstProvinceMarked = true;
            markInstant("hexmap:homePrewarmFirstProvinceReady");
          }
        }

        session.completedProvinceKeys.add(cacheKey);
        session.state = {
          ...session.state,
          done: session.completedProvinceKeys.size
        };
        emit(session);
      }
    }

    session.state = {
      ...session.state,
      done: index.provinces.length,
      total: index.provinces.length,
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
  return getConstituencyBoundariesIndexPath(manifest);
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
