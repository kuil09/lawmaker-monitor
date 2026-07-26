import { cellToBoundary } from "h3-js";
import { useEffect, useMemo, useState } from "react";

import {
  buildCartogramProvinceRegions,
  buildDistrictCartogram
} from "../lib/district-cartogram.js";
import {
  createLogNormalizer,
  getSequentialMetricColor
} from "../lib/geo-utils.js";
import { hydrateHexCells, type SummaryItem } from "../lib/hex-cells.js";
import {
  ensureHexmapStaticLoad,
  getHexmapStaticSessionKey,
  getHexmapStaticState,
  subscribeHexmapStaticState
} from "../lib/hexmap-static-loader.js";

import type { ExtrudedFeature, H3DataCell } from "../lib/geo-utils.js";
import type { MapMetric } from "../lib/map-route.js";
import type {
  AccountabilitySummaryExport,
  Manifest,
  MemberAssetsIndexExport
} from "@lawmaker-monitor/schemas";

const MAP_WIDTH = 520;
const MAP_HEIGHT = 430;
const MAP_PADDING = 14;
const UNMATCHED_COLOR: [number, number, number, number] = [205, 211, 218, 205];

type TooltipDatum = Omit<H3DataCell, "h3Index">;

type NationalDistrictFeature = ExtrudedFeature & {
  properties: ExtrudedFeature["properties"] & {
    summary: TooltipDatum;
  };
};

type ColoredCartogramCell = {
  districtKey: string;
  fillColor: string;
  h3Index: string;
  label: string;
  provinceShortName: string;
};

type ProjectedDistrict = {
  key: string;
  label: string;
  fillColor: string;
  path: string;
};

type ProjectedProvinceRegion = {
  center: readonly [x: number, y: number];
  districtCount: number;
  key: string;
  label: string;
  path: string;
};

type ProjectedCartogram = {
  districts: ProjectedDistrict[];
  provinces: ProjectedProvinceRegion[];
};

function toMercatorPoint(position: [number, number]): [number, number] {
  const [longitude, latitude] = position;
  const clampedLatitude = Math.max(
    -85.051_128_78,
    Math.min(85.051_128_78, latitude)
  );
  const longitudeRadians = (longitude * Math.PI) / 180;
  const latitudeRadians = (clampedLatitude * Math.PI) / 180;

  return [
    longitudeRadians,
    -Math.log(Math.tan(Math.PI / 4 + latitudeRadians / 2))
  ];
}

