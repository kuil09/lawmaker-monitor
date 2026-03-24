import {
  useEffect,
  useState,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent
} from "react";

import type {
  MemberActivityCalendarAssembly,
  MemberActivityCalendarExport,
  MemberActivityCalendarMember,
  MemberActivityCalendarMemberDetailExport,
  MemberActivityVoteRecord
} from "@lawmaker-monitor/schemas";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer
} from "recharts";

import {
  buildCalendarWeeks,
  buildHeadToHeadSummary,
  buildMonthLabels,
  getCurrentStreak,
  getLongestStreak,
  rankActivityMembers,
  type CalendarCell
} from "../lib/member-activity.js";
import { buildCalendarHref, type ActivityViewMode } from "../lib/calendar-route.js";
import { formatDate, formatNumber } from "../lib/format.js";
import { MemberIdentity } from "./MemberIdentity.js";
import { MemberSearchField } from "./MemberSearchField.js";

type ActivityCalendarPageProps = {
  activityCalendar: MemberActivityCalendarExport | null;
  loading: boolean;
  error: string | null;
  assemblyLabel?: string | null;
  initialMemberId?: string | null;
  initialCompareMemberId?: string | null;
  initialView?: ActivityViewMode;
  memberDetails: Record<string, MemberActivityCalendarMemberDetailExport | undefined>;
  memberDetailErrors: Record<string, string | null | undefined>;
  memberDetailLoading: Record<string, boolean | undefined>;
  onEnsureMemberDetail: (member: MemberActivityCalendarMember) => void | Promise<void>;
  onRetryMemberDetail: (member: MemberActivityCalendarMember) => void;
  onBack: () => void;
  onRetry: () => void;
};

const ACTIVITY_RATIO_CHART_HEIGHT = 220;

const weekdayLabels = ["일", "월", "화", "수", "목", "금", "토"];
const currentRunLabel = "현재 찬성 없이 이어진 날";
const longestRunLabel = "가장 길게 찬성 없이 이어진 날";
const runSummaryCopy =
  "이 화면은 표결이 있었던 날짜를 하루 단위로 묶어 보여줍니다. 같은 날 표결이 여러 건이면 그날의 대표 상태만 색으로 표시하고, 지금·최장 지표는 찬성이 나오기 전까지 이어진 날짜 수를 뜻합니다.";

function getDayBreakdown(member: MemberActivityCalendarMember): {
  yesDays: number;
  noDays: number;
  abstainDays: number;
  absentDays: number;
} {
  return {
    yesDays: member.dayStates.filter((day) => day.state === "yes").length,
    noDays: member.dayStates.filter((day) => day.state === "no").length,
    abstainDays: member.dayStates.filter((day) => day.state === "abstain").length,
    absentDays: member.dayStates.filter((day) => day.state === "absent").length
  };
}

type RatioDatum = {
  label: string;
  percent: number;
  color: string;
};

type RatioTickProps = {
  x?: number | string;
  y?: number | string;
  payload?: {
    value?: string;
  };
};

type CompareRatioDatum = {
  label: string;
  axisColor: string;
  leftPercent: number;
  rightPercent: number;
};

const compareRatioColors = {
  leftStroke: "#982d22",
  leftFill: "rgba(152, 45, 34, 0.18)",
  rightStroke: "#43657b",
  rightFill: "rgba(67, 101, 123, 0.18)"
};

function buildRatioData(member: MemberActivityCalendarMember): RatioDatum[] {
  const breakdown = getDayBreakdown(member);
  const total =
    breakdown.yesDays +
    breakdown.noDays +
    breakdown.abstainDays +
    breakdown.absentDays;

  const toPercent = (value: number): number => (total === 0 ? 0 : Math.round((value / total) * 100));

  return [
    { label: "찬성", percent: toPercent(breakdown.yesDays), color: "var(--vote-yes)" },
    { label: "반대", percent: toPercent(breakdown.noDays), color: "var(--vote-no)" },
    { label: "기권", percent: toPercent(breakdown.abstainDays), color: "var(--vote-abstain)" },
    { label: "불참", percent: toPercent(breakdown.absentDays), color: "var(--vote-absent)" }
  ];
}

function renderRatioAxisTick({ x = 0, y = 0, payload }: RatioTickProps) {
  const label = payload?.value ?? "";
  const color = {
    찬성: "var(--vote-yes)",
    반대: "var(--vote-no)",
    기권: "var(--vote-abstain)",
    불참: "var(--vote-absent)"
  }[label] ?? "var(--ink-muted)";

  return (
    <text
      x={Number(x)}
      y={Number(y)}
      dy={4}
      textAnchor="middle"
      fill={color}
      fontSize="12"
      fontWeight="700"
    >
      {label}
    </text>
  );
}

type CompareMetricPreference = "higher" | "lower";
type CompareMetricWinner = "left" | "right" | "tie";

type CompareMetricCardData = {
  leftValue: number;
  rightValue: number;
  summaryText: string;
  detailText: string;
  winner: CompareMetricWinner;
  badgeText: string;
};

function hasBatchim(value: string): boolean {
  const trimmed = value.trim();
  const lastCharacter = trimmed.charAt(trimmed.length - 1);

  if (!lastCharacter) {
    return false;
  }

  const codePoint = lastCharacter.charCodeAt(0);

  if (codePoint < 0xac00 || codePoint > 0xd7a3) {
    return false;
  }

  return (codePoint - 0xac00) % 28 !== 0;
}

function withSubjectParticle(value: string): string {
  return `${value}${hasBatchim(value) ? "이" : "가"}`;
}

