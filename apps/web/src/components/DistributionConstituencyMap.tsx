import { useEffect, useMemo, useRef, useState } from "react";

import {
  buildConstituencyMapRegions,
  getConstituencyMetricColorIntensity,
  getConstituencyMetricDomain,
  resolveProvinceForDistrict,
  type ConstituencyBoundaryTopology,
  type ConstituencyMapRegion
} from "../lib/constituency-map.js";
import {
  loadConstituencyBoundariesIndex,
  loadConstituencyProvinceTopology
} from "../lib/data.js";
import { formatNumber, formatPercent } from "../lib/format.js";

import type { DistributionMemberPoint } from "../lib/distribution.js";
import type {
  ConstituencyBoundariesIndexExport,
  Manifest
} from "@lawmaker-monitor/schemas";

type DistributionConstituencyMapProps = {
  manifest: Manifest | null;
  members: DistributionMemberPoint[];
  highlightedMemberIds: ReadonlySet<string>;
  selectedMemberId: string | null;
  onSelectMember: (memberId: string) => void;
};

const MAP_WIDTH = 920;
const MAP_HEIGHT = 760;
const COLOR_LOW = "#e8eaf0";
const COLOR_HIGH = "#3730a3";
const COLOR_INTENSITY_MIN = 0.14;
const COLOR_INTENSITY_MAX = 0.96;
const ATTENDANCE_METRIC_MODE = "attendance";
const ATTENDANCE_LEGEND_COPY =
  "현재 지도 안에서 진한 색일수록 출석률이 낮습니다.";

function mixHexColor(startHex: string, endHex: string, ratio: number): string {
  const normalized = Math.min(1, Math.max(0, ratio));
  const start = startHex.replace("#", "");
  const end = endHex.replace("#", "");
  const channels = [0, 2, 4].map((offset) => {
    const left = Number.parseInt(start.slice(offset, offset + 2), 16);
    const right = Number.parseInt(end.slice(offset, offset + 2), 16);
    const value = Math.round(left + (right - left) * normalized);
    return value.toString(16).padStart(2, "0");
  });

  return `#${channels.join("")}`;
}

function getRegionFill(
  region: ConstituencyMapRegion,
  metricDomain: ReturnType<typeof getConstituencyMetricDomain>
): string {
  if (!region.member) {
    return "rgba(200, 204, 212, 0.45)";
  }

  if (!region.highlighted) {
    return "rgba(180, 186, 198, 0.42)";
  }

  const normalizedIntensity = getConstituencyMetricColorIntensity(
    region.member,
    ATTENDANCE_METRIC_MODE,
    metricDomain
  );
  const intensity =
    COLOR_INTENSITY_MIN +
    normalizedIntensity * (COLOR_INTENSITY_MAX - COLOR_INTENSITY_MIN);
  return mixHexColor(COLOR_LOW, COLOR_HIGH, intensity);
}

function buildRegionScopeText(args: {
  matchedRegions: ConstituencyMapRegion[];
  highlightedRegions: ConstituencyMapRegion[];
  totalRegions: number;
}): string {
  if (args.totalRegions === 0) {
    return "표시할 지역구가 없습니다.";
  }

  if (args.highlightedRegions.length === args.matchedRegions.length) {
    return `현재 선택한 지역에서 ${formatNumber(args.matchedRegions.length)}개 지역구 통계를 연결했습니다.`;
  }

  return `필터 조건 안에서 ${formatNumber(args.highlightedRegions.length)}개 지역구를 강조하고, 나머지 ${formatNumber(args.matchedRegions.length - args.highlightedRegions.length)}개는 옅게 유지합니다.`;
}

