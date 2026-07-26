import { cellToLatLng, gridDisk, latLngToCell } from "h3-js";

import type { ExtrudedFeature } from "./geo-utils.js";

export const DISTRICT_CARTOGRAM_RESOLUTION = 5;
const DENSITY_RADIUS = 2;
const MAX_SEARCH_RADIUS = 12;
const LAYOUT_CENTER = { latitude: 36.1, longitude: 127.75 };
const LAYOUT_SCALE = { latitude: 0.4, longitude: 0.45 };

export type DistrictCartogramCell<TFeature extends ExtrudedFeature> = {
  h3Index: string;
  feature: TFeature;
};

type GeographicAnchor = {
  latitude: number;
  longitude: number;
};

type PendingDistrict<TFeature extends ExtrudedFeature> = {
  anchor: GeographicAnchor;
  density: number;
  feature: TFeature;
  targetH3Index: string;
};

function getOuterRings(feature: ExtrudedFeature): number[][][] {
  if (feature.geometry.type === "Polygon") {
    return feature.geometry.coordinates.length > 0
      ? [feature.geometry.coordinates[0] ?? []]
      : [];
  }

  return feature.geometry.coordinates.flatMap((polygon) =>
    polygon.length > 0 ? [polygon[0] ?? []] : []
  );
}

function getRingArea(ring: number[][]): number {
  let area = 0;

  for (let index = 0; index < ring.length; index++) {
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];
    if (!current || !next) {
      continue;
    }

    area += current[0]! * next[1]! - next[0]! * current[1]!;
  }

  return area / 2;
}

function getRingCentroid(ring: number[][]): GeographicAnchor {
  const area = getRingArea(ring);

  if (Math.abs(area) < Number.EPSILON) {
    const validPoints = ring.filter(
      (point): point is [number, number] =>
        point[0] !== undefined && point[1] !== undefined
    );
    const divisor = validPoints.length || 1;
    return {
      latitude: validPoints.reduce((sum, point) => sum + point[1], 0) / divisor,
      longitude: validPoints.reduce((sum, point) => sum + point[0], 0) / divisor
    };
  }

  let longitude = 0;
  let latitude = 0;

  for (let index = 0; index < ring.length; index++) {
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];
    if (!current || !next) {
      continue;
    }

    const cross = current[0]! * next[1]! - next[0]! * current[1]!;
    longitude += (current[0]! + next[0]!) * cross;
    latitude += (current[1]! + next[1]!) * cross;
  }

  const divisor = 6 * area;
  return {
    latitude: latitude / divisor,
    longitude: longitude / divisor
  };
}

export function getDistrictGeographicAnchor(
  feature: ExtrudedFeature
): GeographicAnchor {
  const largestRing = getOuterRings(feature)
    .map((ring) => ({ area: Math.abs(getRingArea(ring)), ring }))
    .sort((left, right) => right.area - left.area)[0]?.ring;

  return largestRing
    ? getRingCentroid(largestRing)
    : { latitude: 36.5, longitude: 127.8 };
}

function getCartogramLayoutAnchor(feature: ExtrudedFeature): GeographicAnchor {
  const geographicAnchor = getDistrictGeographicAnchor(feature);

  return {
    latitude:
      LAYOUT_CENTER.latitude +
      (geographicAnchor.latitude - LAYOUT_CENTER.latitude) *
        LAYOUT_SCALE.latitude,
    longitude:
      LAYOUT_CENTER.longitude +
      (geographicAnchor.longitude - LAYOUT_CENTER.longitude) *
        LAYOUT_SCALE.longitude
  };
}

function getCandidateDistance(
  anchor: GeographicAnchor,
  h3Index: string
): number {
  const [latitude, longitude] = cellToLatLng(h3Index);
  const longitudeScale = Math.cos((anchor.latitude * Math.PI) / 180);
  const latitudeDelta = latitude - anchor.latitude;
  const longitudeDelta = (longitude - anchor.longitude) * longitudeScale;

  return latitudeDelta * latitudeDelta + longitudeDelta * longitudeDelta;
}

function findAvailableCell(
  district: PendingDistrict<ExtrudedFeature>,
  occupied: ReadonlySet<string>
): string {
  for (let radius = 0; radius <= MAX_SEARCH_RADIUS; radius++) {
    const candidates = gridDisk(district.targetH3Index, radius)
      .filter((h3Index) => !occupied.has(h3Index))
      .sort((left, right) => {
        const distanceDifference =
          getCandidateDistance(district.anchor, left) -
          getCandidateDistance(district.anchor, right);

        return (
          distanceDifference ||
          left.localeCompare(right, "en", { sensitivity: "base" })
        );
      });

    if (candidates[0]) {
      return candidates[0];
    }
  }

  throw new Error(
    `Unable to place district ${district.feature.properties.districtKey} on the cartogram.`
  );
}

export function buildDistrictCartogram<TFeature extends ExtrudedFeature>(
  features: readonly TFeature[],
  resolution = DISTRICT_CARTOGRAM_RESOLUTION
): DistrictCartogramCell<TFeature>[] {
  const targetDistricts = features.map((feature) => {
    const anchor = getCartogramLayoutAnchor(feature);
    return {
      anchor,
      feature,
      targetH3Index: latLngToCell(anchor.latitude, anchor.longitude, resolution)
    };
  });

  const pendingDistricts = targetDistricts
    .map((district) => {
      const neighborhood = new Set(
        gridDisk(district.targetH3Index, DENSITY_RADIUS)
      );
      return {
        ...district,
        density: targetDistricts.filter((candidate) =>
          neighborhood.has(candidate.targetH3Index)
        ).length
      };
    })
    .sort(
      (left, right) =>
        left.density - right.density ||
        left.feature.properties.label.localeCompare(
          right.feature.properties.label,
          "ko"
        )
    );

  const occupied = new Set<string>();
  const assignedByDistrictKey = new Map<string, string>();

  for (const district of pendingDistricts) {
    const h3Index = findAvailableCell(district, occupied);
    occupied.add(h3Index);
    assignedByDistrictKey.set(district.feature.properties.districtKey, h3Index);
  }

  return features.flatMap((feature) => {
    const h3Index = assignedByDistrictKey.get(feature.properties.districtKey);
    return h3Index ? [{ h3Index, feature }] : [];
  });
}
