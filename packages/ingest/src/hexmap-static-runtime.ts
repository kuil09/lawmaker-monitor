import { polygonToCells } from "h3-js";
import proj4 from "proj4";
import { feature } from "topojson-client";

import { sha256 } from "./utils.js";

import type { ConstituencyBoundaryProvinceShard } from "./constituency-boundary-runtime.js";
import type {
  GeoJsonMultiPolygon,
  GeoJsonPolygon,
  HexmapStaticCell,
  HexmapStaticDistrict,
  HexmapStaticIndexExport,
  HexmapStaticIndexProvince,
  HexmapStaticProvinceArtifact
} from "@lawmaker-monitor/schemas";

const KOREAN_TM =
  "+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs";
const WGS84 = "+proj=longlat +datum=WGS84 +no_defs";
const DETAIL_RES_STEP = 20;
const FULL_FEATURE_STEP = 1;
const LOW_ZOOM_DISTRICT_STEP = 6;

type ConstituencyBoundaryTopology =
  ConstituencyBoundaryProvinceShard["topology"];

type FeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: Record<string, unknown>;
    geometry: { type: string; coordinates: unknown };
  }>;
};

export type HexmapStaticProvinceShard = HexmapStaticIndexProvince & {
  content: string;
  artifact: HexmapStaticProvinceArtifact;
};

export type HexmapStaticRuntimeArtifacts = {
  index: HexmapStaticIndexExport;
  indexJson: string;
  provinces: HexmapStaticProvinceShard[];
};

export const HEXMAP_STATIC_INDEX_PATH = "exports/hexmap_static/index.json";
export const HEXMAP_STATIC_PROVINCES_DIR = "exports/hexmap_static/provinces";

export function buildHexmapStaticProvinceArtifactPath(
  provinceShortName: string
): string {
  return `${HEXMAP_STATIC_PROVINCES_DIR}/${provinceShortName}.json`;
}

function normalizeConstituencyLookupKey(
  value: string | null | undefined
): string {
  if (!value) {
    return "";
  }

  return value.replace(/\s+/g, "").replace(/[ㆍ?]/g, "·").trim();
}

function toWgs84(x: number, y: number): [number, number] {
  if (Math.abs(x) > 180 || Math.abs(y) > 90) {
    return proj4(KOREAN_TM, WGS84, [x, y]) as [number, number];
  }

  return [x, y];
}

function normalizeRing(points: number[][]): number[][] {
  if (points.length === 0) {
    return points;
  }

  const normalized = [...points];
  const firstPoint = normalized[0];
  const lastPoint = normalized[normalized.length - 1];

  if (
    firstPoint &&
    lastPoint &&
    (firstPoint[0] !== lastPoint[0] || firstPoint[1] !== lastPoint[1])
  ) {
    normalized.push([...firstPoint]);
  }

  while (normalized.length < 4 && firstPoint) {
    normalized.push([...firstPoint]);
  }

  return normalized;
}

function reprojectRing(ring: number[][], step: number): number[][] {
  const result: number[][] = [];

  for (let index = 0; index < ring.length; index += 1) {
    if (index === 0 || index === ring.length - 1 || index % step === 0) {
      const point = ring[index];
      const [x, y] = point ?? [];
      if (x === undefined || y === undefined) {
        continue;
      }

      result.push(toWgs84(x, y));
    }
  }

  if (result.length >= 4) {
    return normalizeRing(result);
  }

  return normalizeRing(
    ring.flatMap((point) => {
      const [x, y] = point ?? [];
      if (x === undefined || y === undefined) {
        return [];
      }

      return [toWgs84(x, y)];
    })
  );
}

function reprojectGeometry(
  geometry: { type: string; coordinates: unknown },
  step: number
): GeoJsonPolygon | GeoJsonMultiPolygon {
  if (geometry.type === "Polygon") {
    return {
      type: "Polygon",
      coordinates: (geometry.coordinates as number[][][]).map((ring) =>
        reprojectRing(ring, step)
      ) as GeoJsonPolygon["coordinates"]
    };
  }

  return {
    type: "MultiPolygon",
    coordinates: (geometry.coordinates as number[][][][]).map((polygon) =>
      polygon.map((ring) => reprojectRing(ring, step))
    ) as GeoJsonMultiPolygon["coordinates"]
  };
}

