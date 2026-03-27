import { useCallback, useEffect, useRef, useState } from "react";

import type {
  AccountabilitySummaryExport,
  AccountabilityTrendsExport,
  LatestVotesExport,
  MemberActivityCalendarExport,
  MemberActivityCalendarMember,
  MemberActivityCalendarMemberDetailExport,
  Manifest
} from "@lawmaker-monitor/schemas";

import { AccountabilityLeaderboard } from "./components/AccountabilityLeaderboard.js";
import { ActivityCalendarPage } from "./components/ActivityCalendarPage.js";
import { DistributionPage } from "./components/DistributionPage.js";
import { MemberSearchField } from "./components/MemberSearchField.js";
import { VisualizationOverview } from "./components/VisualizationOverview.js";
import { VoteCarousel } from "./components/VoteCarousel.js";
import { rankAccountabilityItems } from "./lib/accountability.js";
import { buildCalendarHash, type ActivityViewMode } from "./lib/calendar-route.js";
import { buildDistributionHash } from "./lib/distribution-route.js";
import {
  loadAccountabilitySummary,
  loadAccountabilityTrends,
  loadLatestVotes,
  loadManifest,
  loadMemberActivityCalendar,
  loadMemberActivityCalendarMemberDetail
} from "./lib/data.js";
import { formatDateTime, formatNumber, formatPercent } from "./lib/format.js";
import { getMemberAttendanceSummary } from "./lib/member-activity.js";

type AppRoute = "home" | "calendar" | "distribution";

type RouteState = {
  route: AppRoute;
  memberId: string | null;
  compareMemberId: string | null;
  view: ActivityViewMode;
};

function buildEmbeddedActivityMemberDetail(
  activityCalendar: MemberActivityCalendarExport,
  member: MemberActivityCalendarMember
): MemberActivityCalendarMemberDetailExport {
  return {
    generatedAt: activityCalendar.generatedAt,
    snapshotId: activityCalendar.snapshotId,
    assemblyNo: activityCalendar.assemblyNo,
    assemblyLabel: activityCalendar.assemblyLabel,
    memberId: member.memberId,
    voteRecords: member.voteRecords ?? []
  };
}

function getRouteStateFromHash(hash: string): RouteState {
  const normalizedHash = hash.startsWith("#") ? hash.slice(1) : hash;
  const [path, search = ""] = normalizedHash.split("?");
  const params = new URLSearchParams(search);

  if (path === "calendar") {
    return {
      route: "calendar",
      memberId: params.get("member"),
      compareMemberId: params.get("compare"),
      view: params.get("view") === "compare" ? "compare" : "single"
    };
  }

  if (path === "distribution") {
    return {
      route: "distribution",
      memberId: params.get("member"),
      compareMemberId: null,
      view: "single"
    };
  }

  return {
    route: "home",
    memberId: null,
    compareMemberId: null,
    view: "single"
  };
}