function formatCompareMetricSubject(label: string): string {
  if (label === currentRunLabel) {
    return "찬성 없이 이어진 날";
  }

  if (label === longestRunLabel) {
    return "가장 길게 찬성 없이 이어진 날";
  }

  if (label === "반대") {
    return "반대한 날";
  }

  if (label === "기권") {
    return "기권한 날";
  }

  if (label === "불참") {
    return "불참한 날";
  }

  if (label === "찬성") {
    return "찬성한 날";
  }

  return label;
}

function formatCompareMetricBadgeText(difference: number): string {
  return difference === 0 ? "동률" : `차이 ${formatNumber(difference)}일`;
}

function buildCompareMetricCard(
  label: string,
  leftMember: MemberActivityCalendarMember,
  rightMember: MemberActivityCalendarMember,
  leftValue: number,
  rightValue: number,
  preference: CompareMetricPreference
): CompareMetricCardData {
  const subject = formatCompareMetricSubject(label);
  const difference = Math.abs(leftValue - rightValue);
  const detailText = `${leftMember.name} ${formatNumber(leftValue)}일 · ${rightMember.name} ${formatNumber(rightValue)}일`;

  if (leftValue === rightValue) {
    return {
      leftValue,
      rightValue,
      summaryText: `${subject}이 같습니다.`,
      detailText,
      winner: "tie",
      badgeText: formatCompareMetricBadgeText(0)
    };
  }

  const winner =
    preference === "higher"
      ? leftValue > rightValue
        ? leftMember
        : rightMember
      : leftValue < rightValue
        ? leftMember
        : rightMember;
  const winnerSide: CompareMetricWinner =
    winner.memberId === leftMember.memberId ? "left" : "right";

  return {
    leftValue,
    rightValue,
    summaryText:
      label === longestRunLabel
        ? `${withSubjectParticle(winner.name)} ${subject}이 ${formatNumber(difference)}일 더 깁니다.`
        : `${withSubjectParticle(winner.name)} ${subject}이 ${formatNumber(difference)}일 더 ${preference === "higher" ? "많습니다" : "적습니다"}.`,
    detailText,
    winner: winnerSide,
    badgeText: formatCompareMetricBadgeText(difference)
  };
}

function getMemberById(
  assembly: MemberActivityCalendarAssembly | null,
  memberId: string | null
): MemberActivityCalendarMember | null {
  if (!assembly || !memberId) {
    return null;
  }

  return assembly.members.find((member) => member.memberId === memberId) ?? null;
}

function getCalendarCellLabel(cell: CalendarCell): string {
  if (!cell.date) {
    return "표시되지 않는 날짜";
  }

  if (cell.state === "empty") {
    return `${cell.date} · 표결 없음`;
  }

  const parts = [
    `${cell.date}`,
    `총 ${cell.totalRollCalls}건`,
    `찬성 ${cell.yesCount}건`,
    `반대 ${cell.noCount}건`,
    `기권 ${cell.abstainCount}건`,
    `불참 ${cell.absentCount}건`
  ];

  if (cell.unknownCount > 0) {
    parts.push(`미확인 ${cell.unknownCount}건`);
  }

  switch (cell.state) {
    case "absent":
      return `${parts.join(" · ")} · 대표 상태: 불참`;
    case "no":
      return `${parts.join(" · ")} · 대표 상태: 반대`;
    case "abstain":
      return `${parts.join(" · ")} · 대표 상태: 기권`;
    case "yes":
      return `${parts.join(" · ")} · 대표 상태: 찬성`;
    case "unknown":
      return `${parts.join(" · ")} · 대표 상태: 미확인`;
    default:
      return `${cell.date} · 표결 없음`;
  }
}

function ExternalSiteLink({ url }: { url?: string | null }) {
  if (!url) {
    return null;
  }

  return (
    <a
      className="activity-page__action-button activity-page__external-link"
      href={url}
      target="_blank"
      rel="noreferrer"
      aria-label="홈페이지"
      title="홈페이지"
    >
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle
          cx="10"
          cy="10"
          r="6.7"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
        />
        <path
          d="M3.9 10h12.2M10 3.3c1.7 1.6 2.8 4.1 2.8 6.7s-1.1 5.1-2.8 6.7c-1.7-1.6-2.8-4.1-2.8-6.7s1.1-5.1 2.8-6.7Z"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.4"
        />
      </svg>
      <span>홈페이지</span>
    </a>
  );
}

