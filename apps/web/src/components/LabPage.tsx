import { HexagonLayer } from "@deck.gl/aggregation-layers";
import DeckGL from "@deck.gl/react";
import { useEffect, useMemo, useState } from "react";
import { Map } from "react-map-gl/maplibre";

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
  pitch: 40,
  bearing: 0
};

type VizMode = "absence" | "negative" | "activity";

type VizConfig = {
  key: VizMode;
  label: string;
  description: string;
  colorRange: [number, number, number][];
  elevationScale: number;
  radius: number;
  aggregation: "MEAN" | "SUM";
  getWeight: (d: AnnotatedPoint) => number;
  tooltipLabel: (value: number, count: number) => string;
};

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
  points: AnnotatedPoint[];
  value: number;
};

const VIZ_CONFIGS: VizConfig[] = [
  {
    key: "absence",
    label: "결석 핫스팟",
    description: "각 선거구 중심점을 결석률로 가중치를 부여해 헥사곤으로 집계합니다. 높이·색상이 진할수록 해당 지역 의원의 평균 결석률이 높습니다.",
    colorRange: [
      [237, 248, 233],
      [186, 228, 188],
      [116, 196, 118],
      [49, 163, 84],
      [0, 109, 44],
      [0, 68, 27]
    ],
    elevationScale: 3000,
    radius: 20000,
    aggregation: "MEAN",
    getWeight: (d) => d.absentRate,
    tooltipLabel: (value, count) => `평균 결석률 ${(value * 100).toFixed(1)}% · ${count}명`
  },
  {
    key: "negative",
    label: "반대·기권 인덱스",
    description: "반대 + 기권율(negativeRate)로 가중치를 부여합니다. 높이·색상이 진할수록 해당 지역 의원의 반대·기권 성향이 강합니다.",
    colorRange: [
      [255, 247, 236],
      [254, 232, 200],
      [253, 212, 158],
      [253, 141, 60],
      [227, 26, 28],
      [177, 0, 38]
    ],
    elevationScale: 2500,
    radius: 20000,
    aggregation: "MEAN",
    getWeight: (d) => d.negativeRate,
    tooltipLabel: (value, count) => `평균 반대·기권율 ${(value * 100).toFixed(1)}% · ${count}명`
  },
  {
    key: "activity",
    label: "참여량 밀도",
    description: "총 기록표결 참여 수의 합산으로 집계합니다. 수도권 지역의 의원 집중도와 지역별 입법 활동 밀도를 보여줍니다.",
    colorRange: [
      [237, 248, 251],
      [178, 226, 226],
      [102, 194, 164],
      [44, 162, 95],
      [0, 109, 44],
      [0, 68, 27]
    ],
    elevationScale: 0.1,
    radius: 25000,
    aggregation: "SUM",
    getWeight: (d) => d.totalRecordedVotes,
    tooltipLabel: (value, count) => `총 표결 ${Math.round(value).toLocaleString()}건 · ${count}명`
  }
];

type LabPageProps = {
  manifest: Manifest | null;
  accountabilitySummary: AccountabilitySummaryExport | null;
  assemblyLabel: string;
};

export function LabPage({ manifest, accountabilitySummary, assemblyLabel }: LabPageProps) {
  const [activeViz, setActiveViz] = useState<VizMode>("absence");
  const [allCentroids, setAllCentroids] = useState<{ longitude: number; latitude: number; districtKey: string; label: string }[]>([]);
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

  const layer = useMemo(() => {
    if (annotatedPoints.length === 0) return null;

    return new HexagonLayer<AnnotatedPoint>({
      id: `hex-${activeViz}`,
      data: annotatedPoints,
      getPosition: (d) => [d.longitude, d.latitude],
      getElevationWeight: vizConfig.getWeight,
      getColorWeight: vizConfig.getWeight,
      elevationAggregation: vizConfig.aggregation,
      colorAggregation: vizConfig.aggregation,
      radius: vizConfig.radius,
      elevationScale: vizConfig.elevationScale,
      extruded: true,
      colorRange: vizConfig.colorRange.map(([r, g, b]) => [r, g, b, 220]) as [number, number, number, number][],
      pickable: true,
      onHover: (info) => {
        if (info.object && info.x !== undefined && info.y !== undefined) {
          const pts = (info.object.points ?? []) as AnnotatedPoint[];
          const value = pts.length === 0
            ? 0
            : pts.reduce((sum, p) => sum + vizConfig.getWeight(p), 0) /
              (vizConfig.aggregation === "MEAN" ? pts.length : 1);
          setTooltip({ x: info.x, y: info.y, points: pts, value });
        } else {
          setTooltip(null);
        }
      }
    });
  }, [annotatedPoints, activeViz, vizConfig]);

  const matchedCount = annotatedPoints.length;
  const totalCentroids = allCentroids.length;

  return (
    <div className="lab-page">
      <div className="lab-page__header">
        <h1 className="lab-page__title">실험실 · deck.gl 시각화</h1>
        <p className="lab-page__subtitle">{assemblyLabel} 의원 활동 데이터를 3D 헥사곤 지도로 탐색합니다.</p>
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
            layers={layer ? [layer] : []}
          >
            <Map mapStyle={MAP_STYLE} />
          </DeckGL>
        )}

        {tooltip && (
          <div
            className="lab-tooltip"
            style={{
              left: tooltip.x + 12,
              top: tooltip.y - 40
            }}
          >
            <div className="lab-tooltip__label">{vizConfig.label}</div>
            <div className="lab-tooltip__value">
              {vizConfig.tooltipLabel(tooltip.value, tooltip.points.length)}
            </div>
          </div>
        )}
      </div>

      <p className="lab-footer-note">
        데이터: 공개 기록표결 기준 · 지도: © OpenStreetMap contributors · 시각화: deck.gl
      </p>
    </div>
  );
}
