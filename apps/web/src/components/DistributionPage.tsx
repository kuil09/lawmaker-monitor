import { useEffect, useMemo, useState } from "react";

import type {
  AccountabilitySummaryExport,
  MemberActivityCalendarExport
} from "@lawmaker-monitor/schemas";
import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { buildCalendarHref } from "../lib/calendar-route.js";
import {
  buildDistributionChartDomain,
  buildDistributionMembers,
  buildDistributionPartySummaries,
  getDefaultDistributionMemberId,
  type DistributionMemberPoint
} from "../lib/distribution.js";
import { formatNumber, formatPercent } from "../lib/format.js";
import { MemberIdentity } from "./MemberIdentity.js";
import { MemberSearchField } from "./MemberSearchField.js";

type DistributionPageProps = {
  accountabilitySummary: AccountabilitySummaryExport | null;
  activityCalendar: MemberActivityCalendarExport | null;
  loading: boolean;
  errors: string[];
  assemblyLabel: string;
  initialMemberId?: string | null;
  onBack: () => void;
  onSelectMember: (memberId: string) => void;
};

type DistributionChartPoint = DistributionMemberPoint & {
  attendancePercent: number;
  negativePercent: number;
  radius: number;
};

type DistributionPointShapeProps = {
  cx?: number;
  cy?: number;
  payload?: DistributionChartPoint;
};

type TooltipProps = {
  active?: boolean;
  payload?: ReadonlyArray<{
    payload?: DistributionChartPoint;
  }>;
};

const partyPalette = [
  "#7b3128",
  "#43657b",
  "#7a5a22",
  "#385f43",
  "#8b5c88",
  "#5c4f98"
];
const MIN_POINT_PHOTO_SIZE = 48;
const distributionPointPhotoCache = new Map<string, boolean>();

function formatPercentPointDelta(value: number): string {
  if (Math.abs(value) < 0.0005) {
    return "평균과 거의 같습니다.";
  }

  const prefix = value > 0 ? "+" : "-";
  return `평균 대비 ${prefix}${Math.abs(value * 100).toFixed(1)}%p`;
}

function buildPartyColorMap(members: DistributionMemberPoint[]): Map<string, string> {
  const parties = [...new Set(members.map((member) => member.party))];
  const fallbackColor = "#7b3128";

  return new Map(
    parties.map((party, index) => [party, partyPalette[index % partyPalette.length] ?? fallbackColor])
  );
}

function buildChartPoints(members: DistributionMemberPoint[]): DistributionChartPoint[] {
  return members.map((member) => ({
    ...member,
    attendancePercent: Number((member.attendanceRate * 100).toFixed(1)),
    negativePercent: Number((member.negativeRate * 100).toFixed(1)),
    radius: 7 + Math.min(member.currentNegativeOrAbsentStreak, 4) + Math.min(member.absentVoteCount, 3)
  }));
}

function useDistributionPointPhoto(photoUrl?: string | null): boolean {
  const [canUsePhoto, setCanUsePhoto] = useState(() => {
    if (!photoUrl) {
      return false;
    }

    return distributionPointPhotoCache.get(photoUrl) ?? false;
  });

  useEffect(() => {
    if (!photoUrl) {
      setCanUsePhoto(false);
      return;
    }

    const cachedValue = distributionPointPhotoCache.get(photoUrl);
    if (typeof cachedValue === "boolean") {
      setCanUsePhoto(cachedValue);
      return;
    }

    if (typeof Image === "undefined") {
      setCanUsePhoto(false);
      return;
    }

    let active = true;
    const image = new Image();
    image.decoding = "async";

    image.onload = () => {
      if (!active) {
        return;
      }

      const isUsable =
        image.naturalWidth >= MIN_POINT_PHOTO_SIZE &&
        image.naturalHeight >= MIN_POINT_PHOTO_SIZE;
      distributionPointPhotoCache.set(photoUrl, isUsable);
      setCanUsePhoto(isUsable);
    };
    image.onerror = () => {
      if (!active) {
        return;
      }

      distributionPointPhotoCache.set(photoUrl, false);
      setCanUsePhoto(false);
    };
    image.src = photoUrl;

    return () => {
      active = false;
      image.onload = null;
      image.onerror = null;
    };
  }, [photoUrl]);

  return canUsePhoto;
}