export default function App() {
  const [latestVotes, setLatestVotes] = useState<LatestVotesExport | null>(null);
  const [accountabilitySummary, setAccountabilitySummary] =
    useState<AccountabilitySummaryExport | null>(null);
  const [accountabilityTrends, setAccountabilityTrends] =
    useState<AccountabilityTrendsExport | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [activityCalendar, setActivityCalendar] = useState<MemberActivityCalendarExport | null>(null);
  const [activityMemberDetails, setActivityMemberDetails] = useState<
    Record<string, MemberActivityCalendarMemberDetailExport | undefined>
  >({});
  const [activityMemberDetailErrors, setActivityMemberDetailErrors] = useState<
    Record<string, string | null | undefined>
  >({});
  const [activityMemberDetailLoading, setActivityMemberDetailLoading] = useState<
    Record<string, boolean | undefined>
  >({});
  const [feedError, setFeedError] = useState<string | null>(null);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const [trendsError, setTrendsError] = useState<string | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [isActivityLoading, setIsActivityLoading] = useState(false);
  const [routeState, setRouteState] = useState<RouteState>(() =>
    typeof window === "undefined"
      ? { route: "home", memberId: null, compareMemberId: null, view: "single" }
      : getRouteStateFromHash(window.location.hash)
  );
  const [selectedSearchMemberId, setSelectedSearchMemberId] = useState<string | null>(null);
  const activityCalendarRef = useRef<MemberActivityCalendarExport | null>(null);
  const activityMemberDetailsRef = useRef<
    Record<string, MemberActivityCalendarMemberDetailExport | undefined>
  >({});
  const activityMemberDetailLoadingRef = useRef<Record<string, boolean | undefined>>({});
  const activityMemberDetailRequestsRef = useRef<Record<string, Promise<void> | undefined>>({});

  activityCalendarRef.current = activityCalendar;
  activityMemberDetailsRef.current = activityMemberDetails;
  activityMemberDetailLoadingRef.current = activityMemberDetailLoading;

  useEffect(() => {
    void loadLatestVotes()
      .then((latestVotesPayload) => {
        setLatestVotes(latestVotesPayload);
      })
      .catch((error: Error) => {
        setFeedError(`홈 화면 데이터를 불러오지 못했습니다. ${error.message}`);
      });

    void loadAccountabilitySummary()
      .then((accountabilityPayload) => {
        setAccountabilitySummary(accountabilityPayload);
        if (!accountabilityPayload) {
          setLeaderboardError("책임성 랭킹 데이터가 아직 발행되지 않았습니다.");
        }
      })
      .catch((error: Error) => {
        setLeaderboardError(`책임성 랭킹 데이터를 불러오지 못했습니다. ${error.message}`);
      });

    void loadAccountabilityTrends()
      .then((trendsPayload) => {
        setAccountabilityTrends(trendsPayload);
      })
      .catch((error: Error) => {
        setTrendsError(`추세 차트 데이터를 불러오지 못했습니다. ${error.message}`);
      });

    void loadManifest()
      .then((manifestPayload) => {
        setManifest(manifestPayload);
      })
      .catch(() => {
        setManifest(null);
      });
  }, []);

  useEffect(() => {
    const handleHashChange = () => {
      setRouteState(getRouteStateFromHash(window.location.hash));
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  const currentAssemblyLabel =
    accountabilitySummary?.assemblyLabel ??
    latestVotes?.assemblyLabel ??
    activityCalendar?.assemblyLabel ??
    manifest?.currentAssembly.label ??
    "최신 국회";
  const trendWindowWeekCount = accountabilityTrends?.weeks.length ?? 0;
  const observedTrendWeekCount =
    accountabilityTrends?.weeks.filter((week) => week.eligibleVoteCount > 0).length ?? 0;
  const updatedAt = manifest?.updatedAt ?? latestVotes?.generatedAt ?? accountabilitySummary?.generatedAt;
  const freshnessText = updatedAt ? `최종 갱신 ${formatDateTime(updatedAt)}` : "최종 갱신 정보 확인 중";
  const summaryTotals =
    accountabilitySummary?.items.reduce(
      (totals, item) => {
        totals.totalRecordedVotes += item.totalRecordedVotes;
        totals.absentCount += item.absentCount;
        totals.noCount += item.noCount;
        totals.abstainCount += item.abstainCount;
        return totals;
      },
      {
        totalRecordedVotes: 0,
        absentCount: 0,
        noCount: 0,
        abstainCount: 0
      }
    ) ?? null;
  const latestActiveTrendWeek =
    accountabilityTrends?.weeks.filter((week) => week.eligibleVoteCount > 0).at(-1) ?? null;
  const spotlightLabel = latestActiveTrendWeek ? "최근 표결 주간 참여율" : "누적 참여율";
  const spotlightParticipationRate =
    latestActiveTrendWeek && latestActiveTrendWeek.eligibleVoteCount > 0
      ? (latestActiveTrendWeek.eligibleVoteCount - latestActiveTrendWeek.absentCount) /
        latestActiveTrendWeek.eligibleVoteCount
      : summaryTotals && summaryTotals.totalRecordedVotes > 0
        ? (summaryTotals.totalRecordedVotes - summaryTotals.absentCount) /
          summaryTotals.totalRecordedVotes
        : null;
  const spotlightAbsenceRate =
    latestActiveTrendWeek && latestActiveTrendWeek.eligibleVoteCount > 0
      ? latestActiveTrendWeek.absentCount / latestActiveTrendWeek.eligibleVoteCount
      : summaryTotals && summaryTotals.totalRecordedVotes > 0
        ? summaryTotals.absentCount / summaryTotals.totalRecordedVotes
        : null;
  const spotlightWindowLabel = latestActiveTrendWeek
    ? `${latestActiveTrendWeek.weekStart} ~ ${latestActiveTrendWeek.weekEnd}`
    : accountabilitySummary
      ? `${currentAssemblyLabel} 누적 집계`
      : "공개 기록표결 기준";
  const spotlightNote =
    latestActiveTrendWeek && latestActiveTrendWeek.eligibleVoteCount > 0
      ? `대상 ${formatNumber(latestActiveTrendWeek.eligibleVoteCount)}건 중 불참 ${formatNumber(latestActiveTrendWeek.absentCount)}건`
      : summaryTotals && summaryTotals.totalRecordedVotes > 0
        ? `누적 ${formatNumber(summaryTotals.totalRecordedVotes)}건 중 불참 ${formatNumber(summaryTotals.absentCount)}건`
        : "출석 대비 불참 집계를 준비 중입니다.";
  const heroStats = [
    {
      label: "집계 의원",
      value: accountabilitySummary ? `${formatNumber(accountabilitySummary.items.length)}명` : "준비 중",
      note: "책임성 랭킹 기준"
    },
    {
      label: latestActiveTrendWeek ? "최근 주 불참" : "누적 불참",
      value: latestActiveTrendWeek
        ? `${formatNumber(latestActiveTrendWeek.absentCount)}건`
        : summaryTotals
          ? `${formatNumber(summaryTotals.absentCount)}건`
          : "준비 중",
      note: latestActiveTrendWeek ? `${spotlightWindowLabel} 기준` : "공개 기록표결 집계"
    },
    {
      label: "실제 표결 주간",
      value: accountabilityTrends ? `${formatNumber(observedTrendWeekCount)}주` : "준비 중",
      note:
        accountabilityTrends
          ? trendWindowWeekCount > 0
            ? `최근 ${formatNumber(trendWindowWeekCount)}주 관측`
            : "주간 흐름 기준"
          : "주간 흐름 기준"
    }
  ];

  async function ensureActivityCalendarLoaded(): Promise<void> {
    if (activityCalendar || isActivityLoading) {
      return;
    }

    setIsActivityLoading(true);
    setActivityError(null);

    try {
      const payload = await loadMemberActivityCalendar(manifest);
      if (!payload) {
        setActivityError("활동 캘린더 데이터가 아직 발행되지 않았습니다.");
        return;
      }

      setActivityCalendar(payload);
      setActivityMemberDetails({});
      setActivityMemberDetailErrors({});
      setActivityMemberDetailLoading({});
    } catch (error) {
      setActivityError(
        `활동 캘린더 데이터를 불러오지 못했습니다. ${(error as Error).message}`
      );
    } finally {
      setIsActivityLoading(false);
    }
  }

  useEffect(() => {
    if (
      routeState.route !== "calendar" &&
      routeState.route !== "distribution" &&
      !accountabilitySummary
    ) {
      return;
    }

    void ensureActivityCalendarLoaded();
  }, [routeState.route, manifest, accountabilitySummary]);

  const ensureActivityMemberDetailLoaded = useCallback(async (
    member: MemberActivityCalendarMember,
    force = false
  ): Promise<void> => {
    const activityCalendarValue = activityCalendarRef.current;

    if (!activityCalendarValue) {
      return;
    }

    const pendingRequest = activityMemberDetailRequestsRef.current[member.memberId];

    if (pendingRequest) {
      await pendingRequest;
      return;
    }

    if (
      !force &&
      (
        activityMemberDetailsRef.current[member.memberId] ||
        activityMemberDetailLoadingRef.current[member.memberId]
      )
    ) {
      return;
    }

    const request = (async () => {
      setActivityMemberDetailLoading((current) => ({
        ...current,
        [member.memberId]: true
      }));
      setActivityMemberDetailErrors((current) => ({
        ...current,
        [member.memberId]: null
      }));

      try {
        if (
          member.voteRecordCount === 0 ||
          (member.voteRecords?.length ?? 0) >= member.voteRecordCount
        ) {
          setActivityMemberDetails((current) => ({
            ...current,
            [member.memberId]: buildEmbeddedActivityMemberDetail(activityCalendarValue, member)
          }));
          return;
        }

        const payload = await loadMemberActivityCalendarMemberDetail(member.voteRecordsPath);
        if (!payload) {
          setActivityMemberDetailErrors((current) => ({
            ...current,
            [member.memberId]: "의안별 표결 기록 데이터가 아직 발행되지 않았습니다."
          }));
          return;
        }

        setActivityMemberDetails((current) => ({
          ...current,
          [member.memberId]: payload
        }));
      } catch (error) {
        setActivityMemberDetailErrors((current) => ({
          ...current,
          [member.memberId]: `의안별 표결 기록을 불러오지 못했습니다. ${(error as Error).message}`
        }));
      } finally {
        delete activityMemberDetailRequestsRef.current[member.memberId];
        setActivityMemberDetailLoading((current) => ({
          ...current,
          [member.memberId]: false
        }));
      }
    })();

    activityMemberDetailRequestsRef.current[member.memberId] = request;
    await request;
  }, []);

  const retryActivityMemberDetail = useCallback((member: MemberActivityCalendarMember): void => {
    setActivityMemberDetails((current) => {
      const next = { ...current };
      delete next[member.memberId];
      return next;
    });
    void ensureActivityMemberDetailLoaded(member, true);
  }, [ensureActivityMemberDetailLoaded]);

  function navigateToCalendar(memberId?: string | null, view: ActivityViewMode = "single"): void {
    window.location.hash = buildCalendarHash({ memberId, view });
  }

  function navigateToDistribution(memberId?: string | null): void {
    window.location.hash = buildDistributionHash({ memberId });
  }

  function navigateHome(): void {
    window.location.hash = "";
  }

  const combinedRankingItems = accountabilitySummary
    ? rankAccountabilityItems(accountabilitySummary.items, "combined")
    : [];
  const leaderboardAttendanceByMemberId = new Map(
    (activityCalendar?.assembly.members ?? []).map((member) => [
      member.memberId,
      getMemberAttendanceSummary(member)
    ])
  );
  const homeSearchOptions = combinedRankingItems.map((item) => ({
    id: item.memberId,
    label: `${item.name} · ${item.party}`
  }));
  const homeStatusMessages = [
    feedError ? "최근 표결 데이터를 불러오지 못해 일부 카드가 비어 있습니다." : null,
    leaderboardError ? "책임성 랭킹 데이터를 확인하지 못해 일부 비교 요소가 비활성화되었습니다." : null,
    trendsError ? "추세 차트 데이터를 확인하지 못해 일부 시각화가 단순 표시로 전환되었습니다." : null,
    activityError && accountabilitySummary
      ? "활동 캘린더 데이터를 확인하지 못해 랭킹 출석 요약이 일부 비어 있습니다."
      : null
  ].filter(Boolean) as string[];
  const distributionErrors = [leaderboardError, activityError].filter(Boolean) as string[];

  if (routeState.route === "distribution") {
    return (
      <DistributionPage
        accountabilitySummary={accountabilitySummary}
        activityCalendar={activityCalendar}
        loading={
          (!accountabilitySummary && !leaderboardError) ||
          (!activityCalendar && !activityError)
        }
        errors={distributionErrors}
        assemblyLabel={currentAssemblyLabel}
        initialMemberId={routeState.memberId}
        onBack={navigateHome}
        onSelectMember={(memberId) => {
          navigateToDistribution(memberId);
        }}
      />
    );
  }

  if (routeState.route === "calendar") {
    return (
      <>
        <main className="app-shell">
          <ActivityCalendarPage
            activityCalendar={activityCalendar}
            loading={isActivityLoading}
            error={activityError}
            assemblyLabel={currentAssemblyLabel}
            initialMemberId={routeState.memberId}
            initialCompareMemberId={routeState.compareMemberId}
            initialView={routeState.view}
            memberDetails={activityMemberDetails}
            memberDetailErrors={activityMemberDetailErrors}
            memberDetailLoading={activityMemberDetailLoading}
            onEnsureMemberDetail={ensureActivityMemberDetailLoaded}
            onRetryMemberDetail={retryActivityMemberDetail}
            onBack={navigateHome}
            onRetry={() => void ensureActivityCalendarLoaded()}
          />
        </main>
      </>
    );
  }

  return (
    <>
      <main className="app-shell">
        <section className="hero-panel">
          <div className="hero-panel__grid">
            <div className="hero-panel__story">
              <div className="hero-panel__masthead">
                <div className="hero-panel__context">
                  <p className="section-label">국회 책임성 모니터</p>
                  <div className="hero-panel__chips">
                    <span className="context-chip">{currentAssemblyLabel}</span>
                    <span className="context-chip">공개 기록표결 기준</span>
                    <span className="context-chip">현직·재직 구간 기준</span>
                  </div>
                </div>
                <span className="freshness-indicator">
                  {freshnessText}
                </span>
              </div>
              <div className="hero-panel__headline">
                <h1>국회 책임성 모니터</h1>
                <p className="hero-panel__lede">
                  오늘의 국회 표결 흐름을 한 화면에서 훑고, 의원 단위 비교로 바로 내려갑니다.
                </p>
              </div>
              <p className="hero-panel__copy">
                {`국회 표결 기록으로 의원 활동을 살펴보는 서비스입니다. ${currentAssemblyLabel} 기준 공개 기록표결과 표결일 기준 재직 구간을 바탕으로 현직 의원의 찬성·반대·기권·불참 흐름과 최근 표결을 빠르게 확인할 수 있습니다.`}
              </p>
            </div>
            <aside className="hero-panel__aside" aria-label="브리핑">
              <p className="hero-panel__aside-label">출석 집중 브리핑</p>
              <article className="hero-panel__spotlight">
                <div className="hero-panel__spotlight-header">
                  <p>{spotlightLabel}</p>
                  <span>{spotlightWindowLabel}</span>
                </div>
                <div className="hero-panel__spotlight-metrics">
                  <div className="hero-panel__spotlight-metric">
                    <strong>
                      {spotlightParticipationRate !== null
                        ? formatPercent(spotlightParticipationRate)
                        : "준비 중"}
                    </strong>
                    <span>참여</span>
                  </div>
                  <div className="hero-panel__spotlight-metric hero-panel__spotlight-metric--alert">
                    <strong>
                      {spotlightAbsenceRate !== null ? formatPercent(spotlightAbsenceRate) : "준비 중"}
                    </strong>
                    <span>불참 비중</span>
                  </div>
                </div>
                <p className="hero-panel__spotlight-note">{spotlightNote}</p>
              </article>
              <div className="hero-panel__stat-grid">
                {heroStats.map((item) => (
                  <article key={item.label} className="hero-panel__stat">
                    <p>{item.label}</p>
                    <strong>{item.value}</strong>
                    <span>{item.note}</span>
                  </article>
                ))}
              </div>
              <p className="hero-panel__aside-note">
                공개 기록표결, 출석 대비 불참, 최근 표결 카드, 활동 캘린더를 같은 시각 규칙 안에서 연결해 읽도록 정리합니다.
              </p>
            </aside>
          </div>
        </section>

        <section className="search-panel">
          <div className="search-panel__copy search-panel__lead">
            <p className="section-label">의원 찾기</p>
            <h2>이름이나 정당으로 바로 찾아서 활동 캘린더로 이동합니다.</h2>
            <p className="search-panel__hint">
              가장 빠른 경로는 의원 이름이나 정당을 입력한 뒤 개인 분석 화면으로 바로 넘어가는 것입니다.
            </p>
          </div>
          <div className="search-panel__command">
            <form
              className="search-panel__form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!selectedSearchMemberId) {
                  return;
                }

                navigateToCalendar(selectedSearchMemberId);
              }}
            >
              <MemberSearchField
                label="의원 검색"
                options={homeSearchOptions}
                selectedId={selectedSearchMemberId}
                onSelect={setSelectedSearchMemberId}
                placeholder="의원 이름 또는 정당을 입력하세요"
                className="search-panel__field"
                disabled={homeSearchOptions.length === 0}
              />
              <button
                type="submit"
                className="search-panel__submit"
                disabled={!selectedSearchMemberId}
              >
                활동 캘린더 열기
              </button>
            </form>
            <div className="search-panel__actions">
              <button
                type="button"
                className="search-panel__secondary-action"
                onClick={() => navigateToDistribution()}
              >
                국회 전체 분포 보기
              </button>
            </div>
          </div>
        </section>

        {homeStatusMessages.length > 0 ? (
          <section className="status-panel" role="status" aria-live="polite">
            <p className="section-label">상태 안내</p>
            <ul>
              {homeStatusMessages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <VisualizationOverview
          accountabilityTrends={accountabilityTrends}
          assemblyLabel={currentAssemblyLabel}
        />

        {accountabilitySummary ? (
          <AccountabilityLeaderboard
            items={accountabilitySummary.items}
            assemblyLabel={currentAssemblyLabel}
            attendanceByMemberId={leaderboardAttendanceByMemberId}
          />
        ) : (
          <section className="leaderboard-panel">
            <div className="leaderboard-panel__header">
              <div>
                <p className="section-label">의원 랭킹</p>
                <h2>{`${currentAssemblyLabel} 의원 순위`}</h2>
              </div>
            </div>
            <p className="leaderboard-panel__copy">
              책임성 랭킹 데이터가 아직 준비되지 않았습니다.
            </p>
          </section>
        )}

        <section className="feed-panel">
          <div className="feed-panel__header">
            <div>
              <p className="section-label">최근 표결</p>
              <h2>{`${currentAssemblyLabel} 최신 본회의 표결`}</h2>
            </div>
          </div>

          <VoteCarousel
            items={latestVotes?.items ?? null}
            loading={!latestVotes && !feedError}
            unavailable={Boolean(feedError)}
          />
        </section>

        <details className="info-panel">
          <summary>집계 기준과 반영 스케줄 안내</summary>
          <div className="info-panel__body">
            <p>
              책임성 랭킹은 {currentAssemblyLabel} 기준 국회 공식 API에 공개된 개인별 기록표결 중 <strong>현직 의원만</strong> 집계합니다. 각 표결일마다
              <strong> 재직 구간 안에 있었던 의원</strong>만 분모에 포함하며, 무기명 표결은 개인별 명단이 없어서 제외합니다.
            </p>
            <p>
              공개 화면에서는 반대, 기권, 불참을 분리해 보여줍니다. 불참은 재직 구간 안의 기록표결일이지만 개인별 표결 기록이 없거나 원천 응답에 불참으로 표시된 경우만 집계합니다.
            </p>
            <p>
              데이터 수집은 GitHub Actions에서 <strong>평일 한국시간 09:00, 14:00, 19:00 하루 3회</strong>
              실행됩니다. 수집이 성공하면 후속 데이터 빌드와 공개 저장소 반영이 이어집니다.
            </p>
          </div>
        </details>
      </main>
    </>
  );
}
