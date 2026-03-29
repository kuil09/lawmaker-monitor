import { useEffect, useMemo, useState } from "react";

import type {
  ConstituencyBoundariesIndexExport,
  Manifest
} from "@lawmaker-monitor/schemas";

import {
  buildConstituencyMapRegions,
  getConstituencyMetricValue,
  resolveProvinceForDistrict,
  type ConstituencyBoundaryTopology,
  type ConstituencyMapRegion,
  type ConstituencyMetricMode
} from "../lib/constituency-map.js";
import {
  loadConstituencyBoundariesIndex,
  loadConstituencyProvinceTopology
} from "../lib/data.js";
import type { DistributionMemberPoint } from "../lib/distribution.js";
import { formatNumber, formatPercent } from "../lib/format.js";
import { MemberIdentity } from "./MemberIdentity.js";

type DistributionConstituencyMapProps = {
  manifest: Manifest | null;
  members: DistributionMemberPoint[];
  highlightedMemberIds: ReadonlySet<string>;
  selectedMemberId: string | null;
  onSelectMember: (memberId: string) => void;
};

const MAP_WIDTH = 920;
const MAP_HEIGHT = 760;
const COLOR_LOW = "#f6e8d5";
const COLOR_HIGH = "#7b3128";
const METRIC_OPTIONS: Array<{
  key: ConstituencyMetricMode;
  label: string;
  description: string;
}> = [
  {
    key: "absent",
    label: "불참 비중",
    description: "진한 색일수록 해당 지역구 대표 의원의 불참 비중이 높습니다."
  },
  {
    key: "negative",
    label: "반대·기권 비중",
    description: "진한 색일수록 반대·기권 비중이 높습니다."
  },
  {
    key: "attendance",
    label: "출석률",
    description: "진한 색일수록 출석률이 낮습니다."
  }
];

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

function getRegionFill(region: ConstituencyMapRegion, metricMode: ConstituencyMetricMode): string {
  if (!region.member) {
    return "rgba(214, 203, 191, 0.45)";
  }

  if (!region.highlighted) {
    return "rgba(191, 178, 163, 0.42)";
  }

  const rawValue = getConstituencyMetricValue(region.member, metricMode);
  const intensity = metricMode === "attendance" ? 1 - rawValue : rawValue;
  return mixHexColor(COLOR_LOW, COLOR_HIGH, Math.max(0.14, Math.min(0.96, intensity)));
}

function getActiveMetricMeta(metricMode: ConstituencyMetricMode) {
  return (
    METRIC_OPTIONS.find((metric) => metric.key === metricMode) ?? {
      key: "absent",
      label: "불참 비중",
      description: "진한 색일수록 해당 지역구 대표 의원의 불참 비중이 높습니다."
    }
  );
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
    return `현재 province에서 ${formatNumber(args.matchedRegions.length)}개 지역구 통계를 연결했습니다.`;
  }

  return `필터 조건 안에서 ${formatNumber(args.highlightedRegions.length)}개 지역구를 강조하고, 나머지 ${formatNumber(args.matchedRegions.length - args.highlightedRegions.length)}개는 옅게 유지합니다.`;
}

