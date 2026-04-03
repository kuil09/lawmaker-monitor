import { feature } from "topojson-client";

import type { ConstituencyBoundaryTopology } from "./constituency-map.js";
import { normalizeConstituencyLookupKey } from "./constituency-map.js";

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

    const [lng, lat] = centroid;
    const label = (f.properties.memberDistrictLabel as string | undefined) ?? "";
    const districtKey = normalizeConstituencyLookupKey(label);

    result.push({ longitude: lng, latitude: lat, districtKey, label });
  }

  return result;
}
