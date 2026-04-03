import proj4 from "proj4";
import { feature } from "topojson-client";

import type { ConstituencyBoundaryTopology } from "./constituency-map.js";
import { normalizeConstituencyLookupKey } from "./constituency-map.js";

// 한국 TM 투영좌표계 (EPSG:5179) → WGS84 (EPSG:4326) 변환
const KOREAN_TM = "+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs";
const WGS84 = "+proj=longlat +datum=WGS84 +no_defs";

function toWgs84(x: number, y: number): [number, number] {
  // WGS84 범위(경도 -180~180, 위도 -90~90)가 아니면 투영좌표로 판단하고 변환
  if (Math.abs(x) > 180 || Math.abs(y) > 90) {
    return proj4(KOREAN_TM, WGS84, [x, y]) as [number, number];
  }
  return [x, y];
}

export type MemberGeoPoint = {
  longitude: number;
  latitude: number;
  districtKey: string;
  label: string;
};

type Ring = [number, number][];

function ringBBoxArea(ring: Ring): number {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return (maxX - minX) * (maxY - minY);
}

function ringCentroid(ring: Ring): [number, number] {
  let sumX = 0, sumY = 0;
  for (const [x, y] of ring) {
    sumX += x;
    sumY += y;
  }
  return [sumX / ring.length, sumY / ring.length];
}

function featureCentroid(
  geometry: { type: string; coordinates: unknown }
): [number, number] | null {
  const rings: Ring[] = [];

  if (geometry.type === "Polygon") {
    const coords = geometry.coordinates as Ring[];
    if (coords.length > 0) rings.push(coords[0]);
  } else if (geometry.type === "MultiPolygon") {
    const coords = geometry.coordinates as Ring[][];
    for (const polygon of coords) {
      if (polygon.length > 0) rings.push(polygon[0]);
    }
  } else {
    return null;
  }

  if (rings.length === 0) return null;

  let bestRing = rings[0];
  let bestArea = ringBBoxArea(rings[0]);
  for (let i = 1; i < rings.length; i++) {
    const area = ringBBoxArea(rings[i]);
    if (area > bestArea) {
      bestArea = area;
      bestRing = rings[i];
    }
  }

  return ringCentroid(bestRing);
}

export function extractCentroids(topology: ConstituencyBoundaryTopology): MemberGeoPoint[] {
  const collection = feature(
    topology,
    topology.objects.constituencies
  ) as { type: "FeatureCollection"; features: Array<{ type: "Feature"; properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } }> };

  const result: MemberGeoPoint[] = [];

  for (const f of collection.features) {
    const centroid = featureCentroid(f.geometry);
    if (!centroid) continue;

    const [lng, lat] = toWgs84(centroid[0], centroid[1]);
    const label = (f.properties.memberDistrictLabel as string | undefined) ?? "";
    const districtKey = normalizeConstituencyLookupKey(label);

    result.push({ longitude: lng, latitude: lat, districtKey, label });
  }

  return result;
}