function DistributionConstituencyMapDetail({
  region,
  selectedMemberId,
  onSelectMember
}: {
  region: ConstituencyMapRegion | null;
  selectedMemberId: string | null;
  onSelectMember: (memberId: string) => void;
}) {
  if (!region) {
    return (
      <aside className="distribution-map__detail" aria-live="polite">
        <p className="section-label">선택 지역구</p>
        <h3>지도에서 지역구를 선택해 주세요.</h3>
        <p className="distribution-page__search-note">
          지도 클릭 또는 province 전환으로 지역구별 통계를 살펴볼 수 있습니다.
        </p>
      </aside>
    );
  }

  return (
    <aside className="distribution-map__detail" aria-live="polite">
      <p className="section-label">선택 지역구</p>
      <h3>{region.properties.memberDistrictLabel}</h3>
      <p className="distribution-map__detail-area">{region.properties.areaText}</p>
      {region.member ? (
        <>
          <MemberIdentity
            name={region.member.name}
            party={region.member.party}
            photoUrl={region.member.photoUrl}
            size="large"
          />
          <div className="distribution-map__detail-actions">
            <button
              type="button"
              className="distribution-map__detail-action"
              onClick={() => onSelectMember(region.member!.memberId)}
              disabled={selectedMemberId === region.member.memberId}
            >
              {selectedMemberId === region.member.memberId
                ? "현재 분포 상세와 연결됨"
                : "이 의원 상세와 연결"}
            </button>
          </div>
          <div className="distribution-map__detail-metrics">
            <article>
              <span>출석률</span>
              <strong>{formatPercent(region.member.attendanceRate)}</strong>
            </article>
            <article>
              <span>불참 비중</span>
              <strong>{formatPercent(region.member.absentRate)}</strong>
            </article>
            <article>
              <span>반대·기권 비중</span>
              <strong>{formatPercent(region.member.negativeRate)}</strong>
            </article>
            <article>
              <span>현재 연속 패턴</span>
              <strong>{`${formatNumber(region.member.currentNegativeOrAbsentStreak)}일`}</strong>
            </article>
          </div>
          <dl className="distribution-map__detail-facts">
            <div>
              <dt>대표 의원</dt>
              <dd>{`${region.member.name} · ${region.member.party}`}</dd>
            </div>
            <div>
              <dt>기록표결</dt>
              <dd>{`${formatNumber(region.member.totalRecordedVotes)}건`}</dd>
            </div>
            <div>
              <dt>시군구</dt>
              <dd>{region.properties.sigunguNames.join(", ")}</dd>
            </div>
            <div>
              <dt>읍면동 수</dt>
              <dd>{`${formatNumber(region.properties.emdNames.length)}개`}</dd>
            </div>
          </dl>
        </>
      ) : (
        <>
          <p className="distribution-page__search-note">
            이 지역구는 boundary는 준비됐지만 현재 의원 통계 export와의 연결이 아직 없습니다.
          </p>
          <dl className="distribution-map__detail-facts">
            <div>
              <dt>시군구</dt>
              <dd>{region.properties.sigunguNames.join(", ")}</dd>
            </div>
            <div>
              <dt>읍면동 수</dt>
              <dd>{`${formatNumber(region.properties.emdNames.length)}개`}</dd>
            </div>
          </dl>
        </>
      )}
    </aside>
  );
}

