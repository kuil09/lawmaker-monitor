import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { CalendarCheckIcon } from "@phosphor-icons/react/dist/csr/CalendarCheck";
import { CircleIcon } from "@phosphor-icons/react/dist/csr/Circle";
import { DiamondIcon } from "@phosphor-icons/react/dist/csr/Diamond";
import { HouseIcon } from "@phosphor-icons/react/dist/csr/House";
import { InfoIcon } from "@phosphor-icons/react/dist/csr/Info";
import { ListBulletsIcon } from "@phosphor-icons/react/dist/csr/ListBullets";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { MapPinIcon } from "@phosphor-icons/react/dist/csr/MapPin";
import { MapTrifoldIcon } from "@phosphor-icons/react/dist/csr/MapTrifold";
import { SquareIcon } from "@phosphor-icons/react/dist/csr/Square";
import { TriangleIcon } from "@phosphor-icons/react/dist/csr/Triangle";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/csr/UsersThree";
import { WalletIcon } from "@phosphor-icons/react/dist/csr/Wallet";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import {
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import { MemberDetailLink } from "./MemberDetailLink.js";
import { formatAssetEok, formatDate, formatPercent } from "../lib/format.js";
import { getOptimizedMemberPhotoUrl } from "../lib/member-photo.js";

import type { MapMetric, MapRouteArgs } from "../lib/map-route.js";
import type {
  AccountabilitySummaryExport,
  Manifest,
  MemberAssetsIndexExport
} from "@lawmaker-monitor/schemas";

const PROVINCE_ORDER = [
  "서울",
  "부산",
  "대구",
  "인천",
  "광주",
  "대전",
  "울산",
  "세종",
  "경기",
  "강원",
  "충북",
  "충남",
  "전북",
  "전남",
  "경북",
  "경남",
  "제주"
] as const;

const METRIC_CONFIGS: Array<{
  key: MapMetric;
  label: string;
  shortLabel: string;
  basis: string;
  description: string;
}> = [
  {
    key: "absence",
    label: "결석률",
    shortLabel: "결석률",
    basis: "본회의 기준",
    description: "공개된 본회의 표결 중 결석으로 기록된 비율"
  },
  {
    key: "negative",
    label: "반대·기권 비율",
    shortLabel: "반대·기권",
    basis: "법안 표결 기준",
    description: "공개 표결에서 반대 또는 기권으로 기록된 비율"
  },
  {
    key: "realEstate",
    label: "부동산 신고액",
    shortLabel: "부동산",
    basis: "최근 신고 기준",
    description: "최근 공개된 건물·토지 신고액 합계"
  },
  {
    key: "assetTotal",
    label: "총 재산 신고액",
    shortLabel: "총 재산",
    basis: "최근 신고 기준",
    description: "최근 공개된 순재산 신고액"
  }
];

type ViewMode = "members" | "summary";
type Severity = "low" | "normal" | "caution" | "high";

type RegionalMember = {
  memberId: string;
  name: string;
  party: string;
  district: string;
  province: string | null;
  districtGroup: string;
  photoUrl: string | null;
  absentRate: number;
  negativeRate: number;
  realEstateTotal: number | null;
  assetTotal: number | null;
  assemblyNo: number;
  reelectionLabel: string | null;
  committeeName: string | null;
};

type MetricEvidence = {
  metric: MapMetric;
  label: string;
  basis: string;
  value: number | null;
  formatted: string;
};

type ProvinceSummary = {
  province: string;
  memberCount: number;
  value: number | null;
  averageLabel: string;
  rank: number | null;
  severity: Severity;
  topMember: RegionalMember | null;
};

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

function getProvinceFromDistrict(district: string | null | undefined) {
  if (!district || district === "비례대표") {
    return null;
  }

  if (district.startsWith("전남광주통합특별시")) {
    const localDistrict = district.replace(/^전남광주통합특별시\s*/u, "");
    return /^(동구남구|서구|북구|광산구)/u.test(localDistrict)
      ? "광주"
      : "전남";
  }

  return (
    PROVINCE_ORDER.find(
      (province) =>
        district === province ||
        district.startsWith(`${province} `) ||
        district.startsWith(province)
    ) ?? null
  );
}

function normalizeDistrictLabel(
  district: string,
  province: string | null
): string {
  if (!province) {
    return district;
  }
  if (district.startsWith("전남광주통합특별시")) {
    return `${province} ${district.replace(/^전남광주통합특별시\s*/u, "")}`;
  }
  if (district.startsWith("세종특별자치시")) {
    const seat = district.replace(/^세종특별자치시/u, "");
    return seat ? `세종 ${seat}` : "세종";
  }
  return district;
}

function getDistrictGroup(district: string, province: string | null): string {
  const withoutProvince = province
    ? district.replace(new RegExp(`^${province}\\s*`), "")
    : district;
  const withoutSeatSuffix = withoutProvince.replace(/(갑|을|병|정)$/u, "");
  return withoutSeatSuffix || withoutProvince || "지역구";
}

function getMetricValue(
  member: RegionalMember,
  metric: MapMetric
): number | null {
  switch (metric) {
    case "absence":
      return member.absentRate;
    case "negative":
      return member.negativeRate;
    case "realEstate":
      return member.realEstateTotal;
    case "assetTotal":
      return member.assetTotal;
  }
}

function formatMetricValue(metric: MapMetric, value: number | null): string {
  if (value == null) {
    return "자료 없음";
  }
  return metric === "absence" || metric === "negative"
    ? formatPercent(value)
    : formatAssetEok(value);
}

function getMetricConfig(metric: MapMetric) {
  return (
    METRIC_CONFIGS.find((config) => config.key === metric) ?? METRIC_CONFIGS[0]!
  );
}

function getMetricSeverity(value: number | null, percentile: number): Severity {
  if (value == null) {
    return "low";
  }
  if (percentile <= 0.1) return "high";
  if (percentile <= 0.25) return "caution";
  if (percentile <= 0.55) return "normal";
  return "low";
}

function getSeverityLabel(severity: Severity) {
  switch (severity) {
    case "high":
      return "높음";
    case "caution":
      return "주의";
    case "normal":
      return "보통";
    case "low":
      return "낮음";
  }
}

function renderSeverityIcon(severity: Severity, size = 15) {
  switch (severity) {
    case "high":
      return <TriangleIcon size={size} weight="fill" aria-hidden="true" />;
    case "caution":
      return <DiamondIcon size={size} weight="fill" aria-hidden="true" />;
    case "normal":
      return <CircleIcon size={size} weight="bold" aria-hidden="true" />;
    case "low":
      return <SquareIcon size={size} weight="bold" aria-hidden="true" />;
  }
}

function renderMetricIcon(metric: MapMetric, size = 25) {
  switch (metric) {
    case "absence":
      return <CalendarCheckIcon size={size} aria-hidden="true" />;
    case "negative":
      return <UsersThreeIcon size={size} aria-hidden="true" />;
    case "realEstate":
      return <HouseIcon size={size} aria-hidden="true" />;
    case "assetTotal":
      return <WalletIcon size={size} aria-hidden="true" />;
  }
}

function getMetricProgress(
  value: number | null,
  values: readonly number[]
): number {
  if (value == null || values.length === 0) {
    return 0;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) {
    return 50;
  }
  return Math.max(4, Math.min(100, ((value - min) / (max - min)) * 100));
}

function getMemberRank(
  members: readonly RegionalMember[],
  memberId: string,
  metric: MapMetric
) {
  const ranked = members
    .flatMap((member) => {
      const value = getMetricValue(member, metric);
      return value == null ? [] : [{ memberId: member.memberId, value }];
    })
    .sort((left, right) => right.value - left.value);
  const index = ranked.findIndex((entry) => entry.memberId === memberId);
  return index < 0
    ? { rank: null, total: ranked.length, percentile: 1 }
    : {
        rank: index + 1,
        total: ranked.length,
        percentile: (index + 1) / ranked.length
      };
}

function averageMetric(
  members: readonly RegionalMember[],
  metric: MapMetric
): number | null {
  const values = members.flatMap((member) => {
    const value = getMetricValue(member, metric);
    return value == null ? [] : [value];
  });
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function MemberPhoto({
  member,
  className
}: {
  member: RegionalMember;
  className: string;
}) {
  if (member.photoUrl) {
    return <img src={member.photoUrl} alt="" className={className} />;
  }
  return (
    <span className={`${className} ${className}--fallback`} aria-hidden="true">
      {member.name.slice(0, 1)}
    </span>
  );
}

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
  const [selectedProvince, setSelectedProvince] = useState<string | null>(
    getProvinceFromDistrict(initialDistrict) ?? initialProvince
  );
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [memberSearch, setMemberSearch] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("members");
  const onChangeRouteRef = useRef(onChangeRoute);
  onChangeRouteRef.current = onChangeRoute;

  const assetsByMemberId = useMemo(
    () =>
      new Map(
        (memberAssetsIndex?.members ?? []).map((member) => [
          member.memberId,
          {
            assetTotal: member.latestTotal,
            realEstateTotal: member.latestRealEstateTotal ?? null
          }
        ])
      ),
    [memberAssetsIndex]
  );

  const members = useMemo<RegionalMember[]>(
    () =>
      (accountabilitySummary?.items ?? []).map((item) => {
        const sourceDistrict = item.district ?? "지역구 정보 없음";
        const province = getProvinceFromDistrict(sourceDistrict);
        const district = normalizeDistrictLabel(sourceDistrict, province);
        const assets = assetsByMemberId.get(item.memberId);
        return {
          memberId: item.memberId,
          name: item.name,
          party: item.party,
          district,
          province,
          districtGroup: getDistrictGroup(district, province),
          photoUrl: getOptimizedMemberPhotoUrl(item.photoUrl),
          absentRate: item.absentRate,
          negativeRate: item.noRate + item.abstainRate,
          realEstateTotal: assets?.realEstateTotal ?? null,
          assetTotal: assets?.assetTotal ?? null,
          assemblyNo: item.assemblyNo,
          reelectionLabel: item.profile?.reelectionLabel ?? null,
          committeeName:
            item.profile?.representativeCommitteeName ??
            item.profile?.affiliatedCommitteeName ??
            null
        };
      }),
    [accountabilitySummary, assetsByMemberId]
  );

  const regionalMembers = useMemo(
    () => members.filter((member) => member.province != null),
    [members]
  );
  const availableProvinces = useMemo(
    () =>
      PROVINCE_ORDER.filter((province) =>
        regionalMembers.some((member) => member.province === province)
      ),
    [regionalMembers]
  );

  useEffect(() => {
    setActiveMetric(initialMetric);
  }, [initialMetric]);

  useEffect(() => {
    const routeProvince =
      getProvinceFromDistrict(initialDistrict) ?? initialProvince;
    if (!routeProvince) {
      return;
    }
    setSelectedProvince((currentProvince) => {
      if (currentProvince === routeProvince) {
        return currentProvince;
      }
      setSelectedMemberId(null);
      setMemberSearch("");
      return routeProvince;
    });
  }, [initialDistrict, initialProvince]);

  useEffect(() => {
    if (selectedProvince || availableProvinces.length === 0) {
      return;
    }
    setSelectedProvince(
      availableProvinces.includes("서울")
        ? "서울"
        : (availableProvinces[0] ?? null)
    );
  }, [availableProvinces, selectedProvince]);

  useEffect(() => {
    if (!selectedProvince) {
      return;
    }
    onChangeRouteRef.current({
      district: null,
      province: selectedProvince,
      metric: activeMetric
    });
  }, [activeMetric, selectedProvince]);

  const provinceMembers = useMemo(
    () =>
      regionalMembers.filter((member) => member.province === selectedProvince),
    [regionalMembers, selectedProvince]
  );
  const normalizedSearch = memberSearch.trim().toLocaleLowerCase("ko");
  const visibleMembers = useMemo(
    () =>
      provinceMembers.filter(
        (member) =>
          !normalizedSearch ||
          member.name.toLocaleLowerCase("ko").includes(normalizedSearch) ||
          member.district.toLocaleLowerCase("ko").includes(normalizedSearch) ||
          member.party.toLocaleLowerCase("ko").includes(normalizedSearch)
      ),
    [normalizedSearch, provinceMembers]
  );

  const selectedMember =
    provinceMembers.find((member) => member.memberId === selectedMemberId) ??
    visibleMembers[0] ??
    provinceMembers[0] ??
    null;

  useEffect(() => {
    if (selectedMember && selectedMember.memberId !== selectedMemberId) {
      setSelectedMemberId(selectedMember.memberId);
    }
  }, [selectedMember, selectedMemberId]);

  const districtGroups = useMemo(() => {
    const grouped = new Map<string, RegionalMember[]>();
    for (const member of visibleMembers) {
      const group = grouped.get(member.districtGroup) ?? [];
      group.push(member);
      grouped.set(member.districtGroup, group);
    }
    return [...grouped.entries()]
      .map(([label, groupMembers]) => ({
        label,
        members: groupMembers.sort((left, right) =>
          left.district.localeCompare(right.district, "ko")
        )
      }))
      .sort((left, right) => left.label.localeCompare(right.label, "ko"));
  }, [visibleMembers]);

  const nationalMetricValues = useMemo(
    () =>
      regionalMembers.flatMap((member) => {
        const value = getMetricValue(member, activeMetric);
        return value == null ? [] : [value];
      }),
    [activeMetric, regionalMembers]
  );
  const provinceMetricValues = useMemo(
    () =>
      provinceMembers.flatMap((member) => {
        const value = getMetricValue(member, activeMetric);
        return value == null ? [] : [value];
      }),
    [activeMetric, provinceMembers]
  );

  const provinceSummaries = useMemo<ProvinceSummary[]>(() => {
    const summaries: ProvinceSummary[] = availableProvinces.map((province) => {
      const provinceItems = regionalMembers.filter(
        (member) => member.province === province
      );
      const value = averageMetric(provinceItems, activeMetric);
      const topMember =
        [...provinceItems]
          .filter((member) => getMetricValue(member, activeMetric) != null)
          .sort(
            (left, right) =>
              (getMetricValue(right, activeMetric) ?? 0) -
              (getMetricValue(left, activeMetric) ?? 0)
          )[0] ?? null;
      return {
        province,
        memberCount: provinceItems.length,
        value,
        averageLabel: formatMetricValue(activeMetric, value),
        rank: null,
        severity: "low" as Severity,
        topMember
      };
    });
    const ranked = summaries
      .filter(
        (summary): summary is ProvinceSummary & { value: number } =>
          summary.value != null
      )
      .sort((left, right) => right.value - left.value);
    return summaries.map((summary) => {
      const rank = ranked.findIndex(
        (entry) => entry.province === summary.province
      );
      const percentile = rank < 0 ? 1 : (rank + 1) / ranked.length;
      return {
        ...summary,
        rank: rank < 0 ? null : rank + 1,
        severity: getMetricSeverity(summary.value, percentile)
      };
    });
  }, [activeMetric, availableProvinces, regionalMembers]);

  const selectedProvinceSummary =
    provinceSummaries.find(
      (summary) => summary.province === selectedProvince
    ) ?? null;
  const nationalAverage = averageMetric(regionalMembers, activeMetric);
  const selectedMemberRank = selectedMember
    ? getMemberRank(regionalMembers, selectedMember.memberId, activeMetric)
    : { rank: null, total: 0, percentile: 1 };
  const selectedMemberValue = selectedMember
    ? getMetricValue(selectedMember, activeMetric)
    : null;
  const selectedMemberSeverity = getMetricSeverity(
    selectedMemberValue,
    selectedMemberRank.percentile
  );
  const activeMetricConfig = getMetricConfig(activeMetric);
  const generatedDate =
    accountabilitySummary?.generatedAt ?? manifest?.updatedAt ?? null;

  const selectedMetricEvidence = selectedMember
    ? METRIC_CONFIGS.map<MetricEvidence>((config) => {
        const value = getMetricValue(selectedMember, config.key);
        return {
          metric: config.key,
          label: config.label,
          basis: config.basis,
          value,
          formatted: formatMetricValue(config.key, value)
        };
      })
    : [];

  function selectProvince(province: string) {
    setSelectedProvince(province);
    setSelectedMemberId(null);
    setMemberSearch("");
  }

  function selectMetric(metric: MapMetric) {
    setActiveMetric(metric);
  }

  function handleMetricKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number
  ) {
    let nextIndex = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (index + 1) % METRIC_CONFIGS.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (index - 1 + METRIC_CONFIGS.length) % METRIC_CONFIGS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = METRIC_CONFIGS.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    const nextMetric = METRIC_CONFIGS[nextIndex]!.key;
    selectMetric(nextMetric);
    const tabs =
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
        '[role="tab"]'
      );
    tabs?.[nextIndex]?.focus();
  }

  if (!accountabilitySummary) {
    return (
      <main className="hexmap-page hexmap-page--loading">
        <div className="ledger-loading" role="status" aria-live="polite">
          <CalendarCheckIcon size={28} aria-hidden="true" />
          <strong>지역별 국회 기록을 준비하고 있습니다.</strong>
          <span>의원 활동과 공개 재산 데이터를 연결하는 중입니다.</span>
        </div>
      </main>
    );
  }

  return (
    <main className="hexmap-page">
      <header className="hexmap-page__header">
        <div>
          <p className="hexmap-page__eyebrow">REGIONAL EVIDENCE LEDGER</p>
          <div className="hexmap-page__title-row">
            <h1 className="hexmap-page__title">지역별 국회 기록 탐색</h1>
            <p>
              17개 시·도 국회의원의 의정활동 기록을 지표로 비교하고 근거를
              확인하세요.
            </p>
          </div>
        </div>
        <dl className="hexmap-page__status">
          <div>
            <dt>국회</dt>
            <dd>{assemblyLabel}</dd>
          </div>
          <div>
            <dt>기준일</dt>
            <dd>{generatedDate ? formatDate(generatedDate) : "확인 중"}</dd>
          </div>
        </dl>
      </header>

      <section className="ledger-region-picker" aria-label="지역 선택">
        <div className="ledger-control-label">
          <strong>지역 선택</strong>
          <span>의석수</span>
        </div>
        <div className="ledger-region-tabs">
          {availableProvinces.map((province) => {
            const memberCount = regionalMembers.filter(
              (member) => member.province === province
            ).length;
            return (
              <button
                key={province}
                type="button"
                aria-pressed={selectedProvince === province}
                className={selectedProvince === province ? "is-active" : ""}
                onClick={() => selectProvince(province)}
              >
                <strong>{province}</strong>
                <span>({memberCount})</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="ledger-toolbar" aria-label="비교 지표와 보기 방식">
        <div className="ledger-control-label">
          <strong>지표 선택</strong>
          <InfoIcon size={15} aria-hidden="true" />
        </div>
        <div
          className="ledger-metric-tabs"
          role="tablist"
          aria-label="시각화 지표 선택"
        >
          {METRIC_CONFIGS.map((config, index) => (
            <button
              key={config.key}
              type="button"
              role="tab"
              aria-selected={activeMetric === config.key}
              tabIndex={activeMetric === config.key ? 0 : -1}
              className={activeMetric === config.key ? "is-active" : ""}
              onClick={() => selectMetric(config.key)}
              onKeyDown={(event) => handleMetricKeyDown(event, index)}
            >
              {renderMetricIcon(config.key)}
              <span>
                <strong>{config.label}</strong>
                <small>{config.basis}</small>
              </span>
            </button>
          ))}
        </div>
        <div className="ledger-view-toggle" aria-label="보기 방식">
          <span>보기 방식</span>
          <button
            type="button"
            aria-pressed={viewMode === "members"}
            className={viewMode === "members" ? "is-active" : ""}
            onClick={() => setViewMode("members")}
          >
            <ListBulletsIcon size={19} aria-hidden="true" />
            의원 배치
          </button>
          <button
            type="button"
            aria-pressed={viewMode === "summary"}
            className={viewMode === "summary" ? "is-active" : ""}
            onClick={() => setViewMode("summary")}
          >
            <MapTrifoldIcon size={19} aria-hidden="true" />
            시·도 요약
          </button>
        </div>
      </section>

      {memberAssetsIndexError &&
      (activeMetric === "realEstate" || activeMetric === "assetTotal") ? (
        <p className="ledger-data-warning">{memberAssetsIndexError}</p>
      ) : null}

      <div className="ledger-workspace">
        <section
          className="ledger-primary"
          aria-labelledby="ledger-primary-title"
        >
          <header className="ledger-primary__header">
            <div>
              <p>{viewMode === "members" ? "선택 지역" : "전국 비교"}</p>
              <h2 id="ledger-primary-title">
                {viewMode === "members"
                  ? `${selectedProvince ?? "지역"} (${provinceMembers.length}석)`
                  : `시·도별 ${activeMetricConfig.label} 분포`}
              </h2>
            </div>
            {viewMode === "members" ? (
              <label className="ledger-member-search">
                <MagnifyingGlassIcon size={17} aria-hidden="true" />
                <span className="sr-only">의원 검색</span>
                <input
                  type="search"
                  value={memberSearch}
                  onChange={(event) =>
                    setMemberSearch(event.currentTarget.value)
                  }
                  placeholder="의원·정당·지역구 검색"
                />
                {memberSearch ? (
                  <button
                    type="button"
                    aria-label="검색어 지우기"
                    onClick={() => setMemberSearch("")}
                  >
                    <XIcon size={15} aria-hidden="true" />
                  </button>
                ) : null}
              </label>
            ) : (
              <p className="ledger-primary__hint">
                지역을 선택하면 소속 의원 기록으로 이어집니다.
              </p>
            )}
          </header>

          {viewMode === "members" ? (
            visibleMembers.length > 0 ? (
              <div className="ledger-district-board">
                {districtGroups.map((group) => (
                  <section
                    key={group.label}
                    className="ledger-district-cluster"
                    aria-label={`${group.label} ${group.members.length}석`}
                  >
                    <header>
                      <strong>{group.label}</strong>
                      <span>({group.members.length}석)</span>
                    </header>
                    <div>
                      {group.members.map((member) => {
                        const value = getMetricValue(member, activeMetric);
                        const progress = getMetricProgress(
                          value,
                          provinceMetricValues
                        );
                        const rank = getMemberRank(
                          regionalMembers,
                          member.memberId,
                          activeMetric
                        );
                        const severity = getMetricSeverity(
                          value,
                          rank.percentile
                        );
                        return (
                          <button
                            key={member.memberId}
                            type="button"
                            className={`ledger-member-card${
                              selectedMember?.memberId === member.memberId
                                ? " is-selected"
                                : ""
                            }`}
                            aria-pressed={
                              selectedMember?.memberId === member.memberId
                            }
                            onClick={() => setSelectedMemberId(member.memberId)}
                          >
                            <span className="ledger-member-card__body">
                              <MemberPhoto
                                member={member}
                                className="ledger-member-card__photo"
                              />
                              <span className="ledger-member-card__copy">
                                <strong>{member.name}</strong>
                                <small>{member.party}</small>
                                <small>{member.districtGroup}</small>
                              </span>
                            </span>
                            <span
                              className="ledger-member-card__metric"
                              data-severity={severity}
                              style={
                                {
                                  "--metric-progress": `${progress}%`
                                } as CSSProperties
                              }
                            >
                              <span aria-hidden="true" />
                              <strong>
                                {formatMetricValue(activeMetric, value)}
                              </strong>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <div className="ledger-empty" role="status">
                <MagnifyingGlassIcon size={26} aria-hidden="true" />
                <strong>검색 조건에 맞는 의원이 없습니다.</strong>
                <button type="button" onClick={() => setMemberSearch("")}>
                  검색 초기화
                </button>
              </div>
            )
          ) : (
            <div className="ledger-summary-layout">
              <aside className="ledger-severity-legend">
                <h3>
                  {activeMetricConfig.label} 심각도
                  <small>{activeMetricConfig.basis} · 전국 상대 순위</small>
                </h3>
                {(["low", "normal", "caution", "high"] as Severity[]).map(
                  (severity) => (
                    <span key={severity} data-severity={severity}>
                      {renderSeverityIcon(severity)}
                      {getSeverityLabel(severity)}
                    </span>
                  )
                )}
                <p>
                  전국 평균{" "}
                  <strong>
                    {formatMetricValue(activeMetric, nationalAverage)}
                  </strong>
                </p>
              </aside>
              <div
                className="ledger-province-matrix"
                aria-label={`시·도별 ${activeMetricConfig.label} 비교`}
              >
                {provinceSummaries.map((summary) => (
                  <button
                    key={summary.province}
                    type="button"
                    data-province={summary.province}
                    data-severity={summary.severity}
                    aria-pressed={summary.province === selectedProvince}
                    className={
                      summary.province === selectedProvince ? "is-active" : ""
                    }
                    onClick={() => {
                      selectProvince(summary.province);
                      setViewMode("members");
                    }}
                  >
                    <span className="ledger-province-matrix__severity">
                      {renderSeverityIcon(summary.severity, 16)}
                      {getSeverityLabel(summary.severity)}
                    </span>
                    <strong>{summary.province}</strong>
                    <b>{summary.averageLabel}</b>
                    <small>{summary.memberCount}석</small>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        <aside
          className="ledger-evidence-panel"
          aria-label={
            viewMode === "members" ? "선택한 의원의 기록" : "선택한 지역의 요약"
          }
        >
          {viewMode === "summary" && selectedProvinceSummary ? (
            <>
              <header className="ledger-evidence-panel__heading">
                <span>선택한 지역의 요약</span>
              </header>
              <div className="ledger-region-focus">
                <MapPinIcon size={30} aria-hidden="true" />
                <div>
                  <span>선택 지역</span>
                  <h2>{selectedProvinceSummary.province}</h2>
                </div>
                <strong data-severity={selectedProvinceSummary.severity}>
                  {getSeverityLabel(selectedProvinceSummary.severity)}
                </strong>
              </div>
              <section className="ledger-focus-metric">
                <header>
                  <span>
                    {activeMetricConfig.label}
                    <small>{activeMetricConfig.basis}</small>
                  </span>
                  <strong>{selectedProvinceSummary.averageLabel}</strong>
                </header>
              </section>
              <dl className="ledger-region-stats">
                <div>
                  <dt>전국 순위</dt>
                  <dd>
                    {selectedProvinceSummary.rank ?? "—"} /{" "}
                    {provinceSummaries.length}개 시·도
                  </dd>
                </div>
                <div>
                  <dt>전국 평균</dt>
                  <dd>{formatMetricValue(activeMetric, nationalAverage)}</dd>
                </div>
                <div>
                  <dt>지역구 의원</dt>
                  <dd>{selectedProvinceSummary.memberCount}명</dd>
                </div>
                <div>
                  <dt>지역 내 최고값</dt>
                  <dd>
                    {selectedProvinceSummary.topMember?.name ?? "자료 없음"}
                  </dd>
                </div>
              </dl>
              <button
                type="button"
                className="ledger-primary-action"
                onClick={() => setViewMode("members")}
              >
                {selectedProvinceSummary.province} 의원 기록 보기
                <ArrowRightIcon size={17} aria-hidden="true" />
              </button>
            </>
          ) : selectedMember ? (
            <>
              <header className="ledger-evidence-panel__heading">
                <span>선택한 의원의 기록</span>
              </header>
              <div className="ledger-member-focus">
                <MemberPhoto
                  member={selectedMember}
                  className="ledger-member-focus__photo"
                />
                <div>
                  <h2>{selectedMember.name}</h2>
                  <strong>{selectedMember.party}</strong>
                  <span>{selectedMember.district}</span>
                  <small>
                    {selectedMember.reelectionLabel
                      ? `${selectedMember.reelectionLabel} · `
                      : ""}
                    제{selectedMember.assemblyNo}대 국회
                  </small>
                  {selectedMember.committeeName ? (
                    <small>{selectedMember.committeeName}</small>
                  ) : null}
                </div>
              </div>
              <section
                className="ledger-focus-metric"
                data-severity={selectedMemberSeverity}
              >
                <header>
                  <span>
                    {activeMetricConfig.label}
                    <small>{activeMetricConfig.basis}</small>
                  </span>
                  <strong>
                    {formatMetricValue(activeMetric, selectedMemberValue)}
                  </strong>
                </header>
                <div className="ledger-focus-metric__rank">
                  <span>
                    {selectedMemberRank.rank
                      ? `전국 상위 ${Math.max(
                          1,
                          Math.ceil(selectedMemberRank.percentile * 100)
                        )}%`
                      : "비교 자료 없음"}
                  </span>
                  <strong>{getSeverityLabel(selectedMemberSeverity)}</strong>
                </div>
                <div
                  className="ledger-focus-metric__track"
                  aria-label={`${activeMetricConfig.label} 비교 위치`}
                >
                  <span
                    style={{
                      width: `${getMetricProgress(
                        selectedMemberValue,
                        nationalMetricValues
                      )}%`
                    }}
                  />
                </div>
                <footer>
                  <span>낮음</span>
                  <span>
                    전국 평균 {formatMetricValue(activeMetric, nationalAverage)}
                  </span>
                  <span>높음</span>
                </footer>
              </section>
              <div className="ledger-secondary-metrics">
                {selectedMetricEvidence
                  .filter((evidence) => evidence.metric !== activeMetric)
                  .map((evidence) => (
                    <button
                      key={evidence.metric}
                      type="button"
                      onClick={() => selectMetric(evidence.metric)}
                    >
                      {renderMetricIcon(evidence.metric, 18)}
                      <span>
                        <strong>{evidence.label}</strong>
                        <small>{evidence.basis}</small>
                      </span>
                      <b>{evidence.formatted}</b>
                      <ArrowRightIcon size={15} aria-hidden="true" />
                    </button>
                  ))}
              </div>
              <MemberDetailLink
                className="ledger-primary-action"
                memberId={selectedMember.memberId}
                name={selectedMember.name}
                onNavigate={onNavigateToMember}
              >
                의원 상세 보기
                <ArrowSquareOutIcon size={17} aria-hidden="true" />
              </MemberDetailLink>
              <p className="ledger-evidence-panel__note">
                이 의원의 모든 의정기록과 근거 자료를 확인합니다.
              </p>
            </>
          ) : (
            <div className="ledger-empty">
              <UsersThreeIcon size={28} aria-hidden="true" />
              <strong>의원을 선택해 주세요.</strong>
            </div>
          )}
        </aside>
      </div>

      <footer className="hexmap-footer-note">
        <span>
          데이터: 국회 의정정보시스템·국회 회의록·공직자 재산공개 자료
        </span>
        <span>{activeMetricConfig.description}</span>
      </footer>
    </main>
  );
}
