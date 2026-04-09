import { useCallback, useEffect, useRef } from "react";

import type { ConstituencyBoundaryTopology } from "./constituency-map.js";
import type { StaticHexCellsResult } from "./hex-cells.js";
import type { HexCellsWorkerOutput } from "../workers/hex-cells.worker.js";

type PendingRequest = {
  resolve: (value: StaticHexCellsResult) => void;
  reject: (reason?: unknown) => void;
};

export function useHexCellsWorker() {
  const workerRef = useRef<Worker | null>(null);
  const nextRequestIdRef = useRef(1);
  const pendingRequestsRef = useRef<Map<number, PendingRequest>>(new Map());

  useEffect(() => {
    const worker = new Worker(
      new URL("../workers/hex-cells.worker.ts", import.meta.url),
      { type: "module" }
    );

    worker.onmessage = (event: MessageEvent<HexCellsWorkerOutput>) => {
      const pending = pendingRequestsRef.current.get(event.data.requestId);
      if (!pending) {
        return;
      }

      pendingRequestsRef.current.delete(event.data.requestId);

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
      for (const pending of pendingRequestsRef.current.values()) {
        pending.reject(error);
      }
      pendingRequestsRef.current.clear();
    };

    workerRef.current = worker;

    return () => {
      worker.terminate();
      workerRef.current = null;
      const error = new Error("Worker terminated.");
      for (const pending of pendingRequestsRef.current.values()) {
        pending.reject(error);
      }
      pendingRequestsRef.current.clear();
    };
  }, []);

  const computeStatic = useCallback((
    topology: ConstituencyBoundaryTopology,
    provinceShortName: string
  ): Promise<StaticHexCellsResult> => {
    const worker = workerRef.current;

    if (!worker) {
      return Promise.reject(new Error("Worker not available."));
    }

    const requestId = nextRequestIdRef.current++;

    return new Promise((resolve, reject) => {
      pendingRequestsRef.current.set(requestId, { resolve, reject });
      worker.postMessage({
        type: "COMPUTE_STATIC",
        requestId,
        topology,
        provinceShortName
      });
    });
  }, []);

  return { computeStatic };
}
