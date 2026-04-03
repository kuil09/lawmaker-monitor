import proj4 from "proj4";
import { feature } from "topojson-client";

import type { ConstituencyBoundaryTopology } from "./constituency-map.js";
import { normalizeConstituencyLookupKey } from "./constituency-map.js";

// 한국 TM 투영좌표계 (EPSG:5179) → WGS84 (EPSG:4326)
const KOREAN_TM = "+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs";
const WGS84 = "+proj=longlat +datum=WGS84 +no_defs";

function toWgs84(x: number, y: number): [number, number] {
  if (Math.abs(x) > 180 || Math.abs(y) > 90) {
    return proj4(KOREAN_TM, WGS84, [x, y]) as [number, number];
  }
  return [x, y];
}

// zoom 6~7 수준에서는 6개 중 1개 버텍스만으로도 충분한 해상도
function reprojectRing(ring: number[][], step = 6): number[][] {
  const result: number[][] = [];
  for (let i = 0; i < ring.length; i++) {
    if (i === 0 || i === ring.length - 1 || i % step === 0) {
      result.push(toWgs84(ring[i][0], ring[i][1]));
    }
  }
  return result;
}

function reprojectGeometry(geometry: { type: string; coordinates: unknown }): { type: string; coordinates: unknown } {
  if (geometry.type === "Polygon") {
    return {
      type: "Polygon",
      coordinates: (geometry.coordinates as number[][][]).map(reprojectRing)
    };
  }
  if (geometry.type === "MultiPolygon") {
    return {
      type: "MultiPolygon",
      coordinates: (geometry.coordinates as number[][][][]).map(poly => poly.map(reprojectRing))
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

export function extractReprojectedFeatures(topology: ConstituencyBoundaryTopology): ExtrudedFeature[] {
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
      geometry: reprojectGeometry(f.geometry),
      properties: {
        districtKey: normalizeConstituencyLookupKey(label),
        label
      }
    };
  });
}

// 레거시 centroid export (사용처 없으나 타입 호환 유지)
export type MemberGeoPoint = {
  longitude: number;
  latitude: number;
  districtKey: string;
  label: string;
};
