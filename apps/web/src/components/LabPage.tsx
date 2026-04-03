import { ColumnLayer, ScatterplotLayer } from "@deck.gl/layers";
import DeckGL from "@deck.gl/react";
import { useEffect, useMemo, useState } from "react";
import { Map as MapGL } from "react-map-gl/maplibre";

import type { AccountabilitySummaryExport, Manifest } from "@lawmaker-monitor/schemas";

import type { ConstituencyBoundaryTopology } from "../lib/constituency-map.js";
import { normalizeConstituencyLookupKey } from "../lib/constituency-map.js";
import { loadConstituencyBoundariesIndex, loadConstituencyProvinceTopology } from "../lib/data.js";
import { extractCentroids } from "../lib/geo-utils.js";

const MAP_STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: "raster" as const,
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors"
    }
  },
  layers: [{ id: "osm", type: "raster" as const, source: "osm" }]
};

const INITIAL_VIEW_STATE = {
  longitude: 127.8,
  latitude: 36.5,
  zoom: 6.5,
  pitch: 45,
  bearing: 0
};

type VizMode = "absence" | "negative" | "activity";

type AnnotatedPoint = {
  longitude: number;
  latitude: number;
  label: string;
  absentRate: number;
  negativeRate: number;
  totalRecordedVotes: number;
};

type TooltipInfo = {
  x: number;
  y: number;
  object: AnnotatedPoint;
};

// 0~1 값을 colorRange에서 선형 보간해 [r, g, b, a] 반환
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
  const [r2, g2, b2] = colorRange[idx + 1] ?? colorRange[idx];
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
  getMetric: (d: AnnotatedPoint) => number;
  tooltipLabel: (d: AnnotatedPoint) => string;
};

const VIZ_CONFIGS: VizConfig[] = [
  {
    key: "absence",
    label: "결석 핫스팟",
    description: "각 선거구 중심에 의원의 결석률을 높이로 표현한 3D 기둥 지도입니다. 높고 진할수록 결석률이 높습니다.",
    colorRange: [
      [237, 248, 233],
      [186, 228, 188],
      [116, 196, 118],
      [49, 163, 84],
      [0, 109, 44],
      [0, 68, 27]
    ],
    elevationScale: 400000,
    getMetric: (d) => d.absentRate,
    tooltipLabel: (d) => `결석률 ${(d.absentRate * 100).toFixed(1)}%`
  },
  {
    key: "negative",
    label: "반대·기권 인덱스",
    description: "반대 + 기권율(negativeRate)을 높이로 표현합니다. 높고 붉을수록 반대·기권 성향이 강합니다.",
    colorRange: [
      [255, 247, 236],
      [254, 232, 200],
      [253, 212, 158],
      [253, 141, 60],
      [227, 26, 28],
      [177, 0, 38]
    ],
    elevationScale: 300000,
    getMetric: (d) => d.negativeRate,
    tooltipLabel: (d) => `반대·기권율 ${(d.negativeRate * 100).toFixed(1)}%`
  },
  {
    key: "activity",
    label: "참여량 밀도",
    description: "총 기록표결 참여 수를 높이로 표현합니다. 수도권 의원 밀집도와 입법 활동량을 보여줍니다.",
    colorRange: [
      [237, 248, 251],
      [178, 226, 226],
      [102, 194, 164],
      [44, 162, 95],
      [0, 109, 44],
      [0, 68, 27]
    ],
    elevationScale: 20,
    getMetric: (d) => d.totalRecordedVotes,
    tooltipLabel: (d) => `총 표결 ${d.totalRecordedVotes.toLocaleString()}건`
  }
];

type LabPageProps = {
  manifest: Manifest | null;
  accountabilitySummary: AccountabilitySummaryExport | null;
  assemblyLabel: string;
};

