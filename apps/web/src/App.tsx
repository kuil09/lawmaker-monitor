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
import { MemberSearchField } from "./components/MemberSearchField.js";
import { VisualizationOverview } from "./components/VisualizationOverview.js";
import { VoteCarousel } from "./components/VoteCarousel.js";
import { rankAccountabilityItems } from "./lib/accountability.js";
import { buildCalendarHash, type ActivityViewMode } from "./lib/calendar-route.js";
import {
  loadAccountabilitySummary,
  loadAccountabilityTrends,
  loadLatestVotes,
  loadManifest,
  loadMemberActivityCalendar,
  loadMemberActivityCalendarMemberDetail
} from "./lib/data.js";
import { formatDateTime } from "./lib/format.js";

type AppRoute = "home" | "calendar";

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

  if (path !== "calendar") {
    return {
      route: "home",
      memberId: null,
      compareMemberId: null,
      view: "single"
    };
  }

  const params = new URLSearchParams(search);

  return {
    route: "calendar",
    memberId: params.get("member"),
    compareMemberId: params.get("compare"),
    view: params.get("view") === "compare" ? "compare" : "single"
  };
}

export default function App() {
  const normalizedBaseUrl = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  const koglBadgeUrl = `${normalizedBaseUrl}kogl-type1-badge.png`;
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
  const updatedAt = manifest?.updatedAt ?? latestVotes?.generatedAt ?? accountabilitySummary?.generatedAt;
  const freshnessText = updatedAt ? `최종 갱신 ${formatDateTime(updatedAt)}` : "최종 갱신 정보 확인 중";
  const heroStats = [
    {
      label: "집계 의원",
      value: accountabilitySummary ? `${accountabilitySummary.items.length}명` : "준비 중",
      note: "책임성 랭킹 기준"
    },
    {
      label: "최근 표결",
      value: latestVotes ? `${latestVotes.items.length}건` : "준비 중",
      note: "홈 피드 노출 건수"
    },
    {
      label: "추세 관측 창",
      value: accountabilityTrends ? `${accountabilityTrends.weeks.length}주` : "최근 12주",
      note: "주간 흐름 기준"
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
    if (routeState.route !== "calendar") {
      return;
    }

    void ensureActivityCalendarLoaded();
  }, [routeState.route, manifest]);

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

  function navigateHome(): void {
    window.location.hash = "";
  }

  const combinedRankingItems = accountabilitySummary
    ? rankAccountabilityItems(accountabilitySummary.items, "combined")
    : [];
  const homeSearchOptions = combinedRankingItems.map((item) => ({
    id: item.memberId,
    label: `${item.name} · ${item.party}`
  }));
  const homeStatusMessages = [
    feedError ? "최근 표결 데이터를 불러오지 못해 일부 카드가 비어 있습니다." : null,
    leaderboardError ? "책임성 랭킹 데이터를 확인하지 못해 일부 비교 요소가 비활성화되었습니다." : null,
    trendsError ? "추세 차트 데이터를 확인하지 못해 일부 시각화가 단순 표시로 전환되었습니다." : null
  ].filter(Boolean) as string[];
  const siteFooter = (
    <footer className="site-footer">
      <div className="site-footer__notice">
        <img
          src={koglBadgeUrl}
          alt="공공누리 제1유형"
          className="site-footer__badge"
        />
        <div className="site-footer__copy">
          <p>
            본 서비스는{" "}
            <a href="https://www.assembly.go.kr/" target="_blank" rel="noreferrer">
              대한민국 국회
            </a>
            의 공개 자료를 바탕으로 합니다. 공공누리(KOGL) 제1유형 표기 자료는 출처 표시와 원문 링크 제공 조건으로 자유 이용할 수 있습니다.
          </p>
          <details className="site-footer__details">
            <summary>이용 조건 보기</summary>
            <ul>
              <li>출처 또는 저작권자를 표시하고, 가능한 경우 원 출처 웹사이트로 링크해야 합니다.</li>
              <li>공공기관이 이용자를 후원하거나 특수 관계가 있는 것처럼 보이게 표시해서는 안 됩니다.</li>
              <li>공공저작물을 변경해 이용하더라도 저작인격권을 존중해야 합니다.</li>
              <li>자료의 정확성이나 지속적인 제공은 원 출처 기관이 보장하지 않으며, 이용 조건 위반 시 허락은 자동 종료될 수 있습니다.</li>
            </ul>
          </details>
        </div>
      </div>
    </footer>
  );

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
        {siteFooter}
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
              <p className="hero-panel__lede">오늘의 국회 표결 흐름을 한 화면에서 훑고, 의원 단위 비교로 바로 내려갑니다.</p>
              <h1>국회 책임성 모니터</h1>
              <p className="hero-panel__copy">
                {`국회 표결 기록으로 의원 활동을 살펴보는 서비스입니다. ${currentAssemblyLabel} 기준 공개 기록표결과 표결일 기준 재직 구간을 바탕으로 현직 의원의 찬성·반대·기권·불참 흐름과 최근 표결을 빠르게 확인할 수 있습니다.`}
              </p>
            </div>
            <aside className="hero-panel__aside" aria-label="브리핑">
              <p className="hero-panel__aside-label">오늘의 브리핑</p>
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
                공개 기록표결, 의원별 집계, 최근 표결 카드, 활동 캘린더를 같은 시각 규칙 안에서 연결해 읽도록 정리합니다.
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
      {siteFooter}
    </>
  );
}
