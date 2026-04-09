import type { H3DataCell } from "./geo-utils.js";
import type { CachedHexCell } from "./hex-cells.js";
import type { MapMetric } from "./map-route.js";

export type HexCellStaticCacheEntry = {
  cacheKey: string;
  provinceShortName: string;
  detailRes: number;
  createdAt: number;
  cells: CachedHexCell[];
};

export type HexCellStaticCacheReadResult = {
  entry: HexCellStaticCacheEntry | null;
  source: "memory" | "indexeddb" | "miss";
};

export type HexCellStaticCacheStore = {
  get(cacheKey: string): Promise<HexCellStaticCacheEntry | null>;
  set(entry: HexCellStaticCacheEntry): Promise<void>;
};

export type HexCellHydrationArgs = {
  staticKey: string;
  summarySnapshotId: string | null | undefined;
  metric: MapMetric;
  compute: () => H3DataCell[];
};

const DB_NAME = "lawmaker-monitor-hex-cells";
const STORE_NAME = "province-static-cells";

function buildHydratedKey(
  staticKey: string,
  summarySnapshotId: string | null | undefined,
  metric: MapMetric
): string {
  return `${staticKey}::${summarySnapshotId ?? "unknown"}::${metric}`;
}

function createNoopStore(): HexCellStaticCacheStore {
  return {
    async get() {
      return null;
    },
    async set() {}
  };
}

function createIndexedDbStore(): HexCellStaticCacheStore {
  if (typeof indexedDB === "undefined") {
    return createNoopStore();
  }

  let dbPromise: Promise<IDBDatabase> | null = null;

  function openDatabase(): Promise<IDBDatabase> {
    if (dbPromise) {
      return dbPromise;
    }

    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);

      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: "cacheKey" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB."));
    });

    return dbPromise;
  }

  function runRequest<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
    });
  }

  return {
    async get(cacheKey) {
      try {
        const database = await openDatabase();
        const transaction = database.transaction(STORE_NAME, "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const entry = await runRequest(store.get(cacheKey) as IDBRequest<HexCellStaticCacheEntry | undefined>);
        return entry ?? null;
      } catch {
        return null;
      }
    },
    async set(entry) {
      try {
        const database = await openDatabase();
        const transaction = database.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        await runRequest(store.put(entry));
      } catch {
        return;
      }
    }
  };
}

export function buildHexCellStaticCacheKey(
  boundarySnapshotId: string,
  provinceChecksumSha256: string
): string {
  return `${boundarySnapshotId}:${provinceChecksumSha256}`;
}

export function createHexCellCache(store: HexCellStaticCacheStore = createIndexedDbStore()) {
  const staticMemory = new Map<string, HexCellStaticCacheEntry>();
  const hydratedMemory = new Map<string, H3DataCell[]>();

  return {
    async readStatic(cacheKey: string): Promise<HexCellStaticCacheReadResult> {
      const inMemory = staticMemory.get(cacheKey);
      if (inMemory) {
        return { entry: inMemory, source: "memory" };
      }

      const stored = await store.get(cacheKey);
      if (stored) {
        staticMemory.set(cacheKey, stored);
        return { entry: stored, source: "indexeddb" };
      }

      return { entry: null, source: "miss" };
    },
    async writeStatic(entry: HexCellStaticCacheEntry): Promise<void> {
      staticMemory.set(entry.cacheKey, entry);
      await store.set(entry);
    },
    getOrCreateHydratedCells(args: HexCellHydrationArgs): H3DataCell[] {
      const hydrationKey = buildHydratedKey(
        args.staticKey,
        args.summarySnapshotId,
        args.metric
      );
      const cached = hydratedMemory.get(hydrationKey);
      if (cached) {
        return cached;
      }

      const cells = args.compute();
      hydratedMemory.set(hydrationKey, cells);
      return cells;
    }
  };
}

export type HexCellCache = ReturnType<typeof createHexCellCache>;