export function LabPage({ manifest, accountabilitySummary, assemblyLabel }: LabPageProps) {
  const [activeViz, setActiveViz] = useState<VizMode>("absence");
  const [allCentroids, setAllCentroids] = useState<ReturnType<typeof extractCentroids>>([]);
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

        const topologies = await Promise.all(
          index.provinces.map((p) =>
            loadConstituencyProvinceTopology<ConstituencyBoundaryTopology>(p.path)
          )
        );

        if (cancelled) return;

        const centroids = topologies
          .filter((t): t is ConstituencyBoundaryTopology => t !== null)
          .flatMap((t) => extractCentroids(t));

        setAllCentroids(centroids);
      } catch (err) {
        if (!cancelled) {
          setError(`데이터 로딩 중 오류: ${(err as Error).message}`);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [manifest]);

  const annotatedPoints = useMemo<AnnotatedPoint[]>(() => {
    if (!accountabilitySummary || allCentroids.length === 0) return [];

    const memberByKey = new Map(
      accountabilitySummary.items.map((item) => [
        normalizeConstituencyLookupKey(item.district),
        item
      ])
    );

    return allCentroids.flatMap((centroid) => {
      const member = memberByKey.get(centroid.districtKey);
      if (!member) return [];
      return [{
        longitude: centroid.longitude,
        latitude: centroid.latitude,
        label: centroid.label,
        absentRate: member.absentRate,
        negativeRate: member.noRate + member.abstainRate,
        totalRecordedVotes: member.totalRecordedVotes
      }];
    });
  }, [allCentroids, accountabilitySummary]);

  const vizConfig = VIZ_CONFIGS.find((v) => v.key === activeViz) ?? VIZ_CONFIGS[0];

  const layers = useMemo(() => {
    if (annotatedPoints.length === 0) return [];

    const metrics = annotatedPoints.map((d) => vizConfig.getMetric(d));
    const minVal = Math.min(...metrics);
    const maxVal = Math.max(...metrics);

    return [
      new ScatterplotLayer<AnnotatedPoint>({
        id: `scatter-${activeViz}`,
        data: annotatedPoints,
        getPosition: (d) => [d.longitude, d.latitude],
        getRadius: 4000,
        getFillColor: (d) => interpolateColor(vizConfig.getMetric(d), minVal, maxVal, vizConfig.colorRange),
        opacity: 0.3,
        pickable: false
      }),
      new ColumnLayer<AnnotatedPoint>({
        id: `column-${activeViz}`,
        data: annotatedPoints,
        getPosition: (d) => [d.longitude, d.latitude],
        getElevation: (d) => vizConfig.getMetric(d) * vizConfig.elevationScale,
        getFillColor: (d) => interpolateColor(vizConfig.getMetric(d), minVal, maxVal, vizConfig.colorRange),
        radius: 4000,
        extruded: true,
        pickable: true,
        onHover: (info) => {
          if (info.object && info.x !== undefined && info.y !== undefined) {
            setTooltip({ x: info.x, y: info.y, object: info.object });
          } else {
            setTooltip(null);
          }
        }
      })
    ];
  }, [annotatedPoints, activeViz, vizConfig]);

  const matchedCount = annotatedPoints.length;
  const totalCentroids = allCentroids.length;

  return (
    <div className="lab-page">
      <div className="lab-page__header">
        <h1 className="lab-page__title">실험실 · deck.gl 시각화</h1>
        <p className="lab-page__subtitle">{assemblyLabel} 의원 활동 데이터를 3D 기둥 지도로 탐색합니다.</p>
      </div>

      <div className="lab-disclaimer">
        실험적 기능입니다. 선거구 중심점(센트로이드)은 TopoJSON 폴리곤 꼭짓점 평균으로 근사 계산되며 실제 행정 중심점과 다를 수 있습니다.
        비례대표 의원은 지역구가 없어 지도에 표시되지 않습니다.
        {matchedCount > 0 && ` · ${totalCentroids}개 선거구 중 ${matchedCount}개 매칭됨`}
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
            <p>전체 시·도 경계 데이터를 불러오고 있습니다.</p>
          </div>
        ) : error ? (
          <div className="lab-state">
            <div className="lab-state__title">데이터를 불러오지 못했습니다</div>
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
        데이터: 공개 기록표결 기준 · 지도: © OpenStreetMap contributors · 시각화: deck.gl
      </p>
    </div>
  );
}
