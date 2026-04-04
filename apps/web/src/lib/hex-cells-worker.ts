import { useCallback, useEffect, useRef, useState } from "react";

import type { ConstituencyBoundaryTopology } from "./constituency-map.js";
import type { H3DataCell } from "./geo-utils.js";
import type { MapMetric } from "./map-route.js";
import type { HexCellsWorkerOutput } from "../workers/hex-cells.worker.js";

type SummaryItem = {
  memberId: string;
  name: string;
  party: string;
  district: string;
  absentRate: number;
  noRate: number;
  abstainRate: number;
  committeeParticipationRate: number;
};

export type HexCellsStatus = "idle" | "loading" | "done" | "error";

export function useHexCellsWorker() {
  const workerRef = useRef<Worker | null>(null);
  const [cells, setCells] = useState<H3DataCell[]>([]);
  const [status, setStatus] = useState<HexCellsStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const worker = new Worker(
      new URL("../workers/hex-cells.worker.ts", import.meta.url),
      { type: "module" }
    );
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const compute = useCallback((
    topology: ConstituencyBoundaryTopology,
    items: SummaryItem[],
    vizKey: MapMetric
  ) => {
    const worker = workerRef.current;
    if (!worker) return;

    setStatus("loading");
    setCells([]);
    setError(null);

    // onmessage를 매 compute 호출마다 교체 → stale 결과 자동 폐기
    worker.onmessage = (event: MessageEvent<HexCellsWorkerOutput>) => {
      if (event.data.type === "RESULT") {
        setCells(event.data.cells);
        setStatus("done");
      } else {
        setError(event.data.message);
        setStatus("error");
      }
    };

    worker.onerror = (e) => {
      setError(e.message ?? "워커 오류");
      setStatus("error");
    };

    worker.postMessage({ type: "COMPUTE", topology, items, vizKey });
  }, []);

  return { cells, status, error, compute };
}