function ActivityRatioChart({
  member
}: {
  member: MemberActivityCalendarMember;
}) {
  const data = buildRatioData(member);

  return (
    <section className="activity-ratio-card" aria-label="활동 비율">
      <div className="activity-ratio-card__header">
        <h4>활동 비율</h4>
        <p>캘린더 날짜 기준 비율</p>
      </div>
      <div className="activity-ratio-card__body">
        <div className="activity-ratio-card__chart">
          <ResponsiveContainer width="100%" height={ACTIVITY_RATIO_CHART_HEIGHT}>
            <RadarChart data={data} outerRadius="72%">
              <PolarGrid stroke="rgba(23, 20, 17, 0.12)" />
              <PolarAngleAxis dataKey="label" tick={renderRatioAxisTick} />
              <PolarRadiusAxis
                axisLine={false}
                tickLine={false}
                tick={false}
                domain={[0, 100]}
              />
              <Radar
                dataKey="percent"
                stroke="var(--accent)"
                fill="rgba(152, 45, 34, 0.2)"
                fillOpacity={1}
                strokeWidth={2}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>
        <ul className="activity-ratio-card__list">
          {data.map((item) => (
            <li key={item.label}>
              <span className="activity-ratio-card__label">
                <i style={{ background: item.color }} />
                {item.label}
              </span>
              <strong>{`${formatNumber(item.percent)}%`}</strong>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function ActivityCompareRatioChart({
  leftMember,
  rightMember
}: {
  leftMember: MemberActivityCalendarMember;
  rightMember: MemberActivityCalendarMember;
}) {
  const leftData = buildRatioData(leftMember);
  const rightData = buildRatioData(rightMember);
  const compareData: CompareRatioDatum[] = leftData.map((item, index) => ({
    label: item.label,
    axisColor: item.color,
    leftPercent: item.percent,
    rightPercent: rightData[index]?.percent ?? 0
  }));

  return (
    <section className="activity-ratio-card activity-ratio-card--compare" aria-label="비율 비교">
      <div className="activity-ratio-card__header">
        <h4>비율 비교</h4>
        <p>캘린더 날짜 기준 비율</p>
      </div>
      <div className="activity-ratio-compare__legend">
        <span>
          <i style={{ background: compareRatioColors.leftStroke }} />
          {leftMember.name}
        </span>
        <span>
          <i style={{ background: compareRatioColors.rightStroke }} />
          {rightMember.name}
        </span>
      </div>
      <div className="activity-ratio-card__body activity-ratio-card__body--compare">
        <div className="activity-ratio-card__chart">
          <ResponsiveContainer width="100%" height={ACTIVITY_RATIO_CHART_HEIGHT}>
            <RadarChart data={compareData} outerRadius="72%">
              <PolarGrid stroke="rgba(23, 20, 17, 0.12)" />
              <PolarAngleAxis dataKey="label" tick={renderRatioAxisTick} />
              <PolarRadiusAxis
                axisLine={false}
                tickLine={false}
                tick={false}
                domain={[0, 100]}
              />
              <Radar
                dataKey="leftPercent"
                stroke={compareRatioColors.leftStroke}
                fill={compareRatioColors.leftFill}
                fillOpacity={1}
                strokeWidth={2}
              />
              <Radar
                dataKey="rightPercent"
                stroke={compareRatioColors.rightStroke}
                fill={compareRatioColors.rightFill}
                fillOpacity={1}
                strokeWidth={2}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>
        <div className="activity-ratio-compare__table" role="table" aria-label="비율 비교 표">
          <div className="activity-ratio-compare__row activity-ratio-compare__row--head" role="row">
            <span role="columnheader" aria-hidden="true" />
            <span role="columnheader">{leftMember.name}</span>
            <span role="columnheader">{rightMember.name}</span>
          </div>
          {compareData.map((item) => (
            <div key={item.label} className="activity-ratio-compare__row" role="row">
              <span className="activity-ratio-card__label" role="rowheader">
                <i style={{ background: item.axisColor }} />
                {item.label}
              </span>
              <strong role="cell">{`${formatNumber(item.leftPercent)}%`}</strong>
              <strong role="cell">{`${formatNumber(item.rightPercent)}%`}</strong>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ActivityVoteRecordSections({
  records,
  recordCount,
  loading,
  error,
  onRetry
}: {
  records: MemberActivityVoteRecord[];
  recordCount: number;
  loading: boolean;
  error: string | null;
  onRetry: (() => void) | null;
}) {
  const resolvedRecordCount = Math.max(recordCount, records.length);
  const isPendingRemoteLoad = resolvedRecordCount > records.length && !loading && !error;
  const groupedRecords: Array<{
    label: string;
    records: MemberActivityVoteRecord[];
  }> = [
    {
      label: "찬성",
      records: records.filter((record) => record.voteCode === "yes")
    },
    {
      label: "반대",
      records: records.filter((record) => record.voteCode === "no")
    },
    {
      label: "기권",
      records: records.filter((record) => record.voteCode === "abstain")
    }
  ].filter((group) => group.records.length > 0);

  if (resolvedRecordCount === 0 && !loading && !error) {
    return null;
  }

  return (
    <section className="activity-vote-records" aria-label="의안별 표결 기록">
      <div className="activity-vote-records__header">
        <h4>의안별 표결 기록</h4>
        <p>{`해당 의원이 찬성·반대·기권한 의안을 최근 순으로 봅니다. 총 ${formatNumber(
          resolvedRecordCount
        )}건`}</p>
      </div>
      {loading || isPendingRemoteLoad ? (
        <p className="activity-drawer__empty">전체 표결 기록을 불러오는 중입니다…</p>
      ) : null}
      {!loading && !isPendingRemoteLoad && error ? (
        <div className="activity-drawer__empty">
          <p>{error}</p>
          {onRetry ? (
            <button type="button" onClick={onRetry}>
              다시 시도
            </button>
          ) : null}
        </div>
      ) : null}
      {!loading && !isPendingRemoteLoad && !error && groupedRecords.length === 0 ? (
        <p className="activity-drawer__empty">표시할 찬성·반대·기권 기록이 없습니다.</p>
      ) : null}
      {!loading && !isPendingRemoteLoad && !error && groupedRecords.length > 0 ? (
      <div className="activity-vote-records__groups">
        {groupedRecords.map((group) => (
          <section
            key={group.label}
            className="activity-vote-records__group"
            aria-label={`${group.label} 의안`}
          >
            <div className="activity-vote-records__group-header">
              <h5>{group.label}</h5>
              <span>{`${formatNumber(group.records.length)}건`}</span>
            </div>
            <ul className="activity-vote-records__list">
              {group.records.map((record) => {
                const content = (
                  <>
                    <span className="activity-vote-records__meta">
                      {record.committeeName
                        ? `${formatDate(record.voteDatetime)} · ${record.committeeName}`
                        : formatDate(record.voteDatetime)}
                    </span>
                    <strong>{record.billName}</strong>
                  </>
                );

                return (
                  <li key={`${group.label}:${record.rollCallId}`}>
                    {record.officialSourceUrl ? (
                      <a
                        href={record.officialSourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="activity-vote-records__item"
                      >
                        {content}
                      </a>
                    ) : (
                      <div className="activity-vote-records__item">{content}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      ) : null}
    </section>
  );
}

function buildCommitteeCompositionStyle(
  value: number,
  total: number,
  colorVariable: string
): { width: string; background: string } {
  const width = total === 0 ? 0 : (value / total) * 100;
  return {
    width: `${width}%`,
    background: `var(${colorVariable})`
  };
}

function ActivityCommitteeSections({
  member
}: {
  member: MemberActivityCalendarMember;
}) {
  const committeeSummaries = (member.committeeSummaries ?? []).filter(
    (summary) => summary.eligibleRollCallCount >= 5
  );

  if (committeeSummaries.length === 0) {
    return null;
  }

  const mostResponsiveCommittees = [...committeeSummaries].sort((left, right) => {
    if (right.participationRate !== left.participationRate) {
      return right.participationRate - left.participationRate;
    }

    if (right.eligibleRollCallCount !== left.eligibleRollCallCount) {
      return right.eligibleRollCallCount - left.eligibleRollCallCount;
    }

    return left.committeeName.localeCompare(right.committeeName, "ko-KR");
  });
  const leastResponsiveCommittees = [...committeeSummaries].sort((left, right) => {
    if (left.participationRate !== right.participationRate) {
      return left.participationRate - right.participationRate;
    }

    if (right.eligibleRollCallCount !== left.eligibleRollCallCount) {
      return right.eligibleRollCallCount - left.eligibleRollCallCount;
    }

    return left.committeeName.localeCompare(right.committeeName, "ko-KR");
  });

  const sections = [
    {
      title: "관심 높은 위원회",
      summaries: mostResponsiveCommittees
    },
    {
      title: "무관심한 위원회",
      summaries: leastResponsiveCommittees
    }
  ];

  return (
    <section className="activity-committee-sections" aria-label="위원회 반응도">
      <div className="activity-committee-sections__header">
        <h4>위원회 반응도</h4>
        <p>위원회별 참여율과 최근 대표 의안을 함께 봅니다.</p>
      </div>
      <div className="activity-committee-sections__groups">
        {sections.map((section) => (
          <section
            key={section.title}
            className="activity-committee-sections__group"
            aria-label={section.title}
          >
            <div className="activity-committee-sections__group-header">
              <h5>{section.title}</h5>
            </div>
            <ul className="activity-committee-sections__list">
              {section.summaries.map((summary) => {
                const participatedCount =
                  summary.yesCount + summary.noCount + summary.abstainCount;

                return (
                  <li key={`${section.title}:${summary.committeeName}`}>
                    <article className="activity-committee-card">
                      <div className="activity-committee-card__header">
                        <div className="activity-committee-card__title-row">
                          <h6>{summary.committeeName}</h6>
                          {summary.isCurrentCommittee ? (
                            <span className="activity-committee-card__badge">소속 위원회</span>
                          ) : null}
                        </div>
                        <strong>{`${formatNumber(Math.round(summary.participationRate * 100))}%`}</strong>
                      </div>
                      <p className="activity-committee-card__meta">
                        {`참여 ${formatNumber(summary.participatedRollCallCount)} / 대상 ${formatNumber(summary.eligibleRollCallCount)} · 불참 ${formatNumber(summary.absentRollCallCount)}`}
                      </p>
                      <div className="activity-committee-card__bar" aria-hidden="true">
                        <span
                          style={buildCommitteeCompositionStyle(
                            summary.yesCount,
                            participatedCount,
                            "--vote-yes"
                          )}
                        />
                        <span
                          style={buildCommitteeCompositionStyle(
                            summary.noCount,
                            participatedCount,
                            "--vote-no"
                          )}
                        />
                        <span
                          style={buildCommitteeCompositionStyle(
                            summary.abstainCount,
                            participatedCount,
                            "--vote-abstain"
                          )}
                        />
                      </div>
                      {summary.recentVoteRecords.length > 0 ? (
                        <ul className="activity-committee-card__records">
                          {summary.recentVoteRecords.map((record) => {
                            const linkLabel = `${formatDate(record.voteDatetime)} · ${record.billName}`;
                            const detailLabel =
                              record.voteCode === "yes"
                                ? "찬성"
                                : record.voteCode === "no"
                                  ? "반대"
                                  : "기권";

                            return (
                              <li key={`${summary.committeeName}:${record.rollCallId}`}>
                                {record.officialSourceUrl ? (
                                  <a
                                    href={record.officialSourceUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="activity-committee-card__record-link"
                                  >
                                    <span>{linkLabel}</span>
                                    <em>{detailLabel}</em>
                                  </a>
                                ) : (
                                  <div className="activity-committee-card__record-link">
                                    <span>{linkLabel}</span>
                                    <em>{detailLabel}</em>
                                  </div>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                    </article>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}

function ContributionCalendar({
  assembly,
  member,
  compact = false
}: {
  assembly: MemberActivityCalendarAssembly;
  member: MemberActivityCalendarMember;
  compact?: boolean;
}) {
  const weeks = buildCalendarWeeks(assembly, member);
  const monthLabels = buildMonthLabels(weeks);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startClientX: number;
    startScrollLeft: number;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const className = [
    "contribution-calendar",
    compact ? "contribution-calendar--compact" : ""
  ]
    .filter(Boolean)
    .join(" ");

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return undefined;
    }

    const scrollToLatest = () => {
      viewport.scrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    };

    scrollToLatest();
    const frame = window.requestAnimationFrame(scrollToLatest);

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [assembly.assemblyNo, member.memberId, weeks.length]);

  function stopDragging(pointerId?: number): void {
    const viewport = viewportRef.current;
    const dragState = dragStateRef.current;
    if (!dragState) {
      return;
    }

    if (
      viewport &&
      typeof viewport.releasePointerCapture === "function" &&
      pointerId !== undefined &&
      viewport.hasPointerCapture(pointerId)
    ) {
      viewport.releasePointerCapture(pointerId);
    }

    dragStateRef.current = null;
    setIsDragging(false);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.pointerType !== "mouse" || event.button !== 0) {
      return;
    }

    const viewport = viewportRef.current;
    if (!viewport || viewport.scrollWidth <= viewport.clientWidth) {
      return;
    }

    dragStateRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startScrollLeft: viewport.scrollLeft
    };
    if (typeof viewport.setPointerCapture === "function") {
      viewport.setPointerCapture(event.pointerId);
    }
    setIsDragging(true);
    event.preventDefault();
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const viewport = viewportRef.current;
    const dragState = dragStateRef.current;
    if (!viewport || !dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    viewport.scrollLeft =
      dragState.startScrollLeft - (event.clientX - dragState.startClientX);
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    stopDragging(event.pointerId);
  }

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>): void {
    const viewport = viewportRef.current;
    if (!viewport || viewport.scrollWidth <= viewport.clientWidth) {
      return;
    }

    const horizontalDelta =
      Math.abs(event.deltaX) > 0 ? event.deltaX : Math.abs(event.deltaY) > 0 ? event.deltaY : 0;
    if (horizontalDelta === 0) {
      return;
    }

    viewport.scrollLeft += horizontalDelta;
    event.preventDefault();
  }

  return (
    <div className={className}>
      <div className="contribution-calendar__legend" aria-label="대표 상태 범례">
        <ul className="contribution-calendar__legend-list">
          {[
            { state: "yes", label: "찬성" },
            { state: "no", label: "반대" },
            { state: "abstain", label: "기권" },
            { state: "absent", label: "불참" },
            { state: "empty", label: "표결 없음" }
          ].map((item) => (
            <li key={item.label} className="contribution-calendar__legend-chip">
              <i
                className={`contribution-calendar__legend-swatch contribution-calendar__legend-swatch--${item.state}`}
                aria-hidden="true"
              />
              <span>{item.label}</span>
            </li>
          ))}
        </ul>
        <p className="contribution-calendar__legend-note">
          {compact ? "가로 스크롤로 최근 날짜를 확인합니다." : "좌우로 스크롤해 최근 날짜까지 확인합니다."}
        </p>
      </div>
      <div
        ref={viewportRef}
        className={
          isDragging
            ? "contribution-calendar__viewport contribution-calendar__viewport--dragging"
            : "contribution-calendar__viewport"
        }
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
      >
        <div className="contribution-calendar__content">
          <div className="contribution-calendar__months" aria-hidden="true">
            <span className="contribution-calendar__month-spacer" />
            <div className="contribution-calendar__month-track">
              {monthLabels.map((label, index) => (
                <span key={`${assembly.assemblyNo}:${index}`} className="contribution-calendar__month">
                  {label}
                </span>
              ))}
            </div>
          </div>
          <div className="contribution-calendar__body">
            <div className="contribution-calendar__weekdays" aria-hidden="true">
              {weekdayLabels.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
            <div className="contribution-calendar__weeks">
              {weeks.map((week, index) => (
                <div key={`${assembly.assemblyNo}:${index}`} className="contribution-calendar__week">
                  {week.days.map((cell, dayIndex) => (
                    <span
                      key={`${assembly.assemblyNo}:${index}:${dayIndex}:${cell.date ?? "empty"}`}
                      className={`contribution-calendar__cell contribution-calendar__cell--${cell.state}`}
                      title={getCalendarCellLabel(cell)}
                      aria-label={getCalendarCellLabel(cell)}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ActivityCalendarPage({
  activityCalendar,
  loading,
  error,
  assemblyLabel,
  initialMemberId,
  initialCompareMemberId,
  initialView = "single",
  memberDetails,
  memberDetailErrors,
  memberDetailLoading,
  onEnsureMemberDetail,
  onRetryMemberDetail,
  onBack,
  onRetry
}: ActivityCalendarPageProps) {
  const [activeView, setActiveView] = useState<ActivityViewMode>(initialView);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [compareMemberId, setCompareMemberId] = useState<string | null>(null);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const hasInitializedSelectedMemberRef = useRef(false);
  const lastAppliedRouteMemberIdRef = useRef<string | null | undefined>(undefined);

  const selectedAssembly = activityCalendar?.assembly ?? null;
  const rankedMembers = selectedAssembly ? rankActivityMembers(selectedAssembly, true) : [];
  const compareCandidates = rankedMembers.filter((member) => member.memberId !== selectedMemberId);
  const memberOptions = rankedMembers.map((member) => ({
    id: member.memberId,
    label: `${member.name} · ${member.party}`
  }));
  const compareOptions = compareCandidates.map((member) => ({
    id: member.memberId,
    label: `${member.name} · ${member.party}`
  }));

  useEffect(() => {
    setActiveView(initialView);
  }, [initialView]);

  useEffect(() => {
    if (!selectedAssembly || rankedMembers.length === 0) {
      setSelectedMemberId(null);
      hasInitializedSelectedMemberRef.current = false;
      lastAppliedRouteMemberIdRef.current = undefined;
      return;
    }

    const routeMemberId =
      initialMemberId && rankedMembers.some((member) => member.memberId === initialMemberId)
        ? initialMemberId
        : null;
    const routeChanged = routeMemberId !== lastAppliedRouteMemberIdRef.current;

    if (!hasInitializedSelectedMemberRef.current || routeChanged) {
      hasInitializedSelectedMemberRef.current = true;
      lastAppliedRouteMemberIdRef.current = routeMemberId;

      setSelectedMemberId((currentSelectedId) => {
        if (routeMemberId) {
          return routeMemberId;
        }

        if (
          currentSelectedId &&
          rankedMembers.some((member) => member.memberId === currentSelectedId)
        ) {
          return currentSelectedId;
        }

        return rankedMembers[0]?.memberId ?? null;
      });
      return;
    }

    setSelectedMemberId((currentSelectedId) => {
      if (currentSelectedId === null) {
        return null;
      }

      if (
        currentSelectedId &&
        rankedMembers.some((member) => member.memberId === currentSelectedId)
      ) {
        return currentSelectedId;
      }

      return routeMemberId ?? rankedMembers[0]?.memberId ?? null;
    });
  }, [initialMemberId, rankedMembers, selectedAssembly]);

  const selectedMember = getMemberById(selectedAssembly, selectedMemberId);
  const selectedMemberDetail = selectedMember ? memberDetails[selectedMember.memberId] ?? null : null;
  const selectedMemberDetailError = selectedMember
    ? memberDetailErrors[selectedMember.memberId] ?? null
    : null;
  const selectedMemberDetailLoading = selectedMember
    ? Boolean(memberDetailLoading[selectedMember.memberId])
    : false;
  const compareMember = getMemberById(selectedAssembly, compareMemberId);
  const comparisonSummary =
    selectedAssembly && selectedMember && compareMember
      ? buildHeadToHeadSummary(selectedAssembly, selectedMember, compareMember, true)
      : null;
  const selectedBreakdown = selectedMember ? getDayBreakdown(selectedMember) : null;
  const compareBreakdown = compareMember ? getDayBreakdown(compareMember) : null;
  const compareMetrics =
    selectedMember && compareMember && selectedBreakdown && compareBreakdown && comparisonSummary
      ? [
          buildCompareMetricCard(
            currentRunLabel,
            selectedMember,
            compareMember,
            comparisonSummary.leftCurrentStreak,
            comparisonSummary.rightCurrentStreak,
            "higher"
          ),
          buildCompareMetricCard(
            longestRunLabel,
            selectedMember,
            compareMember,
            comparisonSummary.leftLongestStreak,
            comparisonSummary.rightLongestStreak,
            "higher"
          ),
          buildCompareMetricCard(
            "반대",
            selectedMember,
            compareMember,
            selectedBreakdown.noDays,
            compareBreakdown.noDays,
            "higher"
          ),
          buildCompareMetricCard(
            "기권",
            selectedMember,
            compareMember,
            selectedBreakdown.abstainDays,
            compareBreakdown.abstainDays,
            "higher"
          ),
          buildCompareMetricCard(
            "불참",
            selectedMember,
            compareMember,
            selectedBreakdown.absentDays,
            compareBreakdown.absentDays,
            "higher"
          ),
          buildCompareMetricCard(
            "찬성",
            selectedMember,
            compareMember,
            selectedBreakdown.yesDays,
            compareBreakdown.yesDays,
            "lower"
          )
        ]
      : [];

  useEffect(() => {
    if (!selectedAssembly || !selectedMember) {
      setCompareMemberId(null);
      return;
    }

    const availableCompareMembers = selectedAssembly.members.filter(
      (member) => member.memberId !== selectedMember.memberId
    );

    if (availableCompareMembers.length === 0) {
      setCompareMemberId(null);
      return;
    }

    const preferredCompareId =
      initialCompareMemberId &&
      initialCompareMemberId !== selectedMember.memberId &&
      availableCompareMembers.some((member) => member.memberId === initialCompareMemberId)
        ? initialCompareMemberId
        : null;

    setCompareMemberId((currentCompareId) => {
      if (preferredCompareId && currentCompareId !== preferredCompareId) {
        return preferredCompareId;
      }

      if (
        currentCompareId &&
        currentCompareId !== selectedMember.memberId &&
        availableCompareMembers.some((member) => member.memberId === currentCompareId)
      ) {
        return currentCompareId;
      }

      return availableCompareMembers[0]?.memberId ?? null;
    });
  }, [initialCompareMemberId, selectedAssembly, selectedMember]);

  useEffect(() => {
    if (activeView !== "single" || !selectedMember) {
      return;
    }

    if (selectedMemberDetail || selectedMemberDetailLoading || selectedMemberDetailError) {
      return;
    }

    void onEnsureMemberDetail(selectedMember);
  }, [
    activeView,
    selectedMember,
    selectedMemberDetail,
    selectedMemberDetailError,
    selectedMemberDetailLoading,
    onEnsureMemberDetail
  ]);

  function buildShareUrl(): string | null {
    if (!selectedMember || activeView !== "single") {
      return null;
    }

    const hash = buildCalendarHref({
      memberId: selectedMember.memberId,
      view: "single"
    });

    if (typeof window === "undefined") {
      return hash;
    }

    const url = new URL(window.location.href);
    url.hash = hash.slice(1);
    return url.toString();
  }

  async function handleShare(): Promise<void> {
    const shareUrl = buildShareUrl();
    if (!selectedAssembly || !selectedMember || !shareUrl) {
      return;
    }

    setIsSharing(true);
    setShareError(null);
    setShareNotice(null);

    try {
      const title = `${selectedMember.name} 활동 캘린더`;
      const text = `${selectedAssembly.label} 활동 캘린더 링크입니다.`;

      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({
          title,
          text,
          url: shareUrl
        });
        return;
      }

      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        setShareNotice("현재 화면 링크를 복사했습니다.");
        return;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      setShareError("공유 링크를 준비하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setIsSharing(false);
    }
  }

  return (
    <section className="activity-page" aria-labelledby="activity-page-title">
      <header className="activity-page__masthead">
        <div>
          <p className="section-label">활동 캘린더</p>
          <h1 id="activity-page-title">의원 표결 활동 그래프</h1>
          <p className="activity-page__copy">
            {`${assemblyLabel ?? selectedAssembly?.label ?? "최신 국회"} 기준 개인 보기와 VS 비교`}
          </p>
        </div>
        <div className="activity-page__actions">
          <button
            type="button"
            className="activity-page__action-button activity-page__back"
            onClick={onBack}
            aria-label="홈으로"
            title="홈으로"
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path
                d="M3.9 9.1 10 4.2l6.1 4.9v6.2a1 1 0 0 1-1 1h-2.9v-4.7H7.8v4.7H4.9a1 1 0 0 1-1-1Z"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.7"
              />
            </svg>
          </button>
        </div>
      </header>

      <section className="activity-page__panel">
        <header className="activity-drawer__header">
          <div>
            <h2>{`${assemblyLabel ?? selectedAssembly?.label ?? "최신 국회"} 기준`}</h2>
          </div>
          <button
            type="button"
            className="activity-page__help-button"
            aria-label={isHelpOpen ? "설명 닫기" : "설명 보기"}
            aria-expanded={isHelpOpen}
            onClick={() => setIsHelpOpen((current) => !current)}
          >
            ?
          </button>
        </header>

        {isHelpOpen ? (
          <p className="activity-page__panel-copy activity-page__panel-copy--help">
            {runSummaryCopy}
          </p>
        ) : null}

        <div className="activity-drawer__tabs" role="tablist" aria-label="활동 분석 보기">
          <button
            type="button"
            role="tab"
            aria-selected={activeView === "single"}
            className={activeView === "single" ? "activity-drawer__tab is-active" : "activity-drawer__tab"}
            onClick={() => setActiveView("single")}
          >
            개인 분석
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeView === "compare"}
            className={activeView === "compare" ? "activity-drawer__tab is-active" : "activity-drawer__tab"}
            onClick={() => setActiveView("compare")}
          >
            VS 비교
          </button>
        </div>

        <div className="activity-drawer__toolbar">
          <MemberSearchField
            label="기준 의원 찾기"
            options={memberOptions}
            selectedId={selectedMemberId}
            onSelect={setSelectedMemberId}
            placeholder="다른 의원 이름 또는 정당을 입력하세요"
            className="activity-drawer__field activity-drawer__field--wide"
            disabled={memberOptions.length === 0}
          />
        </div>
        <p className="activity-drawer__toolbar-hint">
          입력값을 지우고 다른 이름이나 정당을 입력하면 기준 의원을 바꿀 수 있습니다.
        </p>

        {shareError ? <p className="error-banner">{shareError}</p> : null}
        {shareNotice ? <p className="info-banner">{shareNotice}</p> : null}

        {loading ? (
          <p className="activity-drawer__empty">활동 캘린더 데이터를 불러오는 중입니다…</p>
        ) : null}

        {!loading && error ? (
          <div className="activity-drawer__empty">
            <p>{error}</p>
            <button type="button" onClick={onRetry}>
              다시 시도
            </button>
          </div>
        ) : null}

        {!loading && !error && !selectedAssembly ? (
          <p className="activity-drawer__empty">활동 캘린더 데이터가 아직 발행되지 않았습니다.</p>
        ) : null}

        {!loading && !error && selectedAssembly ? (
          <div className="activity-drawer__content">
            <div className="activity-drawer__main activity-drawer__main--full">
              {activeView === "single" && selectedMember && selectedBreakdown ? (
                <>
                  <div className="activity-drawer__member-header">
                    <div className="activity-drawer__member-primary">
                      <MemberIdentity
                        name={selectedMember.name}
                        party={selectedMember.party}
                        photoUrl={selectedMember.photoUrl}
                        calendarHref={buildCalendarHref({ memberId: selectedMember.memberId })}
                      />
                      <p className="activity-drawer__member-copy">
                        {`반대 ${formatNumber(selectedBreakdown.noDays)}일 · 기권 ${formatNumber(selectedBreakdown.abstainDays)}일 · 불참 ${formatNumber(selectedBreakdown.absentDays)}일`}
                      </p>
                      <div className="activity-drawer__committee-memberships">
                        <strong>현재 소속 위원회</strong>
                        {selectedMember.committeeMemberships?.length ? (
                          <div className="activity-drawer__committee-chips">
                            {selectedMember.committeeMemberships.map((committeeName) => (
                              <span
                                key={`${selectedMember.memberId}:${committeeName}`}
                                className="activity-drawer__committee-chip"
                              >
                                {committeeName}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="activity-drawer__committee-fallback">위원회 소속 미확인</p>
                        )}
                      </div>
                      {selectedMember.homeCommitteeAlerts?.length ? (
                        <div className="activity-drawer__committee-alerts" aria-label="소속 위원회 주의">
                          {selectedMember.homeCommitteeAlerts.map((alert) => (
                            <div
                              key={`${selectedMember.memberId}:${alert.committeeName}`}
                              className="activity-drawer__committee-alert"
                            >
                              <strong>{alert.message}</strong>
                              <p>
                                {`${alert.committeeName} 참여율 ${formatNumber(
                                  Math.round(alert.participationRate * 100)
                                )}% (참여 ${formatNumber(alert.participatedRollCallCount)} / 대상 ${formatNumber(
                                  alert.eligibleRollCallCount
                                )})`}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <dl className="activity-drawer__summary">
                      <div>
                        <dt>{currentRunLabel}</dt>
                        <dd>{formatNumber(getCurrentStreak(selectedMember, true))}</dd>
                      </div>
                      <div>
                        <dt>{longestRunLabel}</dt>
                        <dd>{formatNumber(getLongestStreak(selectedMember, true))}</dd>
                      </div>
                      <div>
                        <dt>반대한 날</dt>
                        <dd>{formatNumber(selectedBreakdown.noDays)}</dd>
                      </div>
                      <div>
                        <dt>불참한 날</dt>
                        <dd>{formatNumber(selectedBreakdown.absentDays)}</dd>
                      </div>
                    </dl>
                    <div className="activity-page__member-actions">
                      <ExternalSiteLink url={selectedMember.officialExternalUrl} />
                      <button
                        type="button"
                        className="activity-page__action-button activity-page__share"
                        onClick={handleShare}
                        disabled={isSharing || !selectedAssembly || !selectedMember}
                        aria-label={isSharing ? "링크 준비 중" : "공유하기"}
                        title={isSharing ? "링크 준비 중" : "공유하기"}
                      >
                        <svg viewBox="0 0 20 20" aria-hidden="true">
                          <path
                            d="M8.1 6.3H6.6a2.8 2.8 0 0 0 0 5.5h1.5M11.9 6.3h1.5a2.8 2.8 0 1 1 0 5.5h-1.5M7.4 10h5.2"
                            fill="none"
                            stroke="currentColor"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="1.7"
                          />
                        </svg>
                        <span>{isSharing ? "링크 준비 중" : "공유하기"}</span>
                      </button>
                    </div>
                  </div>
                  <section className="activity-drawer__calendar-card" aria-label="활동 캘린더 요약">
                    <div className="activity-drawer__section-head">
                      <div>
                        <p className="section-label">대표 상태 캘린더</p>
                        <h3>최근 표결 날짜 흐름</h3>
                      </div>
                      <p>
                        최근 표결일을 하루 단위로 묶고, 같은 날 여러 표결이 있으면 대표 상태만 남겨 비교합니다.
                      </p>
                    </div>
                    <ContributionCalendar assembly={selectedAssembly} member={selectedMember} />
                  </section>
                  <ActivityRatioChart member={selectedMember} />
                  <ActivityCommitteeSections member={selectedMember} />
                  <ActivityVoteRecordSections
                    records={selectedMemberDetail?.voteRecords ?? selectedMember.voteRecords ?? []}
                    recordCount={selectedMember.voteRecordCount}
                    loading={selectedMemberDetailLoading}
                    error={selectedMemberDetailError}
                    onRetry={
                      selectedMember
                        ? () => onRetryMemberDetail(selectedMember)
                        : null
                    }
                  />
                </>
              ) : null}

              {activeView === "compare" && selectedMember ? (
                <div className="activity-compare">
                  <header className="activity-compare__header">
                    <div>
                      <p className="section-label">같은 대수 기준 비교</p>
                      <h3>{`${selectedAssembly.label} 두 의원 비교`}</h3>
                    </div>
                  </header>

                  {compareCandidates.length > 0 ? (
                    <MemberSearchField
                      label="비교 의원 찾기"
                      options={compareOptions}
                      selectedId={compareMemberId}
                      onSelect={setCompareMemberId}
                      placeholder="비교할 의원 이름 또는 정당을 입력하세요"
                      className="activity-drawer__field activity-drawer__field--wide"
                      disabled={compareOptions.length === 0}
                    />
                  ) : null}

                  {compareMember ? (
                    <>
                      <section className="activity-compare__summary" aria-label="비교 요약">
                        {compareMetrics.map((metric, index) => (
                          <article
                            key={`${index}:${metric.summaryText}:${metric.detailText}`}
                            className={`activity-compare__summary-card activity-compare__summary-card--${metric.winner}`}
                          >
                            <p className="activity-compare__summary-kicker">{metric.badgeText}</p>
                            <p className="activity-compare__summary-copy">{metric.summaryText}</p>
                            <p className="activity-compare__summary-note">{metric.detailText}</p>
                          </article>
                        ))}
                      </section>

                      <div className="activity-compare__grid">
                        <section className="activity-compare__column">
                          <MemberIdentity
                            name={selectedMember.name}
                            party={selectedMember.party}
                            photoUrl={selectedMember.photoUrl}
                            calendarHref={buildCalendarHref({ memberId: selectedMember.memberId })}
                          />
                          <ExternalSiteLink url={selectedMember.officialExternalUrl} />
                          <ContributionCalendar
                            assembly={selectedAssembly}
                            member={selectedMember}
                            compact
                          />
                        </section>
                        <section className="activity-compare__column">
                          <MemberIdentity
                            name={compareMember.name}
                            party={compareMember.party}
                            photoUrl={compareMember.photoUrl}
                            calendarHref={buildCalendarHref({ memberId: compareMember.memberId })}
                          />
                          <ExternalSiteLink url={compareMember.officialExternalUrl} />
                          <ContributionCalendar
                            assembly={selectedAssembly}
                            member={compareMember}
                            compact
                          />
                        </section>
                      </div>

                      <ActivityCompareRatioChart
                        leftMember={selectedMember}
                        rightMember={compareMember}
                      />
                    </>
                  ) : (
                    <p className="activity-drawer__empty">같은 대수 안에서 비교할 의원을 선택해 주세요.</p>
                  )}
                </div>
              ) : null}

              {!selectedMember ? (
                <p className="activity-drawer__empty">표시할 의원을 선택해 주세요.</p>
              ) : null}
            </div>
          </div>
        ) : null}

      </section>

    </section>
  );
}
