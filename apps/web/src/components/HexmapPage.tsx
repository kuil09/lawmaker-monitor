import { WebMercatorViewport } from "@deck.gl/core";
import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { GeoJsonLayer } from "@deck.gl/layers";
import DeckGL from "@deck.gl/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Map as MapGL } from "react-map-gl/maplibre";

import type {
  AccountabilitySummaryExport,
  Manifest,
  MemberAssetsIndexExport
} from "@lawmaker-monitor/schemas";

import { normalizeConstituencyLookupKey } from "../lib/constituency-map.js";
import { formatAssetEok } from "../lib/format.js";
import {
  endPerformanceSpan,
  getHexCellsBounds,
  hydrateHexCells,
  startPerformanceSpan,
  type SummaryItem
} from "../lib/hex-cells.js";
import type { ExtrudedFeature, H3DataCell } from "../lib/geo-utils.js";
import {
  createLogNormalizer,
  getMetricModulatedColor,
  getPartyColor
} from "../lib/geo-utils.js";
import {
  ensureHexmapStaticLoad,
  getHexmapStaticSessionKey,
  getHexmapStaticState,
  subscribeHexmapStaticState
} from "../lib/hexmap-static-loader.js";
import type { MapMetric, MapRouteArgs } from "../lib/map-route.js";

