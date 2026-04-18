import { useRef } from "react";

import type { ConstituencyBoundaryTopology } from "./constituency-map.js";
import type { StaticHexCellsResult } from "./hex-cells.js";
import type { HexCellsWorkerOutput } from "../workers/hex-cells.worker.js";

type PendingRequest = {
  resolve: (value: StaticHexCellsResult) => void;
  reject: (reason?: unknown) => void;
};

export type HexCellsWorkerClient = {
  computeStatic: (
    topology: ConstituencyBoundaryTopology,
    provinceShortName: string
  ) => Promise<StaticHexCellsResult>;
};

function createHexCellsWorkerClient(): HexCellsWorkerClient {
  const worker = new Worker(
    new URL("../workers/hex-cells.worker.ts", import.meta.url),
    { type: "module" }
  );
  const pendingRequests = new Map<number, PendingRequest>();
  let nextRequestId = 1;

  worker.onmessage = (event: MessageEvent<HexCellsWorkerOutput>) => {
    const pending = pendingRequests.get(event.data.requestId);
    if (!pending) {
      return;
    }

    pendingRequests.delete(event.data.requestId);

    if (event.data.type === "RESULT") {
      pending.resolve({
        cells: event.data.cells,
        detailRes: event.data.detailRes,
        timings: event.data.timings
      });
      return;
    }

    pending.reject(new Error(event.data.message));
  };

  worker.onerror = (event) => {
    const error = new Error(event.message ?? "Worker error.");
    for (const pending of pendingRequests.values()) {
      pending.reject(error);
    }
    pendingRequests.clear();
  };

  return {
    computeStatic(
      topology: ConstituencyBoundaryTopology,
      provinceShortName: string
    ): Promise<StaticHexCellsResult> {
      const requestId = nextRequestId++;

      return new Promise((resolve, reject) => {
        pendingRequests.set(requestId, { resolve, reject });
        worker.postMessage({
          type: "COMPUTE_STATIC",
          requestId,
          topology,
          provinceShortName
        });
      });
    }
  };
}

let sharedHexCellsWorkerClient: HexCellsWorkerClient | null = null;

export function getSharedHexCellsWorkerClient(): HexCellsWorkerClient {
  if (!sharedHexCellsWorkerClient) {
    sharedHexCellsWorkerClient = createHexCellsWorkerClient();
  }

  return sharedHexCellsWorkerClient;
}

export function setSharedHexCellsWorkerClientForTests(
  client: HexCellsWorkerClient | null
): void {
  sharedHexCellsWorkerClient = client;
}

export function useHexCellsWorker(): HexCellsWorkerClient {
  const workerClientRef = useRef<HexCellsWorkerClient | null>(null);

  if (!workerClientRef.current) {
    workerClientRef.current = getSharedHexCellsWorkerClient();
  }

  return workerClientRef.current;
}
