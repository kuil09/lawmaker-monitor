import proj4 from "proj4";
import { feature } from "topojson-client";

import type { ConstituencyBoundaryTopology } from "./constituency-map.js";
import { normalizeConstituencyLookupKey } from "./constituency-map.js";

// Korean TM projection (EPSG:5179) -> WGS84 (EPSG:4326)
const KOREAN_TM = "+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs";
const WGS84 = "+proj=longlat +datum=WGS84 +no_defs";

function toWgs84(x: number, y: number): [number, number] {
  if (Math.abs(x) > 180 || Math.abs(y) > 90) {
    return proj4(KOREAN_TM, WGS84, [x, y]) as [number, number];
  }
  return [x, y];
}

// At zoom 6-7, one sampled vertex out of 20 still preserves constituency outlines.
function reprojectRing(ring: number[][], step = 20): number[][] {
  const result: number[][] = [];
  for (let i = 0; i < ring.length; i++) {
    if (i === 0 || i === ring.length - 1 || i % step === 0) {
      const point = ring[i];
      const [x, y] = point ?? [];
      if (x === undefined || y === undefined) continue;
      result.push(toWgs84(x, y));
    }
  }
  return result;
}

function reprojectGeometry(geometry: { type: string; coordinates: unknown }, step = 20): { type: string; coordinates: unknown } {
  if (geometry.type === "Polygon") {
    return {
      type: "Polygon",
      coordinates: (geometry.coordinates as number[][][]).map(ring => reprojectRing(ring, step))
    };
  }
  if (geometry.type === "MultiPolygon") {
    return {
      type: "MultiPolygon",
      coordinates: (geometry.coordinates as number[][][][]).map(poly => poly.map(ring => reprojectRing(ring, step)))
    };
  }
  return geometry;
}

export type ExtrudedFeature = {
  type: "Feature";
  geometry: { type: string; coordinates: unknown };
  properties: {
    districtKey: string;
    label: string;
  };
};

export function extractReprojectedFeatures(topology: ConstituencyBoundaryTopology, step = 20): ExtrudedFeature[] {
  const collection = feature(
    topology,
    topology.objects.constituencies
  ) as {
    type: "FeatureCollection";
    features: Array<{
      type: "Feature";
      properties: Record<string, unknown>;
      geometry: { type: string; coordinates: unknown };
    }>;
  };

  return collection.features.map(f => {
    const label = (f.properties.memberDistrictLabel as string | undefined) ?? "";
    return {
      type: "Feature" as const,
      geometry: reprojectGeometry(f.geometry, step),
      properties: {
        districtKey: normalizeConstituencyLookupKey(label),
        label
      }
    };
  });
}

export type MemberGeoPoint = {
  longitude: number;
  latitude: number;
  districtKey: string;
  label: string;
};

// Approximate a visual centroid from sampled outer-ring vertices.
function computeCentroid(ring: number[][], step = 50): [number, number] {
  let sumLng = 0, sumLat = 0, count = 0;
  for (let i = 0; i < ring.length; i += step) {
    const point = ring[i];
    const [x, y] = point ?? [];
    if (x === undefined || y === undefined) continue;
    const [lng, lat] = toWgs84(x, y);
    sumLng += lng;
    sumLat += lat;
    count++;
  }
  if (count === 0) return [0, 0];
  return [sumLng / count, sumLat / count];
}

// Shared H3 visualization types and constants.

export type H3DataCell = {
  h3Index: string;
  districtKey: string;
  districtLabel: string;
  provinceShortName: string;
  party: string;
  metric: number;
  memberCount: number;
  memberNames: string[];
  memberParties: string[];
  memberIds: string[];
};

export type H3BgCell = {
  h3Index: string;
};

export const PARTY_COLORS: Record<string, [number, number, number, number]> = {
  "더불어민주당": [30,  100, 210, 230],
  "국민의힘":     [220,  50,  32, 230],
  "조국혁신당":   [0,   170, 120, 230],
  "개혁신당":     [230, 120,   0, 230],
  "진보당":       [170,   0,  50, 230],
  "기본소득당":   [100,  60, 180, 230],
  "사회민주당":   [80,  160,  80, 230],
};

export function getPartyColor(party: string): [number, number, number, number] {
  return PARTY_COLORS[party] ?? [130, 130, 130, 230];
}

// t is a normalized value in [0, 1].
// t=0 -> lighter via white blend, t=0.5 -> base party color, t=1 -> darker via black blend.
export function getMetricModulatedColor(
  party: string,
  t: number
): [number, number, number, number] {
  const [r, g, b, a] = getPartyColor(party);
  if (t <= 0.5) {
    const whiteMix = (0.5 - t) * 1.2;
    return [
      Math.round(r + (255 - r) * whiteMix),
      Math.round(g + (255 - g) * whiteMix),
      Math.round(b + (255 - b) * whiteMix),
      a
    ];
  } else {
    const darkMix = (t - 0.5) * 0.5;
    return [
      Math.round(r * (1 - darkMix)),
      Math.round(g * (1 - darkMix)),
      Math.round(b * (1 - darkMix)),
      a
    ];
  }
}

export function createLogNormalizer(values: readonly number[]): (raw: number) => number {
  if (values.length === 0) return () => 0;

  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }

  const range = max - min || 1;

  return (raw: number) => {
    const x = Math.max(0, Math.min(1, (raw - min) / range));
    return Math.log1p(x * 9) / Math.log1p(9);
  };
}

// Select H3 resolution from feature span. Step=20 reduced features are sufficient here.
export function getDetailRes(features: ExtrudedFeature[]): number {
  let minLng = 180, maxLng = -180, minLat = 90, maxLat = -90;
  for (const f of features) {
    const polys = f.geometry.type === "Polygon"
      ? [(f.geometry.coordinates as number[][][])]
      : (f.geometry.coordinates as number[][][][]);
    for (const poly of polys) {
      for (const ring of poly) {
        for (const point of ring) {
          const [lng, lat] = point;
          if (lng === undefined || lat === undefined) continue;
          if (lng < minLng) minLng = lng;
          if (lng > maxLng) maxLng = lng;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
        }
      }
    }
  }
  const span = Math.max(maxLng - minLng, (maxLat - minLat) * 1.3);
  if (span > 2) return 6;
  if (span > 0.8) return 7;
  return 8;
}

export function extractCentroids(topology: ConstituencyBoundaryTopology): MemberGeoPoint[] {
  const collection = feature(
    topology,
    topology.objects.constituencies
  ) as {
    type: "FeatureCollection";
    features: Array<{
      type: "Feature";
      properties: Record<string, unknown>;
      geometry: { type: string; coordinates: unknown };
    }>;
  };

  return collection.features.flatMap(f => {
    const label = (f.properties.memberDistrictLabel as string | undefined) ?? "";
    if (!label) return [];

    let ring: number[][];
    if (f.geometry.type === "Polygon") {
      const polygon = f.geometry.coordinates as number[][][];
      const firstRing = polygon[0];
      if (!firstRing) return [];
      ring = firstRing;
    } else if (f.geometry.type === "MultiPolygon") {
      const polys = f.geometry.coordinates as number[][][][];
      const firstRing = polys[0]?.[0];
      if (!firstRing) return [];
      ring = polys.reduce(
        (best, poly) => {
          const candidate = poly[0];
          if (!candidate) return best;
          return candidate.length > best.length ? candidate : best;
        },
        firstRing
      );
    } else {
      return [];
    }

    const [longitude, latitude] = computeCentroid(ring);
    return [{
      longitude,
      latitude,
      districtKey: normalizeConstituencyLookupKey(label),
      label
    }];
  });
}
