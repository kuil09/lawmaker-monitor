import { cellToBoundary } from "h3-js";
import { useEffect, useMemo, useState } from "react";

import {
  buildCartogramProvinceRegions,
  buildDistrictCartogram
} from "../lib/district-cartogram.js";
import {
  formatAssetEok,
  formatAssetEokDelta,
  formatPercent
} from "../lib/format.js";
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
import {
  createMapSeverityScale,
  MAP_SEVERITY_BANDS,
  type MapSeverity
} from "../lib/map-severity.js";

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
  memberCount: number;
  memberIds: string[];
  memberNames: string[];
  memberParties: string[];
  metric: number | null;
  provinceShortName: string;
  severity: MapSeverity | null;
};

type ProjectedDistrict = {
  center: readonly [x: number, y: number];
  key: string;
  label: string;
  fillColor: string;
  memberCount: number;
  memberIds: string[];
  memberNames: string[];
  memberParties: string[];
  metric: number | null;
  path: string;
  provinceShortName: string;
  severity: MapSeverity | null;
};

type ProjectedProvinceRegion = {
  center: readonly [x: number, y: number];
  districtCount: number;
  key: string;
  label: string;
  metric: number | null;
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
    const boundary = boundaries[cellIndex] ?? [];
    const path = projectLoop(boundary);
    const projectedBoundary = boundary.map(projectPosition);
    const center =
      projectedBoundary.length > 0
        ? ([
            projectedBoundary.reduce((sum, point) => sum + point[0], 0) /
              projectedBoundary.length,
            projectedBoundary.reduce((sum, point) => sum + point[1], 0) /
              projectedBoundary.length
          ] as const)
        : ([0, 0] as const);

    return path && !path.includes("NaN")
      ? [
          {
            center,
            key: cell.districtKey,
            label: cell.label,
            fillColor: cell.fillColor,
            memberCount: cell.memberCount,
            memberIds: cell.memberIds,
            memberNames: cell.memberNames,
            memberParties: cell.memberParties,
            metric: cell.metric,
            path,
            provinceShortName: cell.provinceShortName,
            severity: cell.severity
          }
        ]
      : [];
  });
  const provinces = buildCartogramProvinceRegions(cells).flatMap((region) => {
    const path = region.geometry.coordinates
      .flatMap((polygon) => polygon.map(projectLoop))
      .join(" ");
    const center = projectPosition(region.center);
    const provinceMetrics = cells.flatMap((cell) =>
      cell.provinceShortName === region.provinceShortName && cell.metric != null
        ? [cell.metric]
        : []
    );
    const metric =
      provinceMetrics.length > 0
        ? provinceMetrics.reduce((sum, value) => sum + value, 0) /
          provinceMetrics.length
        : null;

    return path && !path.includes("NaN")
      ? [
          {
            center,
            districtCount: region.districtCount,
            key: region.provinceShortName,
            label: region.provinceShortName,
            metric,
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
  onOpenMember: (memberId: string) => void;
};

function isRateMetric(metric: MapMetric): boolean {
  return metric === "absence" || metric === "negative";
}

function formatMapMetric(metric: MapMetric, value: number): string {
  return isRateMetric(metric) ? formatPercent(value) : formatAssetEok(value);
}

function formatMapMetricDelta(metric: MapMetric, value: number): string {
  if (!isRateMetric(metric)) {
    return formatAssetEokDelta(value);
  }

  const percentagePointValue = value * 100;
  const sign = percentagePointValue > 0 ? "+" : "";
  return `${sign}${percentagePointValue.toFixed(1)}%p`;
}

function renderSeverityMarker(district: ProjectedDistrict) {
  const [x, y] = district.center;
  if (!district.severity) {
    return null;
  }

  const level =
    district.severity.key === "low"
      ? 1
      : district.severity.key === "moderate"
        ? 2
        : district.severity.key === "caution"
          ? 3
          : 4;

  return (
    <text
      className={`v2-national-map__severity-marker is-${district.severity.key}`}
      x={x}
      y={y}
      textAnchor="middle"
      dominantBaseline="central"
      data-severity={district.severity.label}
    >
      {level}
    </text>
  );
}

export function V2NationalMap({
  manifest,
  accountabilitySummary,
  memberAssetsIndex,
  metric,
  onOpenMember
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
  const [activeDistrictKey, setActiveDistrictKey] = useState<string | null>(
    null
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
  const metricValues = useMemo(
    () =>
      nationalDistricts.flatMap((district) => {
        const summary = district.properties.summary;
        return summary.memberCount > 0 && summary.metricMemberCount > 0
          ? [summary.metric]
          : [];
      }),
    [nationalDistricts]
  );
  const metricSeverityScale = useMemo(
    () => createMapSeverityScale(metricValues),
    [metricValues]
  );

  const coloredCartogramCells = useMemo<ColoredCartogramCell[]>(() => {
    if (nationalDistricts.length === 0) {
      return [];
    }

    const normalizeMetric = createLogNormalizer(metricValues);

    return buildDistrictCartogram(nationalDistricts).map(
      ({ h3Index, feature }) => {
        const summary = feature.properties.summary;
        const hasMetric =
          summary.memberCount > 0 && summary.metricMemberCount > 0;
        const [red, green, blue, alpha] = !hasMetric
          ? UNMATCHED_COLOR
          : getSequentialMetricColor(normalizeMetric(summary.metric));

        return {
          districtKey: feature.properties.districtKey,
          fillColor: `rgba(${red}, ${green}, ${blue}, ${alpha / 255})`,
          h3Index,
          label: feature.properties.label,
          memberCount: summary.memberCount,
          memberIds: summary.memberIds,
          memberNames: summary.memberNames,
          memberParties: summary.memberParties,
          metric: hasMetric ? summary.metric : null,
          provinceShortName: summary.provinceShortName,
          severity: hasMetric
            ? metricSeverityScale.classify(summary.metric)
            : null
        };
      }
    );
  }, [metricSeverityScale, metricValues, nationalDistricts]);

  const projectedCartogram = useMemo(
    () => projectCartogram(coloredCartogramCells),
    [coloredCartogramCells]
  );
  const activeDistrict = useMemo(
    () =>
      projectedCartogram.districts.find(
        (district) => district.key === activeDistrictKey
      ) ?? null,
    [activeDistrictKey, projectedCartogram.districts]
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
      data-metric={metric}
      data-cartogram-cell-count={coloredCartogramCells.length}
      data-feature-count={nationalDistricts.length}
      data-loaded-provinces={staticState.entries.length}
      data-rendered-feature-count={projectedCartogram.districts.length}
      data-rendered-province-count={projectedCartogram.provinces.length}
      data-renderer="svg-cartogram"
      role="region"
      aria-label={`전국 지역구 ${distributionLabel} 카토그램. 각 지역구를 같은 크기 육각형 하나로 표시하며, 셀 안의 1부터 4까지 단계와 색상으로 ${metricLabel}의 전국 상대 수준을 함께 나타냅니다. 굵은 선과 라벨은 시·도 경계이며, 회색은 자료 없음입니다. 키보드로 세부 값을 확인하려면 목록 보기를 사용하세요.`}
    >
      <div className="v2-national-map__canvas">
        <svg
          className="v2-national-map__svg"
          viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
        >
          {projectedCartogram.districts.map((district) => {
            const metricValue =
              district.metric == null
                ? "자료 없음"
                : formatMapMetric(metric, district.metric);
            const severityLabel = district.severity
              ? `${district.severity.label}, 전국 상위 ${district.severity.topShare}%`
              : "비교 단계 없음";
            const memberLabel =
              district.memberNames.length > 0
                ? district.memberNames
                    .map((name, index) =>
                      `${name} ${district.memberParties[index] ?? ""}`.trim()
                    )
                    .join(", ")
                : "의원 정보 없음";
            const selected = district.key === activeDistrictKey;

            return (
              <path
                key={district.key}
                className={`v2-national-map__district is-${district.severity?.key ?? "missing"}${selected ? " is-active" : ""}`}
                d={district.path}
                fill={district.fillColor}
                fillRule="evenodd"
                vectorEffect="non-scaling-stroke"
                data-district-label={district.label}
                data-severity={district.severity?.label ?? "자료 없음"}
                onClick={() => {
                  const memberId = district.memberIds[0];
                  if (memberId) {
                    onOpenMember(memberId);
                  }
                }}
                onMouseEnter={() => setActiveDistrictKey(district.key)}
                onMouseLeave={() => setActiveDistrictKey(null)}
              >
                <title>{`${district.label}, ${memberLabel}, ${metricLabel} ${metricValue}, ${severityLabel}`}</title>
              </path>
            );
          })}
          {projectedCartogram.districts.map((district) => (
            <g key={`${district.key}-severity`} aria-hidden="true">
              {renderSeverityMarker(district)}
            </g>
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
              <tspan x={province.center[0]} dy="-3">
                {province.label}
              </tspan>
              {province.metric != null ? (
                <tspan
                  className="v2-national-map__province-metric"
                  x={province.center[0]}
                  dy="9"
                >
                  {formatMapMetric(metric, province.metric)}
                </tspan>
              ) : null}
            </text>
          ))}
        </svg>

        {activeDistrict ? (
          <div
            className="v2-national-map__evidence"
            role="status"
            aria-live="polite"
          >
            <div className="v2-national-map__evidence-heading">
              <div>
                <span>{activeDistrict.provinceShortName}</span>
                <strong>{activeDistrict.label}</strong>
              </div>
              <em className={`is-${activeDistrict.severity?.key ?? "missing"}`}>
                {activeDistrict.severity?.label ?? "자료 없음"}
              </em>
            </div>
            <dl>
              <div>
                <dt>{metricLabel}</dt>
                <dd>
                  {activeDistrict.metric == null
                    ? "—"
                    : formatMapMetric(metric, activeDistrict.metric)}
                </dd>
              </div>
              <div>
                <dt>전국 기준</dt>
                <dd>
                  {activeDistrict.severity
                    ? `상위 ${activeDistrict.severity.topShare}%`
                    : "비교 불가"}
                </dd>
              </div>
              <div>
                <dt>중앙값 대비</dt>
                <dd>
                  {activeDistrict.metric == null
                    ? "—"
                    : formatMapMetricDelta(
                        metric,
                        activeDistrict.metric - metricSeverityScale.median
                      )}
                </dd>
              </div>
            </dl>
            <p>
              {activeDistrict.memberNames.length > 0
                ? activeDistrict.memberNames
                    .map(
                      (name, index) =>
                        `${name} · ${activeDistrict.memberParties[index] ?? "정당 정보 없음"}`
                    )
                    .join(" / ")
                : "연결된 의원 정보가 없습니다."}
            </p>
            {activeDistrict.memberIds.length > 0 ? (
              <span>셀을 클릭하면 의원 상세로 이동합니다.</span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div
        className="v2-national-map__severity-legend"
        aria-label={`${metricLabel} 비교 단계. 실제 값과 전국 순위를 함께 확인할 수 있습니다.`}
      >
        <div>
          <strong>{metricLabel} 비교 단계</strong>
          <span>
            셀 숫자와 색상을 함께 보세요 · 전국 중앙값{" "}
            {formatMapMetric(metric, metricSeverityScale.median)}
          </span>
        </div>
        <ol>
          {MAP_SEVERITY_BANDS.map((band, index) => (
            <li key={band.key}>
              <b className={`is-${band.key}`}>{index + 1}</b>
              <span>{band.label}</span>
              <small>{band.rangeLabel}</small>
            </li>
          ))}
          <li>
            <b className="is-missing">—</b>
            <span>자료 없음</span>
          </li>
        </ol>
      </div>
    </div>
  );
}
