import { cellToBoundary, polygonToCells } from "h3-js";

import type { ConstituencyBoundaryTopology } from "./constituency-map.js";
import { normalizeConstituencyLookupKey } from "./constituency-map.js";
import type { H3DataCell } from "./geo-utils.js";
import { extractReprojectedFeatures, getDetailRes } from "./geo-utils.js";
import type { MapMetric } from "./map-route.js";

export type SummaryItem = {
  memberId: string;
  name: string;
  party: string;
  district: string;
  absentRate: number;
  noRate: number;
  abstainRate: number;
};

export type CachedHexCell = {
  h3Index: string;
  districtKey: string;
  districtLabel: string;
  provinceShortName: string;
};

export type PerformanceSpan = {
  label: string;
  startMark: string;
  endMark: string;
  startTime: number;
};

export type StaticHexTimings = {
  reducedFeaturesMs: number;
  fullFeaturesMs: number;
  polygonToCellsMs: number;
  staticHexComputeMs: number;
};

export type StaticHexCellsResult = {
  cells: CachedHexCell[];
  detailRes: number;
  timings: StaticHexTimings;
};

let performanceSequence = 0;

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function startPerformanceSpan(label: string): PerformanceSpan {
  const suffix = `${performanceSequence++}`;
  const startMark = `${label}:start:${suffix}`;
  const endMark = `${label}:end:${suffix}`;

  if (typeof performance !== "undefined" && typeof performance.mark === "function") {
    performance.mark(startMark);
  }

  return {
    label,
    startMark,
    endMark,
    startTime: now()
  };
}

export function endPerformanceSpan(span: PerformanceSpan): number {
  const durationMs = now() - span.startTime;

  if (
    typeof performance !== "undefined" &&
    typeof performance.mark === "function" &&
    typeof performance.measure === "function"
  ) {
    performance.mark(span.endMark);
    performance.measure(span.label, span.startMark, span.endMark);
  }

  return durationMs;
}

function getMetricValue(item: SummaryItem, metric: MapMetric): number {
  if (metric === "absence") {
    return item.absentRate;
  }

  return item.noRate + item.abstainRate;
}

function getDominantParty(items: SummaryItem[]): string {
  const partyCounts = new Map<string, number>();

  for (const item of items) {
    partyCounts.set(item.party, (partyCounts.get(item.party) ?? 0) + 1);
  }

  return (
    [...partyCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ??
    ""
  );
}

function buildSummaryLookup(items: readonly SummaryItem[]): Map<string, SummaryItem[]> {
  const byDistrictKey = new Map<string, SummaryItem[]>();

  for (const item of items) {
    const districtKey = normalizeConstituencyLookupKey(item.district);
    if (!districtKey) {
      continue;
    }

    const existing = byDistrictKey.get(districtKey);
    if (existing) {
      existing.push(item);
      continue;
    }

    byDistrictKey.set(districtKey, [item]);
  }

  return byDistrictKey;
}

export function buildStaticHexCells(
  topology: ConstituencyBoundaryTopology,
  provinceShortName: string
): StaticHexCellsResult {
  const totalSpan = startPerformanceSpan(`hexmap:${provinceShortName}:staticHexCompute`);
  const reducedSpan = startPerformanceSpan(`hexmap:${provinceShortName}:reducedFeatures`);
  const reducedFeatures = extractReprojectedFeatures(topology, 20);
  const reducedFeaturesMs = endPerformanceSpan(reducedSpan);

  const detailRes = getDetailRes(reducedFeatures);

  const fullSpan = startPerformanceSpan(`hexmap:${provinceShortName}:fullFeatures`);
  const fullFeatures = extractReprojectedFeatures(topology, 1);
  const fullFeaturesMs = endPerformanceSpan(fullSpan);

  const polygonSpan = startPerformanceSpan(`hexmap:${provinceShortName}:polygonToCells`);
  const cells: CachedHexCell[] = [];

  for (const feature of fullFeatures) {
    const polygons =
      feature.geometry.type === "Polygon"
        ? [feature.geometry.coordinates as number[][][]]
        : (feature.geometry.coordinates as number[][][][]);

    for (const polygon of polygons) {
      try {
        const polygonCells = polygonToCells(polygon as number[][][], detailRes, true);
        for (const h3Index of polygonCells) {
          cells.push({
            h3Index,
            districtKey: feature.properties.districtKey,
            districtLabel: feature.properties.label,
            provinceShortName
          });
        }
      } catch {
        continue;
      }
    }
  }

  const polygonToCellsMs = endPerformanceSpan(polygonSpan);

  return {
    cells,
    detailRes,
    timings: {
      reducedFeaturesMs,
      fullFeaturesMs,
      polygonToCellsMs,
      staticHexComputeMs: endPerformanceSpan(totalSpan)
    }
  };
}

export function hydrateHexCells(
  cachedCells: readonly CachedHexCell[],
  items: readonly SummaryItem[],
  metric: MapMetric
): H3DataCell[] {
  const memberByDistrictKey = buildSummaryLookup(items);

  return cachedCells.flatMap((cell) => {
    const members = memberByDistrictKey.get(cell.districtKey);
    if (!members || members.length === 0) {
      return [];
    }

    const averageMetric =
      members.reduce((sum, member) => sum + getMetricValue(member, metric), 0) / members.length;

    return [{
      h3Index: cell.h3Index,
      districtKey: cell.districtKey,
      districtLabel: cell.districtLabel,
      provinceShortName: cell.provinceShortName,
      party: getDominantParty(members),
      metric: averageMetric,
      memberCount: members.length,
      memberNames: members.map((member) => member.name),
      memberParties: members.map((member) => member.party),
      memberIds: members.map((member) => member.memberId)
    }];
  });
}

export function getHexCellsBounds(
  cells: ReadonlyArray<Pick<CachedHexCell, "h3Index"> | Pick<H3DataCell, "h3Index">>
): [[number, number], [number, number]] | null {
  let minLng = Number.POSITIVE_INFINITY;
  let maxLng = Number.NEGATIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;

  for (const cell of cells) {
    let boundary: Array<[number, number]>;

    try {
      boundary = cellToBoundary(cell.h3Index) as Array<[number, number]>;
    } catch {
      continue;
    }

    for (const point of boundary) {
      const [lat, lng] = point;
      if (lat === undefined || lng === undefined) {
        continue;
      }

      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }

  if (
    !Number.isFinite(minLng) ||
    !Number.isFinite(maxLng) ||
    !Number.isFinite(minLat) ||
    !Number.isFinite(maxLat)
  ) {
    return null;
  }

  return [
    [minLng, minLat],
    [maxLng, maxLat]
  ];
}
