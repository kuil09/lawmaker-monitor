import { useEffect, useMemo, useState } from "react";
import {
  Layer,
  Map as MapGL,
  Source,
  type LayerProps
} from "react-map-gl/maplibre";

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

const INITIAL_VIEW_STATE = {
  longitude: 127.8,
  latitude: 36.45,
  zoom: 6.15,
  minZoom: 5,
  maxZoom: 8,
  pitch: 0,
  bearing: 0
};

const MAP_STYLE = {
  version: 8 as const,
  sources: {},
  layers: [
    {
      id: "v2-map-background",
      type: "background" as const,
      paint: {
        "background-color": "#f7fafb"
      }
    }
  ]
};

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

const DISTRICT_FILL_LAYER: LayerProps = {
  id: "v2-national-district-fill",
  type: "fill",
  paint: {
    "fill-color": ["get", "fillColor"],
    "fill-opacity": 1
  }
};

const DISTRICT_LINE_LAYER: LayerProps = {
  id: "v2-national-district-line",
  type: "line",
  paint: {
    "line-color": "rgba(255, 255, 255, 0.88)",
    "line-width": 0.8
  }
};

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
  const [mapReady, setMapReady] = useState(false);
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

  const mapData = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: coloredDistricts
    }),
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
      role="img"
      aria-label={`전국 지역구 ${metric === "absence" ? "출석" : metric === "negative" ? "표결 성향" : "재산"} 분포 지도`}
    >
      <div className="v2-national-map__canvas" aria-hidden="true">
        <MapGL
          initialViewState={INITIAL_VIEW_STATE}
          mapStyle={MAP_STYLE}
          attributionControl={false}
          interactive={false}
          onLoad={() => setMapReady(true)}
        >
          {mapReady ? (
            <Source id="v2-national-districts" type="geojson" data={mapData}>
              <Layer {...DISTRICT_FILL_LAYER} />
              <Layer {...DISTRICT_LINE_LAYER} />
            </Source>
          ) : null}
        </MapGL>
      </div>
      <div className="v2-national-map__labels" aria-hidden="true">
        <span className="v2-national-map__label v2-national-map__label--seoul">
          서울
        </span>
        <span className="v2-national-map__label v2-national-map__label--gangwon">
          강원
        </span>
        <span className="v2-national-map__label v2-national-map__label--chungcheong">
          충청
        </span>
        <span className="v2-national-map__label v2-national-map__label--gyeongsang">
          경상
        </span>
        <span className="v2-national-map__label v2-national-map__label--jeolla">
          전라
        </span>
        <span className="v2-national-map__label v2-national-map__label--jeju">
          제주
        </span>
      </div>
    </div>
  );
}