function extractReprojectedFeatures(
  topology: ConstituencyBoundaryTopology,
  step: number
): HexmapStaticDistrict[] {
  const collection = feature(
    topology,
    topology.objects.constituencies
  ) as FeatureCollection;

  return collection.features.map((currentFeature) => {
    const label =
      (currentFeature.properties.memberDistrictLabel as string | undefined) ??
      "";

    return {
      type: "Feature",
      geometry: reprojectGeometry(currentFeature.geometry, step),
      properties: {
        districtKey: normalizeConstituencyLookupKey(label),
        label
      }
    };
  });
}

function getDetailRes(features: HexmapStaticDistrict[]): number {
  let minLng = 180;
  let maxLng = -180;
  let minLat = 90;
  let maxLat = -90;

  for (const currentFeature of features) {
    const polygons =
      currentFeature.geometry.type === "Polygon"
        ? [currentFeature.geometry.coordinates]
        : currentFeature.geometry.coordinates;

    for (const polygon of polygons) {
      for (const ring of polygon) {
        for (const point of ring) {
          const [lng, lat] = point;
          if (lng === undefined || lat === undefined) {
            continue;
          }

          if (lng < minLng) {
            minLng = lng;
          }
          if (lng > maxLng) {
            maxLng = lng;
          }
          if (lat < minLat) {
            minLat = lat;
          }
          if (lat > maxLat) {
            maxLat = lat;
          }
        }
      }
    }
  }

  const span = Math.max(maxLng - minLng, (maxLat - minLat) * 1.3);
  if (span > 2) {
    return 6;
  }
  if (span > 0.8) {
    return 7;
  }

  return 8;
}

function buildStaticHexCells(
  topology: ConstituencyBoundaryTopology,
  provinceShortName: string
): Pick<HexmapStaticProvinceArtifact, "cells" | "detailRes"> {
  const reducedFeatures = extractReprojectedFeatures(topology, DETAIL_RES_STEP);
  const detailRes = getDetailRes(reducedFeatures);
  const fullFeatures = extractReprojectedFeatures(topology, FULL_FEATURE_STEP);
  const cells: HexmapStaticCell[] = [];

  for (const currentFeature of fullFeatures) {
    const polygons =
      currentFeature.geometry.type === "Polygon"
        ? [currentFeature.geometry.coordinates as number[][][]]
        : (currentFeature.geometry.coordinates as number[][][][]);

    for (const polygon of polygons) {
      try {
        const polygonCells = polygonToCells(
          polygon as number[][][],
          detailRes,
          true
        );
        for (const h3Index of polygonCells) {
          cells.push({
            h3Index,
            districtKey: currentFeature.properties.districtKey,
            districtLabel: currentFeature.properties.label,
            provinceShortName
          });
        }
      } catch {
        continue;
      }
    }
  }

  return {
    cells,
    detailRes
  };
}

export function buildHexmapStaticRuntimeArtifacts(args: {
  generatedAt: string;
  snapshotId: string;
  provinceShards: ConstituencyBoundaryProvinceShard[];
}): HexmapStaticRuntimeArtifacts {
  const provinces = args.provinceShards.map((provinceShard) => {
    const districts = extractReprojectedFeatures(
      provinceShard.topology,
      LOW_ZOOM_DISTRICT_STEP
    );
    const { cells, detailRes } = buildStaticHexCells(
      provinceShard.topology,
      provinceShard.provinceShortName
    );
    const artifact = {
      provinceShortName: provinceShard.provinceShortName,
      detailRes,
      districts,
      cells
    } satisfies HexmapStaticProvinceArtifact;
    const content = JSON.stringify(artifact);

    return {
      provinceShortName: provinceShard.provinceShortName,
      path: buildHexmapStaticProvinceArtifactPath(
        provinceShard.provinceShortName
      ),
      checksumSha256: sha256(content),
      detailRes,
      cellCount: cells.length,
      districtCount: districts.length,
      content,
      artifact
    } satisfies HexmapStaticProvinceShard;
  });

  const index = {
    generatedAt: args.generatedAt,
    snapshotId: args.snapshotId,
    provinces: provinces.map(
      ({ content: _content, artifact: _artifact, ...province }) => province
    )
  } satisfies HexmapStaticIndexExport;

  return {
    index,
    indexJson: JSON.stringify(index),
    provinces
  };
}
