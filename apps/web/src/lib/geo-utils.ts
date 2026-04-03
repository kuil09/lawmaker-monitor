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

// zoom 6~7 수준에서 20개 중 1개 버텍스로도 선거구 윤곽 식별 가능
function reprojectRing(ring: number[][], step = 20): number[][] {
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

export type MemberGeoPoint = {
  longitude: number;
  latitude: number;
  districtKey: string;
  label: string;
};

// 외곽 링 버텍스의 표본 평균으로 시각적 센트로이드 계산
function computeCentroid(ring: number[][], step = 50): [number, number] {
  let sumLng = 0, sumLat = 0, count = 0;
  for (let i = 0; i < ring.length; i += step) {
    const [lng, lat] = toWgs84(ring[i][0], ring[i][1]);
    sumLng += lng;
    sumLat += lat;
    count++;
  }
  return [sumLng / count, sumLat / count];
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
      ring = (f.geometry.coordinates as number[][][])[0];
    } else if (f.geometry.type === "MultiPolygon") {
      const polys = f.geometry.coordinates as number[][][][];
      ring = polys.reduce(
        (best, poly) => (poly[0].length > best.length ? poly[0] : best),
        polys[0][0]
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
