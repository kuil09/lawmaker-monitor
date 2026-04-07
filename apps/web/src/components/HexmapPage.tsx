import { WebMercatorViewport } from "@deck.gl/core";
import { H3HexagonLayer } from "@deck.gl/geo-layers";
import DeckGL from "@deck.gl/react";
import { cellToParent, latLngToCell } from "h3-js";
import { useEffect, useMemo, useRef, useState } from "react";
import { Map as MapGL } from "react-map-gl/maplibre";

import type {
  AccountabilitySummaryExport,
  ConstituencyBoundariesIndexExport,
  Manifest
} from "@lawmaker-monitor/schemas";

import type { ConstituencyBoundaryTopology } from "../lib/constituency-map.js";
import { normalizeConstituencyLookupKey } from "../lib/constituency-map.js";
import {
  loadConstituencyBoundariesIndex,
  loadConstituencyProvinceTopology
} from "../lib/data.js";
import type { ExtrudedFeature, H3BgCell, H3DataCell, MemberGeoPoint } from "../lib/geo-utils.js";
import {
  createLogNormalizer,
  extractCentroids,
  extractReprojectedFeatures,
  getMetricModulatedColor,
  getPartyColor
} from "../lib/geo-utils.js";
import { useHexCellsWorker } from "../lib/hex-cells-worker.js";
import type { MapMetric } from "../lib/map-route.js";

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
  zoom: 6.5,
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

const BG_RES = 4;
const DATA_RES = 5;

type AnnotatedPoint = MemberGeoPoint & {
  memberId: string;
  name: string;
  party: string;
  absentRate: number;
  negativeRate: number;
};

type WorkerSummaryItem = {
  memberId: string;
  name: string;
  party: string;
  district: string;
  absentRate: number;
  noRate: number;
  abstainRate: number;
};

type TooltipInfo = {
  x: number;
  y: number;
  cell: H3DataCell;
};

type VizConfig = {
  key: MapMetric;
  label: string;
  description: string;
  getMetric: (p: AnnotatedPoint) => number;
  tooltipLabel: (cell: H3DataCell) => string;
};

const VIZ_CONFIGS: VizConfig[] = [
  {
    key: "absence",
    label: "결석 핫스팟",
    description: "타일 색 진하기 = 결석률 평균(로그 정규화). 색상 hue는 셀 내 다수당을 따르며, 같은 정당 안에서는 값이 높을수록 더 진합니다.",
    getMetric: (p) => p.absentRate,
    tooltipLabel: (c) => `결석률 ${(c.metric * 100).toFixed(1)}%`
  },
  {
    key: "negative",
    label: "반대·기권 인덱스",
    description: "타일 색 진하기 = 반대·기권율 평균(로그 정규화). 색상 hue는 셀 내 다수당을 따르며, 같은 정당 안에서는 값이 높을수록 더 진합니다.",
    getMetric: (p) => p.negativeRate,
    tooltipLabel: (c) => `반대·기권율 ${(c.metric * 100).toFixed(1)}%`
  },
];

type HexmapPageProps = {
  manifest: Manifest | null;
  accountabilitySummary: AccountabilitySummaryExport | null;
  assemblyLabel: string;
  initialProvince: string | null;
  initialMetric: MapMetric;
  onNavigateToMember: (memberId: string) => void;
  onChangeRoute: (province: string | null, metric: MapMetric) => void;
};

