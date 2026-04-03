import { WebMercatorViewport } from "@deck.gl/core";
import { H3HexagonLayer } from "@deck.gl/geo-layers";
import DeckGL from "@deck.gl/react";
import { cellToParent, latLngToCell, polygonToCells } from "h3-js";
import { useEffect, useMemo, useState } from "react";
import { Map as MapGL } from "react-map-gl/maplibre";

import type { AccountabilitySummaryExport, ConstituencyBoundariesIndexExport, Manifest } from "@lawmaker-monitor/schemas";

import type { ConstituencyBoundaryTopology } from "../lib/constituency-map.js";
import { normalizeConstituencyLookupKey } from "../lib/constituency-map.js";
import { loadConstituencyBoundariesIndex, loadConstituencyProvinceTopology } from "../lib/data.js";
import type { ExtrudedFeature, MemberGeoPoint } from "../lib/geo-utils.js";
import { extractCentroids, extractReprojectedFeatures } from "../lib/geo-utils.js";

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
  pitch: 15,
  bearing: 0
};

// H3 해상도 설정
const BG_RES = 4;   // 배경 타일 (~42km 셀)
const DATA_RES = 6; // 데이터 셀 (~6km 셀, BG_RES 셀 안에 ~49개 내접)

// 정당별 고유색 (RGBA)
const PARTY_COLORS: Record<string, [number, number, number, number]> = {
  "더불어민주당": [30,  100, 210, 230],
  "국민의힘":     [220,  50,  32, 230],
  "조국혁신당":   [0,   170, 120, 230],
  "개혁신당":     [230, 120,   0, 230],
  "진보당":       [170,   0,  50, 230],
  "기본소득당":   [100,  60, 180, 230],
  "사회민주당":   [80,  160,  80, 230],
};

function getPartyColor(party: string): [number, number, number, number] {
  return PARTY_COLORS[party] ?? [130, 130, 130, 230];
}

type VizMode = "absence" | "negative" | "activity";

type AnnotatedPoint = MemberGeoPoint & {
  name: string;
  party: string;
  absentRate: number;
  negativeRate: number;
  totalRecordedVotes: number;
};

// H3 셀 단위로 집계된 데이터
type H3DataCell = {
  h3Index: string;
  party: string;           // 다수당
  metric: number;          // 평균값
  memberCount: number;
  memberNames: string[];
  memberParties: string[];
};

type H3BgCell = {
  h3Index: string;
};

type TooltipInfo = {
  x: number;
  y: number;
  cell: H3DataCell;
};

type VizConfig = {
  key: VizMode;
  label: string;
  description: string;
  elevationScale: number;
  getMetric: (p: AnnotatedPoint) => number;
  tooltipLabel: (cell: H3DataCell) => string;
};

const VIZ_CONFIGS: VizConfig[] = [
  {
    key: "absence",
    label: "결석 핫스팟",
    description: "셀 높이 = 결석률 평균. 색상은 셀 내 다수당.",
    elevationScale: 60000,
    getMetric: (p) => p.absentRate,
    tooltipLabel: (c) => `결석률 ${(c.metric * 100).toFixed(1)}%`
  },
  {
    key: "negative",
    label: "반대·기권 인덱스",
    description: "셀 높이 = 반대·기권율 평균. 색상은 셀 내 다수당.",
    elevationScale: 40000,
    getMetric: (p) => p.negativeRate,
    tooltipLabel: (c) => `반대·기권율 ${(c.metric * 100).toFixed(1)}%`
  },
  {
    key: "activity",
    label: "참여량 밀도",
    description: "셀 높이 = 총 표결 참여 수 평균. 색상은 셀 내 다수당.",
    elevationScale: 10,
    getMetric: (p) => p.totalRecordedVotes,
    tooltipLabel: (c) => `표결 ${c.metric.toLocaleString(undefined, { maximumFractionDigits: 0 })}건`
  }
];