function DistributionPointShape({
  cx = 0,
  cy = 0,
  payload,
  selected = false,
  partyColors,
  onSelectMember
}: DistributionPointShapeProps & {
  selected?: boolean;
  partyColors: Map<string, string>;
  onSelectMember: (memberId: string) => void;
}) {
  if (!payload) {
    return null;
  }

  const resolvedColor = partyColors.get(payload.party);
  const fill = resolvedColor ?? partyPalette[0];
  const radius = payload.radius + (selected ? 2 : 0);
  const canUsePhoto = useDistributionPointPhoto(payload.photoUrl);
  const markerIdBase = `distribution-point-${payload.memberId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const clipPathId = `${markerIdBase}-clip`;
  const badgeRadius = Math.max(3.4, Math.round(radius * 0.28 * 10) / 10);

  return (
    <g
      transform={`translate(${Number(cx)}, ${Number(cy)})`}
      className="distribution-chart__point"
      onClick={() => onSelectMember(payload.memberId)}
      style={{ cursor: "pointer" }}
    >
      {selected ? (
        <circle
          r={radius + 4}
          fill="rgba(255, 255, 255, 0.86)"
          stroke={fill}
          strokeWidth={2}
        />
      ) : null}
      {canUsePhoto && payload.photoUrl ? (
        <>
          <defs>
            <clipPath id={clipPathId}>
              <circle r={radius} />
            </clipPath>
          </defs>
          <circle
            r={radius + 1.2}
            fill="rgba(255, 255, 255, 0.94)"
            stroke={fill}
            strokeWidth={selected ? 2.6 : 1.8}
          />
          <image
            href={payload.photoUrl}
            x={-radius}
            y={-radius}
            width={radius * 2}
            height={radius * 2}
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#${clipPathId})`}
          />
          <circle
            r={radius}
            fill="transparent"
            stroke={selected ? "#1d1812" : "rgba(255, 255, 255, 0.92)"}
            strokeWidth={selected ? 2.2 : 1.5}
          />
          <circle
            cx={radius * 0.64}
            cy={radius * 0.64}
            r={badgeRadius}
            fill={fill}
            stroke="rgba(255, 255, 255, 0.96)"
            strokeWidth={1.5}
          />
        </>
      ) : (
        <circle
          r={radius}
          fill={fill}
          fillOpacity={selected ? 0.96 : 0.78}
          stroke={selected ? "#1d1812" : "#ffffff"}
          strokeWidth={selected ? 2.4 : 1.5}
        />
      )}
      <title>{payload.name}</title>
    </g>
  );
}

function DistributionTooltipPanel({ active, payload }: TooltipProps) {
  const point = payload?.[0]?.payload;
  if (!active || !point) {
    return null;
  }

  return (
    <div className="chart-tooltip distribution-chart__tooltip">
      <strong>{point.name}</strong>
      <p className="distribution-chart__tooltip-line">{`${point.party} · ${
        point.district ?? "지역 정보 없음"
      }`}</p>
      <ul>
        <li>
          <span>출석률</span>
          <strong>{formatPercent(point.attendanceRate)}</strong>
        </li>
        <li>
          <span>반대·기권 비중</span>
          <strong>{formatPercent(point.negativeRate)}</strong>
        </li>
        <li>
          <span>불참 비중</span>
          <strong>{formatPercent(point.absentRate)}</strong>
        </li>
        <li>
          <span>현재 연속 패턴</span>
          <strong>{`${formatNumber(point.currentNegativeOrAbsentStreak)}일`}</strong>
        </li>
      </ul>
    </div>
  );
}

