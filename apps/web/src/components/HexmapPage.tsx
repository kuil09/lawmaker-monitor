import { WebMercatorViewport } from "@deck.gl/core";
import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { IconLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import DeckGL from "@deck.gl/react";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { cellToLatLng } from "h3-js";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import { MemberDetailLink } from "./MemberDetailLink.js";
import { ProvinceMiniCartogram } from "./ProvinceMiniCartogram.js";
import { normalizeConstituencyLookupKey } from "../lib/constituency-map.js";
import { buildCompactDistrictCartogram } from "../lib/district-cartogram.js";
import { formatAssetEok, formatPercent } from "../lib/format.js";
import {
  createLogNormalizer,
  getPartyColor,
  getSequentialMetricColor
} from "../lib/geo-utils.js";
import {
  endPerformanceSpan,
  getHexCellsBounds,
  hydrateHexCells,
  startPerformanceSpan,
  type SummaryItem
} from "../lib/hex-cells.js";
import {
  ensureHexmapStaticLoad,
  getHexmapStaticSessionKey,
  getHexmapStaticState,
  subscribeHexmapStaticState
} from "../lib/hexmap-static-loader.js";
import { getOptimizedMemberPhotoUrl } from "../lib/member-photo.js";

import type { ExtrudedFeature, H3DataCell } from "../lib/geo-utils.js";
import type { MapMetric, MapRouteArgs } from "../lib/map-route.js";
import type {
  AccountabilitySummaryExport,
  Manifest,
  MemberAssetsIndexExport
} from "@lawmaker-monitor/schemas";

const INITIAL_VIEW_STATE = {
  longitude: 127.75,
  latitude: 35.95,
  zoom: 6.45,
  minZoom: 5,
  maxZoom: 10,
  pitch: 0,
  bearing: 0
};

const CARTOGRAM_VIEW_SIZE = { width: 760, height: 580 };

const UNMATCHED_CELL_COLOR: [number, number, number, number] = [
  204, 210, 216, 190
];

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

type DetailMemberSummary = {
  memberId: string;
  name: string;
  party: string;
  district: string | null;
  photoUrl: string | null;
  absentRate: number;
  negativeRate: number;
  realEstateTotal: number | null;
  assetTotal: number | null;
};

type MemberCartogramPoint = {
  cell: H3DataCell;
  district: string;
  memberCount: number;
  memberId: string;
  name: string;
  party: string;
  photoUrl: string | null;
  position: [longitude: number, latitude: number];
};

type DetailMemberMetricSummary = {
  key: MapMetric;
  label: string;
  value: string;
};

type VizConfig = {
  key: MapMetric;
  label: string;
  description: string;
  tooltipLabel: (cell: TooltipDatum) => string;
};

function isAssetMetric(
  metric: MapMetric
): metric is "realEstate" | "assetTotal" {
  return metric === "realEstate" || metric === "assetTotal";
}

function getAssetMetricLabel(metric: "realEstate" | "assetTotal"): string {
  return metric === "realEstate" ? "부동산" : "총재산";
}

function formatOptionalAssetMetric(value: number | null): string {
  return value != null ? formatAssetEok(value) : "공개 데이터 없음";
}

function toCssColor([red, green, blue, alpha]: [
  number,
  number,
  number,
  number
]): string {
  return `rgba(${red}, ${green}, ${blue}, ${alpha / 255})`;
}

function getProvinceViewState(cells: readonly H3DataCell[]) {
  const bounds = getHexCellsBounds(cells);
  if (!bounds) {
    return INITIAL_VIEW_STATE;
  }

  const viewport = new WebMercatorViewport(CARTOGRAM_VIEW_SIZE).fitBounds(
    bounds,
    { padding: 72 }
  );
  const zoom = Math.min(12, viewport.zoom + 0.35);

  return {
    longitude: viewport.longitude,
    latitude: viewport.latitude,
    zoom,
    minZoom: Math.max(4, zoom - 0.75),
    maxZoom: Math.min(12, zoom + 2.65),
    pitch: 0,
    bearing: 0
  };
}

function buildDetailMemberMetrics(
  member: DetailMemberSummary
): DetailMemberMetricSummary[] {
  return [
    {
      key: "absence",
      label: "결석률",
      value: formatPercent(member.absentRate)
    },
    {
      key: "negative",
      label: "반대·기권",
      value: formatPercent(member.negativeRate)
    },
    {
      key: "realEstate",
      label: "부동산",
      value: formatOptionalAssetMetric(member.realEstateTotal)
    },
    {
      key: "assetTotal",
      label: "공개 순재산",
      value: formatOptionalAssetMetric(member.assetTotal)
    }
  ];
}

const VIZ_CONFIGS: VizConfig[] = [
  {
    key: "absence",
    label: "결석 핫스팟",
    description:
      "모든 지역을 한 가지 색으로 표시합니다. 결석률 평균이 높을수록 타일이 진해집니다(로그 정규화).",
    tooltipLabel: (cell) => `결석률 ${(cell.metric * 100).toFixed(1)}%`
  },
  {
    key: "negative",
    label: "반대·기권 인덱스",
    description:
      "모든 지역을 한 가지 색으로 표시합니다. 반대·기권율 평균이 높을수록 타일이 진해집니다(로그 정규화).",
    tooltipLabel: (cell) => `반대·기권율 ${(cell.metric * 100).toFixed(1)}%`
  },
  {
    key: "realEstate",
    label: "부동산",
    description:
      "모든 지역을 한 가지 색으로 표시합니다. 최신 공개 부동산(건물·토지 합계)이 클수록 타일이 진해집니다. 공개 데이터가 없는 지역구는 회색입니다.",
    tooltipLabel: (cell) => `최신 부동산 ${formatAssetEok(cell.metric)}`
  },
  {
    key: "assetTotal",
    label: "총재산",
    description:
      "모든 지역을 한 가지 색으로 표시합니다. 최신 공개 총재산이 클수록 타일이 진해집니다. 공개 데이터가 없는 지역구는 회색입니다.",
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
  const [selectedProvinceFilter, setSelectedProvinceFilter] = useState<
    string | null
  >(initialDistrict ? null : initialProvince);
  const [staticState, setStaticState] = useState(() =>
    getHexmapStaticState(manifest)
  );
  const [nationalTooltip, setNationalTooltip] = useState<TooltipInfo | null>(
    null
  );
  const [isNationalMapRendered, setIsNationalMapRendered] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [memberSearch, setMemberSearch] = useState("");
  const [partyFilter, setPartyFilter] = useState("all");

  const onChangeRouteRef = useRef(onChangeRoute);
  onChangeRouteRef.current = onChangeRoute;

  const isMountedRef = useRef(false);
  const firstVisibleSpanRef = useRef<ReturnType<
    typeof startPerformanceSpan
  > | null>(null);
  const layerReadySpanRef = useRef<ReturnType<
    typeof startPerformanceSpan
  > | null>(null);
  const districtPanelSpanRef = useRef<ReturnType<
    typeof startPerformanceSpan
  > | null>(null);
  const metricSwitchSpanRef = useRef<ReturnType<
    typeof startPerformanceSpan
  > | null>(null);
  const sessionKey = getHexmapStaticSessionKey(manifest);

  useEffect(() => {
    setActiveMetric((current) => {
      if (current === initialMetric) {
        return current;
      }

      metricSwitchSpanRef.current = startPerformanceSpan(
        "hexmap:metricSwitchReady"
      );
      return initialMetric;
    });
  }, [initialMetric]);

  useEffect(() => {
    const nextDistrictKey =
      normalizeConstituencyLookupKey(initialDistrict) || null;
    const nextProvince = nextDistrictKey ? null : initialProvince;

    if (nextDistrictKey || nextProvince) {
      districtPanelSpanRef.current = startPerformanceSpan(
        "hexmap:districtPanelReady"
      );
    }

    setSelectedDistrictKey(nextDistrictKey);
    setSelectedProvinceFilter(nextProvince);
    setSelectedMemberId(null);
    setNationalTooltip(null);
  }, [initialDistrict, initialProvince]);

  const summaryItems = useMemo<SummaryItem[]>(() => {
    if (!accountabilitySummary) {
      return [];
    }

    const assetByMemberId = new Map(
      (memberAssetsIndex?.members ?? []).map(
        (entry) =>
          [
            entry.memberId,
            {
              assetTotal: entry.latestTotal,
              realEstateTotal: entry.latestRealEstateTotal ?? null
            }
          ] as const
      )
    );

    return accountabilitySummary.items.flatMap((item) => {
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
          photoUrl: item.photoUrl ?? null,
          absentRate: item.absentRate,
          noRate: item.noRate,
          abstainRate: item.abstainRate,
          realEstateTotal: assetSummary?.realEstateTotal ?? null,
          assetTotal: assetSummary?.assetTotal ?? null
        }
      ];
    });
  }, [accountabilitySummary, memberAssetsIndex]);

  useEffect(() => {
    setStaticState(getHexmapStaticState(manifest));
    return subscribeHexmapStaticState(manifest, setStaticState);
  }, [manifest, sessionKey]);

  useEffect(() => {
    if (
      selectedProvinceFilter ||
      selectedDistrictKey ||
      staticState.entries.length === 0
    ) {
      return;
    }

    const seoulProvince = staticState.entries.find(
      (entry) => entry.provinceShortName === "서울"
    )?.provinceShortName;
    if (!seoulProvince && staticState.isLoading) {
      return;
    }

    const defaultProvince =
      seoulProvince ?? staticState.entries[0]?.provinceShortName ?? null;
    setSelectedProvinceFilter(defaultProvince);
  }, [
    selectedDistrictKey,
    selectedProvinceFilter,
    staticState.entries,
    staticState.isLoading
  ]);

  useEffect(() => {
    setNationalTooltip(null);
    setIsNationalMapRendered(false);
    firstVisibleSpanRef.current = startPerformanceSpan(
      "hexmap:firstVisibleHexCells"
    );
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
    if (!selectedDistrictKey || selectedProvinceFilter) {
      return;
    }

    const resolvedProvince =
      allCachedCells.find((cell) => cell.districtKey === selectedDistrictKey)
        ?.provinceShortName ??
      nationalCells.find((cell) => cell.districtKey === selectedDistrictKey)
        ?.provinceShortName ??
      null;

    if (!resolvedProvince) {
      return;
    }

    setSelectedProvinceFilter(resolvedProvince);
    setSelectedDistrictKey(null);
    setNationalTooltip(null);
  }, [
    allCachedCells,
    nationalCells,
    selectedDistrictKey,
    selectedProvinceFilter
  ]);

  useEffect(() => {
    if (firstVisibleSpanRef.current && isNationalMapRendered) {
      endPerformanceSpan(firstVisibleSpanRef.current);
      firstVisibleSpanRef.current = null;
    }

    if (
      layerReadySpanRef.current &&
      !staticState.isLoading &&
      staticState.entries.length > 0 &&
      isNationalMapRendered
    ) {
      endPerformanceSpan(layerReadySpanRef.current);
      layerReadySpanRef.current = null;
    }

    if (
      metricSwitchSpanRef.current &&
      (nationalCells.length > 0 || !staticState.isLoading)
    ) {
      endPerformanceSpan(metricSwitchSpanRef.current);
      metricSwitchSpanRef.current = null;
    }
  }, [
    isNationalMapRendered,
    nationalCells.length,
    staticState.entries.length,
    staticState.isLoading
  ]);

  useEffect(() => {
    if (
      (selectedDistrictKey || selectedProvinceFilter) &&
      !districtPanelSpanRef.current
    ) {
      districtPanelSpanRef.current = startPerformanceSpan(
        "hexmap:districtPanelReady"
      );
    }
  }, [selectedDistrictKey, selectedProvinceFilter]);

  const vizConfig =
    VIZ_CONFIGS.find((config) => config.key === activeMetric) ??
    VIZ_CONFIGS[0]!;

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
    );
  }, [districtSummaryByKey, staticState.entries]);

  const getCellFillColor = useCallback(
    (
      cell: TooltipDatum,
      normalizeMetric: (value: number) => number
    ): [number, number, number, number] => {
      if (cell.memberCount === 0) {
        return UNMATCHED_CELL_COLOR;
      }

      if (isAssetMetric(activeMetric) && cell.metricMemberCount === 0) {
        return UNMATCHED_CELL_COLOR;
      }

      return getSequentialMetricColor(normalizeMetric(cell.metric));
    },
    [activeMetric]
  );

  const provinceCartogramCellsByName = useMemo(() => {
    const cartograms = new Map<string, H3DataCell[]>();

    for (const entry of staticState.entries) {
      const provinceDistricts = nationalDistricts.filter(
        (district) =>
          district.properties.summary.provinceShortName ===
          entry.provinceShortName
      );
      cartograms.set(
        entry.provinceShortName,
        buildCompactDistrictCartogram(provinceDistricts).map(
          ({ h3Index, feature }) => ({
            h3Index,
            ...feature.properties.summary
          })
        )
      );
    }

    return cartograms;
  }, [nationalDistricts, staticState.entries]);
  const nationalCartogramCells = useMemo(
    () => [...provinceCartogramCellsByName.values()].flat(),
    [provinceCartogramCellsByName]
  );
  const selectedCartogramCells = useMemo(
    () =>
      selectedProvinceFilter
        ? (provinceCartogramCellsByName.get(selectedProvinceFilter) ?? [])
        : [],
    [provinceCartogramCellsByName, selectedProvinceFilter]
  );
  const nationalMetricNormalizer = useMemo(
    () =>
      createLogNormalizer(
        nationalCartogramCells
          .filter((cell) => cell.metricMemberCount > 0)
          .map((cell) => cell.metric)
      ),
    [nationalCartogramCells]
  );
  const miniCartogramCellsByName = useMemo(
    () =>
      new Map(
        [...provinceCartogramCellsByName].map(([province, cells]) => [
          province,
          cells.map((cell) => ({
            h3Index: cell.h3Index,
            fillColor: toCssColor(
              getCellFillColor(cell, nationalMetricNormalizer)
            )
          }))
        ])
      ),
    [getCellFillColor, nationalMetricNormalizer, provinceCartogramCellsByName]
  );

  const detailCells = useMemo(() => {
    if (selectedProvinceFilter) {
      return nationalCells.filter(
        (cell) => cell.provinceShortName === selectedProvinceFilter
      );
    }

    return [];
  }, [nationalCells, selectedProvinceFilter]);

  useEffect(() => {
    if (!isMountedRef.current) {
      isMountedRef.current = true;
      return;
    }

    onChangeRouteRef.current({
      district: null,
      province: selectedProvinceFilter,
      metric: activeMetric
    });
  }, [activeMetric, selectedProvinceFilter]);

  useEffect(() => {
    setIsNationalMapRendered(false);
    setNationalTooltip(null);
    setSelectedMemberId(null);
    setMemberSearch("");
    setPartyFilter("all");
  }, [activeMetric, selectedProvinceFilter]);

  const summaryItemsByMemberId = useMemo(
    () => new Map(summaryItems.map((item) => [item.memberId, item] as const)),
    [summaryItems]
  );
  const memberCartogramPoints = useMemo<MemberCartogramPoint[]>(
    () =>
      selectedCartogramCells.flatMap((cell) => {
        const memberId = cell.memberIds[0];
        const member = memberId
          ? summaryItemsByMemberId.get(memberId)
          : undefined;
        if (!member) {
          return [];
        }

        const [latitude, longitude] = cellToLatLng(cell.h3Index);
        return [
          {
            cell,
            district: member.district,
            memberCount: cell.memberCount,
            memberId: member.memberId,
            name: member.name,
            party: member.party,
            photoUrl: getOptimizedMemberPhotoUrl(member.photoUrl),
            position: [longitude, latitude] as [number, number]
          }
        ];
      }),
    [selectedCartogramCells, summaryItemsByMemberId]
  );
  const filteredMemberCartogramPoints = useMemo(() => {
    const normalizedSearch = memberSearch.trim().toLocaleLowerCase("ko");
    return memberCartogramPoints.filter(
      (point) =>
        (partyFilter === "all" || point.party === partyFilter) &&
        (!normalizedSearch ||
          point.name.toLocaleLowerCase("ko").includes(normalizedSearch) ||
          point.district.toLocaleLowerCase("ko").includes(normalizedSearch))
    );
  }, [memberCartogramPoints, memberSearch, partyFilter]);
  const selectedProvinceViewState = useMemo(
    () => getProvinceViewState(selectedCartogramCells),
    [selectedCartogramCells]
  );

  const nationalLayers = useMemo(() => {
    if (selectedCartogramCells.length === 0) {
      return [];
    }

    const selectMember = (point: MemberCartogramPoint) => {
      setSelectedMemberId(point.memberId);
      setNationalTooltip(null);
    };

    return [
      new H3HexagonLayer<H3DataCell>({
        id: `cartogram-province-${selectedProvinceFilter}-${activeMetric}`,
        data: selectedCartogramCells,
        getHexagon: (cell) => cell.h3Index,
        getFillColor: (cell) =>
          getCellFillColor(cell, nationalMetricNormalizer),
        getLineColor: (cell) =>
          selectedMemberId && cell.memberIds.includes(selectedMemberId)
            ? [31, 88, 190, 255]
            : [255, 255, 255, 205],
        lineWidthMinPixels: selectedMemberId ? 1.25 : 1,
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

          const memberId = info.object.memberIds[0];
          if (memberId) {
            setSelectedMemberId(memberId);
          }
          setNationalTooltip(null);
        }
      }),
      new ScatterplotLayer<MemberCartogramPoint>({
        id: `cartogram-member-backplates-${selectedProvinceFilter}`,
        data: filteredMemberCartogramPoints,
        getPosition: (point) => point.position,
        getRadius: (point) =>
          selectedMemberId === point.memberId ? 18.5 : 16.5,
        radiusUnits: "pixels",
        getFillColor: [250, 252, 255, 246],
        getLineColor: (point) => {
          const [red, green, blue] = getPartyColor(point.party);
          return [red, green, blue, 255];
        },
        lineWidthMinPixels: 1.5,
        stroked: true,
        pickable: true,
        onClick: (info) => {
          if (info.object) {
            selectMember(info.object);
          }
        }
      }),
      new IconLayer<MemberCartogramPoint>({
        id: `cartogram-member-photos-${selectedProvinceFilter}`,
        data: filteredMemberCartogramPoints.filter(
          (point) => point.photoUrl != null
        ),
        getPosition: (point) => point.position,
        getIcon: (point) => ({
          url: point.photoUrl!,
          width: 96,
          height: 96,
          anchorX: 48,
          anchorY: 48
        }),
        getSize: (point) => (selectedMemberId === point.memberId ? 32 : 28),
        sizeUnits: "pixels",
        sizeMinPixels: 24,
        sizeMaxPixels: 36,
        pickable: true,
        onClick: (info) => {
          if (info.object) {
            selectMember(info.object);
          }
        }
      }),
      new TextLayer<MemberCartogramPoint>({
        id: `cartogram-member-initials-${selectedProvinceFilter}`,
        data: filteredMemberCartogramPoints.filter(
          (point) => point.photoUrl == null
        ),
        getPosition: (point) => point.position,
        getText: (point) => point.name.slice(0, 1),
        getSize: 13,
        getColor: [36, 55, 77, 255],
        getTextAnchor: "middle",
        getAlignmentBaseline: "center",
        fontFamily:
          "SUIT Variable, Pretendard Variable, Apple SD Gothic Neo, sans-serif",
        fontWeight: 800,
        characterSet: "auto",
        fontSettings: { sdf: true },
        pickable: true,
        onClick: (info) => {
          if (info.object) {
            selectMember(info.object);
          }
        }
      }),
      new TextLayer<MemberCartogramPoint>({
        id: `cartogram-member-names-${selectedProvinceFilter}`,
        data: filteredMemberCartogramPoints,
        getPosition: (point) => point.position,
        getText: (point) =>
          point.memberCount > 1
            ? `${point.name} 외 ${point.memberCount - 1}`
            : point.name,
        getSize: 10.5,
        getColor: [24, 43, 64, 255],
        getTextAnchor: "middle",
        getAlignmentBaseline: "top",
        getPixelOffset: [0, 19],
        fontFamily:
          "SUIT Variable, Pretendard Variable, Apple SD Gothic Neo, sans-serif",
        fontWeight: 800,
        characterSet: "auto",
        fontSettings: { sdf: true },
        outlineWidth: 2.5,
        outlineColor: [247, 250, 251, 245],
        billboard: true,
        sizeUnits: "pixels",
        pickable: true,
        onClick: (info) => {
          if (info.object) {
            selectMember(info.object);
          }
        }
      })
    ];
  }, [
    activeMetric,
    filteredMemberCartogramPoints,
    getCellFillColor,
    nationalMetricNormalizer,
    selectedCartogramCells,
    selectedMemberId,
    selectedProvinceFilter
  ]);

  const detailPanelLabel = selectedProvinceFilter;
  const isFilterPending =
    Boolean(selectedDistrictKey || selectedProvinceFilter) &&
    detailCells.length === 0 &&
    (isLoading || !accountabilitySummary);
  const isStaticMapComplete =
    staticState.total > 0 &&
    staticState.done >= staticState.total &&
    staticState.entries.length >= staticState.total &&
    !isLoading;
  const incompleteMapError =
    !isLoading &&
    staticState.total > 0 &&
    staticState.done >= staticState.total &&
    staticState.entries.length < staticState.total
      ? `${staticState.total}개 시·도 중 ${staticState.entries.length}개만 준비되었습니다.`
      : null;
  const nationalMapError = error ?? incompleteMapError;
  const isNationalMapPending =
    !nationalMapError &&
    (!isStaticMapComplete ||
      selectedCartogramCells.length === 0 ||
      !isNationalMapRendered);
  const handleNationalMapAfterRender = useCallback(() => {
    if (isStaticMapComplete && selectedCartogramCells.length > 0) {
      setIsNationalMapRendered(true);
    }
  }, [isStaticMapComplete, selectedCartogramCells.length]);
  const detailMemberOptions = useMemo(
    () =>
      [...new Set(detailCells.flatMap((cell) => cell.memberIds))]
        .flatMap((memberId) => {
          const member = summaryItemsByMemberId.get(memberId);
          return member
            ? [
                {
                  memberId,
                  name: member.name,
                  party: member.party,
                  district: member.district ?? null,
                  photoUrl: getOptimizedMemberPhotoUrl(member.photoUrl),
                  absentRate: member.absentRate,
                  negativeRate: member.noRate + member.abstainRate,
                  realEstateTotal: member.realEstateTotal ?? null,
                  assetTotal: member.assetTotal ?? null
                }
              ]
            : [];
        })
        .sort(
          (left, right) =>
            (left.district ?? "").localeCompare(right.district ?? "", "ko") ||
            left.name.localeCompare(right.name, "ko")
        ),
    [detailCells, summaryItemsByMemberId]
  );
  const provinceParties = useMemo(
    () =>
      [...new Set(detailMemberOptions.map((member) => member.party))].sort(
        (left, right) => left.localeCompare(right, "ko")
      ),
    [detailMemberOptions]
  );
  const visibleDetailMembers = useMemo(() => {
    const normalizedSearch = memberSearch.trim().toLocaleLowerCase("ko");
    return detailMemberOptions.filter(
      (member) =>
        (partyFilter === "all" || member.party === partyFilter) &&
        (!normalizedSearch ||
          member.name.toLocaleLowerCase("ko").includes(normalizedSearch) ||
          (member.district ?? "")
            .toLocaleLowerCase("ko")
            .includes(normalizedSearch))
    );
  }, [detailMemberOptions, memberSearch, partyFilter]);
  const selectedMember =
    detailMemberOptions.find(
      (member) => member.memberId === selectedMemberId
    ) ??
    visibleDetailMembers[0] ??
    detailMemberOptions[0] ??
    null;

  useEffect(() => {
    if (!selectedMember) {
      setSelectedMemberId(null);
      return;
    }

    if (selectedMember.memberId !== selectedMemberId) {
      setSelectedMemberId(selectedMember.memberId);
    }
  }, [selectedMember, selectedMemberId]);
  const detailDistrictCount = useMemo(
    () =>
      new Set(
        detailMemberOptions.flatMap((member) =>
          member.district ? [member.district] : []
        )
      ).size,
    [detailMemberOptions]
  );
  const metricLegendDescription =
    activeMetric === "absence"
      ? "색이 진할수록 결석률이 높습니다."
      : activeMetric === "negative"
        ? "색이 진할수록 반대·기권률이 높습니다."
        : activeMetric === "realEstate"
          ? "색이 진할수록 공개 부동산액이 큽니다."
          : "색이 진할수록 공개 총재산이 큽니다.";

  useEffect(() => {
    if (
      !districtPanelSpanRef.current ||
      !selectedProvinceFilter ||
      isFilterPending
    ) {
      return;
    }

    endPerformanceSpan(districtPanelSpanRef.current);
    districtPanelSpanRef.current = null;
  }, [detailMemberOptions.length, isFilterPending, selectedProvinceFilter]);

  function renderTooltipContent(info: TooltipInfo, hint: string | null) {
    const { datum: cell } = info;
    const tooltipMemberId = cell.memberIds[0];
    const tooltipMember = tooltipMemberId
      ? summaryItemsByMemberId.get(tooltipMemberId)
      : null;
    const tooltipPhotoUrl = getOptimizedMemberPhotoUrl(tooltipMember?.photoUrl);
    const [red, green, blue] =
      cell.memberCount > 0 ? getPartyColor(cell.party) : UNMATCHED_CELL_COLOR;
    const dotStyle = { background: `rgb(${red},${green},${blue})` };
    const assetMetricLabel = isAssetMetric(activeMetric)
      ? getAssetMetricLabel(activeMetric)
      : null;

    return (
      <div
        className="hexmap-tooltip"
        style={{ left: info.x + 12, top: info.y - 72 }}
      >
        <div className="hexmap-tooltip__party">{cell.districtLabel}</div>
        {cell.memberCount > 0 ? (
          <>
            <div className="hexmap-tooltip__member">
              {tooltipPhotoUrl ? (
                <img
                  className="hexmap-tooltip__photo"
                  src={tooltipPhotoUrl}
                  alt=""
                />
              ) : (
                <span
                  className="hexmap-tooltip__photo hexmap-tooltip__photo--fallback"
                  aria-hidden="true"
                >
                  {tooltipMember?.name.slice(0, 1) ?? "국"}
                </span>
              )}
              <span>
                <span className="hexmap-tooltip__name">
                  {tooltipMember?.name ?? `의원 ${cell.memberCount}명`}
                </span>
                <span className="hexmap-tooltip__party">
                  <i
                    className="hexmap-tooltip__party-dot"
                    style={dotStyle}
                    aria-hidden="true"
                  />
                  {cell.memberCount === 1
                    ? cell.party
                    : `다수당: ${cell.party}`}
                </span>
              </span>
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

  function selectMetric(metric: MapMetric) {
    if (metric !== activeMetric) {
      metricSwitchSpanRef.current = startPerformanceSpan(
        "hexmap:metricSwitchReady"
      );
    }
    setNationalTooltip(null);
    setActiveMetric(metric);
  }

  function handleMetricKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number
  ) {
    let nextIndex = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (index + 1) % VIZ_CONFIGS.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (index - 1 + VIZ_CONFIGS.length) % VIZ_CONFIGS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = VIZ_CONFIGS.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    const nextMetric = VIZ_CONFIGS[nextIndex]!.key;
    selectMetric(nextMetric);
    const tabs =
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
        '[role="tab"]'
      );
    tabs?.[nextIndex]?.focus();
  }

  return (
    <div className="hexmap-page">
      <header className="hexmap-page__header">
        <div>
          <p className="hexmap-page__eyebrow">deck.gl 지역 탐색</p>
          <h1 className="hexmap-page__title">지역별 국회 기록 탐색</h1>
          <p className="hexmap-page__subtitle">
            {assemblyLabel} 활동과 재산 공개 기록을 전국에서 지역까지 연속적으로
            확인하세요.
          </p>
        </div>
        <dl className="hexmap-page__status">
          <div>
            <dt>준비된 시·도</dt>
            <dd>
              {loadProgress
                ? `${loadProgress.done}/${loadProgress.total}`
                : "확인 중"}
            </dd>
          </div>
          <div>
            <dt>지역구 셀</dt>
            <dd>
              {nationalCartogramCells.length > 0
                ? nationalCartogramCells.length
                : "—"}
            </dd>
          </div>
        </dl>
      </header>

      <section className="hexmap-atlas-toolbar" aria-label="지역 탐색 필터">
        <div>
          <span className="hexmap-atlas-toolbar__label">지표 선택</span>
          <div
            className="hexmap-metric-selector"
            role="tablist"
            aria-label="시각화 지표 선택"
          >
            {VIZ_CONFIGS.map((config, index) => (
              <button
                key={config.key}
                type="button"
                role="tab"
                aria-selected={activeMetric === config.key}
                tabIndex={activeMetric === config.key ? 0 : -1}
                className={`hexmap-metric-tab${activeMetric === config.key ? " hexmap-metric-tab--active" : ""}`}
                onClick={() => selectMetric(config.key)}
                onKeyDown={(event) => handleMetricKeyDown(event, index)}
              >
                {config.label}
              </button>
            ))}
          </div>
        </div>
        <label className="hexmap-atlas-toolbar__field">
          <span>정당 필터</span>
          <select
            value={partyFilter}
            onChange={(event) => setPartyFilter(event.currentTarget.value)}
          >
            <option value="all">전체 정당</option>
            {provinceParties.map((party) => (
              <option key={party} value={party}>
                {party}
              </option>
            ))}
          </select>
        </label>
        <label className="hexmap-atlas-toolbar__field">
          <span>의원 검색</span>
          <input
            type="search"
            value={memberSearch}
            onChange={(event) => setMemberSearch(event.currentTarget.value)}
            placeholder="이름 또는 지역구"
          />
        </label>
        <div className="hexmap-atlas-toolbar__mode" aria-label="현재 보기">
          <span>전체 시·도</span>
          <strong>선택 지역</strong>
        </div>
      </section>

      <div className="hexmap-workspace">
        <aside className="hexmap-sidebar" aria-label="지도 탐색 조건">
          <section className="hexmap-sidebar__section">
            <h2>지역 선택</h2>
            <div className="hexmap-region-list">
              {staticState.entries.map((entry) => {
                const selected =
                  entry.provinceShortName === selectedProvinceFilter;
                return (
                  <button
                    key={entry.cacheKey}
                    type="button"
                    aria-pressed={selected}
                    className={selected ? "is-active" : undefined}
                    onClick={() => {
                      setSelectedDistrictKey(null);
                      setSelectedProvinceFilter(entry.provinceShortName);
                      setSelectedMemberId(null);
                      setNationalTooltip(null);
                    }}
                  >
                    <ProvinceMiniCartogram
                      cells={
                        miniCartogramCellsByName.get(entry.provinceShortName) ??
                        []
                      }
                      label={entry.provinceShortName}
                    />
                    <span>{entry.provinceShortName}</span>
                    <small>
                      {provinceCartogramCellsByName.get(entry.provinceShortName)
                        ?.length ?? 0}
                      석
                    </small>
                  </button>
                );
              })}
            </div>
          </section>

          <section
            className="hexmap-sidebar__section hexmap-metric-legend"
            aria-label="지표 색상 범례"
          >
            <div className="hexmap-metric-legend__copy">
              <h2 className="hexmap-metric-legend__heading">색상 기준</h2>
              <span className="hexmap-metric-legend__description">
                {metricLegendDescription}
              </span>
            </div>
            <div
              className="hexmap-metric-legend__axis"
              aria-label={`${vizConfig.label} 낮음에서 높음`}
            >
              <span>낮음</span>
              <i aria-hidden="true" />
              <span>높음</span>
            </div>
            <span className="hexmap-metric-legend__missing">
              <i aria-hidden="true" />
              자료 없음
            </span>
          </section>

          {isAssetMetric(activeMetric) && memberAssetsIndexError ? (
            <p className="hexmap-viz-warning">{memberAssetsIndexError}</p>
          ) : null}

          <details className="hexmap-disclaimer">
            <summary>표시 기준과 제한</summary>
            <p>
              각 육각형은 실제 면적과 무관한 지역구 1곳이며, 위치는 전국의
              대략적 방향을 유지하도록 재배치했습니다. 비례대표 의원은 지역구가
              없어 표시되지 않으며, 공석 또는 매칭되지 않은 지역은 회색 타일로
              유지합니다.
              {isAssetMetric(activeMetric) &&
                ` ${getAssetMetricLabel(activeMetric)} 비교는 ${
                  activeMetric === "realEstate"
                    ? "최신 공개 건물·토지 합계"
                    : "최신 공개 총재산"
                } 기준이며, 공개 데이터가 없는 지역구는 중립 타일로 남깁니다.`}
            </p>
          </details>
        </aside>

        <section
          className="hexmap-section hexmap-section--national"
          aria-labelledby="hexmap-national-title"
        >
          <div className="hexmap-section__heading">
            <div>
              <p>선택 지역</p>
              <h2 id="hexmap-national-title">
                {selectedProvinceFilter ?? "지역을 선택하세요"}
              </h2>
            </div>
            <span>
              프로필과 이름을 선택하면 오른쪽에서 근거 정보를 확인합니다
            </span>
          </div>
          <div
            className={`hexmap-map-container${
              nationalMapError
                ? " hexmap-map-container--error"
                : isNationalMapPending
                  ? " hexmap-map-container--loading"
                  : ""
            }`}
            aria-busy={isNationalMapPending}
          >
            {nationalMapError ? (
              <div className="hexmap-state">
                <div className="hexmap-state__title">
                  지도를 완성하지 못했습니다
                </div>
                <p>{nationalMapError}</p>
              </div>
            ) : (
              <>
                {selectedCartogramCells.length > 0 ? (
                  <DeckGL
                    key={`${selectedProvinceFilter}-${activeMetric}`}
                    initialViewState={selectedProvinceViewState}
                    onAfterRender={handleNationalMapAfterRender}
                    controller
                    layers={nationalLayers}
                    aria-hidden={isNationalMapPending}
                    style={{
                      opacity: isNationalMapPending ? "0" : "1",
                      pointerEvents: isNationalMapPending ? "none" : "auto"
                    }}
                  />
                ) : null}
                {isNationalMapPending ? (
                  <div
                    className="hexmap-map-loading"
                    role="status"
                    aria-live="polite"
                  >
                    <strong>지역 지도를 준비하고 있습니다.</strong>
                    <span>
                      {!accountabilitySummary
                        ? "활동 데이터를 불러오고 있습니다."
                        : loadProgress
                          ? `${loadProgress.total}개 시·도 중 ${loadProgress.done}개 완료`
                          : "선거구 경계 데이터를 불러오는 중입니다."}
                    </span>
                    <progress
                      aria-label="지역 상세 지도 준비 진행률"
                      max={loadProgress?.total ?? 1}
                      value={loadProgress?.done}
                    />
                  </div>
                ) : null}
              </>
            )}

            {nationalTooltip &&
              selectedCartogramCells.length > 0 &&
              renderTooltipContent(nationalTooltip, "클릭 → 의원 선택")}
          </div>
        </section>

        <section
          className="hexmap-section hexmap-section--detail"
          aria-labelledby="hexmap-detail-title"
        >
          <div className="hexmap-detail-header">
            <div>
              <p>선택 의원 정보</p>
              <h2 id="hexmap-detail-title" className="hexmap-section-title">
                {selectedMember?.name ??
                  detailPanelLabel ??
                  "지역을 선택하세요"}
              </h2>
              <p className="hexmap-section-desc">
                카토그램에서 의원을 선택하면 정당·지역구와 공개 지표를
                확인합니다.
              </p>
            </div>
            {(memberSearch || partyFilter !== "all") && (
              <button
                type="button"
                className="hexmap-detail-reset"
                onClick={() => {
                  setMemberSearch("");
                  setPartyFilter("all");
                }}
              >
                필터 초기화
              </button>
            )}
          </div>

          {detailPanelLabel && detailCells.length > 0 ? (
            <div className="hexmap-detail-summary">
              <span className="hexmap-detail-badge">시·도</span>
              <strong>{detailPanelLabel}</strong>
              <span>{detailMemberOptions.length}명 의원</span>
              <span>{detailDistrictCount}개 지역구</span>
            </div>
          ) : null}

          {!selectedDistrictKey && !selectedProvinceFilter ? (
            <div className="hexmap-detail-state">
              <div className="hexmap-state__title">지역을 선택해 주세요</div>
              <p>
                전국 지도나 시·도 바로가기에서 지역을 선택하면 소속 의원 목록을
                보여드립니다.
              </p>
            </div>
          ) : isFilterPending ? (
            <div
              className="hexmap-detail-state"
              role="status"
              aria-live="polite"
            >
              <div className="hexmap-state__title">
                {detailPanelLabel ?? "선택 지역"} 의원 정보를 불러오는 중…
              </div>
              <p>지역구와 활동·재산 공개 기록을 연결하고 있습니다.</p>
            </div>
          ) : detailMemberOptions.length === 0 ? (
            <div className="hexmap-detail-state">
              <div className="hexmap-state__title">
                공개된 지역 의원 정보를 찾지 못했습니다
              </div>
              <p>선택한 지역과 현재 공개된 비교 데이터를 다시 확인해 주세요.</p>
            </div>
          ) : (
            <div
              className="hexmap-detail-directory"
              aria-label={`${detailPanelLabel ?? "선택 지역"} 의원 목록`}
            >
              {selectedMember ? (
                <article className="hexmap-member-focus">
                  <div className="hexmap-member-focus__identity">
                    {selectedMember.photoUrl ? (
                      <img
                        src={selectedMember.photoUrl}
                        alt=""
                        className="hexmap-member-focus__photo"
                      />
                    ) : (
                      <span
                        className="hexmap-member-focus__photo hexmap-member-focus__photo--fallback"
                        aria-hidden="true"
                      >
                        {selectedMember.name.slice(0, 1)}
                      </span>
                    )}
                    <div>
                      <strong>{selectedMember.name}</strong>
                      <span>{selectedMember.party}</span>
                      <small>
                        {selectedMember.district ?? "지역구 정보 없음"}
                      </small>
                    </div>
                  </div>
                  <dl className="hexmap-member-focus__metrics">
                    {buildDetailMemberMetrics(selectedMember).map((metric) => (
                      <div
                        key={metric.key}
                        className={
                          metric.key === activeMetric ? "is-active" : undefined
                        }
                      >
                        <dt>{metric.label}</dt>
                        <dd>{metric.value}</dd>
                      </div>
                    ))}
                  </dl>
                  <MemberDetailLink
                    className="hexmap-member-focus__action"
                    memberId={selectedMember.memberId}
                    name={selectedMember.name}
                    onNavigate={onNavigateToMember}
                  >
                    의원 상세 보기
                    <ArrowRightIcon size={15} aria-hidden="true" />
                  </MemberDetailLink>
                </article>
              ) : null}
              <div className="hexmap-detail-directory__heading">
                <div>
                  <span>지역 의원 전체</span>
                  <strong>{visibleDetailMembers.length}명</strong>
                </div>
                <p>목록에서도 의원 상세로 바로 이동합니다.</p>
              </div>
              <ul className="hexmap-detail-member-list">
                {visibleDetailMembers.map((member) => (
                  <li key={member.memberId}>
                    <MemberDetailLink
                      className={`hexmap-detail-member-card${
                        selectedMember?.memberId === member.memberId
                          ? " is-selected"
                          : ""
                      }`}
                      memberId={member.memberId}
                      name={member.name}
                      onNavigate={onNavigateToMember}
                    >
                      <span className="hexmap-detail-member-card__top">
                        <span className="hexmap-detail-member-card__identity">
                          {member.photoUrl ? (
                            <img
                              src={member.photoUrl}
                              alt=""
                              className="hexmap-detail-member-card__photo"
                              loading="lazy"
                            />
                          ) : (
                            <span
                              className="hexmap-detail-member-card__photo hexmap-detail-member-card__photo--fallback"
                              aria-hidden="true"
                            >
                              {member.name.slice(0, 1)}
                            </span>
                          )}
                          <span>
                            <strong>{member.name}</strong>
                            <small>{member.party}</small>
                          </span>
                        </span>
                        <span className="hexmap-detail-member-card__action">
                          상세
                          <ArrowRightIcon size={13} aria-hidden="true" />
                        </span>
                      </span>
                      <span className="hexmap-detail-member-card__district">
                        {member.district ?? "지역구 정보 없음"}
                      </span>
                      <dl className="hexmap-detail-member-card__metrics">
                        {buildDetailMemberMetrics(member).map((metric) => (
                          <div
                            key={metric.key}
                            className={
                              metric.key === activeMetric
                                ? "is-active"
                                : undefined
                            }
                          >
                            <dt>{metric.label}</dt>
                            <dd>{metric.value}</dd>
                          </div>
                        ))}
                      </dl>
                    </MemberDetailLink>
                  </li>
                ))}
              </ul>
              {visibleDetailMembers.length === 0 ? (
                <div className="hexmap-detail-filter-empty" role="status">
                  현재 필터에 해당하는 의원이 없습니다.
                </div>
              ) : null}
            </div>
          )}
        </section>
      </div>

      <p className="hexmap-footer-note">
        데이터: 공개 기록표결·재산공개 기준 · 시각화: deck.gl · 격자: Uber H3
      </p>
    </div>
  );
}