function projectCartogram(cells: ColoredCartogramCell[]): ProjectedCartogram {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const boundaries = cells.map((cell) =>
    cellToBoundary(cell.h3Index).map(
      ([latitude, longitude]) => [longitude, latitude] as [number, number]
    )
  );

  for (const boundary of boundaries) {
    for (const position of boundary) {
      const [x, y] = toMercatorPoint(position);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }

  const contentWidth = maxX - minX;
  const contentHeight = maxY - minY;

  if (
    !Number.isFinite(contentWidth) ||
    !Number.isFinite(contentHeight) ||
    contentWidth <= 0 ||
    contentHeight <= 0
  ) {
    return { districts: [], provinces: [] };
  }

  const scale = Math.min(
    (MAP_WIDTH - MAP_PADDING * 2) / contentWidth,
    (MAP_HEIGHT - MAP_PADDING * 2) / contentHeight
  );
  const offsetX = (MAP_WIDTH - contentWidth * scale) / 2;
  const offsetY = (MAP_HEIGHT - contentHeight * scale) / 2;

  const projectPosition = (position: [number, number]) => {
    const [x, y] = toMercatorPoint(position);
    return [
      offsetX + (x - minX) * scale,
      offsetY + (y - minY) * scale
    ] as const;
  };

  const projectLoop = (positions: [number, number][]) =>
    positions
      .map((position, positionIndex) => {
        const [x, y] = projectPosition(position);
        return `${positionIndex === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ")
      .concat(" Z");

  const districts = cells.flatMap((cell, cellIndex) => {
    const path = projectLoop(boundaries[cellIndex] ?? []);
    return path && !path.includes("NaN")
      ? [
          {
            key: cell.districtKey,
            label: cell.label,
            fillColor: cell.fillColor,
            path
          }
        ]
      : [];
  });
  const provinces = buildCartogramProvinceRegions(cells).flatMap((region) => {
    const path = region.geometry.coordinates
      .flatMap((polygon) => polygon.map(projectLoop))
      .join(" ");
    const center = projectPosition(region.center);

    return path && !path.includes("NaN")
      ? [
          {
            center,
            districtCount: region.districtCount,
            key: region.provinceShortName,
            label: region.provinceShortName,
            path
          }
        ]
      : [];
  });

  return { districts, provinces };
}

type V2NationalMapProps = {
  manifest: Manifest | null;
  accountabilitySummary: AccountabilitySummaryExport | null;
  memberAssetsIndex: MemberAssetsIndexExport | null;
  metric: MapMetric;
};

export function V2NationalMap({
  manifest,
  accountabilitySummary,
  memberAssetsIndex,
  metric
}: V2NationalMapProps) {
  const metricLabel =
    metric === "absence"
      ? "결석률"
      : metric === "negative"
        ? "반대·기권률"
        : metric === "realEstate"
          ? "공개 부동산액"
          : "공개 총재산";
  const distributionLabel =
    metric === "absence"
      ? "결석률"
      : metric === "negative"
        ? "표결 성향"
        : "재산";
  const [staticState, setStaticState] = useState(() =>
    getHexmapStaticState(manifest)
  );
  const sessionKey = getHexmapStaticSessionKey(manifest);

  useEffect(() => {
    setStaticState(getHexmapStaticState(manifest));
    return subscribeHexmapStaticState(manifest, setStaticState);
  }, [manifest, sessionKey]);

  useEffect(() => {
    void ensureHexmapStaticLoad(manifest, { source: "home" });
  }, [manifest, sessionKey]);

  const summaryItems = useMemo<SummaryItem[]>(() => {
    const assetByMemberId = new Map(
      (memberAssetsIndex?.members ?? []).map((entry) => [
        entry.memberId,
        {
          assetTotal: entry.latestTotal,
          realEstateTotal: entry.latestRealEstateTotal ?? null
        }
      ])
    );

    return (accountabilitySummary?.items ?? []).flatMap((item) => {
      if (!item.district) {
        return [];
      }

      const assetSummary = assetByMemberId.get(item.memberId);
      return [
        {
          memberId: item.memberId,
          name: item.name,
          party: item.party,
          district: item.district,
          absentRate: item.absentRate,
          noRate: item.noRate,
          abstainRate: item.abstainRate,
          assetTotal: assetSummary?.assetTotal ?? null,
          realEstateTotal: assetSummary?.realEstateTotal ?? null
        }
      ];
    });
  }, [accountabilitySummary, memberAssetsIndex]);

  const nationalCells = useMemo(
    () =>
      staticState.entries.flatMap((entry) =>
        hydrateHexCells(entry.cells, summaryItems, metric)
      ),
    [metric, staticState.entries, summaryItems]
  );

  const districtSummaryByKey = useMemo(() => {
    const result = new Map<string, TooltipDatum>();
    for (const cell of nationalCells) {
      if (result.has(cell.districtKey)) {
        continue;
      }

      const { h3Index: _h3Index, ...summary } = cell;
      result.set(cell.districtKey, summary);
    }
    return result;
  }, [nationalCells]);

  const nationalDistricts = useMemo<NationalDistrictFeature[]>(
    () =>
      staticState.entries.flatMap((entry) =>
        (entry.districts ?? []).map((district) => ({
          ...district,
          properties: {
            ...district.properties,
            summary: districtSummaryByKey.get(
              district.properties.districtKey
            ) ?? {
              districtKey: district.properties.districtKey,
              districtLabel: district.properties.label,
              provinceShortName: entry.provinceShortName,
              party: "",
              metric: 0,
              memberCount: 0,
              metricMemberCount: 0,
              memberNames: [],
              memberParties: [],
              memberIds: []
            }
          }
        }))
      ),
    [districtSummaryByKey, staticState.entries]
  );

  const coloredCartogramCells = useMemo<ColoredCartogramCell[]>(() => {
    if (nationalDistricts.length === 0) {
      return [];
    }

    const normalizeMetric = createLogNormalizer(
      nationalCells
        .filter((cell) => cell.metricMemberCount > 0)
        .map((cell) => cell.metric)
    );

    return buildDistrictCartogram(nationalDistricts).map(
      ({ h3Index, feature }) => {
        const summary = feature.properties.summary;
        const [red, green, blue, alpha] =
          summary.memberCount === 0 || summary.metricMemberCount === 0
            ? UNMATCHED_COLOR
            : getSequentialMetricColor(normalizeMetric(summary.metric));

        return {
          districtKey: feature.properties.districtKey,
          fillColor: `rgba(${red}, ${green}, ${blue}, ${alpha / 255})`,
          h3Index,
          label: feature.properties.label,
          provinceShortName: summary.provinceShortName
        };
      }
    );
  }, [nationalCells, nationalDistricts]);

  const projectedCartogram = useMemo(
    () => projectCartogram(coloredCartogramCells),
    [coloredCartogramCells]
  );
  const isStaticMapComplete =
    staticState.total > 0 &&
    staticState.done >= staticState.total &&
    staticState.entries.length >= staticState.total &&
    !staticState.isLoading;
  const hasIncompleteMapData =
    !staticState.isLoading &&
    staticState.total > 0 &&
    staticState.done >= staticState.total &&
    staticState.entries.length < staticState.total;

  if (staticState.error || hasIncompleteMapData) {
    return (
      <div className="v2-map-state" role="status">
        <strong>지도 데이터를 불러오지 못했습니다.</strong>
        <span>
          {hasIncompleteMapData
            ? `${staticState.total}개 시·도 중 ${staticState.entries.length}개만 준비되었습니다.`
            : "상세 지도에서 다시 시도할 수 있습니다."}
        </span>
      </div>
    );
  }

  if (!isStaticMapComplete || nationalDistricts.length === 0) {
    return (
      <div
        className="v2-map-state"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <span className="v2-map-state__pulse" aria-hidden="true" />
        <strong>전국 지도를 준비하고 있습니다.</strong>
        <span>
          {staticState.total > 0
            ? `${staticState.total}개 시·도 중 ${staticState.done}개 준비`
            : "공식 선거구 경계를 불러오는 중입니다."}
        </span>
        <progress
          className="v2-map-state__progress"
          aria-label="전국 지도 데이터 준비 진행률"
          max={staticState.total || 1}
          value={staticState.total > 0 ? staticState.done : undefined}
        />
      </div>
    );
  }

  if (projectedCartogram.districts.length === 0) {
    return (
      <div className="v2-map-state" role="status">
        <strong>지도 경계를 완성하지 못했습니다.</strong>
        <span>상세 지도에서 다시 시도할 수 있습니다.</span>
      </div>
    );
  }

  return (
    <div
      className="v2-national-map"
      data-cartogram-cell-count={coloredCartogramCells.length}
      data-feature-count={nationalDistricts.length}
      data-loaded-provinces={staticState.entries.length}
      data-rendered-feature-count={projectedCartogram.districts.length}
      data-rendered-province-count={projectedCartogram.provinces.length}
      data-renderer="svg-cartogram"
      role="img"
      aria-label={`전국 지역구 ${distributionLabel} 카토그램. 각 지역구를 같은 크기 육각형 하나로 표시하며, 굵은 선과 라벨은 시·도 경계입니다. 색이 진할수록 ${metricLabel}이 높음을 나타냅니다. 회색은 자료 없음입니다.`}
    >
      <div className="v2-national-map__canvas" aria-hidden="true">
        <svg
          className="v2-national-map__svg"
          viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
        >
          {projectedCartogram.districts.map((district) => (
            <path
              key={district.key}
              d={district.path}
              fill={district.fillColor}
              fillRule="evenodd"
              stroke="rgba(255, 255, 255, 0.88)"
              strokeWidth="0.8"
              vectorEffect="non-scaling-stroke"
              data-district-label={district.label}
            />
          ))}
          {projectedCartogram.provinces.map((province) => (
            <path
              key={`${province.key}-boundary`}
              className="v2-national-map__province-boundary"
              d={province.path}
              fill="none"
              fillRule="evenodd"
              vectorEffect="non-scaling-stroke"
              data-province-boundary={province.label}
            />
          ))}
          {projectedCartogram.provinces.map((province) => (
            <text
              key={`${province.key}-label`}
              className="v2-national-map__province-label"
              x={province.center[0]}
              y={province.center[1]}
              textAnchor="middle"
              dominantBaseline="central"
              data-district-count={province.districtCount}
              data-province-label={province.label}
            >
              {province.label}
            </text>
          ))}
        </svg>
      </div>
    </div>
  );
}