function DistributionSignalList({
  title,
  description,
  members,
  selectedMemberId,
  onSelectMember,
  renderValue
}: {
  title: string;
  description: string;
  members: DistributionMemberPoint[];
  selectedMemberId: string | null;
  onSelectMember: (memberId: string) => void;
  renderValue: (member: DistributionMemberPoint) => string;
}) {
  return (
    <section className="distribution-signal-card">
      <div className="distribution-signal-card__header">
        <div>
          <p className="section-label">{title}</p>
          <h3>{description}</h3>
        </div>
      </div>
      <ol className="distribution-signal-list">
        {members.map((member) => (
          <li key={`${title}:${member.memberId}`}>
            <button
              type="button"
              className={
                member.memberId === selectedMemberId
                  ? "distribution-signal-list__button is-active"
                  : "distribution-signal-list__button"
              }
              onClick={() => onSelectMember(member.memberId)}
            >
              <span className="distribution-signal-list__identity">
                <span className="distribution-signal-list__name">{member.name}</span>
                <span className="distribution-signal-list__meta">
                  {`${member.party} · ${member.district ?? "지역 정보 없음"}`}
                </span>
              </span>
              <strong className="distribution-signal-list__value">{renderValue(member)}</strong>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function DistributionPage({
  accountabilitySummary,
  activityCalendar,
  loading,
  errors,
  assemblyLabel,
  initialMemberId,
  onBack,
  onSelectMember
}: DistributionPageProps) {
  const [isChartHelpOpen, setIsChartHelpOpen] = useState(false);
  const members = useMemo(
    () =>
      accountabilitySummary && activityCalendar
        ? buildDistributionMembers(accountabilitySummary, activityCalendar)
        : [],
    [accountabilitySummary, activityCalendar]
  );
  const partySummaries = useMemo(
    () => buildDistributionPartySummaries(members).slice(0, 4),
    [members]
  );
  const chartPoints = useMemo(() => buildChartPoints(members), [members]);
  const attendanceDomain = useMemo(
    () => buildDistributionChartDomain(chartPoints.map((member) => member.attendancePercent)),
    [chartPoints]
  );
  const negativeDomain = useMemo(
    () => buildDistributionChartDomain(chartPoints.map((member) => member.negativePercent)),
    [chartPoints]
  );
  const selectedMemberId =
    initialMemberId && members.some((member) => member.memberId === initialMemberId)
      ? initialMemberId
      : getDefaultDistributionMemberId(members);
  const selectedMember =
    members.find((member) => member.memberId === selectedMemberId) ?? null;
  const selectedChartPoint =
    chartPoints.find((member) => member.memberId === selectedMemberId) ?? null;
  const otherChartPoints = chartPoints.filter((member) => member.memberId !== selectedMemberId);
  const partyColors = useMemo(() => buildPartyColorMap(members), [members]);
  const searchOptions = useMemo(
    () =>
      [...members]
        .sort((left, right) => left.name.localeCompare(right.name, "ko-KR"))
        .map((member) => ({
          id: member.memberId,
          label: `${member.name} · ${member.party} · ${member.district ?? "지역 정보 없음"}`
        })),
    [members]
  );

  const averageAttendanceRate =
    members.length > 0
      ? members.reduce((sum, member) => sum + member.attendanceRate, 0) / members.length
      : 0;
  const averageNegativeRate =
    members.length > 0
      ? members.reduce((sum, member) => sum + member.negativeRate, 0) / members.length
      : 0;
  const highNegativeMembers = [...members]
    .sort((left, right) => {
      if (right.negativeRate !== left.negativeRate) {
        return right.negativeRate - left.negativeRate;
      }

      if (right.noRate !== left.noRate) {
        return right.noRate - left.noRate;
      }

      return right.currentNegativeOrAbsentStreak - left.currentNegativeOrAbsentStreak;
    })
    .slice(0, 5);
  const attendanceRiskMembers = [...members]
    .sort((left, right) => {
      if (left.attendanceRate !== right.attendanceRate) {
        return left.attendanceRate - right.attendanceRate;
      }

      if (right.absentRate !== left.absentRate) {
        return right.absentRate - left.absentRate;
      }

      return right.absentVoteCount - left.absentVoteCount;
    })
    .slice(0, 5);
  const streakMembers = [...members]
    .sort((left, right) => {
      if (right.currentNegativeOrAbsentStreak !== left.currentNegativeOrAbsentStreak) {
        return right.currentNegativeOrAbsentStreak - left.currentNegativeOrAbsentStreak;
      }

      if (right.longestNegativeOrAbsentStreak !== left.longestNegativeOrAbsentStreak) {
        return right.longestNegativeOrAbsentStreak - left.longestNegativeOrAbsentStreak;
      }

      return right.disruptionRate - left.disruptionRate;
    })
    .slice(0, 5);

  if (loading && members.length === 0) {
    return (
      <main className="app-shell">
        <section className="distribution-page__empty">
          <button type="button" className="distribution-page__back" onClick={onBack}>
            홈으로
          </button>
          <p className="section-label">전체 분포</p>
          <h1>{`${assemblyLabel} 분포 화면을 준비 중입니다.`}</h1>
          <p>책임성 요약과 활동 캘린더를 합쳐 의원별 위치를 계산하고 있습니다.</p>
        </section>
      </main>
    );
  }

  if (members.length === 0) {
    return (
      <main className="app-shell">
        <section className="distribution-page__empty">
          <button type="button" className="distribution-page__back" onClick={onBack}>
            홈으로
          </button>
          <p className="section-label">전체 분포</p>
          <h1>{`${assemblyLabel} 분포 화면을 열 수 없습니다.`}</h1>
          <ul className="distribution-page__error-list">
            {(errors.length > 0
              ? errors
              : ["책임성 요약 또는 활동 캘린더 데이터가 아직 준비되지 않았습니다."]).map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="distribution-page__masthead">
        <div className="distribution-page__headline">
          <button type="button" className="distribution-page__back" onClick={onBack}>
            홈으로
          </button>
          <p className="section-label">전체 분포</p>
          <h1>{`${assemblyLabel} 의원 분포`}</h1>
        </div>
        <div className="distribution-page__search">
          <MemberSearchField
            label="분포에서 의원 찾기"
            options={searchOptions}
            selectedId={selectedMember?.memberId ?? null}
            onSelect={(memberId) => {
              if (memberId) {
                onSelectMember(memberId);
              }
            }}
            placeholder="이름, 정당, 지역으로 의원을 고르세요"
          />
        </div>
      </section>

      <div className="distribution-page__layout">
        <section className="distribution-chart" aria-label="의원 분포 차트">
          <div className="distribution-chart__header">
            <div>
              <div className="distribution-chart__eyebrow">
                <p className="section-label">좌표 분포</p>
                <button
                  type="button"
                  className="distribution-chart__help-button"
                  aria-label={isChartHelpOpen ? "분포 설명 닫기" : "분포 설명 보기"}
                  aria-expanded={isChartHelpOpen}
                  aria-controls="distribution-chart-help"
                  onClick={() => setIsChartHelpOpen((current) => !current)}
                >
                  ?
                </button>
              </div>
              <h2>출석률이 낮고 반대·기권 비중이 높은 의원이 왼쪽 위에 모입니다.</h2>
              {isChartHelpOpen ? (
                <div id="distribution-chart-help" className="distribution-chart__help-panel" role="note">
                  <p className="distribution-page__copy">
                    출석률과 반대·기권 비중을 한 좌표에 두고, 불참과 연속 패턴을 함께 읽는 첫 분포 화면입니다.
                  </p>
                  <p className="distribution-chart__copy">
                    가로축은 출석률, 세로축은 반대·기권 비중입니다. 점 크기는 현재 반대·기권·불참 연속 패턴을 반영합니다.
                  </p>
                  <p className="distribution-page__search-note">
                    점, 우측 카드, 아래 시그널 리스트가 모두 같은 선택 상태를 공유합니다.
                  </p>
                </div>
              ) : null}
            </div>
            <div className="distribution-chart__summary-grid" aria-label="분포 요약">
              <div className="chart-card__summary">
                <span>대상 의원</span>
                <strong>{`${formatNumber(members.length)}명`}</strong>
                <small>두 export 교집합 기준</small>
              </div>
              <div className="chart-card__summary">
                <span>평균 출석률</span>
                <strong>{formatPercent(averageAttendanceRate)}</strong>
                <small>캘린더 날짜 기준</small>
              </div>
              <div className="chart-card__summary chart-card__summary--alert">
                <span>평균 반대·기권</span>
                <strong>{formatPercent(averageNegativeRate)}</strong>
                <small>기록표결 분모 기준</small>
              </div>
            </div>
          </div>
          <div className="distribution-chart__surface">
            <ResponsiveContainer width="100%" height={420}>
              <ScatterChart margin={{ top: 22, right: 28, bottom: 34, left: 12 }}>
                <CartesianGrid stroke="rgba(72, 56, 40, 0.12)" />
                <ReferenceLine
                  x={Number((averageAttendanceRate * 100).toFixed(1))}
                  stroke="rgba(123, 49, 40, 0.22)"
                  strokeDasharray="4 4"
                />
                <ReferenceLine
                  y={Number((averageNegativeRate * 100).toFixed(1))}
                  stroke="rgba(123, 49, 40, 0.22)"
                  strokeDasharray="4 4"
                />
                <XAxis
                  type="number"
                  dataKey="attendancePercent"
                  domain={attendanceDomain}
                  tick={{ fill: "rgba(29, 24, 18, 0.72)", fontSize: 12 }}
                  tickFormatter={(value) => `${value}%`}
                  label={{ value: "출석률", position: "insideBottom", offset: -12 }}
                />
                <YAxis
                  type="number"
                  dataKey="negativePercent"
                  domain={negativeDomain}
                  tick={{ fill: "rgba(29, 24, 18, 0.72)", fontSize: 12 }}
                  tickFormatter={(value) => `${value}%`}
                  width={44}
                  label={{ value: "반대·기권 비중", angle: -90, position: "insideLeft" }}
                />
                <Tooltip content={<DistributionTooltipPanel />} />
                <Scatter
                  data={otherChartPoints}
                  shape={(props) => (
                    <DistributionPointShape
                      {...props}
                      partyColors={partyColors}
                      onSelectMember={onSelectMember}
                    />
                  )}
                />
                {selectedChartPoint ? (
                  <Scatter
                    data={[selectedChartPoint]}
                    shape={(props) => (
                      <DistributionPointShape
                        {...props}
                        selected
                        partyColors={partyColors}
                        onSelectMember={onSelectMember}
                      />
                    )}
                  />
                ) : null}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="distribution-chart__legend">
            <div className="distribution-chart__legend-copy">
              <strong>정당 군집</strong>
              <span>초상화 점의 테두리와 작은 배지는 정당을 뜻하고, 점 크기는 현재 연속 패턴 길이를 뜻합니다.</span>
            </div>
            <ul className="distribution-chart__legend-list">
              {partySummaries.map((summary) => (
                <li key={summary.party}>
                  <i style={{ backgroundColor: partyColors.get(summary.party) ?? partyPalette[0] }} />
                  <span>{summary.party}</span>
                  <strong>{`${formatNumber(summary.memberCount)}명`}</strong>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {selectedMember ? (
          <aside className="distribution-focus" aria-label="선택 의원 요약">
            <div className="distribution-focus__header">
              <p className="section-label">선택 의원</p>
              <MemberIdentity
                name={selectedMember.name}
                party={selectedMember.party}
                photoUrl={selectedMember.photoUrl}
                size="large"
              />
              <p className="distribution-focus__district">
                {selectedMember.district ?? "지역 정보 없음"}
              </p>
              <p className="distribution-focus__note">
                {`${selectedMember.party} 내부에서는 ${
                  selectedMember.currentNegativeOrAbsentStreak > 0
                    ? `현재 ${formatNumber(selectedMember.currentNegativeOrAbsentStreak)}일 연속으로 반대·기권·불참 패턴이 이어지고 있습니다.`
                    : "현재 찬성 없이 이어지는 연속 패턴은 없습니다."
                }`}
              </p>
            </div>

            <div className="distribution-focus__actions">
              <a className="distribution-focus__action distribution-focus__action--primary" href={buildCalendarHref({
                memberId: selectedMember.memberId
              })}>
                활동 캘린더 열기
              </a>
              {selectedMember.officialProfileUrl ? (
                <a
                  className="distribution-focus__action"
                  href={selectedMember.officialProfileUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  국회 프로필
                </a>
              ) : null}
            </div>

            <div className="distribution-focus__metric-grid">
              <article className="distribution-focus__metric">
                <span>출석률</span>
                <strong>{formatPercent(selectedMember.attendanceRate)}</strong>
                <small>
                  {`${formatNumber(selectedMember.attendedDays)}일 / 대상 ${formatNumber(
                    selectedMember.eligibleDays
                  )}일`}
                </small>
              </article>
              <article className="distribution-focus__metric distribution-focus__metric--alert">
                <span>반대·기권 비중</span>
                <strong>{formatPercent(selectedMember.negativeRate)}</strong>
                <small>{formatPercentPointDelta(selectedMember.negativeRate - averageNegativeRate)}</small>
              </article>
              <article className="distribution-focus__metric">
                <span>불참 비중</span>
                <strong>{formatPercent(selectedMember.absentRate)}</strong>
                <small>{`${formatNumber(selectedMember.absentVoteCount)}건 불참`}</small>
              </article>
              <article className="distribution-focus__metric">
                <span>현재 연속 패턴</span>
                <strong>{`${formatNumber(selectedMember.currentNegativeOrAbsentStreak)}일`}</strong>
                <small>{`최장 ${formatNumber(selectedMember.longestNegativeOrAbsentStreak)}일`}</small>
              </article>
            </div>

            <div className="distribution-focus__composition">
              <div className="distribution-focus__composition-bar" aria-hidden="true">
                <span
                  className="distribution-focus__segment distribution-focus__segment--yes"
                  style={{ width: `${selectedMember.yesRate * 100}%` }}
                />
                <span
                  className="distribution-focus__segment distribution-focus__segment--no"
                  style={{ width: `${selectedMember.noRate * 100}%` }}
                />
                <span
                  className="distribution-focus__segment distribution-focus__segment--abstain"
                  style={{ width: `${selectedMember.abstainRate * 100}%` }}
                />
                <span
                  className="distribution-focus__segment distribution-focus__segment--absent"
                  style={{ width: `${selectedMember.absentRate * 100}%` }}
                />
              </div>
              <div className="distribution-focus__composition-list">
                <span><i className="distribution-focus__dot distribution-focus__dot--yes" />찬성 {formatPercent(selectedMember.yesRate)}</span>
                <span><i className="distribution-focus__dot distribution-focus__dot--no" />반대 {formatPercent(selectedMember.noRate)}</span>
                <span><i className="distribution-focus__dot distribution-focus__dot--abstain" />기권 {formatPercent(selectedMember.abstainRate)}</span>
                <span><i className="distribution-focus__dot distribution-focus__dot--absent" />불참 {formatPercent(selectedMember.absentRate)}</span>
              </div>
            </div>

            <dl className="distribution-focus__signals">
              <div>
                <dt>위원회</dt>
                <dd>
                  {selectedMember.committeeMemberships.length > 0
                    ? selectedMember.committeeMemberships.join(", ")
                    : "현재 위원회 정보 없음"}
                </dd>
              </div>
              <div>
                <dt>반대·기권 날짜</dt>
                <dd>{`${formatNumber(selectedMember.negativeDayCount)}일`}</dd>
              </div>
              <div>
                <dt>불참 날짜</dt>
                <dd>{`${formatNumber(selectedMember.absentDayCount)}일`}</dd>
              </div>
              <div>
                <dt>출석률 위치</dt>
                <dd>{formatPercentPointDelta(selectedMember.attendanceRate - averageAttendanceRate)}</dd>
              </div>
            </dl>
          </aside>
        ) : null}
      </div>

      <div className="distribution-signal-grid">
        <DistributionSignalList
          title="시그널 1"
          description="반대·기권 비중이 높은 의원"
          members={highNegativeMembers}
          selectedMemberId={selectedMemberId}
          onSelectMember={onSelectMember}
          renderValue={(member) => formatPercent(member.negativeRate)}
        />
        <DistributionSignalList
          title="시그널 2"
          description="출석률이 낮은 의원"
          members={attendanceRiskMembers}
          selectedMemberId={selectedMemberId}
          onSelectMember={onSelectMember}
          renderValue={(member) => formatPercent(member.attendanceRate)}
        />
        <DistributionSignalList
          title="시그널 3"
          description="현재 연속 패턴이 긴 의원"
          members={streakMembers}
          selectedMemberId={selectedMemberId}
          onSelectMember={onSelectMember}
          renderValue={(member) => `${formatNumber(member.currentNegativeOrAbsentStreak)}일`}
        />
        <section className="distribution-signal-card distribution-signal-card--party">
          <div className="distribution-signal-card__header">
            <div>
              <p className="section-label">정당 군집</p>
              <h3>정당 평균으로도 출석과 반대·기권 위치를 읽습니다.</h3>
            </div>
          </div>
          <ul className="distribution-party-list">
            {partySummaries.map((summary) => (
              <li key={summary.party}>
                <div className="distribution-party-list__title">
                  <span>
                    <i
                      style={{ backgroundColor: partyColors.get(summary.party) ?? partyPalette[0] }}
                    />
                    {summary.party}
                  </span>
                  <strong>{`${formatNumber(summary.memberCount)}명`}</strong>
                </div>
                <div className="distribution-party-list__stats">
                  <span>{`평균 출석률 ${formatPercent(summary.averageAttendanceRate)}`}</span>
                  <span>{`평균 반대·기권 ${formatPercent(summary.averageNegativeRate)}`}</span>
                  <span>{`평균 불참 ${formatPercent(summary.averageAbsenceRate)}`}</span>
                  <span>{`최대 연속 ${formatNumber(summary.topCurrentStreak)}일`}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
