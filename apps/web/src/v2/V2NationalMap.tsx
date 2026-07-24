import { useEffect, useMemo, useState } from "react";

import {
  createLogNormalizer,
  getMetricModulatedColor
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

type ColoredDistrictFeature = ExtrudedFeature & {
  properties: ExtrudedFeature["properties"] & {
    fillColor: string;
  };
};

type ProjectedDistrict = {
  key: string;
  label: string;
  fillColor: string;
  path: string;
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

function getFeaturePolygons(feature: ColoredDistrictFeature) {
  return feature.geometry.type === "Polygon"
    ? [feature.geometry.coordinates]
    : feature.geometry.coordinates;
}

function projectDistricts(
  features: ColoredDistrictFeature[]
): ProjectedDistrict[] {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const feature of features) {
    for (const polygon of getFeaturePolygons(feature)) {
      for (const ring of polygon) {
        for (const position of ring) {
          const [x, y] = toMercatorPoint(position);
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
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
    return [];
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

  return features.flatMap((feature, featureIndex) => {
    const path = getFeaturePolygons(feature)
      .flatMap((polygon) =>
        polygon.map((ring) =>
          ring
            .map((position, positionIndex) => {
              const [x, y] = projectPosition(position);
              return `${positionIndex === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
            })
            .join(" ")
            .concat(" Z")
        )
      )
      .join(" ");

    if (!path || path.includes("NaN")) {
      return [];
    }

    return [
      {
        key: `${feature.properties.districtKey}-${featureIndex}`,
        label: feature.properties.label,
        fillColor: feature.properties.fillColor,
        path
      }
    ];
  });
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

  const coloredDistricts = useMemo<ColoredDistrictFeature[]>(() => {
    if (nationalDistricts.length === 0) {
      return [];
    }

    const normalizeMetric = createLogNormalizer(
      nationalCells
        .filter((cell) => cell.metricMemberCount > 0)
        .map((cell) => cell.metric)
    );

    return nationalDistricts.map((feature) => {
      const summary = feature.properties.summary;
      const [red, green, blue, alpha] =
        !summary.party || summary.metricMemberCount === 0
          ? UNMATCHED_COLOR
          : getMetricModulatedColor(
              summary.party,
              normalizeMetric(summary.metric)
            );

      return {
        ...feature,
        properties: {
          districtKey: feature.properties.districtKey,
          label: feature.properties.label,
          fillColor: `rgba(${red}, ${green}, ${blue}, ${alpha / 255})`
        }
      };
    });
  }, [nationalCells, nationalDistricts]);

  const projectedDistricts = useMemo(
    () => projectDistricts(coloredDistricts),
    [coloredDistricts]
  );

  if (staticState.error && nationalDistricts.length === 0) {
    return (
      <div className="v2-map-state" role="status">
        <strong>지도 데이터를 불러오지 못했습니다.</strong>
        <span>상세 지도에서 다시 시도할 수 있습니다.</span>
      </div>
    );
  }

  if (nationalDistricts.length === 0) {
    return (
      <div className="v2-map-state" role="status" aria-live="polite">
        <span className="v2-map-state__pulse" aria-hidden="true" />
        <strong>전국 지역구를 연결하고 있습니다.</strong>
        <span>
          {staticState.total > 0
            ? `${staticState.total}개 시·도 중 ${staticState.done}개 준비`
            : "공식 선거구 경계를 불러오는 중입니다."}
        </span>
      </div>
    );
  }

  return (
    <div
      className="v2-national-map"
      data-feature-count={coloredDistricts.length}
      data-loaded-provinces={staticState.entries.length}
      data-rendered-feature-count={projectedDistricts.length}
      data-renderer="svg"
      role="img"
      aria-label={`전국 지역구 ${metric === "absence" ? "출석" : metric === "negative" ? "표결 성향" : "재산"} 분포 지도. 색상은 정당을, 같은 정당색 안에서 진할수록 ${metricLabel}이 높음을 나타냅니다. 회색은 자료 없음입니다.`}
    >
      <div className="v2-national-map__canvas" aria-hidden="true">
        <svg
          className="v2-national-map__svg"
          viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
        >
          {projectedDistricts.map((district) => (
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
        </svg>
      </div>
    </div>
  );
}
