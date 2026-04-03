import { ColumnLayer } from "@deck.gl/layers";
import DeckGL from "@deck.gl/react";
import { useEffect, useMemo, useState } from "react";
import { Map as MapGL } from "react-map-gl/maplibre";

import type { AccountabilitySummaryExport, Manifest } from "@lawmaker-monitor/schemas";

import type { ConstituencyBoundaryTopology } from "../lib/constituency-map.js";
import { normalizeConstituencyLookupKey } from "../lib/constituency-map.js";
import { loadConstituencyBoundariesIndex, loadConstituencyProvinceTopology } from "../lib/data.js";
import type { MemberGeoPoint } from "../lib/geo-utils.js";
import { extractCentroids } from "../lib/geo-utils.js";

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

// 정당별 고유색 (RGBA)
const PARTY_COLORS: Record<string, [number, number, number, number]> = {
  "더불어민주당":  [30,  100, 210, 230],
  "국민의힘":      [220,  50,  32, 230],
  "조국혁신당":    [0,   170, 120, 230],
  "개혁신당":      [230, 120,   0, 230],
  "진보당":        [170,   0,  50, 230],
  "기본소득당":    [100,  60, 180, 230],
  "사회민주당":    [80,  160,  80, 230],
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

type TooltipInfo = {
  x: number;
  y: number;
  object: AnnotatedPoint;
};

type VizConfig = {
  key: VizMode;
  label: string;
  description: string;
  elevationScale: number;
  getMetric: (p: AnnotatedPoint) => number;
  tooltipLabel: (p: AnnotatedPoint) => string;
};

const VIZ_CONFIGS: VizConfig[] = [
  {
    key: "absence",
    label: "결석 핫스팟",
    description: "선거구 중심에 육각형 기둥으로 결석률을 표현합니다. 기둥이 높을수록 결석률이 높습니다. 색상은 소속 정당을 나타냅니다.",
    elevationScale: 60000,
    getMetric: (p) => p.absentRate,
    tooltipLabel: (p) => `결석률 ${(p.absentRate * 100).toFixed(1)}%`
  },
  {
    key: "negative",
    label: "반대·기권 인덱스",
    description: "반대 + 기권율을 육각형 기둥으로 표현합니다. 기둥이 높을수록 반대·기권 성향이 강합니다. 색상은 소속 정당을 나타냅니다.",
    elevationScale: 40000,
    getMetric: (p) => p.negativeRate,
    tooltipLabel: (p) => `반대·기권율 ${(p.negativeRate * 100).toFixed(1)}%`
  },
  {
    key: "activity",
    label: "참여량 밀도",
    description: "총 기록표결 참여 수를 육각형 기둥으로 표현합니다. 기둥이 높을수록 표결 참여량이 많습니다. 색상은 소속 정당을 나타냅니다.",
    elevationScale: 10,
    getMetric: (p) => p.totalRecordedVotes,
    tooltipLabel: (p) => `총 표결 ${p.totalRecordedVotes.toLocaleString()}건`
  }
];

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

  // 실제 데이터에 등장하는 정당 목록 (범례용)
  const partiesPresent = useMemo<Array<{ party: string; color: [number, number, number, number] }>>(() => {
    const seen = new Map<string, [number, number, number, number]>();
    for (const p of annotatedPoints) {
      if (!seen.has(p.party)) seen.set(p.party, getPartyColor(p.party));
    }
    return [...seen.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], "ko"))
      .map(([party, color]) => ({ party, color }));
  }, [annotatedPoints]);

  const vizConfig = VIZ_CONFIGS.find((v) => v.key === activeViz) ?? VIZ_CONFIGS[0];

  const layer = useMemo(() => {
    if (annotatedPoints.length === 0) return null;

    return new ColumnLayer<AnnotatedPoint>({
      id: `column-${activeViz}`,
      data: annotatedPoints,
      diskResolution: 6,
      radius: 12000,
      radiusUnits: "meters",
      extruded: true,
      getPosition: (p) => [p.longitude, p.latitude],
      getElevation: (p) => vizConfig.getMetric(p) * vizConfig.elevationScale,
      getFillColor: (p) => getPartyColor(p.party),
      getLineColor: [255, 255, 255, 40],
      lineWidthMinPixels: 1,
      pickable: true,
      onHover: (info) => {
        if (info.object && info.x !== undefined && info.y !== undefined) {
          setTooltip({ x: info.x, y: info.y, object: info.object });
        } else {
          setTooltip(null);
        }
      }
    });
  }, [annotatedPoints, activeViz, vizConfig]);

  const matchedCount = annotatedPoints.length;
  const totalPoints = allPoints.length;

  return (
    <div className="lab-page">
      <div className="lab-page__header">
        <h1 className="lab-page__title">실험실 · deck.gl 시각화</h1>
        <p className="lab-page__subtitle">{assemblyLabel} 의원 활동 데이터를 선거구별 3D 육각 기둥으로 탐색합니다.</p>
      </div>

      <div className="lab-disclaimer">
        실험적 기능입니다. 비례대표 의원은 지역구가 없어 표시되지 않습니다.
        {matchedCount > 0 && ` · ${totalPoints}개 선거구 중 ${matchedCount}개 매칭됨`}
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
            layers={layer ? [layer] : []}
          >
            <MapGL mapStyle={MAP_STYLE} />
          </DeckGL>
        )}

        {tooltip && (
          <div
            className="lab-tooltip"
            style={{ left: tooltip.x + 12, top: tooltip.y - 56 }}
          >
            <div className="lab-tooltip__member">
              <span
                className="lab-tooltip__party-dot"
                style={{
                  background: (() => {
                    const [r, g, b] = getPartyColor(tooltip.object.party);
                    return `rgb(${r},${g},${b})`;
                  })()
                }}
              />
              <span className="lab-tooltip__name">{tooltip.object.name}</span>
            </div>
            <div className="lab-tooltip__party">{tooltip.object.party}</div>
            <div className="lab-tooltip__district">{tooltip.object.label}</div>
            <div className="lab-tooltip__value">{vizConfig.tooltipLabel(tooltip.object)}</div>
          </div>
        )}
      </div>

      <p className="lab-footer-note">
        데이터: 공개 기록표결 기준 · 지도: © OpenStreetMap contributors © CARTO · 시각화: deck.gl
      </p>
    </div>
  );
}