export function DistributionConstituencyMap({
  manifest,
  members,
  highlightedMemberIds,
  selectedMemberId,
  onSelectMember
}: DistributionConstituencyMapProps) {
  const [boundaryIndex, setBoundaryIndex] = useState<ConstituencyBoundariesIndexExport | null>(null);
  const [isIndexLoading, setIsIndexLoading] = useState(false);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [activeProvinceShortName, setActiveProvinceShortName] = useState<string | null>(null);
  const [provinceTopologies, setProvinceTopologies] = useState<
    Record<string, ConstituencyBoundaryTopology | null | undefined>
  >({});
  const [isProvinceLoading, setIsProvinceLoading] = useState(false);
  const [provinceError, setProvinceError] = useState<string | null>(null);
  const [selectedDistrictKey, setSelectedDistrictKey] = useState<string | null>(null);
  const [metricMode, setMetricMode] = useState<ConstituencyMetricMode>("absent");

  const selectedMember = useMemo(
    () => members.find((member) => member.memberId === selectedMemberId) ?? null,
    [members, selectedMemberId]
  );
  const preferredProvince = useMemo(
    () =>
      boundaryIndex
        ? resolveProvinceForDistrict(selectedMember?.district ?? null, boundaryIndex.provinces)
        : null,
    [boundaryIndex, selectedMember?.district]
  );
  const activeProvince = useMemo(
    () =>
      activeProvinceShortName && boundaryIndex
        ? boundaryIndex.provinces.find(
            (province) => province.provinceShortName === activeProvinceShortName
          ) ?? null
        : null,
    [activeProvinceShortName, boundaryIndex]
  );
  const activeTopology =
    activeProvinceShortName !== null ? provinceTopologies[activeProvinceShortName] : undefined;

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
      preferredProvince?.provinceShortName ?? boundaryIndex.provinces[0]?.provinceShortName ?? null;

    if (!fallbackProvince) {
      return;
    }

    setActiveProvinceShortName((current) =>
      current === fallbackProvince ? current : fallbackProvince
    );
  }, [boundaryIndex, preferredProvince?.provinceShortName]);

  useEffect(() => {
    if (!activeProvince || provinceTopologies[activeProvince.provinceShortName] !== undefined) {
      return;
    }

    let active = true;
    setIsProvinceLoading(true);
    setProvinceError(null);

    void loadConstituencyProvinceTopology<ConstituencyBoundaryTopology>(activeProvince.path)
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
  const selectedMemberRegion = useMemo(
    () => regions.find((region) => region.member?.memberId === selectedMemberId) ?? null,
    [regions, selectedMemberId]
  );
  const selectedRegion =
    regions.find((region) => region.districtKey === selectedDistrictKey) ??
    selectedMemberRegion ??
    highlightedRegions[0] ??
    matchedRegions[0] ??
    regions[0] ??
    null;

  useEffect(() => {
    if (!selectedRegion || selectedRegion.districtKey === selectedDistrictKey) {
      return;
    }

    setSelectedDistrictKey(selectedRegion.districtKey);
  }, [selectedDistrictKey, selectedRegion]);

  const provinceAttendanceAverage =
    highlightedRegions.length > 0
      ? highlightedRegions.reduce(
          (sum, region) => sum + (region.member?.attendanceRate ?? 0),
          0
        ) / highlightedRegions.length
      : 0;
  const provinceAbsenceAverage =
    highlightedRegions.length > 0
      ? highlightedRegions.reduce((sum, region) => sum + (region.member?.absentRate ?? 0), 0) /
        highlightedRegions.length
      : 0;
  const activeMetricMeta = getActiveMetricMeta(metricMode);

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
          manifest와 province shard를 확인한 뒤 지도 패널을 엽니다.
        </p>
      </section>
    );
  }

  if (indexError) {
    return (
      <section className="distribution-map distribution-map--error" aria-live="polite">
        <p className="section-label">지역구 지도</p>
        <h2>지도 데이터를 열 수 없습니다.</h2>
        <p className="distribution-page__search-note">{indexError}</p>
      </section>
    );
  }

  if (!boundaryIndex) {
    return (
      <section className="distribution-map distribution-map--error" aria-live="polite">
        <p className="section-label">지역구 지도</p>
        <h2>배포 데이터에 지역구 boundary export가 아직 없습니다.</h2>
        <p className="distribution-page__search-note">
          `exports/constituency_boundaries/index.json`이 발행되면 같은 distribution route 안에서 상세 지도를 바로 열 수 있습니다.
        </p>
      </section>
    );
  }

  return (
    <section className="distribution-map" aria-label="지역구 지도 패널">
      <div className="distribution-map__header">
        <div>
          <p className="section-label">지역구 지도</p>
          <h2>{`${activeProvince?.provinceShortName ?? "선택한"} 지역구별 핵심 통계`}</h2>
          <p className="distribution-page__search-note">
            지도에서 선거구를 누르면 대표 의원과 출석, 불참, 반대·기권 패턴을 같은 화면에서 확인할 수 있습니다.
          </p>
        </div>
        <div className="distribution-map__summary-grid" aria-label="지역구 지도 요약">
          <article className="chart-card__summary">
            <span>매칭 지역구</span>
            <strong>{`${formatNumber(matchedRegions.length)} / ${formatNumber(regions.length)}`}</strong>
            <small>boundary 대비 current member 연결 수</small>
          </article>
          <article className="chart-card__summary">
            <span>평균 출석률</span>
            <strong>{formatPercent(provinceAttendanceAverage)}</strong>
            <small>현재 강조 cohort 기준</small>
          </article>
          <article className="chart-card__summary">
            <span>평균 불참 비중</span>
            <strong>{formatPercent(provinceAbsenceAverage)}</strong>
            <small>현재 강조 cohort 기준</small>
          </article>
        </div>
      </div>

      <div className="distribution-map__controls">
        <div className="distribution-map__province-list" role="tablist" aria-label="province 선택">
          {boundaryIndex.provinces.map((province) => (
            <button
              key={province.provinceShortName}
              type="button"
              className={
                province.provinceShortName === activeProvinceShortName
                  ? "distribution-map__province-button is-active"
                  : "distribution-map__province-button"
              }
              aria-selected={province.provinceShortName === activeProvinceShortName}
              onClick={() => handleSelectProvince(province.provinceShortName)}
            >
              <span>{province.provinceShortName}</span>
              <strong>{`${formatNumber(province.featureCount)}곳`}</strong>
            </button>
          ))}
        </div>
        <div className="distribution-map__metric-list" aria-label="지도 색상 기준">
          {METRIC_OPTIONS.map((metric) => (
            <button
              key={metric.key}
              type="button"
              className={
                metric.key === metricMode
                  ? "distribution-map__metric-button is-active"
                  : "distribution-map__metric-button"
              }
              aria-pressed={metric.key === metricMode}
              onClick={() => setMetricMode(metric.key)}
            >
              {metric.label}
            </button>
          ))}
        </div>
      </div>

      <div className="distribution-map__legend">
        <div className="distribution-map__legend-scale" aria-hidden="true">
          <span />
          <span />
        </div>
        <p className="distribution-page__search-note">{activeMetricMeta.description}</p>
        <p className="distribution-page__search-note">
          {buildRegionScopeText({
            matchedRegions,
            highlightedRegions,
            totalRegions: regions.length
          })}
        </p>
      </div>

      <div className="distribution-map__layout">
        <div className="distribution-map__surface">
          {isProvinceLoading && activeTopology === undefined ? (
            <div className="distribution-map__state">
              <h3>{`${activeProvince?.provinceShortName ?? "선택한 province"} 지도를 불러오는 중입니다.`}</h3>
              <p className="distribution-page__search-note">
                province shard를 받은 뒤 지역구별 SVG 경계를 그립니다.
              </p>
            </div>
          ) : provinceError ? (
            <div className="distribution-map__state">
              <h3>province shard를 열 수 없습니다.</h3>
              <p className="distribution-page__search-note">{provinceError}</p>
            </div>
          ) : activeTopology === null ? (
            <div className="distribution-map__state">
              <h3>선택한 province shard가 아직 발행되지 않았습니다.</h3>
              <p className="distribution-page__search-note">
                boundary index는 보이지만 실제 지도 파일이 없어 로컬 기준으로만 준비된 상태입니다.
              </p>
            </div>
          ) : (
            <svg
              className="distribution-map__svg"
              viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
              role="img"
              aria-label={`${activeProvince?.provinceShortName ?? "선택한 province"} 지역구 지도`}
            >
              {regions.map((region) => {
                const isSelected = selectedRegion?.districtKey === region.districtKey;
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
                      fill={getRegionFill(region, metricMode)}
                    />
                  </g>
                );
              })}
            </svg>
          )}
        </div>

        <DistributionConstituencyMapDetail
          region={selectedRegion}
          selectedMemberId={selectedMemberId}
          onSelectMember={onSelectMember}
        />
      </div>
    </section>
  );
}
