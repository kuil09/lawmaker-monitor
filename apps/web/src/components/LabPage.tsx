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

type VizMode = "absence" | "negative" | "activity";

type AnnotatedPoint = MemberGeoPoint & {
  absentRate: number;
  negativeRate: number;
  totalRecordedVotes: number;
};

type TooltipInfo = {
  x: number;
  y: number;
  object: AnnotatedPoint;
};

function interpolateColor(
  value: number,
  min: number,
  max: number,
  colorRange: [number, number, number][]
): [number, number, number, number] {
  const t = max === min ? 0 : Math.max(0, Math.min(1, (value - min) / (max - min)));
  const segments = colorRange.length - 1;
  const idx = Math.min(Math.floor(t * segments), segments - 1);
  const frac = t * segments - idx;
  const [r1, g1, b1] = colorRange[idx];
  const [r2, g2, b2] = colorRange[Math.min(idx + 1, segments)];
  return [
    Math.round(r1 + (r2 - r1) * frac),
    Math.round(g1 + (g2 - g1) * frac),
    Math.round(b1 + (b2 - b1) * frac),
    220
  ];
}

type VizConfig = {
  key: VizMode;
  label: string;
  description: string;
  colorRange: [number, number, number][];
  elevationScale: number;
  getMetric: (p: AnnotatedPoint) => number;
  tooltipLabel: (p: AnnotatedPoint) => string;
};

const VIZ_CONFIGS: VizConfig[] = [
  {
    key: "absence",
    label: "결석 핫스팟",
    description: "선거구 중심에 육각형 기둥으로 결석률을 표현합니다. 높고 진한 붉은색일수록 결석률이 높습니다.",
    colorRange: [
      [254, 229, 217],
      [252, 174, 145],
      [251, 106, 74],
      [222, 45, 38],
      [165, 15, 21]
    ],
    elevationScale: 60000,
    getMetric: (p) => p.absentRate,
    tooltipLabel: (p) => `결석률 ${(p.absentRate * 100).toFixed(1)}%`
  },
  {
    key: "negative",
    label: "반대·기권 인덱스",
    description: "반대 + 기권율을 육각형 기둥으로 표현합니다. 높고 진한 노란색일수록 반대·기권 성향이 강합니다.",
    colorRange: [
      [255, 255, 212],
      [254, 227, 145],
      [254, 196, 79],
      [254, 153, 41],
      [204, 76, 2]
    ],
    elevationScale: 40000,
    getMetric: (p) => p.negativeRate,
    tooltipLabel: (p) => `반대·기권율 ${(p.negativeRate * 100).toFixed(1)}%`
  },
  {
    key: "activity",
    label: "참여량 밀도",
    description: "총 기록표결 참여 수를 육각형 기둥으로 표현합니다. 높고 진한 초록색일수록 표결 참여량이 많습니다.",
    colorRange: [
      [237, 248, 233],
      [186, 228, 179],
      [116, 196, 118],
      [49, 163, 84],
      [0, 109, 44]
    ],
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
        absentRate: member.absentRate,
        negativeRate: member.noRate + member.abstainRate,
        totalRecordedVotes: member.totalRecordedVotes
      }];
    });
  }, [allPoints, accountabilitySummary]);

  const vizConfig = VIZ_CONFIGS.find((v) => v.key === activeViz) ?? VIZ_CONFIGS[0];

  const layer = useMemo(() => {
    if (annotatedPoints.length === 0) return null;

    const metrics = annotatedPoints.map((p) => vizConfig.getMetric(p));
    const minVal = Math.min(...metrics);
    const maxVal = Math.max(...metrics);

    return new ColumnLayer<AnnotatedPoint>({
      id: `column-${activeViz}`,
      data: annotatedPoints,
      diskResolution: 6,
      radius: 12000,
      radiusUnits: "meters",
      extruded: true,
      getPosition: (p) => [p.longitude, p.latitude],
      getElevation: (p) => vizConfig.getMetric(p) * vizConfig.elevationScale,
      getFillColor: (p) =>
        interpolateColor(vizConfig.getMetric(p), minVal, maxVal, vizConfig.colorRange),
      getLineColor: [255, 255, 255, 60],
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
            style={{ left: tooltip.x + 12, top: tooltip.y - 40 }}
          >
            <div className="lab-tooltip__label">{tooltip.object.label}</div>
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
