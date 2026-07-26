import { cellToLatLng, getResolution } from "h3-js";
import { describe, expect, it } from "vitest";

import {
  buildCartogramProvinceRegions,
  buildDistrictCartogram,
  DISTRICT_CARTOGRAM_RESOLUTION
} from "../../apps/web/src/lib/district-cartogram.js";

import type { ExtrudedFeature } from "../../apps/web/src/lib/geo-utils.js";

function createDistrict(
  districtKey: string,
  label: string,
  longitude: number,
  latitude: number
): ExtrudedFeature {
  const offset = 0.02;
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [longitude - offset, latitude - offset],
          [longitude + offset, latitude - offset],
          [longitude + offset, latitude + offset],
          [longitude - offset, latitude + offset],
          [longitude - offset, latitude - offset]
        ]
      ]
    },
    properties: { districtKey, label }
  };
}

describe("district cartogram", () => {
  it("assigns one unique equal-resolution hexagon to every district", () => {
    const districts = [
      createDistrict("서울갑", "서울 갑", 126.98, 37.57),
      createDistrict("서울을", "서울 을", 126.98, 37.57),
      createDistrict("서울병", "서울 병", 126.98, 37.57),
      createDistrict("부산갑", "부산 갑", 129.08, 35.18),
      createDistrict("제주갑", "제주 갑", 126.53, 33.5)
    ];

    const cells = buildDistrictCartogram(districts);

    expect(cells).toHaveLength(districts.length);
    expect(new Set(cells.map((cell) => cell.h3Index)).size).toBe(
      districts.length
    );
    expect(
      cells.every(
        (cell) => getResolution(cell.h3Index) === DISTRICT_CARTOGRAM_RESOLUTION
      )
    ).toBe(true);
    expect(cells.map((cell) => cell.feature.properties.districtKey)).toEqual(
      districts.map((district) => district.properties.districtKey)
    );
  });

  it("keeps broad north-to-south geography while resolving dense districts", () => {
    const cells = buildDistrictCartogram([
      createDistrict("서울갑", "서울 갑", 126.98, 37.57),
      createDistrict("서울을", "서울 을", 126.98, 37.57),
      createDistrict("부산갑", "부산 갑", 129.08, 35.18),
      createDistrict("제주갑", "제주 갑", 126.53, 33.5)
    ]);
    const latitudeByDistrict = new Map(
      cells.map((cell) => [
        cell.feature.properties.districtKey,
        cellToLatLng(cell.h3Index)[0]
      ])
    );

    expect(latitudeByDistrict.get("서울갑")).not.toBe(
      latitudeByDistrict.get("서울을")
    );
    expect(latitudeByDistrict.get("서울갑")!).toBeGreaterThan(
      latitudeByDistrict.get("부산갑")!
    );
    expect(latitudeByDistrict.get("부산갑")!).toBeGreaterThan(
      latitudeByDistrict.get("제주갑")!
    );
  });

  it("preserves enough regional separation to retain the national silhouette", () => {
    const districts = [
      ...Array.from({ length: 24 }, (_, index) =>
        createDistrict(
          `서울${index}`,
          `서울 ${index}`,
          126.98 + (index % 6) * 0.01,
          37.57 + Math.floor(index / 6) * 0.01
        )
      ),
      ...Array.from({ length: 8 }, (_, index) =>
        createDistrict(
          `강원${index}`,
          `강원 ${index}`,
          128.2 + (index % 4) * 0.04,
          37.35 + Math.floor(index / 4) * 0.04
        )
      ),
      ...Array.from({ length: 18 }, (_, index) =>
        createDistrict(
          `부산${index}`,
          `부산 ${index}`,
          129.08 + (index % 6) * 0.01,
          35.18 + Math.floor(index / 6) * 0.01
        )
      ),
      ...Array.from({ length: 3 }, (_, index) =>
        createDistrict(
          `제주${index}`,
          `제주 ${index}`,
          126.53 + index * 0.03,
          33.5
        )
      )
    ];
    const cells = buildDistrictCartogram(districts);
    const meanPosition = (prefix: string) => {
      const positions = cells
        .filter((cell) =>
          cell.feature.properties.districtKey.startsWith(prefix)
        )
        .map((cell) => cellToLatLng(cell.h3Index));

      return {
        latitude:
          positions.reduce((sum, [latitude]) => sum + latitude, 0) /
          positions.length,
        longitude:
          positions.reduce((sum, [, longitude]) => sum + longitude, 0) /
          positions.length
      };
    };
    const seoul = meanPosition("서울");
    const gangwon = meanPosition("강원");
    const busan = meanPosition("부산");
    const jeju = meanPosition("제주");

    expect(seoul.latitude - busan.latitude).toBeGreaterThan(1.2);
    expect(busan.latitude - jeju.latitude).toBeGreaterThan(0.8);
    expect(gangwon.longitude).toBeGreaterThan(seoul.longitude);
    expect(busan.longitude).toBeGreaterThan(seoul.longitude);
  });

  it("groups district cells into labeled province outlines", () => {
    const cells = buildDistrictCartogram([
      createDistrict("서울갑", "서울 갑", 126.98, 37.57),
      createDistrict("서울을", "서울 을", 127.02, 37.55),
      createDistrict("부산갑", "부산 갑", 129.08, 35.18)
    ]).map(({ h3Index, feature }) => ({
      h3Index,
      provinceShortName: feature.properties.districtKey.startsWith("서울")
        ? "서울"
        : "부산"
    }));
    const regions = buildCartogramProvinceRegions(cells);
    const seoul = regions.find((region) => region.provinceShortName === "서울");
    const busan = regions.find((region) => region.provinceShortName === "부산");

    expect(regions.map((region) => region.provinceShortName)).toEqual([
      "부산",
      "서울"
    ]);
    expect(seoul).toMatchObject({
      districtCount: 2,
      geometry: { type: "MultiPolygon" }
    });
    expect(seoul?.geometry.coordinates.length).toBeGreaterThan(0);
    expect(seoul?.center[1]).toBeGreaterThan(busan?.center[1] ?? 0);
  });
});