// 실험 B: 시·도별 H3 상세 해상도 (1지역구 ≈ 1셀)
const DETAIL_RES = 8;

const INITIAL_DETAIL_VIEW_STATE = {
  longitude: 127.8,
  latitude: 36.5,
  zoom: 6.5,
  pitch: 45,
  bearing: 0,
  minZoom: 5,
  maxZoom: 14
};

// 지역 면적에 따른 H3 해상도 자동 결정
function getDetailRes(features: ExtrudedFeature[]): number {
  let minLng = 180, maxLng = -180, minLat = 90, maxLat = -90;
  for (const f of features) {
    const polys = f.geometry.type === "Polygon"
      ? [(f.geometry.coordinates as number[][][])]
      : (f.geometry.coordinates as number[][][][]);
    for (const poly of polys) {
      for (const ring of poly) {
        for (const [lng, lat] of ring) {
          if (lng < minLng) minLng = lng;
          if (lng > maxLng) maxLng = lng;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
        }
      }
    }
  }
  const span = Math.max(maxLng - minLng, (maxLat - minLat) * 1.3);
  if (span > 2) return 6;
  if (span > 0.8) return 7;
  return 8;
}

type LabPageProps = {
  manifest: Manifest | null;
  accountabilitySummary: AccountabilitySummaryExport | null;
  assemblyLabel: string;
};

