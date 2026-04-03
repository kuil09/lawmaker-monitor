import type {
  ConstituencyBoundariesIndexProvince,
  ConstituencyBoundaryProperties,
  GeoJsonMultiPolygon,
  GeoJsonPolygon
} from "@lawmaker-monitor/schemas";
import { feature } from "topojson-client";

import type { DistributionMemberPoint } from "./distribution.js";

export type ConstituencyMetricMode = "attendance" | "absent" | "negative";

export type ConstituencyMetricDomain = {
  min: number;
  max: number;
};

export type ConstituencyBoundaryTopology = {
  type: "Topology";
  objects: {
    constituencies: {
      type: "GeometryCollection";
      geometries: Array<{
        type: string;
        properties: ConstituencyBoundaryProperties;
        arcs: unknown;
      }>;
    };
  };
  arcs: unknown[];
  bbox?: [number, number, number, number];
  transform?: {
    scale: [number, number];
    translate: [number, number];
  };
};

type ConstituencyFeature = {
  type: "Feature";
  properties: ConstituencyBoundaryProperties;
  geometry: GeoJsonPolygon | GeoJsonMultiPolygon;
};

type ConstituencyFeatureCollection = {
  type: "FeatureCollection";
  features: ConstituencyFeature[];
};

type Point = [number, number];

type Bounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

export type ConstituencyMapRegion = {
  districtKey: string;
  properties: ConstituencyBoundaryProperties;
  path: string;
  member: DistributionMemberPoint | null;
  highlighted: boolean;
};

const DEFAULT_MAP_WIDTH = 920;
const DEFAULT_MAP_HEIGHT = 760;
const DEFAULT_MAP_PADDING = 28;

export function normalizeConstituencyLookupKey(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  return value.replace(/\s+/g, "").replace(/[ㆍ?]/g, "·").trim();
}

export function resolveProvinceForDistrict(
  district: string | null | undefined,
  provinces: ConstituencyBoundariesIndexProvince[]
): ConstituencyBoundariesIndexProvince | null {
  const normalizedDistrict = normalizeConstituencyLookupKey(district);
  if (!normalizedDistrict) {
    return null;
  }

  return (
    provinces.find((province) => {
      const shortName = normalizeConstituencyLookupKey(province.provinceShortName);
      const fullName = normalizeConstituencyLookupKey(province.provinceName);
      return normalizedDistrict.startsWith(shortName) || normalizedDistrict.startsWith(fullName);
    }) ?? null
  );
}

export function getConstituencyMetricValue(
  member: DistributionMemberPoint,
  metricMode: ConstituencyMetricMode
): number {
  if (metricMode === "attendance") {
    return member.attendanceRate;
  }

  if (metricMode === "absent") {
    return member.absentRate;
  }

  return member.negativeRate;
}

export function getConstituencyMetricRenderValue(
  member: DistributionMemberPoint,
  metricMode: ConstituencyMetricMode
): number {
  const value = getConstituencyMetricValue(member, metricMode);
  return metricMode === "attendance" ? 1 - value : value;
}

function collectConstituencyMetricValues(
  regions: Array<Pick<ConstituencyMapRegion, "member" | "highlighted">>,
  metricMode: ConstituencyMetricMode
): number[] {
  return regions.flatMap((region) =>
    region.member ? [getConstituencyMetricRenderValue(region.member, metricMode)] : []
  );
}

export function getConstituencyMetricDomain(
  regions: Array<Pick<ConstituencyMapRegion, "member" | "highlighted">>,
  metricMode: ConstituencyMetricMode
): ConstituencyMetricDomain {
  const highlightedValues = collectConstituencyMetricValues(
    regions.filter((region) => region.highlighted),
    metricMode
  );
  const fallbackValues =
    highlightedValues.length >= 2
      ? highlightedValues
      : collectConstituencyMetricValues(regions, metricMode);

  if (fallbackValues.length < 2) {
    return {
      min: 0,
      max: 1
    };
  }

  return {
    min: Math.min(...fallbackValues),
    max: Math.max(...fallbackValues)
  };
}

export function getConstituencyMetricColorIntensity(
  member: DistributionMemberPoint,
  metricMode: ConstituencyMetricMode,
  domain: ConstituencyMetricDomain
): number {
  const value = getConstituencyMetricRenderValue(member, metricMode);
  const span = domain.max - domain.min;

  if (!Number.isFinite(span) || span <= 0) {
    return Math.min(1, Math.max(0, value));
  }

  return Math.min(1, Math.max(0, (value - domain.min) / span));
}

function buildFeatureLookupKeys(properties: ConstituencyBoundaryProperties): string[] {
  return [
    properties.memberDistrictLabel,
    properties.memberDistrictKey,
    properties.districtName,
    properties.lawDistrictName,
    ...properties.aliases
  ]
    .map((candidate) => normalizeConstituencyLookupKey(candidate))
    .filter((candidate, index, array) => candidate.length > 0 && array.indexOf(candidate) === index);
}

