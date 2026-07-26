import { cellToLatLng, getResolution } from "h3-js";
import { describe, expect, it } from "vitest";

import {
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
});
