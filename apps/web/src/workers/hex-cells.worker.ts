/// <reference lib="webworker" />

import { polygonToCells } from "h3-js";

import type { ConstituencyBoundaryTopology } from "../lib/constituency-map.js";
import { normalizeConstituencyLookupKey } from "../lib/constituency-map.js";
import type { H3DataCell } from "../lib/geo-utils.js";
import { extractReprojectedFeatures, getDetailRes, getPartyColor } from "../lib/geo-utils.js";
import type { MapMetric } from "../lib/map-route.js";

// AccountabilitySummaryItem의 필요 필드만 추출 (런타임 Zod 의존 없음)
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

type HexCellsWorkerInput = {
  type: "COMPUTE";
  topology: ConstituencyBoundaryTopology;
  items: SummaryItem[];
  vizKey: MapMetric;
};

export type HexCellsWorkerOutput =
  | { type: "RESULT"; cells: H3DataCell[] }
  | { type: "ERROR"; message: string };

function getMetricValue(item: SummaryItem, vizKey: MapMetric): number {
  if (vizKey === "absence") return item.absentRate;
  if (vizKey === "negative") return item.noRate + item.abstainRate;
  if (vizKey === "committee") return item.committeeParticipationRate;
  return 0;
}

self.onmessage = (event: MessageEvent<HexCellsWorkerInput>) => {
  const { topology, items, vizKey } = event.data;

  try {
    // bounds 계산용 축소본 (getDetailRes에서만 사용)
    const reducedFeatures = extractReprojectedFeatures(topology, 20);
    const detailRes = getDetailRes(reducedFeatures);

    // polygonToCells용 풀해상도 features
    const fullResFeatures = extractReprojectedFeatures(topology, 1);

    const memberByKey = new Map(
      items.map(item => [normalizeConstituencyLookupKey(item.district), item])
    );

    const result: H3DataCell[] = [];

    for (const feature of fullResFeatures) {
      const member = memberByKey.get(feature.properties.districtKey);
      if (!member) continue;

      const metric = getMetricValue(member, vizKey);

      const polys = feature.geometry.type === "Polygon"
        ? [(feature.geometry.coordinates as number[][][])]
        : (feature.geometry.coordinates as number[][][][]);

      for (const poly of polys) {
        try {
          const cells = polygonToCells(poly as number[][][], detailRes, true);
          for (const h3Index of cells) {
            result.push({
              h3Index,
              party: member.party,
              metric,
              memberCount: 1,
              memberNames: [member.name],
              memberParties: [member.party],
              memberIds: [member.memberId]
            });
          }
        } catch {
          // 폴리곤이 너무 작거나 비정상인 경우 무시
        }
      }
    }

    const response: HexCellsWorkerOutput = { type: "RESULT", cells: result };
    self.postMessage(response);
  } catch (err) {
    const response: HexCellsWorkerOutput = {
      type: "ERROR",
      message: (err as Error).message ?? "알 수 없는 워커 오류"
    };
    self.postMessage(response);
  }
};

// getPartyColor을 import해서 워커 번들에 포함시킴 (tree-shake 방지)
void getPartyColor;