export function HexmapPage({
  manifest,
  accountabilitySummary,
  assemblyLabel,
  initialProvince,
  initialMetric,
  onNavigateToMember,
  onChangeRoute
}: HexmapPageProps) {
  const [activeMetric, setActiveMetric] = useState<MapMetric>(initialMetric);
  const [allPoints, setAllPoints] = useState<MemberGeoPoint[]>([]);
  const [loadProgress, setLoadProgress] = useState<{ done: number; total: number } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null);

  const [boundaryIndex, setBoundaryIndex] =
    useState<ConstituencyBoundariesIndexExport | null>(null);
  const [detailProvince, setDetailProvince] = useState<string | null>(initialProvince);
  const [detailTopology, setDetailTopology] = useState<
    ConstituencyBoundaryTopology | null | undefined
  >(undefined);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [detailViewState, setDetailViewState] = useState(INITIAL_DETAIL_VIEW_STATE);
  const [detailTooltip, setDetailTooltip] = useState<TooltipInfo | null>(null);

  const { cells: workerCells, status: workerStatus, compute } = useHexCellsWorker();

  // Stable ref for onChangeRoute to avoid effect re-runs when parent re-renders
  const onChangeRouteRef = useRef(onChangeRoute);
  onChangeRouteRef.current = onChangeRoute;

  // Skip URL sync on initial mount
  const isMountedRef = useRef(false);

  // Load boundary index + centroids for national map
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);

      try {
        const index = await loadConstituencyBoundariesIndex(manifest);
        if (!index || index.provinces.length === 0) {
          setError("선거구 경계 데이터를 불러오지 못했습니다.");
          return;
        }
        if (!cancelled) setBoundaryIndex(index);

        const total = index.provinces.length;
        setLoadProgress({ done: 0, total });
        let done = 0;

        const topologies = await Promise.all(
          index.provinces.map(async (province) => {
            const topo = await loadConstituencyProvinceTopology<ConstituencyBoundaryTopology>(
              province.path
            );
            if (!cancelled) setLoadProgress({ done: ++done, total });
            return topo;
          })
        );

        if (cancelled) return;

        const points: MemberGeoPoint[] = [];
        for (const topo of topologies) {
          if (topo) points.push(...extractCentroids(topo));
        }
        if (!cancelled) setAllPoints(points);
      } catch (err) {
        if (!cancelled) setError(`데이터 로딩 중 오류: ${(err as Error).message}`);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
          setLoadProgress(null);
        }
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [manifest]);

  // Auto-select first province once boundary index loads
  useEffect(() => {
    if (boundaryIndex && !detailProvince) {
      setDetailProvince(boundaryIndex.provinces[0]?.provinceShortName ?? null);
    }
  }, [boundaryIndex, detailProvince]);

  const annotatedPoints = useMemo<AnnotatedPoint[]>(() => {
    if (!accountabilitySummary || allPoints.length === 0) return [];

    const memberByKey = new Map(
      accountabilitySummary.items.map((item) => [
        normalizeConstituencyLookupKey(item.district),
        item
      ])
    );

    return allPoints.flatMap((p) => {
      const member = memberByKey.get(p.districtKey);
      if (!member) return [];
      return [{
        ...p,
        memberId: member.memberId,
        name: member.name,
        party: member.party,
        absentRate: member.absentRate,
        negativeRate: member.noRate + member.abstainRate
      }];
    });
  }, [allPoints, accountabilitySummary]);

  const vizConfig = VIZ_CONFIGS.find((v) => v.key === activeMetric) ?? VIZ_CONFIGS[0]!;

  const workerItems = useMemo<WorkerSummaryItem[]>(() => {
    if (!accountabilitySummary) return [];

    return accountabilitySummary.items.flatMap((item) => {
      if (!item.district) return [];
      return [{
        memberId: item.memberId,
        name: item.name,
        party: item.party,
        district: item.district,
        absentRate: item.absentRate,
        noRate: item.noRate,
        abstainRate: item.abstainRate
      }];
    });
  }, [accountabilitySummary]);

  // National H3 cell aggregation (centroid-based, fixed res)
  const { dataCells, bgCells } = useMemo<{ dataCells: H3DataCell[]; bgCells: H3BgCell[] }>(() => {
    if (annotatedPoints.length === 0) return { dataCells: [], bgCells: [] };

    const cellMap = new Map<string, AnnotatedPoint[]>();
    for (const p of annotatedPoints) {
      const h3Index = latLngToCell(p.latitude, p.longitude, DATA_RES);
      const existing = cellMap.get(h3Index);
      if (existing) existing.push(p);
      else cellMap.set(h3Index, [p]);
    }

    const data: H3DataCell[] = [];
    const bgSet = new Set<string>();

    for (const [h3Index, points] of cellMap) {
      const partyCounts = new Map<string, number>();
      for (const p of points) {
        partyCounts.set(p.party, (partyCounts.get(p.party) ?? 0) + 1);
      }
      const dominantParty = [...partyCounts.entries()].reduce(
        (a, b) => (b[1] > a[1] ? b : a)
      )[0];

      const avgMetric =
        points.reduce((sum, p) => sum + vizConfig.getMetric(p), 0) / points.length;

      data.push({
        h3Index,
        party: dominantParty,
        metric: avgMetric,
        memberCount: points.length,
        memberNames: points.map((p) => p.name),
        memberParties: points.map((p) => p.party),
        memberIds: points.map((p) => p.memberId)
      });

      bgSet.add(cellToParent(h3Index, BG_RES));
    }

    return {
      dataCells: data,
      bgCells: [...bgSet].map((h3Index) => ({ h3Index }))
    };
  }, [annotatedPoints, vizConfig]);

  const partiesPresent = useMemo(() => {
    const seen = new Map<string, [number, number, number, number]>();
    for (const c of dataCells) {
      if (!seen.has(c.party)) seen.set(c.party, getPartyColor(c.party));
    }
    return [...seen.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], "ko"))
      .map(([party, color]) => ({ party, color }));
  }, [dataCells]);

  const layers = useMemo(() => {
    if (dataCells.length === 0) return [];
    const normalizeMetric = createLogNormalizer(dataCells.map((d) => d.metric));

    const dataLayer = new H3HexagonLayer<H3DataCell>({
      id: `h3-data-${activeMetric}`,
      data: dataCells,
      getHexagon: (d) => d.h3Index,
      getFillColor: (d) => getMetricModulatedColor(d.party, normalizeMetric(d.metric)),
      getLineColor: [255, 255, 255, 40],
      lineWidthMinPixels: 1,
      extruded: false,
      pickable: true,
      onHover: (info) => {
        if (info.object && info.x !== undefined && info.y !== undefined) {
          setTooltip({ x: info.x, y: info.y, cell: info.object });
        } else {
          setTooltip(null);
        }
      }
    });

    return [dataLayer];
  }, [dataCells, activeMetric]);

  // Load topology for selected province
  useEffect(() => {
    if (!boundaryIndex || !detailProvince) return;
    const province = boundaryIndex.provinces.find(
      (p) => p.provinceShortName === detailProvince
    );
    if (!province) return;

    let cancelled = false;
    setIsDetailLoading(true);
    setDetailTopology(undefined);

    void loadConstituencyProvinceTopology<ConstituencyBoundaryTopology>(province.path)
      .then((topo) => { if (!cancelled) setDetailTopology(topo); })
      .catch(() => { if (!cancelled) setDetailTopology(null); })
      .finally(() => { if (!cancelled) setIsDetailLoading(false); });

    return () => { cancelled = true; };
  }, [boundaryIndex, detailProvince]);

  // Reduced-resolution features for fitBounds (step=20 is fine for bounds)
  const detailFeatures = useMemo<ExtrudedFeature[]>(() => {
    if (!detailTopology) return [];
    return extractReprojectedFeatures(detailTopology);
  }, [detailTopology]);

  // Zoom to province bounds when features load
  useEffect(() => {
    if (detailFeatures.length === 0) return;
    let minLng = 180, maxLng = -180, minLat = 90, maxLat = -90;
    for (const f of detailFeatures) {
      const polys =
        f.geometry.type === "Polygon"
          ? [(f.geometry.coordinates as number[][][])]
          : (f.geometry.coordinates as number[][][][]);
      for (const poly of polys) {
        for (const ring of poly) {
          for (const point of ring) {
            const [lng, lat] = point;
            if (lng === undefined || lat === undefined) continue;
            if (lng < minLng) minLng = lng;
            if (lng > maxLng) maxLng = lng;
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
          }
        }
      }
    }
    if (!Number.isFinite(minLng)) return;
    try {
      const vp = new WebMercatorViewport({ width: 900, height: 480 });
      const { longitude, latitude, zoom } = vp.fitBounds(
        [[minLng, minLat], [maxLng, maxLat]],
        { padding: 48 }
      );
      setDetailViewState((prev) => ({
        ...prev,
        longitude,
        latitude,
        zoom: Math.min(zoom, 12)
      }));
    } catch {
      const span = Math.max(maxLng - minLng, (maxLat - minLat) * 1.3, 0.1);
      setDetailViewState((prev) => ({
        ...prev,
        longitude: (minLng + maxLng) / 2,
        latitude: (minLat + maxLat) / 2,
        zoom: Math.min(11, Math.max(6, Math.log2(360 / span) - 1.5))
      }));
    }
  }, [detailFeatures]);

  // Trigger worker when topology or metric changes
  useEffect(() => {
    if (!detailTopology || workerItems.length === 0) return;
    compute(detailTopology, workerItems, activeMetric);
  }, [detailTopology, workerItems, activeMetric, compute]);

  // URL sync — skip initial mount
  useEffect(() => {
    if (!isMountedRef.current) {
      isMountedRef.current = true;
      return;
    }
    onChangeRouteRef.current(detailProvince, activeMetric);
  }, [detailProvince, activeMetric]);

  // Detail map layers using worker output
  const detailLayers = useMemo(() => {
    if (workerCells.length === 0) return [];
    const normalizeMetric = createLogNormalizer(workerCells.map((d) => d.metric));

    return [
      new H3HexagonLayer<H3DataCell>({
        id: `h3-detail-${activeMetric}-${detailProvince ?? ""}`,
        data: workerCells,
        getHexagon: (d) => d.h3Index,
        getFillColor: (d) => getMetricModulatedColor(d.party, normalizeMetric(d.metric)),
        getLineColor: [255, 255, 255, 40],
        lineWidthMinPixels: 1,
        extruded: false,
        pickable: true,
        onHover: (info) => {
          if (info.object && info.x !== undefined && info.y !== undefined) {
            setDetailTooltip({ x: info.x, y: info.y, cell: info.object });
          } else {
            setDetailTooltip(null);
          }
        },
        onClick: (info) => {
          if (!info.object) return;
          const cell = info.object as H3DataCell;
          const memberId = cell.memberIds[0];
          if (cell.memberCount === 1 && memberId) {
            onNavigateToMember(memberId);
          }
        }
      })
    ];
  }, [workerCells, activeMetric, detailProvince, onNavigateToMember]);

  const isWorkerComputing = workerStatus === "loading";

  function renderTooltipContent(info: TooltipInfo) {
    const { cell } = info;
    const [r, g, b] = getPartyColor(cell.party);
    const dotStyle = { background: `rgb(${r},${g},${b})` };

    return (
      <div
        className="hexmap-tooltip"
        style={{ left: info.x + 12, top: info.y - 56 }}
      >
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
        <div className="hexmap-tooltip__value">{vizConfig.tooltipLabel(cell)}</div>
      </div>
    );
  }

  return (
    <div className="hexmap-page">
      <div className="hexmap-page__header">
        <h1 className="hexmap-page__title">의원 지역구 지도</h1>
        <p className="hexmap-page__subtitle">
          {assemblyLabel} 의원 활동 데이터를 H3 헥사곤 격자로 탐색합니다.
        </p>
      </div>

      <div className="hexmap-disclaimer">
        비례대표 의원은 지역구가 없어 표시되지 않습니다.
        {dataCells.length > 0 &&
          ` · ${annotatedPoints.length}명, ${dataCells.length}개 셀 (res ${DATA_RES}) / ${bgCells.length}개 구역 (res ${BG_RES})`}
      </div>

      {/* Metric selector */}
      <div className="hexmap-metric-selector" role="tablist" aria-label="시각화 지표 선택">
        {VIZ_CONFIGS.map((v) => (
          <button
            key={v.key}
            role="tab"
            aria-selected={activeMetric === v.key}
            className={`hexmap-metric-tab${activeMetric === v.key ? " hexmap-metric-tab--active" : ""}`}
            onClick={() => {
              setTooltip(null);
              setDetailTooltip(null);
              setActiveMetric(v.key);
            }}
          >
            {v.label}
          </button>
        ))}
      </div>

      <p className="hexmap-viz-description">{vizConfig.description}</p>

      {/* National map section */}
      <section className="hexmap-section hexmap-section--national">
        {partiesPresent.length > 0 && (
          <div className="hexmap-party-legend" aria-label="정당 범례">
            <span className="hexmap-party-legend__heading">정당</span>
            {partiesPresent.map(({ party, color: [r, g, b] }) => (
              <span key={party} className="hexmap-party-legend__item">
                <span
                  className="hexmap-party-legend__dot"
                  style={{ background: `rgb(${r},${g},${b})` }}
                  aria-hidden="true"
                />
                {party}
              </span>
            ))}
          </div>
        )}

        <div
          className={`hexmap-map-container${
            isLoading
              ? " hexmap-map-container--loading"
              : error
                ? " hexmap-map-container--error"
                : ""
          }`}
        >
          {isLoading ? (
            <div className="hexmap-state">
              <div className="hexmap-state__title">선거구 데이터 로딩 중…</div>
              <p>
                {loadProgress
                  ? `${loadProgress.total}개 시·도 중 ${loadProgress.done}개 완료`
                  : "경계 데이터 인덱스를 불러오는 중입니다."}
              </p>
            </div>
          ) : error ? (
            <div className="hexmap-state">
              <div className="hexmap-state__title">데이터를 불러오지 못했습니다</div>
              <p>{error}</p>
            </div>
          ) : (
            <DeckGL
              initialViewState={INITIAL_VIEW_STATE}
              controller
              layers={layers}
            >
              <MapGL mapStyle={MAP_STYLE} />
            </DeckGL>
          )}

          {tooltip && renderTooltipContent(tooltip)}
        </div>
      </section>

      <p className="hexmap-footer-note">
        데이터: 공개 기록표결 기준 · 지도: © OpenStreetMap contributors © CARTO · 시각화: deck.gl · 격자: Uber H3
      </p>

      {/* Province detail section */}
      <section className="hexmap-section hexmap-section--detail">
        <div className="hexmap-section-divider">
          <h2 className="hexmap-section-title">시·도별 상세 지도</h2>
          <p className="hexmap-section-desc">
            시·도를 선택하면 해당 지역 지역구를 H3 헥사곤으로 확대 탐색합니다.
            헥사곤을 클릭하면 해당 의원의 활동 캘린더로 이동합니다.
          </p>
        </div>

        {boundaryIndex && (
          <div className="hexmap-detail-controls">
            <label className="hexmap-detail-province-label">
              <span className="hexmap-detail-province-text">시·도</span>
              <select
                className="hexmap-detail-province-select"
                value={detailProvince ?? ""}
                onChange={(e) => {
                  setDetailTooltip(null);
                  setDetailProvince(e.currentTarget.value);
                }}
              >
                {boundaryIndex.provinces.map((p) => (
                  <option key={p.provinceShortName} value={p.provinceShortName}>
                    {`${p.provinceShortName} · ${p.featureCount}곳`}
                  </option>
                ))}
              </select>
            </label>
            {workerCells.length > 0 && (
              <span className="hexmap-detail-info">{workerCells.length}개 셀</span>
            )}
          </div>
        )}

        <div
          className={`hexmap-map-container${
            isDetailLoading ? " hexmap-map-container--loading" : ""
          }`}
        >
          {isDetailLoading ? (
            <div className="hexmap-state">
              <div className="hexmap-state__title">{detailProvince} 지역구 데이터 로딩 중…</div>
            </div>
          ) : (
            <>
              <DeckGL
                viewState={detailViewState}
                onViewStateChange={({ viewState: vs }) => {
                  setDetailViewState(vs as typeof detailViewState);
                }}
                controller
                layers={detailLayers}
              >
                <MapGL mapStyle={MAP_STYLE} />
              </DeckGL>

              {isWorkerComputing && (
                <div className="hexmap-computing-overlay">
                  헥사곤 격자 계산 중…
                </div>
              )}
            </>
          )}

          {detailTooltip && !isDetailLoading && (
            <div
              className="hexmap-tooltip"
              style={{ left: detailTooltip.x + 12, top: detailTooltip.y - 56 }}
            >
              {(() => {
                const { cell } = detailTooltip;
                const [r, g, b] = getPartyColor(cell.party);
                return (
                  <>
                    <div className="hexmap-tooltip__member">
                      <span
                        className="hexmap-tooltip__party-dot"
                        style={{ background: `rgb(${r},${g},${b})` }}
                        aria-hidden="true"
                      />
                      <span className="hexmap-tooltip__name">{cell.memberNames[0]}</span>
                    </div>
                    <div className="hexmap-tooltip__party">{cell.party}</div>
                    <div className="hexmap-tooltip__value">{vizConfig.tooltipLabel(cell)}</div>
                    {cell.memberCount === 1 && (
                      <div className="hexmap-tooltip__hint">클릭 → 활동 캘린더</div>
                    )}
                  </>
                );
              })()}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