function buildMemberLookupMap(members: DistributionMemberPoint[]): Map<string, DistributionMemberPoint | null> {
  const memberByKey = new Map<string, DistributionMemberPoint | null>();

  for (const member of members) {
    const lookupKey = normalizeConstituencyLookupKey(member.district);
    if (!lookupKey) {
      continue;
    }

    const existing = memberByKey.get(lookupKey);
    memberByKey.set(lookupKey, existing && existing.memberId !== member.memberId ? null : member);
  }

  return memberByKey;
}

function topologyToFeatures(topology: ConstituencyBoundaryTopology): ConstituencyFeature[] {
  const collection = feature(
    topology,
    topology.objects.constituencies
  ) as ConstituencyFeatureCollection;

  return collection.features;
}

function readBounds(features: ConstituencyFeature[]): Bounds {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const feature of features) {
    const polygons =
      feature.geometry.type === "Polygon"
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates;

    for (const polygon of polygons) {
      for (const ring of polygon) {
        for (const [x, y] of ring) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
    return {
      minX: 0,
      maxX: 1,
      minY: 0,
      maxY: 1
    };
  }

  return {
    minX,
    maxX,
    minY,
    maxY
  };
}

function buildProjector(bounds: Bounds, width: number, height: number, padding: number) {
  const spanX = Math.max(bounds.maxX - bounds.minX, 1);
  const spanY = Math.max(bounds.maxY - bounds.minY, 1);
  const usableWidth = Math.max(width - padding * 2, 1);
  const usableHeight = Math.max(height - padding * 2, 1);
  const scale = Math.min(usableWidth / spanX, usableHeight / spanY);
  const contentWidth = spanX * scale;
  const contentHeight = spanY * scale;
  const offsetX = padding + (usableWidth - contentWidth) / 2 - bounds.minX * scale;
  const offsetY = padding + (usableHeight - contentHeight) / 2 + bounds.maxY * scale;

  return ([x, y]: Point): Point => [x * scale + offsetX, offsetY - y * scale];
}

function buildRingPath(ring: Point[], project: (point: Point) => Point): string {
  return ring
    .map((point, index) => {
      const [x, y] = project(point);
      const command = index === 0 ? "M" : "L";
      return `${command}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ")
    .concat(" Z");
}

function buildFeaturePath(
  geometry: GeoJsonPolygon | GeoJsonMultiPolygon,
  project: (point: Point) => Point
): string {
  if (geometry.type === "Polygon") {
    return geometry.coordinates.map((ring) => buildRingPath(ring, project)).join(" ");
  }

  return geometry.coordinates
    .map((polygon) => polygon.map((ring) => buildRingPath(ring, project)).join(" "))
    .join(" ");
}

export function buildConstituencyMapRegions(args: {
  topology: ConstituencyBoundaryTopology;
  members: DistributionMemberPoint[];
  highlightedMemberIds?: ReadonlySet<string>;
  width?: number;
  height?: number;
  padding?: number;
}): ConstituencyMapRegion[] {
  const features = topologyToFeatures(args.topology);
  const bounds = readBounds(features);
  const project = buildProjector(
    bounds,
    args.width ?? DEFAULT_MAP_WIDTH,
    args.height ?? DEFAULT_MAP_HEIGHT,
    args.padding ?? DEFAULT_MAP_PADDING
  );
  const memberByKey = buildMemberLookupMap(args.members);

  return features
    .map((currentFeature) => {
      const matchingMember =
        buildFeatureLookupKeys(currentFeature.properties)
          .map((lookupKey) => memberByKey.get(lookupKey) ?? null)
          .find((member): member is DistributionMemberPoint => Boolean(member)) ?? null;

      return {
        districtKey: currentFeature.properties.memberDistrictKey,
        properties: currentFeature.properties,
        path: buildFeaturePath(currentFeature.geometry, project),
        member: matchingMember,
        highlighted: matchingMember
          ? args.highlightedMemberIds?.has(matchingMember.memberId) ?? true
          : false
      };
    })
    .sort((left, right) =>
      left.properties.memberDistrictLabel.localeCompare(right.properties.memberDistrictLabel, "ko")
    );
}

export function findLowestAttendanceRegion(
  regions: ConstituencyMapRegion[]
): ConstituencyMapRegion | null {
  let lowest: ConstituencyMapRegion | null = null;

  for (const region of regions) {
    if (!region.member) {
      continue;
    }

    if (!lowest || !lowest.member || region.member.attendanceRate < lowest.member.attendanceRate) {
      lowest = region;
    }
  }

  return lowest;
}
