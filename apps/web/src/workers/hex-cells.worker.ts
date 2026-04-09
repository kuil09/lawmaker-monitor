/// <reference lib="webworker" />

import type { ConstituencyBoundaryTopology } from "../lib/constituency-map.js";
import type { CachedHexCell, StaticHexTimings } from "../lib/hex-cells.js";
import { buildStaticHexCells } from "../lib/hex-cells.js";

type HexCellsWorkerInput = {
  type: "COMPUTE_STATIC";
  requestId: number;
  topology: ConstituencyBoundaryTopology;
  provinceShortName: string;
};

export type HexCellsWorkerOutput =
  | {
      type: "RESULT";
      requestId: number;
      cells: CachedHexCell[];
      detailRes: number;
      timings: StaticHexTimings;
    }
  | {
      type: "ERROR";
      requestId: number;
      message: string;
    };

self.onmessage = (event: MessageEvent<HexCellsWorkerInput>) => {
  const { requestId, topology, provinceShortName } = event.data;

  try {
    const result = buildStaticHexCells(topology, provinceShortName);
    const response: HexCellsWorkerOutput = {
      type: "RESULT",
      requestId,
      cells: result.cells,
      detailRes: result.detailRes,
      timings: result.timings
    };
    self.postMessage(response);
  } catch (error) {
    const response: HexCellsWorkerOutput = {
      type: "ERROR",
      requestId,
      message: (error as Error).message ?? "Unknown worker error."
    };
    self.postMessage(response);
  }
};
