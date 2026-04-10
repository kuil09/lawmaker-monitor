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
  realEstateTotal?: number | null;
  assetTotal?: number | null;
};

export type CachedHexCell = {
  h3Index: string;
  districtKey: string;
  districtLabel: string;
  provinceShortName: string;
};

const PROVINCE_NAME_VARIANTS = [
  { shortName: "서울", fullNames: ["서울특별시"] },
  { shortName: "부산", fullNames: ["부산광역시"] },
  { shortName: "대구", fullNames: ["대구광역시"] },
  { shortName: "인천", fullNames: ["인천광역시"] },
  { shortName: "광주", fullNames: ["광주광역시"] },
  { shortName: "대전", fullNames: ["대전광역시"] },
  { shortName: "울산", fullNames: ["울산광역시"] },
  { shortName: "세종", fullNames: ["세종특별자치시"] },
  { shortName: "경기", fullNames: ["경기도"] },
  { shortName: "강원", fullNames: ["강원도", "강원특별자치도"] },
  { shortName: "충북", fullNames: ["충청북도"] },
  { shortName: "충남", fullNames: ["충청남도"] },
  { shortName: "전북", fullNames: ["전라북도", "전북특별자치도"] },
  { shortName: "전남", fullNames: ["전라남도"] },
  { shortName: "경북", fullNames: ["경상북도"] },
  { shortName: "경남", fullNames: ["경상남도"] },
  { shortName: "제주", fullNames: ["제주특별자치도"] }
] as const;

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

function getMetricValue(item: SummaryItem, metric: MapMetric): number | null {
  if (metric === "absence") {
    return item.absentRate;
  }

  if (metric === "realEstate") {
    return item.realEstateTotal ?? null;
  }

  if (metric === "assetTotal") {
    return item.assetTotal ?? null;
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

function buildDistrictLookupKeys(value: string | null | undefined): string[] {
  const baseKey = normalizeConstituencyLookupKey(value);
  if (!baseKey) {
    return [];
  }

  const candidates = new Set<string>([baseKey]);
  const queue = [baseKey];

  while (queue.length > 0) {
    const current = queue.shift() ?? "";
    if (!current) {
      continue;
    }

    const suffixShortened = current
      .replace(/특별자치시/g, "시")
      .replace(/특별자치도/g, "도")
      .replace(/특별시/g, "")
      .replace(/광역시/g, "");

    if (!candidates.has(suffixShortened)) {
      candidates.add(suffixShortened);
      queue.push(suffixShortened);
    }

    for (const province of PROVINCE_NAME_VARIANTS) {
      for (const fullName of province.fullNames) {
        const normalizedFullName = normalizeConstituencyLookupKey(fullName);
        if (current.startsWith(normalizedFullName)) {
          const shortened = `${province.shortName}${current.slice(normalizedFullName.length)}`;
          if (!candidates.has(shortened)) {
            candidates.add(shortened);
            queue.push(shortened);
          }
        }
      }

      if (
        current.startsWith(`${province.shortName}${province.shortName}시`) ||
        current.startsWith(`${province.shortName}${province.shortName}도`)
      ) {
        const collapsedDuplicate = current.slice(province.shortName.length);
        if (!candidates.has(collapsedDuplicate)) {
          candidates.add(collapsedDuplicate);
          queue.push(collapsedDuplicate);
        }
      }

      if (current.startsWith(`${province.shortName}시`) || current.startsWith(`${province.shortName}도`)) {
        const duplicatedPrefix = `${province.shortName}${current}`;
        if (!candidates.has(duplicatedPrefix)) {
          candidates.add(duplicatedPrefix);
          queue.push(duplicatedPrefix);
        }
      }
    }
  }

  return [...candidates];
}

function buildSummaryLookup(items: readonly SummaryItem[]): Map<string, SummaryItem[]> {
  const byDistrictKey = new Map<string, SummaryItem[]>();

  for (const item of items) {
    const districtKeys = buildDistrictLookupKeys(item.district);
    if (districtKeys.length === 0) {
      continue;
    }

    for (const districtKey of districtKeys) {
      const existing = byDistrictKey.get(districtKey);
      if (existing) {
        existing.push(item);
        continue;
      }

      byDistrictKey.set(districtKey, [item]);
    }
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

  return cachedCells.map((cell) => {
    const members = memberByDistrictKey.get(cell.districtKey);
    if (!members || members.length === 0) {
      return {
        h3Index: cell.h3Index,
        districtKey: cell.districtKey,
        districtLabel: cell.districtLabel,
        provinceShortName: cell.provinceShortName,
        party: "",
        metric: 0,
        memberCount: 0,
        metricMemberCount: 0,
        memberNames: [],
        memberParties: [],
        memberIds: []
      };
    }

    const membersWithMetric = members.flatMap((member) => {
      const metricValue = getMetricValue(member, metric);
      return metricValue == null ? [] : [{ member, metricValue }] as const;
    });

    const averageMetric =
      membersWithMetric.length > 0
        ? membersWithMetric.reduce((sum, entry) => sum + entry.metricValue, 0) / membersWithMetric.length
        : 0;

    return {
      h3Index: cell.h3Index,
      districtKey: cell.districtKey,
      districtLabel: cell.districtLabel,
      provinceShortName: cell.provinceShortName,
      party: getDominantParty(members),
      metric: averageMetric,
      memberCount: members.length,
      metricMemberCount: membersWithMetric.length,
      memberNames: members.map((member) => member.name),
      memberParties: members.map((member) => member.party),
      memberIds: members.map((member) => member.memberId)
    };
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