const MAP_STYLE = {
  version: 8 as const,
  sources: {
    carto: {
      type: "raster" as const,
      tiles: ["https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors © CARTO"
    }
  },
  layers: [{ id: "carto", type: "raster" as const, source: "carto" }]
};

const INITIAL_VIEW_STATE = {
  longitude: 127.8,
  latitude: 36.5,
  zoom: 6.2,
  minZoom: 5,
  maxZoom: 10,
  pitch: 0,
  bearing: 0
};

const INITIAL_DETAIL_VIEW_STATE = {
  longitude: 127.8,
  latitude: 36.5,
  zoom: 6.5,
  pitch: 0,
  bearing: 0,
  minZoom: 5,
  maxZoom: 14
};

const UNMATCHED_CELL_COLOR: [number, number, number, number] = [204, 210, 216, 190];
const NATIONAL_POLYGON_MAX_ZOOM = 5.8;

type TooltipDatum = Omit<H3DataCell, "h3Index">;
type NationalDistrictFeature = ExtrudedFeature & {
  properties: ExtrudedFeature["properties"] & {
    summary: TooltipDatum;
  };
};

type TooltipInfo = {
  x: number;
  y: number;
  datum: TooltipDatum;
};

type VizConfig = {
  key: MapMetric;
  label: string;
  description: string;
  tooltipLabel: (cell: TooltipDatum) => string;
};

function isAssetMetric(metric: MapMetric): metric is "realEstate" | "assetTotal" {
  return metric === "realEstate" || metric === "assetTotal";
}

function getAssetMetricLabel(metric: "realEstate" | "assetTotal"): string {
  return metric === "realEstate" ? "부동산" : "총재산";
}

const VIZ_CONFIGS: VizConfig[] = [
  {
    key: "absence",
    label: "결석 핫스팟",
    description:
      "타일 색 진하기 = 결석률 평균(로그 정규화). 색상 hue는 셀 내 다수당을 따르며, 같은 정당 안에서는 값이 높을수록 더 진합니다.",
    tooltipLabel: (cell) => `결석률 ${(cell.metric * 100).toFixed(1)}%`
  },
  {
    key: "negative",
    label: "반대·기권 인덱스",
    description:
      "타일 색 진하기 = 반대·기권율 평균(로그 정규화). 색상 hue는 셀 내 다수당을 따르며, 같은 정당 안에서는 값이 높을수록 더 진합니다.",
    tooltipLabel: (cell) => `반대·기권율 ${(cell.metric * 100).toFixed(1)}%`
  },
  {
    key: "realEstate",
    label: "부동산",
    description:
      "타일 색 hue는 셀 내 다수당을 따르며, 같은 정당 안에서는 최신 공개 부동산(건물·토지 합계)이 클수록 더 진하게 보입니다. 재산 공개가 없는 지역구는 회색으로 둡니다.",
    tooltipLabel: (cell) => `최신 부동산 ${formatAssetEok(cell.metric)}`
  },
  {
    key: "assetTotal",
    label: "총재산",
    description:
      "타일 색 hue는 셀 내 다수당을 따르며, 같은 정당 안에서는 최신 공개 총재산이 클수록 더 진하게 보입니다. 재산 공개가 없는 지역구는 회색으로 둡니다.",
    tooltipLabel: (cell) => `최신 총재산 ${formatAssetEok(cell.metric)}`
  }
];

type HexmapPageProps = {
  manifest: Manifest | null;
  accountabilitySummary: AccountabilitySummaryExport | null;
  memberAssetsIndex: MemberAssetsIndexExport | null;
  memberAssetsIndexError?: string | null;
  assemblyLabel: string;
  initialProvince: string | null;
  initialDistrict: string | null;
  initialMetric: MapMetric;
  onNavigateToMember: (memberId: string) => void;
  onChangeRoute: (args: MapRouteArgs) => void;
};

export function HexmapPage({
  manifest,
  accountabilitySummary,
  memberAssetsIndex,
  memberAssetsIndexError,
  assemblyLabel,
  initialProvince,
  initialDistrict,
  initialMetric,
  onNavigateToMember,
  onChangeRoute
}: HexmapPageProps) {
  const [activeMetric, setActiveMetric] = useState<MapMetric>(initialMetric);
  const [selectedDistrictKey, setSelectedDistrictKey] = useState<string | null>(
    normalizeConstituencyLookupKey(initialDistrict) || null
  );
  const [selectedProvinceFilter, setSelectedProvinceFilter] = useState<string | null>(
    initialDistrict ? null : initialProvince
  );
  const [staticState, setStaticState] = useState(() => getHexmapStaticState(manifest));
  const [nationalTooltip, setNationalTooltip] = useState<TooltipInfo | null>(null);
  const [detailTooltip, setDetailTooltip] = useState<TooltipInfo | null>(null);
  const [nationalViewState, setNationalViewState] = useState(INITIAL_VIEW_STATE);
  const [detailViewState, setDetailViewState] = useState(INITIAL_DETAIL_VIEW_STATE);

  const onChangeRouteRef = useRef(onChangeRoute);
  onChangeRouteRef.current = onChangeRoute;

  const isMountedRef = useRef(false);
  const firstVisibleSpanRef = useRef<ReturnType<typeof startPerformanceSpan> | null>(null);
  const layerReadySpanRef = useRef<ReturnType<typeof startPerformanceSpan> | null>(null);
  const districtPanelSpanRef = useRef<ReturnType<typeof startPerformanceSpan> | null>(null);
  const metricSwitchSpanRef = useRef<ReturnType<typeof startPerformanceSpan> | null>(null);
  const sessionKey = getHexmapStaticSessionKey(manifest);

  useEffect(() => {
    setActiveMetric((current) => {
      if (current === initialMetric) {
        return current;
      }

      metricSwitchSpanRef.current = startPerformanceSpan("hexmap:metricSwitchReady");
      return initialMetric;
    });
  }, [initialMetric]);

  useEffect(() => {
    const nextDistrictKey = normalizeConstituencyLookupKey(initialDistrict) || null;
    const nextProvince = nextDistrictKey ? null : initialProvince;

    if (nextDistrictKey || nextProvince) {
      districtPanelSpanRef.current = startPerformanceSpan("hexmap:districtPanelReady");
    }

    setSelectedDistrictKey(nextDistrictKey);
    setSelectedProvinceFilter(nextProvince);
    setNationalTooltip(null);
    setDetailTooltip(null);
  }, [initialDistrict, initialProvince]);

  const summaryItems = useMemo<SummaryItem[]>(() => {
    if (!accountabilitySummary) {
      return [];
    }

    const assetByMemberId = new Map(
      (memberAssetsIndex?.members ?? []).map((entry) => [
        entry.memberId,
        {
          assetTotal: entry.latestTotal,
          realEstateTotal: entry.latestRealEstateTotal ?? null
        }
      ] as const)
    );

    return accountabilitySummary.items.flatMap((item) => {
      if (!item.district) {
        return [];
      }

      const assetSummary = assetByMemberId.get(item.memberId);

      return [{
        memberId: item.memberId,
        name: item.name,
        party: item.party,
        district: item.district,
        absentRate: item.absentRate,
        noRate: item.noRate,
        abstainRate: item.abstainRate,
        realEstateTotal: assetSummary?.realEstateTotal ?? null,
        assetTotal: assetSummary?.assetTotal ?? null
      }];
    });
  }, [accountabilitySummary, memberAssetsIndex]);

  useEffect(() => {
    setStaticState(getHexmapStaticState(manifest));
    return subscribeHexmapStaticState(manifest, setStaticState);
  }, [manifest, sessionKey]);

  useEffect(() => {
    setNationalTooltip(null);
    setDetailTooltip(null);
    firstVisibleSpanRef.current = startPerformanceSpan("hexmap:firstVisibleHexCells");
    layerReadySpanRef.current = startPerformanceSpan("hexmap:layerReady");

    void ensureHexmapStaticLoad(manifest, { source: "map" });
  }, [manifest, sessionKey]);

  const allCachedCells = useMemo(
    () => staticState.entries.flatMap((entry) => entry.cells),
    [staticState.entries]
  );
  const loadProgress =
    staticState.total > 0
      ? { done: staticState.done, total: staticState.total }
      : null;
  const isLoading = staticState.isLoading;
  const error = staticState.error;

  const nationalCells = useMemo(() => {
    if (!accountabilitySummary || staticState.entries.length === 0) {
      return [];
    }

    const hydrateSpan = startPerformanceSpan("hexmap:metricHydrate");
    const cells = staticState.entries.flatMap((entry) =>
      hydrateHexCells(entry.cells, summaryItems, activeMetric)
    );
    endPerformanceSpan(hydrateSpan);

    return cells;
  }, [accountabilitySummary, activeMetric, staticState.entries, summaryItems]);

  useEffect(() => {
    if (firstVisibleSpanRef.current && nationalCells.length > 0) {
      endPerformanceSpan(firstVisibleSpanRef.current);
      firstVisibleSpanRef.current = null;
    }

    if (layerReadySpanRef.current && !staticState.isLoading && staticState.entries.length > 0) {
      endPerformanceSpan(layerReadySpanRef.current);
      layerReadySpanRef.current = null;
    }

    if (metricSwitchSpanRef.current && (nationalCells.length > 0 || !staticState.isLoading)) {
      endPerformanceSpan(metricSwitchSpanRef.current);
      metricSwitchSpanRef.current = null;
    }
  }, [nationalCells.length, staticState.entries.length, staticState.isLoading]);

  useEffect(() => {
    if (!selectedDistrictKey && !selectedProvinceFilter) {
      setDetailViewState(INITIAL_DETAIL_VIEW_STATE);
      return;
    }

    if (!districtPanelSpanRef.current) {
      districtPanelSpanRef.current = startPerformanceSpan("hexmap:districtPanelReady");
    }
  }, [selectedDistrictKey, selectedProvinceFilter]);

  const vizConfig = VIZ_CONFIGS.find((config) => config.key === activeMetric) ?? VIZ_CONFIGS[0]!;

  const partiesPresent = useMemo(() => {
    const seen = new Map<string, [number, number, number, number]>();

    for (const cell of nationalCells) {
      if (cell.memberCount === 0 || !cell.party) {
        continue;
      }

      if (!seen.has(cell.party)) {
        seen.set(cell.party, getPartyColor(cell.party));
      }
    }

    return [...seen.entries()]
      .sort((left, right) => left[0].localeCompare(right[0], "ko"))
      .map(([party, color]) => ({ party, color }));
  }, [nationalCells]);

  const districtSummaryByKey = useMemo(() => {
    const summaryByKey = new Map<string, TooltipDatum>();

    for (const cell of nationalCells) {
      if (summaryByKey.has(cell.districtKey)) {
        continue;
      }

      const { h3Index: _h3Index, ...summary } = cell;
      summaryByKey.set(cell.districtKey, summary);
    }

    return summaryByKey;
  }, [nationalCells]);

  const nationalDistricts = useMemo<NationalDistrictFeature[]>(() => {
    return staticState.entries.flatMap((entry) =>
      (entry.districts ?? []).map((district) => ({
        ...district,
        properties: {
          ...district.properties,
          summary: districtSummaryByKey.get(district.properties.districtKey) ?? {
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
    );
  }, [districtSummaryByKey, staticState.entries]);

  function getCellFillColor(
    cell: TooltipDatum,
    normalizeMetric: (value: number) => number
  ): [number, number, number, number] {
    if (cell.memberCount === 0) {
      return UNMATCHED_CELL_COLOR;
    }

    if (isAssetMetric(activeMetric)) {
      if (cell.metricMemberCount === 0) {
        return UNMATCHED_CELL_COLOR;
      }
    }

    return getMetricModulatedColor(cell.party, normalizeMetric(cell.metric));
  }

  const selectedDistrictLabel = useMemo(() => {
    if (!selectedDistrictKey) {
      return null;
    }

    return (
      allCachedCells.find((cell) => cell.districtKey === selectedDistrictKey)?.districtLabel ??
      initialDistrict
    );
  }, [allCachedCells, initialDistrict, selectedDistrictKey]);

  const detailCells = useMemo(() => {
    if (selectedDistrictKey) {
      return nationalCells.filter((cell) => cell.districtKey === selectedDistrictKey);
    }

    if (selectedProvinceFilter) {
      return nationalCells.filter((cell) => cell.provinceShortName === selectedProvinceFilter);
    }

    return [];
  }, [nationalCells, selectedDistrictKey, selectedProvinceFilter]);

  const detailBounds = useMemo(() => getHexCellsBounds(detailCells), [detailCells]);

  useEffect(() => {
    if (!detailBounds) {
      return;
    }

    const [[minLng, minLat], [maxLng, maxLat]] = detailBounds;

    try {
      const viewport = new WebMercatorViewport({ width: 900, height: 480 });
      const { longitude, latitude, zoom } = viewport.fitBounds(detailBounds, { padding: 48 });
      setDetailViewState((current) => ({
        ...current,
        longitude,
        latitude,
        zoom: Math.min(zoom, 12),
        pitch: 0,
        bearing: 0
      }));
    } catch {
      const span = Math.max(maxLng - minLng, (maxLat - minLat) * 1.3, 0.1);
      setDetailViewState((current) => ({
        ...current,
        longitude: (minLng + maxLng) / 2,
        latitude: (minLat + maxLat) / 2,
        zoom: Math.min(11, Math.max(6, Math.log2(360 / span) - 1.5)),
        pitch: 0,
        bearing: 0
      }));
    }

    if (districtPanelSpanRef.current) {
      endPerformanceSpan(districtPanelSpanRef.current);
      districtPanelSpanRef.current = null;
    }
  }, [detailBounds]);

  useEffect(() => {
    if (!isMountedRef.current) {
      isMountedRef.current = true;
      return;
    }

    onChangeRouteRef.current({
      district: selectedDistrictKey,
      province: selectedDistrictKey ? null : selectedProvinceFilter,
      metric: activeMetric
    });
  }, [activeMetric, selectedDistrictKey, selectedProvinceFilter]);

  const nationalLayers = useMemo(() => {
    if (nationalCells.length === 0) {
      return [];
    }

    const normalizeMetric = createLogNormalizer(
      nationalCells.filter((cell) => cell.metricMemberCount > 0).map((cell) => cell.metric)
    );

    if (nationalViewState.zoom <= NATIONAL_POLYGON_MAX_ZOOM && nationalDistricts.length > 0) {
      return [
        new GeoJsonLayer<NationalDistrictFeature>({
          id: `district-national-${activeMetric}`,
          data: nationalDistricts,
          filled: true,
          stroked: true,
          getFillColor: (feature) =>
            getCellFillColor(
              (feature as unknown as NationalDistrictFeature).properties.summary,
              normalizeMetric
            ),
          getLineColor: [255, 255, 255, 110],
          lineWidthMinPixels: 1,
          pickable: true,
          onHover: (info) => {
            const feature = info.object as unknown as NationalDistrictFeature | undefined;
            if (feature && info.x !== undefined && info.y !== undefined) {
              setNationalTooltip({ x: info.x, y: info.y, datum: feature.properties.summary });
              return;
            }

            setNationalTooltip(null);
          },
          onClick: (info) => {
            const feature = info.object as unknown as NationalDistrictFeature | undefined;
            if (!feature) {
              return;
            }

            districtPanelSpanRef.current = startPerformanceSpan("hexmap:districtPanelReady");
            setSelectedDistrictKey(feature.properties.summary.districtKey);
            setSelectedProvinceFilter(null);
            setNationalTooltip(null);
            setDetailTooltip(null);
          }
        })
      ];
    }

    return [
      new H3HexagonLayer<H3DataCell>({
        id: `h3-national-${activeMetric}`,
        data: nationalCells,
        getHexagon: (cell) => cell.h3Index,
        getFillColor: (cell) => getCellFillColor(cell, normalizeMetric),
        getLineColor: [255, 255, 255, 40],
        lineWidthMinPixels: 1,
        extruded: false,
        pickable: true,
        onHover: (info) => {
          if (info.object && info.x !== undefined && info.y !== undefined) {
            const { h3Index: _h3Index, ...datum } = info.object;
            setNationalTooltip({ x: info.x, y: info.y, datum });
            return;
          }

          setNationalTooltip(null);
        },
        onClick: (info) => {
          if (!info.object) {
            return;
          }

          districtPanelSpanRef.current = startPerformanceSpan("hexmap:districtPanelReady");
          setSelectedDistrictKey(info.object.districtKey);
          setSelectedProvinceFilter(null);
          setNationalTooltip(null);
          setDetailTooltip(null);
        }
      })
    ];
  }, [activeMetric, nationalCells, nationalDistricts, nationalViewState.zoom]);

  const detailLayers = useMemo(() => {
    if (detailCells.length === 0) {
      return [];
    }

    const normalizeMetric = createLogNormalizer(
      detailCells.filter((cell) => cell.metricMemberCount > 0).map((cell) => cell.metric)
    );
    const filterKey = selectedDistrictKey ?? selectedProvinceFilter ?? "none";

    return [
      new H3HexagonLayer<H3DataCell>({
        id: `h3-panel-${activeMetric}-${filterKey}`,
        data: detailCells,
        getHexagon: (cell) => cell.h3Index,
        getFillColor: (cell) => getCellFillColor(cell, normalizeMetric),
        getLineColor: [255, 255, 255, 40],
        lineWidthMinPixels: 1,
        extruded: false,
        pickable: true,
        onHover: (info) => {
          if (info.object && info.x !== undefined && info.y !== undefined) {
            const { h3Index: _h3Index, ...datum } = info.object;
            setDetailTooltip({ x: info.x, y: info.y, datum });
            return;
          }

          setDetailTooltip(null);
        },
        onClick: (info) => {
          const memberId = info.object?.memberIds[0];
          if (memberId) {
            onNavigateToMember(memberId);
          }
        }
      })
    ];
  }, [activeMetric, detailCells, onNavigateToMember, selectedDistrictKey, selectedProvinceFilter]);

  const detailPanelLabel = selectedDistrictKey ? selectedDistrictLabel : selectedProvinceFilter;
  const isFilterPending =
    Boolean(selectedDistrictKey || selectedProvinceFilter) &&
    detailCells.length === 0 &&
    (isLoading || !accountabilitySummary);
  const partyLegendDescription = isAssetMetric(activeMetric)
    ? `${getAssetMetricLabel(activeMetric)} 비교에서도 색상은 정당별로 나뉘며, 같은 정당 안에서는 ${
        activeMetric === "realEstate" ? "부동산 규모" : "재산 규모"
      }가 클수록 더 진합니다.`
    : "색상은 정당별로 구분되며, 같은 정당 안에서는 값이 높을수록 더 진합니다.";

  function renderTooltipContent(info: TooltipInfo, hint: string | null) {
    const { datum: cell } = info;
    const [red, green, blue] =
      cell.memberCount > 0 ? getPartyColor(cell.party) : UNMATCHED_CELL_COLOR;
    const dotStyle = { background: `rgb(${red},${green},${blue})` };
    const assetMetricLabel = isAssetMetric(activeMetric) ? getAssetMetricLabel(activeMetric) : null;

    return (
      <div className="hexmap-tooltip" style={{ left: info.x + 12, top: info.y - 72 }}>
        <div className="hexmap-tooltip__party">{cell.districtLabel}</div>
        {cell.memberCount > 0 ? (
          <>
            <div className="hexmap-tooltip__member">
              <span className="hexmap-tooltip__party-dot" style={dotStyle} aria-hidden="true" />
              <span className="hexmap-tooltip__name">
                {cell.memberCount === 1
                  ? cell.memberNames[0]
                  : `${cell.memberNames[0]} 외 ${cell.memberCount - 1}명`}
              </span>
            </div>
            <div className="hexmap-tooltip__party">
              {cell.memberCount === 1 ? cell.party : `다수당: ${cell.party}`}
            </div>
            <div className="hexmap-tooltip__value">
              {assetMetricLabel && cell.metricMemberCount === 0
                ? `최신 ${assetMetricLabel} 공개 데이터가 없어 중립 타일로 표시됩니다.`
                : vizConfig.tooltipLabel(cell)}
            </div>
          </>
        ) : (
          <div className="hexmap-tooltip__value">
            {assetMetricLabel
              ? "현재 공개된 의원 재산 데이터가 없어 중립 타일로 표시됩니다."
              : "현재 공개된 의원 활동 데이터가 없어 중립 타일로 표시됩니다."}
          </div>
        )}
        {hint ? <div className="hexmap-tooltip__hint">{hint}</div> : null}
      </div>
    );
  }

  return (
    <div className="hexmap-page">
      <div className="hexmap-page__header">
        <h1 className="hexmap-page__title">의원 활동·재산 지도</h1>
        <p className="hexmap-page__subtitle">
          {assemblyLabel} 의원 활동과 재산 공개 데이터를 전국 상세 H3 격자로 탐색합니다.
        </p>
      </div>

      <div className="hexmap-disclaimer">
        비례대표 의원은 지역구가 없어 표시되지 않으며, 공석 또는 매칭되지 않은 지역은 회색 타일로 유지합니다.
        {isAssetMetric(activeMetric) &&
          ` · ${getAssetMetricLabel(activeMetric)} 비교는 ${
            activeMetric === "realEstate" ? "최신 공개 건물·토지 합계" : "최신 공개 총재산"
          } 기준이며, 공개 데이터가 없는 지역구는 중립 타일로 남깁니다.`}
        {loadProgress &&
          ` · ${loadProgress.total}개 시·도 중 ${loadProgress.done}개 상세 격자 로드 완료`}
        {nationalCells.length > 0 && ` · ${nationalCells.length}개 상세 셀`}
      </div>

      <div className="hexmap-metric-selector" role="tablist" aria-label="시각화 지표 선택">
        {VIZ_CONFIGS.map((config) => (
          <button
            key={config.key}
            role="tab"
            aria-selected={activeMetric === config.key}
            className={`hexmap-metric-tab${activeMetric === config.key ? " hexmap-metric-tab--active" : ""}`}
            onClick={() => {
              if (config.key !== activeMetric) {
                metricSwitchSpanRef.current = startPerformanceSpan("hexmap:metricSwitchReady");
              }
              setNationalTooltip(null);
              setDetailTooltip(null);
              setActiveMetric(config.key);
            }}
          >
            {config.label}
          </button>
        ))}
      </div>

      <p className="hexmap-viz-description">{vizConfig.description}</p>
      {isAssetMetric(activeMetric) && memberAssetsIndexError ? (
        <p className="hexmap-viz-warning">{memberAssetsIndexError}</p>
      ) : null}

      <section className="hexmap-section hexmap-section--national">
        {partiesPresent.length > 0 && (
          <div className="hexmap-party-legend" aria-label="정당 범례">
            <div className="hexmap-party-legend__copy">
              <span className="hexmap-party-legend__heading">정당</span>
              <span className="hexmap-party-legend__description">{partyLegendDescription}</span>
            </div>
            {partiesPresent.map(({ party, color: [red, green, blue] }) => (
              <span key={party} className="hexmap-party-legend__item">
                <span
                  className="hexmap-party-legend__dot"
                  style={{ background: `rgb(${red},${green},${blue})` }}
                  aria-hidden="true"
                />
                {party}
              </span>
            ))}
          </div>
        )}

        <div
          className={`hexmap-map-container${
            error && nationalCells.length === 0 ? " hexmap-map-container--error" : ""
          }`}
        >
          {error && nationalCells.length === 0 ? (
            <div className="hexmap-state">
              <div className="hexmap-state__title">데이터를 불러오지 못했습니다</div>
              <p>{error}</p>
            </div>
          ) : nationalCells.length === 0 ? (
            <div className="hexmap-state">
              <div className="hexmap-state__title">
                {isLoading ? "전국 상세 격자 로딩 중…" : "지도 데이터를 준비 중입니다"}
              </div>
              <p>
                {!accountabilitySummary
                  ? "활동 데이터를 불러오고 있습니다."
                  : loadProgress
                    ? `${loadProgress.total}개 시·도 중 ${loadProgress.done}개 완료`
                    : "선거구 경계 데이터를 불러오는 중입니다."}
              </p>
            </div>
          ) : (
            <>
              <DeckGL
                initialViewState={INITIAL_VIEW_STATE}
                onViewStateChange={({ viewState }) => {
                  setNationalViewState(viewState as typeof INITIAL_VIEW_STATE);
                }}
                controller
                layers={nationalLayers}
              >
                <MapGL mapStyle={MAP_STYLE} />
              </DeckGL>
              {isLoading && (
                <div className="hexmap-computing-overlay">
                  전국 상세 격자 로딩 중…
                  {loadProgress ? ` ${loadProgress.done}/${loadProgress.total}` : ""}
                </div>
              )}
            </>
          )}

          {nationalTooltip && nationalCells.length > 0 && (
            renderTooltipContent(nationalTooltip, "클릭 → 아래에서 확대")
          )}
        </div>
      </section>

      <p className="hexmap-footer-note">
        데이터: 공개 기록표결·재산공개 기준 · 지도: © OpenStreetMap contributors © CARTO · 시각화: deck.gl · 격자: Uber H3
      </p>

      <section className="hexmap-section hexmap-section--detail">
        <div className="hexmap-section-divider">
          <div className="hexmap-detail-header">
            <div>
              <h2 className="hexmap-section-title">선택 지역구 확대 보기</h2>
              <p className="hexmap-section-desc">
                {selectedDistrictKey
                  ? `${selectedDistrictLabel ?? selectedDistrictKey}만 확대해 보여줍니다.`
                  : selectedProvinceFilter
                    ? `${selectedProvinceFilter} 전체 지역구를 레거시 링크 호환 모드로 보여줍니다.`
                    : "상단 전국 지도에서 지역구를 클릭하면 아래에서 해당 지역구만 확대합니다."}
                {" "}헥사곤을 클릭하면 해당 의원의 활동 캘린더로 이동합니다.
              </p>
            </div>
            {(selectedDistrictKey || selectedProvinceFilter) && (
              <button
                type="button"
                className="hexmap-detail-reset"
                onClick={() => {
                  setSelectedDistrictKey(null);
                  setSelectedProvinceFilter(null);
                  setDetailTooltip(null);
                }}
              >
                선택 해제
              </button>
            )}
          </div>
        </div>

        {detailPanelLabel && detailCells.length > 0 && (
          <div className="hexmap-detail-summary">
            <span className="hexmap-detail-badge">
              {selectedDistrictKey ? "지역구" : "시·도"}
            </span>
            <strong>{detailPanelLabel}</strong>
            <span>{detailCells.length}개 셀</span>
          </div>
        )}

        <div className="hexmap-map-container">
          {!selectedDistrictKey && !selectedProvinceFilter ? (
            <div className="hexmap-state">
              <div className="hexmap-state__title">아직 선택된 지역구가 없습니다</div>
              <p>상단 전국 지도에서 지역구를 클릭하면 이 영역에 확대 지도가 나타납니다.</p>
            </div>
          ) : isFilterPending ? (
            <div className="hexmap-state">
              <div className="hexmap-state__title">
                {detailPanelLabel ?? "선택 지역"} 데이터를 불러오는 중…
              </div>
              <p>브라우저 캐시를 확인하고 필요한 시·도만 순차적으로 계산합니다.</p>
            </div>
          ) : detailCells.length === 0 ? (
            <div className="hexmap-state">
              <div className="hexmap-state__title">표시할 지역구 데이터를 찾지 못했습니다</div>
              <p>선택한 필터와 현재 공개된 비교 데이터를 다시 확인해 주세요.</p>
            </div>
          ) : (
            <DeckGL
              viewState={detailViewState}
              onViewStateChange={({ viewState }) => {
                setDetailViewState(viewState as typeof detailViewState);
              }}
              controller
              layers={detailLayers}
            >
              <MapGL mapStyle={MAP_STYLE} />
            </DeckGL>
          )}

          {detailTooltip && detailCells.length > 0 && (
            renderTooltipContent(detailTooltip, "클릭 → 활동 캘린더")
          )}
        </div>
      </section>
    </div>
  );
}
