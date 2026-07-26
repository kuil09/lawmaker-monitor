import { H3HexagonLayer } from "@deck.gl/geo-layers";
import DeckGL from "@deck.gl/react";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import { MemberDetailLink } from "./MemberDetailLink.js";
import { normalizeConstituencyLookupKey } from "../lib/constituency-map.js";
import { buildDistrictCartogram } from "../lib/district-cartogram.js";
import { formatAssetEok, formatPercent } from "../lib/format.js";
import {
  createLogNormalizer,
  getPartyColor,
  getSequentialMetricColor
} from "../lib/geo-utils.js";
import {
  endPerformanceSpan,
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
  absentRate: number;
  negativeRate: number;
  realEstateTotal: number | null;
  assetTotal: number | null;
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

  const nationalCartogramCells = useMemo<H3DataCell[]>(
    () =>
      buildDistrictCartogram(nationalDistricts).map(({ h3Index, feature }) => ({
        h3Index,
        ...feature.properties.summary
      })),
    [nationalDistricts]
  );

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

  const nationalLayers = useMemo(() => {
    if (nationalCartogramCells.length === 0) {
      return [];
    }

    const normalizeMetric = createLogNormalizer(
      nationalCartogramCells
        .filter((cell) => cell.metricMemberCount > 0)
        .map((cell) => cell.metric)
    );

    return [
      new H3HexagonLayer<H3DataCell>({
        id: `cartogram-national-${activeMetric}`,
        data: nationalCartogramCells,
        getHexagon: (cell) => cell.h3Index,
        getFillColor: (cell) => getCellFillColor(cell, normalizeMetric),
        getLineColor: [255, 255, 255, 180],
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

          districtPanelSpanRef.current = startPerformanceSpan(
            "hexmap:districtPanelReady"
          );
          setSelectedDistrictKey(null);
          setSelectedProvinceFilter(info.object.provinceShortName);
          setNationalTooltip(null);
        }
      })
    ];
  }, [activeMetric, getCellFillColor, nationalCartogramCells]);

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
      nationalCartogramCells.length === 0 ||
      !isNationalMapRendered);
  const handleNationalMapAfterRender = useCallback(() => {
    if (isStaticMapComplete && nationalCartogramCells.length > 0) {
      setIsNationalMapRendered(true);
    }
  }, [isStaticMapComplete, nationalCartogramCells.length]);
  const summaryItemsByMemberId = useMemo(
    () => new Map(summaryItems.map((item) => [item.memberId, item] as const)),
    [summaryItems]
  );
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
              <span
                className="hexmap-tooltip__party-dot"
                style={dotStyle}
                aria-hidden="true"
              />
              <span className="hexmap-tooltip__name">
                {`의원 ${cell.memberCount}명`}
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

      <div className="hexmap-workspace">
        <aside className="hexmap-sidebar" aria-label="지도 탐색 조건">
          <section className="hexmap-sidebar__section">
            <h2>비교 기준</h2>
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
            <p className="hexmap-viz-description">{vizConfig.description}</p>
            {isAssetMetric(activeMetric) && memberAssetsIndexError ? (
              <p className="hexmap-viz-warning">{memberAssetsIndexError}</p>
            ) : null}
          </section>

          <section className="hexmap-sidebar__section">
            <h2>시·도 바로가기</h2>
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
                      setNationalTooltip(null);
                    }}
                  >
                    {entry.provinceShortName}
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
              <p>전국 보기</p>
              <h2 id="hexmap-national-title">지역구 카토그램</h2>
            </div>
            <span>한 지역구를 동일 크기 육각형 하나로 표시합니다</span>
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
                {nationalCartogramCells.length > 0 ? (
                  <DeckGL
                    initialViewState={INITIAL_VIEW_STATE}
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
                    <strong>전국 지도를 준비하고 있습니다.</strong>
                    <span>
                      {!accountabilitySummary
                        ? "활동 데이터를 불러오고 있습니다."
                        : loadProgress
                          ? `${loadProgress.total}개 시·도 중 ${loadProgress.done}개 완료`
                          : "선거구 경계 데이터를 불러오는 중입니다."}
                    </span>
                    <progress
                      aria-label="전국 상세 지도 준비 진행률"
                      max={loadProgress?.total ?? 1}
                      value={loadProgress?.done}
                    />
                  </div>
                ) : null}
              </>
            )}

            {nationalTooltip &&
              nationalCartogramCells.length > 0 &&
              renderTooltipContent(nationalTooltip, "클릭 → 지역 선택")}
          </div>
        </section>

        <section
          className="hexmap-section hexmap-section--detail"
          aria-labelledby="hexmap-detail-title"
        >
          <div className="hexmap-detail-header">
            <div>
              <p>선택 지역</p>
              <h2 id="hexmap-detail-title" className="hexmap-section-title">
                {detailPanelLabel ?? "지역을 선택하세요"}
              </h2>
              <p className="hexmap-section-desc">
                {selectedProvinceFilter
                  ? `${selectedProvinceFilter} 지역 의원의 지역구·정당과 핵심 지표를 비교합니다.`
                  : selectedDistrictKey
                    ? "선택한 지역구의 상위 시·도 범위를 불러오는 중입니다."
                    : "전국 지도나 시·도 바로가기에서 지역을 선택하세요."}{" "}
                의원을 선택하면 상세 활동 화면으로 이동합니다.
              </p>
            </div>
            {(selectedDistrictKey || selectedProvinceFilter) && (
              <button
                type="button"
                className="hexmap-detail-reset"
                onClick={() => {
                  setSelectedDistrictKey(null);
                  setSelectedProvinceFilter(null);
                }}
              >
                선택 해제
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
              <div className="hexmap-detail-directory__heading">
                <div>
                  <span>지역 의원</span>
                  <strong>{detailMemberOptions.length}명</strong>
                </div>
                <p>지역구와 활동·재산 지표를 함께 봅니다.</p>
              </div>
              <ul className="hexmap-detail-member-list">
                {detailMemberOptions.map((member) => (
                  <li key={member.memberId}>
                    <MemberDetailLink
                      className="hexmap-detail-member-card"
                      memberId={member.memberId}
                      name={member.name}
                      onNavigate={onNavigateToMember}
                    >
                      <span className="hexmap-detail-member-card__top">
                        <span className="hexmap-detail-member-card__identity">
                          <span
                            className="hexmap-detail-member-card__party-dot"
                            style={{
                              background: `rgb(${getPartyColor(member.party)
                                .slice(0, 3)
                                .join(",")})`
                            }}
                            aria-hidden="true"
                          />
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