export function DistributionConstituencyMap({
  manifest,
  members,
  highlightedMemberIds,
  selectedMemberId,
  onSelectMember
}: DistributionConstituencyMapProps) {
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [boundaryIndex, setBoundaryIndex] =
    useState<ConstituencyBoundariesIndexExport | null>(null);
  const [isIndexLoading, setIsIndexLoading] = useState(false);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [activeProvinceShortName, setActiveProvinceShortName] = useState<
    string | null
  >(null);
  const [provinceTopologies, setProvinceTopologies] = useState<
    Record<string, ConstituencyBoundaryTopology | null | undefined>
  >({});
  const [isProvinceLoading, setIsProvinceLoading] = useState(false);
  const [provinceError, setProvinceError] = useState<string | null>(null);
  const [selectedDistrictKey, setSelectedDistrictKey] = useState<string | null>(
    null
  );

  const selectedMember = useMemo(
    () =>
      members.find((member) => member.memberId === selectedMemberId) ?? null,
    [members, selectedMemberId]
  );
  const preferredProvince = useMemo(
    () =>
      boundaryIndex
        ? resolveProvinceForDistrict(
            selectedMember?.district ?? null,
            boundaryIndex.provinces
          )
        : null,
    [boundaryIndex, selectedMember?.district]
  );
  const activeProvince = useMemo(
    () =>
      activeProvinceShortName && boundaryIndex
        ? (boundaryIndex.provinces.find(
            (province) => province.provinceShortName === activeProvinceShortName
          ) ?? null)
        : null,
    [activeProvinceShortName, boundaryIndex]
  );
  const activeTopology =
    activeProvinceShortName !== null
      ? provinceTopologies[activeProvinceShortName]
      : undefined;

  useEffect(() => {
    let active = true;
    setIsIndexLoading(true);
    setIndexError(null);

    void loadConstituencyBoundariesIndex(manifest)
      .then((payload) => {
        if (!active) {
          return;
        }

        setBoundaryIndex(payload);
      })
      .catch((error: Error) => {
        if (!active) {
          return;
        }

        setIndexError(error.message);
        setBoundaryIndex(null);
      })
      .finally(() => {
        if (!active) {
          return;
        }

        setIsIndexLoading(false);
      });

    return () => {
      active = false;
    };
  }, [manifest]);

  useEffect(() => {
    if (!boundaryIndex || boundaryIndex.provinces.length === 0) {
      return;
    }

    const fallbackProvince =
      preferredProvince?.provinceShortName ??
      boundaryIndex.provinces[0]?.provinceShortName ??
      null;

    if (!fallbackProvince) {
      return;
    }

    setActiveProvinceShortName((current) =>
      current === fallbackProvince ? current : fallbackProvince
    );
  }, [boundaryIndex, preferredProvince?.provinceShortName]);

  useEffect(() => {
    if (
      !activeProvince ||
      provinceTopologies[activeProvince.provinceShortName] !== undefined
    ) {
      return;
    }

    let active = true;
    setIsProvinceLoading(true);
    setProvinceError(null);

    void loadConstituencyProvinceTopology<ConstituencyBoundaryTopology>(
      activeProvince.path
    )
      .then((payload) => {
        if (!active) {
          return;
        }

        setProvinceTopologies((current) => ({
          ...current,
          [activeProvince.provinceShortName]: payload
        }));
      })
      .catch((error: Error) => {
        if (!active) {
          return;
        }

        setProvinceError(error.message);
        setProvinceTopologies((current) => ({
          ...current,
          [activeProvince.provinceShortName]: null
        }));
      })
      .finally(() => {
        if (!active) {
          return;
        }

        setIsProvinceLoading(false);
      });

    return () => {
      active = false;
    };
  }, [activeProvince, provinceTopologies]);

  const regions = useMemo(
    () =>
      activeTopology
        ? buildConstituencyMapRegions({
            topology: activeTopology,
            members,
            highlightedMemberIds,
            width: MAP_WIDTH,
            height: MAP_HEIGHT
          })
        : [],
    [activeTopology, highlightedMemberIds, members]
  );

  const matchedRegions = useMemo(
    () => regions.filter((region) => region.member),
    [regions]
  );
  const highlightedRegions = useMemo(
    () => matchedRegions.filter((region) => region.highlighted),
    [matchedRegions]
  );
  const metricDomain = useMemo(
    () =>
      getConstituencyMetricDomain(
        highlightedRegions.length > 0 ? highlightedRegions : regions,
        ATTENDANCE_METRIC_MODE
      ),
    [highlightedRegions, regions]
  );
  const selectedMemberRegion = useMemo(
    () =>
      regions.find((region) => region.member?.memberId === selectedMemberId) ??
      null,
    [regions, selectedMemberId]
  );
  const selectedRegion =
    regions.find((region) => region.districtKey === selectedDistrictKey) ??
    selectedMemberRegion ??
    null;

  // When the map's auto-selected region has a member that differs from the
  // global selection (e.g. selected member is proportional-rep with no
  // district), push the map's choice up so both panels stay in sync.
  const lastSyncedRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      selectedRegion?.member &&
      selectedMemberId &&
      selectedRegion.member.memberId !== selectedMemberId &&
      !selectedMemberRegion &&
      !selectedDistrictKey &&
      lastSyncedRef.current !== selectedRegion.member.memberId
    ) {
      lastSyncedRef.current = selectedRegion.member.memberId;
      onSelectMember(selectedRegion.member.memberId);
    }
  }, [
    selectedRegion,
    selectedMemberId,
    selectedMemberRegion,
    selectedDistrictKey,
    onSelectMember
  ]);

  const visibleRegions =
    highlightedRegions.length > 0 ? highlightedRegions : matchedRegions;
  const provinceAttendanceAverage =
    visibleRegions.length > 0
      ? visibleRegions.reduce(
          (sum, region) => sum + (region.member?.attendanceRate ?? 0),
          0
        ) / visibleRegions.length
      : 0;
  const provinceLowestAttendanceRate =
    visibleRegions.length > 0
      ? Math.min(
          ...visibleRegions.map((region) => region.member?.attendanceRate ?? 0)
        )
      : 0;
  const selectedCohortLabel =
    highlightedRegions.length > 0
      ? "현재 강조 집합 기준"
      : "현재 지역 전체 기준";
  const matchedCoverageLabel =
    regions.length > 0
      ? "boundary 대비 현재 의원 연결 수"
      : "표시할 지역구 없음";
  const regionScopeText = buildRegionScopeText({
    matchedRegions,
    highlightedRegions,
    totalRegions: regions.length
  });

  function handleSelectProvince(provinceShortName: string) {
    setActiveProvinceShortName(provinceShortName);
    setSelectedDistrictKey(null);
  }

  function handleSelectRegion(region: ConstituencyMapRegion) {
    setSelectedDistrictKey(region.districtKey);

    if (region.member) {
      onSelectMember(region.member.memberId);
    }
  }

  if (isIndexLoading && !boundaryIndex && !indexError) {
    return (
      <section className="distribution-map" aria-live="polite">
        <p className="section-label">지역구 지도</p>
        <h2>지역구 boundary를 불러오는 중입니다.</h2>
        <p className="distribution-page__search-note">
          manifest와 지역 shard를 확인한 뒤 지도 패널을 엽니다.
        </p>
      </section>
    );
  }

  if (indexError) {
    return (
      <section
        className="distribution-map distribution-map--error"
        aria-live="polite"
      >
        <p className="section-label">지역구 지도</p>
        <h2>지도 데이터를 열 수 없습니다.</h2>
        <p className="distribution-page__search-note">{indexError}</p>
      </section>
    );
  }

  if (!boundaryIndex) {
    return (
      <section
        className="distribution-map distribution-map--error"
        aria-live="polite"
      >
        <p className="section-label">지역구 지도</p>
        <h2>배포 데이터에 지역구 boundary export가 아직 없습니다.</h2>
        <p className="distribution-page__search-note">
          `exports/constituency_boundaries/index.json`이 발행되면 같은 분포 화면
          안에서 상세 지도를 바로 열 수 있습니다.
        </p>
      </section>
    );
  }

  return (
    <section
      className="distribution-map"
      aria-label="지역구 지도 패널"
      style={
        {
          "--map-color-low": mixHexColor(
            COLOR_LOW,
            COLOR_HIGH,
            COLOR_INTENSITY_MIN
          ),
          "--map-color-high": mixHexColor(
            COLOR_LOW,
            COLOR_HIGH,
            COLOR_INTENSITY_MAX
          )
        } as React.CSSProperties
      }
    >
      <div className="distribution-map__header">
        <div>
          <div className="distribution-map__eyebrow">
            <p className="section-label">지역구 지도</p>
            <button
              type="button"
              className="distribution-map__help-button"
              aria-label={
                isHelpOpen ? "지역구 지도 설명 닫기" : "지역구 지도 설명 보기"
              }
              aria-expanded={isHelpOpen}
              aria-controls="distribution-map-help"
              onClick={() => setIsHelpOpen((current) => !current)}
            >
              ?
            </button>
          </div>
          <h2>{`${activeProvince?.provinceShortName ?? "선택한"} 지역구별 핵심 통계`}</h2>
        </div>
        <div
          className="distribution-map__summary-grid"
          aria-label="지역구 지도 요약"
        >
          <article className="chart-card__summary">
            <span>매칭 지역구</span>
            <strong>{`${formatNumber(matchedRegions.length)} / ${formatNumber(regions.length)}`}</strong>
            <small>{matchedCoverageLabel}</small>
          </article>
          <article className="chart-card__summary">
            <span>평균 출석률</span>
            <strong>{formatPercent(provinceAttendanceAverage)}</strong>
            <small>{selectedCohortLabel}</small>
          </article>
          <article className="chart-card__summary">
            <span>가장 낮은 출석률</span>
            <strong>{formatPercent(provinceLowestAttendanceRate)}</strong>
            <small>{selectedCohortLabel}</small>
          </article>
        </div>
      </div>

      <div className="distribution-map__controls">
        <label className="distribution-map__province-picker">
          <span className="distribution-map__field-label">지역 선택</span>
          <select
            className="distribution-map__province-select"
            aria-label="지역 선택"
            value={activeProvinceShortName ?? ""}
            onChange={(event) =>
              handleSelectProvince(event.currentTarget.value)
            }
          >
            {activeProvinceShortName ? null : (
              <option value="" disabled>
                지역을 선택해 주세요
              </option>
            )}
            {boundaryIndex.provinces.map((province) => (
              <option
                key={province.provinceShortName}
                value={province.provinceShortName}
              >
                {`${province.provinceShortName} · ${formatNumber(province.featureCount)}곳`}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="distribution-map__legend">
        <span className="distribution-map__legend-label">높은 출석</span>
        <div className="distribution-map__legend-scale" aria-hidden="true">
          <span />
          <span />
        </div>
        <span className="distribution-map__legend-label distribution-map__legend-label--end">
          낮은 출석
        </span>
      </div>

      {isHelpOpen ? (
        <div
          id="distribution-map-help"
          className="distribution-map__help-panel"
          role="note"
        >
          <p className="distribution-page__search-note">
            지도에서 선거구를 누르면 대표 의원과 출석 흐름을 먼저 보고, 상세
            패널에서 다른 표결 지표를 함께 확인할 수 있습니다.
          </p>
          <p className="distribution-page__search-note">
            지역을 바꾸면 같은 화면에서 해당 지역구 출석률 분포를 다시 읽습니다.
          </p>
          <p className="distribution-page__search-note">
            {ATTENDANCE_LEGEND_COPY}
          </p>
          <p className="distribution-page__search-note">{regionScopeText}</p>
        </div>
      ) : null}

      <div className="distribution-map__surface">
        {isProvinceLoading && activeTopology === undefined ? (
          <div className="distribution-map__state">
            <h3>{`${activeProvince?.provinceShortName ?? "선택한 지역"} 지도를 불러오는 중입니다.`}</h3>
            <p className="distribution-page__search-note">
              지역 shard를 받은 뒤 지역구별 SVG 경계를 그립니다.
            </p>
          </div>
        ) : provinceError ? (
          <div className="distribution-map__state">
            <h3>지역 shard를 열 수 없습니다.</h3>
            <p className="distribution-page__search-note">{provinceError}</p>
          </div>
        ) : activeTopology === null ? (
          <div className="distribution-map__state">
            <h3>선택한 지역 shard가 아직 발행되지 않았습니다.</h3>
            <p className="distribution-page__search-note">
              boundary index는 보이지만 실제 지도 파일이 없어 로컬 기준으로만
              준비된 상태입니다.
            </p>
          </div>
        ) : (
          <svg
            className="distribution-map__svg"
            viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
            role="img"
            aria-label={`${activeProvince?.provinceShortName ?? "선택한 지역"} 지역구 지도`}
          >
            {regions.map((region) => {
              const isSelected =
                selectedRegion?.districtKey === region.districtKey;
              return (
                <g
                  key={region.districtKey}
                  role="button"
                  tabIndex={0}
                  aria-label={region.properties.memberDistrictLabel}
                  onClick={() => handleSelectRegion(region)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      handleSelectRegion(region);
                    }
                  }}
                >
                  <title>{region.properties.memberDistrictLabel}</title>
                  <path
                    d={region.path}
                    className={
                      isSelected
                        ? "distribution-map__region is-selected"
                        : "distribution-map__region"
                    }
                    fill={getRegionFill(region, metricDomain)}
                  />
                </g>
              );
            })}
          </svg>
        )}
      </div>

      {selectedRegion?.member ? (
        <p className="distribution-map__selected-label">
          {`${selectedRegion.properties.memberDistrictLabel} · ${selectedRegion.member.name} · 출석률 ${formatPercent(selectedRegion.member.attendanceRate)}`}
        </p>
      ) : null}
    </section>
  );
}