export function LabPage({ manifest, accountabilitySummary, assemblyLabel }: LabPageProps) {
  const [activeViz, setActiveViz] = useState<VizMode>("absence");
  const [allPoints, setAllPoints] = useState<MemberGeoPoint[]>([]);
  const [loadProgress, setLoadProgress] = useState<{ done: number; total: number } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null);

  // 실험 B: 시·도별 상세 지도 state
  const [boundaryIndex, setBoundaryIndex] = useState<ConstituencyBoundariesIndexExport | null>(null);
  const [detailProvince, setDetailProvince] = useState<string | null>(null);
  const [detailTopology, setDetailTopology] = useState<ConstituencyBoundaryTopology | null | undefined>(undefined);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [detailViewState, setDetailViewState] = useState(INITIAL_DETAIL_VIEW_STATE);
  const [detailTooltip, setDetailTooltip] = useState<TooltipInfo | null>(null);

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

  // 초기 province 설정
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
        name: member.name,
        party: member.party,
        absentRate: member.absentRate,
        negativeRate: member.noRate + member.abstainRate,
        totalRecordedVotes: member.totalRecordedVotes
      }];
    });
  }, [allPoints, accountabilitySummary]);

  const vizConfig = VIZ_CONFIGS.find((v) => v.key === activeViz) ?? VIZ_CONFIGS[0];

  // H3 셀 집계: 데이터 셀(res 6) + 배경 셀(res 4)
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
      // 다수당 결정
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
        memberParties: points.map((p) => p.party)
      });

      bgSet.add(cellToParent(h3Index, BG_RES));
    }

    return {
      dataCells: data,
      bgCells: [...bgSet].map((h3Index) => ({ h3Index }))
    };
  }, [annotatedPoints, vizConfig]);

  // 범례: 실제 등장 정당
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
    if (bgCells.length === 0) return [];

    const bgLayer = new H3HexagonLayer<H3BgCell>({
      id: "h3-bg",
      data: bgCells,
      getHexagon: (d) => d.h3Index,
      getFillColor: [220, 225, 232, 60],
      getLineColor: [180, 190, 200, 100],
      lineWidthMinPixels: 1,
      extruded: false,
      pickable: false
    });

    const dataLayer = new H3HexagonLayer<H3DataCell>({
      id: `h3-data-${activeViz}`,
      data: dataCells,
      getHexagon: (d) => d.h3Index,
      getFillColor: (d) => getPartyColor(d.party),
      getElevation: (d) => d.metric * vizConfig.elevationScale,
      getLineColor: [255, 255, 255, 40],
      lineWidthMinPixels: 1,
      extruded: true,
      pickable: true,
      onHover: (info) => {
        if (info.object && info.x !== undefined && info.y !== undefined) {
          setTooltip({ x: info.x, y: info.y, cell: info.object });
        } else {
          setTooltip(null);
        }
      }
    });

    return [bgLayer, dataLayer];
  }, [bgCells, dataCells, activeViz, vizConfig]);

  // ── 실험 B: 시·도별 H3 상세 지도 ────────────────────────────────────────────

  // topology 로딩
  useEffect(() => {
    if (!boundaryIndex || !detailProvince) return;
    const province = boundaryIndex.provinces.find(p => p.provinceShortName === detailProvince);
    if (!province) return;

    let cancelled = false;
    setIsDetailLoading(true);
    setDetailTopology(undefined);

    void loadConstituencyProvinceTopology<ConstituencyBoundaryTopology>(province.path)
      .then(topo => { if (!cancelled) setDetailTopology(topo); })
      .catch(() => { if (!cancelled) setDetailTopology(null); })
      .finally(() => { if (!cancelled) setIsDetailLoading(false); });

    return () => { cancelled = true; };
  }, [boundaryIndex, detailProvince]);

  // topology → reprojected GeoJSON features
  const detailFeatures = useMemo<ExtrudedFeature[]>(() => {
    if (!detailTopology) return [];
    return extractReprojectedFeatures(detailTopology);
  }, [detailTopology]);

  // features 로드 시 WebMercatorViewport.fitBounds로 정확한 줌 설정
  useEffect(() => {
    if (detailFeatures.length === 0) return;
    let minLng = 180, maxLng = -180, minLat = 90, maxLat = -90;
    for (const f of detailFeatures) {
      const polys = f.geometry.type === "Polygon"
        ? [(f.geometry.coordinates as number[][][])]
        : (f.geometry.coordinates as number[][][][]);
      for (const poly of polys) {
        for (const ring of poly) {
          for (const [lng, lat] of ring) {
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
      setDetailViewState(prev => ({ ...prev, longitude, latitude, zoom: Math.min(zoom, 12) }));
    } catch {
      const span = Math.max(maxLng - minLng, (maxLat - minLat) * 1.3, 0.1);
      setDetailViewState(prev => ({
        ...prev,
        longitude: (minLng + maxLng) / 2,
        latitude: (minLat + maxLat) / 2,
        zoom: Math.min(11, Math.max(6, Math.log2(360 / span) - 1.5))
      }));
    }
  }, [detailFeatures]);

  // features → polygonToCells → H3DataCell (지역구 경계를 헥사곤으로 채움)
  const detailCells = useMemo<H3DataCell[]>(() => {
    if (detailFeatures.length === 0 || !accountabilitySummary) return [];

    const detailRes = getDetailRes(detailFeatures);
    const memberByKey = new Map(
      accountabilitySummary.items.map(item => [
        normalizeConstituencyLookupKey(item.district),
        item
      ])
    );

    const result: H3DataCell[] = [];

    for (const feature of detailFeatures) {
      const member = memberByKey.get(feature.properties.districtKey);
      if (!member) continue;

      const metric = vizConfig.getMetric({
        absentRate: member.absentRate,
        negativeRate: member.noRate + member.abstainRate,
        totalRecordedVotes: member.totalRecordedVotes
      } as AnnotatedPoint);

      const polys = feature.geometry.type === "Polygon"
        ? [(feature.geometry.coordinates as number[][][])]
        : (feature.geometry.coordinates as number[][][][]);

      for (const poly of polys) {
        try {
          // isGeoJson=true: 좌표가 [lng, lat] 순서
          const cells = polygonToCells(poly as number[][][], detailRes, true);
          for (const h3Index of cells) {
            result.push({
              h3Index,
              party: member.party,
              metric,
              memberCount: 1,
              memberNames: [member.name],
              memberParties: [member.party]
            });
          }
        } catch {
          // 폴리곤이 너무 작거나 비정상인 경우 무시
        }
      }
    }

    return result;
  }, [detailFeatures, accountabilitySummary, vizConfig]);

  const detailLayers = useMemo(() => {
    if (detailCells.length === 0) return [];
    return [
      new H3HexagonLayer<H3DataCell>({
        id: `h3-detail-${activeViz}-${detailProvince ?? ""}`,
        data: detailCells,
        getHexagon: (d) => d.h3Index,
        getFillColor: (d) => getPartyColor(d.party),
        getElevation: (d) => d.metric * vizConfig.elevationScale,
        getLineColor: [255, 255, 255, 40],
        lineWidthMinPixels: 1,
        extruded: true,
        pickable: true,
        onHover: (info) => {
          if (info.object && info.x !== undefined && info.y !== undefined) {
            setDetailTooltip({ x: info.x, y: info.y, cell: info.object });
          } else {
            setDetailTooltip(null);
          }
        }
      })
    ];
  }, [detailCells, activeViz, detailProvince, vizConfig]);

  return (
    <div className="lab-page">
      <div className="lab-page__header">
        <h1 className="lab-page__title">실험실 · deck.gl 시각화</h1>
        <p className="lab-page__subtitle">
          {assemblyLabel} 의원 활동 데이터를 H3 헥사곤 격자로 탐색합니다.
        </p>
      </div>

      <div className="lab-disclaimer">
        실험적 기능입니다. 비례대표 의원은 지역구가 없어 표시되지 않습니다.
        {dataCells.length > 0 &&
          ` · ${annotatedPoints.length}명, ${dataCells.length}개 셀 (res ${DATA_RES}) / ${bgCells.length}개 구역 (res ${BG_RES})`}
      </div>

      <div className="lab-viz-selector" role="tablist" aria-label="시각화 선택">
        {VIZ_CONFIGS.map((v) => (
          <button
            key={v.key}
            role="tab"
            aria-selected={activeViz === v.key}
            className={`lab-viz-tab${activeViz === v.key ? " lab-viz-tab--active" : ""}`}
            onClick={() => {
              setTooltip(null);
              setActiveViz(v.key);
            }}
          >
            {v.label}
          </button>
        ))}
      </div>

      <p className="lab-viz-description">{vizConfig.description}</p>

      {partiesPresent.length > 0 && (
        <div className="lab-party-legend" aria-label="정당 범례">
          <span className="lab-party-legend__heading">정당</span>
          {partiesPresent.map(({ party, color: [r, g, b] }) => (
            <span key={party} className="lab-party-legend__item">
              <span
                className="lab-party-legend__dot"
                style={{ background: `rgb(${r},${g},${b})` }}
                aria-hidden="true"
              />
              {party}
            </span>
          ))}
        </div>
      )}

      <div
        className={`lab-map-container${isLoading ? " lab-map-container--loading" : error ? " lab-map-container--error" : ""}`}
      >
        {isLoading ? (
          <div className="lab-state">
            <div className="lab-state__title">선거구 데이터 로딩 중…</div>
            <p>
              {loadProgress
                ? `${loadProgress.total}개 시·도 중 ${loadProgress.done}개 완료`
                : "경계 데이터 인덱스를 불러오는 중입니다."}
            </p>
          </div>
        ) : error ? (
          <div className="lab-state">
            <div className="lab-state__title">데이터를 불러오지 못했습니다</div>
            <p>{error}</p>
          </div>
        ) : (
          <DeckGL
            initialViewState={INITIAL_VIEW_STATE}
            controller={{ minZoom: 5, maxZoom: 10 }}
            layers={layers}
          >
            <MapGL mapStyle={MAP_STYLE} />
          </DeckGL>
        )}

        {tooltip && (
          <div
            className="lab-tooltip"
            style={{ left: tooltip.x + 12, top: tooltip.y - 56 }}
          >
            {tooltip.cell.memberCount === 1 ? (
              <>
                <div className="lab-tooltip__member">
                  <span
                    className="lab-tooltip__party-dot"
                    style={{
                      background: (() => {
                        const [r, g, b] = getPartyColor(tooltip.cell.party);
                        return `rgb(${r},${g},${b})`;
                      })()
                    }}
                  />
                  <span className="lab-tooltip__name">{tooltip.cell.memberNames[0]}</span>
                </div>
                <div className="lab-tooltip__party">{tooltip.cell.party}</div>
              </>
            ) : (
              <>
                <div className="lab-tooltip__member">
                  <span
                    className="lab-tooltip__party-dot"
                    style={{
                      background: (() => {
                        const [r, g, b] = getPartyColor(tooltip.cell.party);
                        return `rgb(${r},${g},${b})`;
                      })()
                    }}
                  />
                  <span className="lab-tooltip__name">
                    {tooltip.cell.memberNames[0]} 외 {tooltip.cell.memberCount - 1}명
                  </span>
                </div>
                <div className="lab-tooltip__party">다수당: {tooltip.cell.party}</div>
              </>
            )}
            <div className="lab-tooltip__value">{vizConfig.tooltipLabel(tooltip.cell)}</div>
          </div>
        )}
      </div>

      <p className="lab-footer-note">
        데이터: 공개 기록표결 기준 · 지도: © OpenStreetMap contributors © CARTO · 시각화: deck.gl · 격자: Uber H3
      </p>

      <div className="lab-section-divider">
        <h2 className="lab-section-title">실험 B · 시·도별 H3 상세 지도</h2>
        <p className="lab-section-desc">
          시·도를 선택하면 해당 지역 지역구를 H3 res {DETAIL_RES} 헥사곤(1지역구 ≈ 1셀)으로 확대 탐색합니다.
          높이·색상 기준은 실험 A와 동일합니다.
        </p>
      </div>

      {boundaryIndex && (
        <div className="lab-detail-controls">
          <label className="lab-detail-province-label">
            <span className="lab-detail-province-text">시·도</span>
            <select
              className="lab-detail-province-select"
              value={detailProvince ?? ""}
              onChange={(e) => {
                setDetailTooltip(null);
                setDetailProvince(e.currentTarget.value);
              }}
            >
              {boundaryIndex.provinces.map(p => (
                <option key={p.provinceShortName} value={p.provinceShortName}>
                  {`${p.provinceShortName} · ${p.featureCount}곳`}
                </option>
              ))}
            </select>
          </label>
          {detailCells.length > 0 && (
            <span className="lab-detail-info">
              {detailCells.length}개 셀 (res {DETAIL_RES})
            </span>
          )}
        </div>
      )}

      <div className={`lab-map-container${isDetailLoading ? " lab-map-container--loading" : ""}`}>
        {isDetailLoading ? (
          <div className="lab-state">
            <div className="lab-state__title">{detailProvince} 지역구 데이터 로딩 중…</div>
          </div>
        ) : (
          <DeckGL
            viewState={detailViewState}
            onViewStateChange={({ viewState: vs }) => {
              setDetailViewState(vs as typeof detailViewState);
            }}
            controller={{ minZoom: 5, maxZoom: 14 }}
            layers={detailLayers}
          >
            <MapGL mapStyle={MAP_STYLE} />
          </DeckGL>
        )}

        {detailTooltip && (
          <div
            className="lab-tooltip"
            style={{ left: detailTooltip.x + 12, top: detailTooltip.y - 56 }}
          >
            <div className="lab-tooltip__member">
              <span
                className="lab-tooltip__party-dot"
                style={{
                  background: (() => {
                    const [r, g, b] = getPartyColor(detailTooltip.cell.party);
                    return `rgb(${r},${g},${b})`;
                  })()
                }}
              />
              <span className="lab-tooltip__name">{detailTooltip.cell.memberNames[0]}</span>
            </div>
            <div className="lab-tooltip__party">{detailTooltip.cell.party}</div>
            <div className="lab-tooltip__value">{vizConfig.tooltipLabel(detailTooltip.cell)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
