import { useCallback, useEffect, useRef, useState } from "react";

import type {
  AccountabilitySummaryExport,
  AccountabilityTrendsExport,
  LatestVotesExport,
  MemberActivityCalendarExport,
  MemberActivityCalendarMember,
  MemberActivityCalendarMemberDetailExport,
  MemberAssetsHistoryExport,
  MemberAssetsIndexExport,
  Manifest
} from "@lawmaker-monitor/schemas";

import { AccountabilityLeaderboard } from "./components/AccountabilityLeaderboard.js";
import { ActivityCalendarPage } from "./components/ActivityCalendarPage.js";
import { DistributionConstituencyMap } from "./components/DistributionConstituencyMap.js";
import { DistributionPage } from "./components/DistributionPage.js";
import { GlobalNav } from "./components/GlobalNav.js";
import { MemberSearchField } from "./components/MemberSearchField.js";
import { HexmapPage } from "./components/HexmapPage.js";
import { TrendsPage } from "./components/TrendsPage.js";
import { VotesPage } from "./components/VotesPage.js";
import { rankAccountabilityItems } from "./lib/accountability.js";
import { buildCalendarHash, type ActivityViewMode } from "./lib/calendar-route.js";
import { buildDistributionHash } from "./lib/distribution-route.js";
import {
  buildMapHash,
  parseMapRoute,
  type MapMetric,
  type MapRouteArgs
} from "./lib/map-route.js";
import {
  buildDistributionBehaviorSummaries,
  buildDistributionMembers,
  isDistributionBehaviorFilter,
  type DistributionBehaviorFilter
} from "./lib/distribution.js";
import {
  loadAccountabilitySummary,
  loadAccountabilityTrends,
  loadLatestVotes,
  loadManifest,
  loadMemberActivityCalendar,
  loadMemberActivityCalendarMemberDetail,
  loadMemberAssetsHistory,
  loadMemberAssetsIndex
} from "./lib/data.js";
import { formatDateTime, formatNumber } from "./lib/format.js";
import { scheduleHexmapPrewarm } from "./lib/hexmap-static-loader.js";
import {
  buildLatestAssetAllocationSummary,
  getLatestRealEstateTotalFromHistory
} from "./lib/member-assets.js";
import { getMemberAttendanceSummary } from "./lib/member-activity.js";

type AppRoute = "home" | "calendar" | "distribution" | "votes" | "trends" | "map";

type RouteState = {
  route: AppRoute;
  memberId: string | null;
  compareMemberId: string | null;
  view: ActivityViewMode;
  behaviorFilter: DistributionBehaviorFilter | null;
  mapProvince: string | null;
  mapDistrict: string | null;
  mapMetric: MapMetric;
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
      view: params.get("view") === "compare" ? "compare" : "single",
      behaviorFilter: null,
      mapProvince: null,
      mapDistrict: null,
      mapMetric: "absence"
    };
  }

  if (path === "distribution") {
    const rawBehaviorFilter = params.get("behavior");
    return {
      route: "distribution",
      memberId: params.get("member"),
      compareMemberId: null,
      view: "single",
      behaviorFilter: isDistributionBehaviorFilter(rawBehaviorFilter) ? rawBehaviorFilter : null,
      mapProvince: null,
      mapDistrict: null,
      mapMetric: "absence"
    };
  }

  if (path === "votes") {
    return {
      route: "votes",
      memberId: null,
      compareMemberId: null,
      view: "single",
      behaviorFilter: null,
      mapProvince: null,
      mapDistrict: null,
      mapMetric: "absence"
    };
  }

  if (path === "trends") {
    return {
      route: "trends",
      memberId: null,
      compareMemberId: null,
      view: "single",
      behaviorFilter: null,
      mapProvince: null,
      mapDistrict: null,
      mapMetric: "absence"
    };
  }

  if (path === "map") {
    const mapRoute = parseMapRoute(params);
    return {
      route: "map",
      memberId: null,
      compareMemberId: null,
      view: "single",
      behaviorFilter: null,
      mapProvince: mapRoute.province,
      mapDistrict: mapRoute.district,
      mapMetric: mapRoute.metric
    };
  }

  return {
    route: "home",
    memberId: null,
    compareMemberId: null,
    view: "single",
    behaviorFilter: null,
    mapProvince: null,
    mapDistrict: null,
    mapMetric: "absence"
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
  const [memberAssetsIndex, setMemberAssetsIndex] = useState<MemberAssetsIndexExport | null>(null);
  const [memberAssetsIndexError, setMemberAssetsIndexError] = useState<string | null>(null);
  const [memberAssetHistories, setMemberAssetHistories] = useState<
    Record<string, MemberAssetsHistoryExport | undefined>
  >({});
  const [memberAssetHistoryErrors, setMemberAssetHistoryErrors] = useState<
    Record<string, string | null | undefined>
  >({});
  const [memberAssetHistoryLoading, setMemberAssetHistoryLoading] = useState<
    Record<string, boolean | undefined>
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
      ? {
          route: "home",
          memberId: null,
          compareMemberId: null,
          view: "single",
          behaviorFilter: null,
          mapProvince: null,
          mapDistrict: null,
          mapMetric: "absence"
        }
      : getRouteStateFromHash(window.location.hash)
  );
  const [selectedSearchMemberId, setSelectedSearchMemberId] = useState<string | null>(null);
  const activityCalendarRef = useRef<MemberActivityCalendarExport | null>(null);
  const activityMemberDetailsRef = useRef<
    Record<string, MemberActivityCalendarMemberDetailExport | undefined>
  >({});
  const memberAssetsIndexRef = useRef<MemberAssetsIndexExport | null>(null);
  const memberAssetHistoriesRef = useRef<Record<string, MemberAssetsHistoryExport | undefined>>({});
  const memberAssetHistoryLoadingRef = useRef<Record<string, boolean | undefined>>({});
  const activityMemberDetailLoadingRef = useRef<Record<string, boolean | undefined>>({});
  const activityMemberDetailRequestsRef = useRef<Record<string, Promise<void> | undefined>>({});
  const memberAssetHistoryRequestsRef = useRef<Record<string, Promise<void> | undefined>>({});

  activityCalendarRef.current = activityCalendar;
  activityMemberDetailsRef.current = activityMemberDetails;
  memberAssetsIndexRef.current = memberAssetsIndex;
  memberAssetHistoriesRef.current = memberAssetHistories;
  memberAssetHistoryLoadingRef.current = memberAssetHistoryLoading;
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

  useEffect(() => {
    if (
      routeState.route !== "home" ||
      !manifest ||
      !accountabilitySummary
    ) {
      return;
    }

    return scheduleHexmapPrewarm(manifest);
  }, [routeState.route, manifest, accountabilitySummary]);

  const currentAssemblyLabel =
    accountabilitySummary?.assemblyLabel ??
    latestVotes?.assemblyLabel ??
    activityCalendar?.assemblyLabel ??
    manifest?.currentAssembly.label ??
    "최신 국회";
  const updatedAt = manifest?.updatedAt ?? latestVotes?.generatedAt ?? accountabilitySummary?.generatedAt;
  const freshnessText = updatedAt ? `최종 갱신 ${formatDateTime(updatedAt)}` : "최종 갱신 정보 확인 중";

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

  useEffect(() => {
    if (
      routeState.route !== "home" &&
      routeState.route !== "calendar" &&
      routeState.route !== "map"
    ) {
      return;
    }

    if (memberAssetsIndex || memberAssetsIndexError) {
      return;
    }

    void loadMemberAssetsIndex(manifest)
      .then((payload) => {
        setMemberAssetsIndex(payload);
        setMemberAssetsIndexError(null);
      })
      .catch((error: Error) => {
        setMemberAssetsIndexError(`재산 공개 데이터를 불러오지 못했습니다. ${error.message}`);
      });
  }, [routeState.route, manifest, memberAssetsIndex, memberAssetsIndexError]);

  const ensureMemberAssetHistoryLoadedByIndexEntry = useCallback(async (
    indexEntry: NonNullable<MemberAssetsIndexExport>["members"][number],
    force = false
  ): Promise<void> => {
    const pendingRequest = memberAssetHistoryRequestsRef.current[indexEntry.memberId];
    if (pendingRequest) {
      await pendingRequest;
      return;
    }

    if (
      !force &&
      (
        memberAssetHistoriesRef.current[indexEntry.memberId] ||
        memberAssetHistoryLoadingRef.current[indexEntry.memberId]
      )
    ) {
      return;
    }

    const request = (async () => {
      setMemberAssetHistoryLoading((current) => ({
        ...current,
        [indexEntry.memberId]: true
      }));
      setMemberAssetHistoryErrors((current) => ({
        ...current,
        [indexEntry.memberId]: null
      }));

      try {
        const payload = await loadMemberAssetsHistory(indexEntry.historyPath);
        if (!payload) {
          setMemberAssetHistoryErrors((current) => ({
            ...current,
            [indexEntry.memberId]: "재산 공개 이력이 아직 발행되지 않았습니다."
          }));
          return;
        }

        setMemberAssetHistories((current) => ({
          ...current,
          [indexEntry.memberId]: payload
        }));
      } catch (error) {
        setMemberAssetHistoryErrors((current) => ({
          ...current,
          [indexEntry.memberId]: `재산 공개 이력을 불러오지 못했습니다. ${(error as Error).message}`
        }));
      } finally {
        delete memberAssetHistoryRequestsRef.current[indexEntry.memberId];
        setMemberAssetHistoryLoading((current) => ({
          ...current,
          [indexEntry.memberId]: false
        }));
      }
    })();

    memberAssetHistoryRequestsRef.current[indexEntry.memberId] = request;
    await request;
  }, []);

  useEffect(() => {
    if (routeState.route !== "home" || !memberAssetsIndex) {
      return;
    }

    const missingRealEstateEntries = memberAssetsIndex.members.filter(
      (entry) =>
        entry.latestRealEstateTotal == null &&
        !memberAssetHistoriesRef.current[entry.memberId] &&
        !memberAssetHistoryLoadingRef.current[entry.memberId]
    );

    if (missingRealEstateEntries.length === 0) {
      return;
    }

    let cancelled = false;

    void (async () => {
      const batchSize = 6;

      for (let start = 0; start < missingRealEstateEntries.length; start += batchSize) {
        if (cancelled) {
          return;
        }

        const batch = missingRealEstateEntries.slice(start, start + batchSize);
        await Promise.all(batch.map((entry) => ensureMemberAssetHistoryLoadedByIndexEntry(entry)));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [routeState.route, memberAssetsIndex, ensureMemberAssetHistoryLoadedByIndexEntry]);

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

  const ensureMemberAssetHistoryLoaded = useCallback(async (
    member: MemberActivityCalendarMember,
    force = false
  ): Promise<void> => {
    const indexPayload = memberAssetsIndexRef.current;
    if (!indexPayload) {
      return;
    }

    const indexEntry = indexPayload.members.find((entry) => entry.memberId === member.memberId);
    if (!indexEntry) {
      return;
    }
    await ensureMemberAssetHistoryLoadedByIndexEntry(indexEntry, force);
  }, [ensureMemberAssetHistoryLoadedByIndexEntry]);

  const retryMemberAssetHistory = useCallback((member: MemberActivityCalendarMember): void => {
    setMemberAssetHistories((current) => {
      const next = { ...current };
      delete next[member.memberId];
      return next;
    });
    void ensureMemberAssetHistoryLoaded(member, true);
  }, [ensureMemberAssetHistoryLoaded]);

  function navigateToCalendar(memberId?: string | null, view: ActivityViewMode = "single"): void {
    window.location.hash = buildCalendarHash({ memberId, view });
  }

  function navigateToDistribution(
    memberId?: string | null,
    behaviorFilter?: DistributionBehaviorFilter | null
  ): void {
    window.location.hash = buildDistributionHash({ memberId, behaviorFilter });
  }

  function navigateHome(): void {
    window.location.hash = "";
  }

  function navigateToVotes(): void {
    window.location.hash = "votes";
  }

  function navigateToTrends(): void {
    window.location.hash = "trends";
  }

  function navigateToMap(args: MapRouteArgs = {}): void {
    window.location.hash = buildMapHash(args);
  }

  function handleNavNavigate(target: "votes" | "trends" | "map"): void {
    if (target === "votes") {
      navigateToVotes();
    } else if (target === "trends") {
      navigateToTrends();
    } else {
      navigateToMap();
    }
  }

  const combinedRankingItems = accountabilitySummary
    ? rankAccountabilityItems(accountabilitySummary.items, "combined")
    : [];
  const accountabilityItemsByMemberId = new Map(
    (accountabilitySummary?.items ?? []).map((item) => [item.memberId, item])
  );
  const leaderboardAttendanceByMemberId = new Map(
    (activityCalendar?.assembly.members ?? []).map((member) => [
      member.memberId,
      getMemberAttendanceSummary(member)
    ])
  );
  const distributionMembers =
    accountabilitySummary && activityCalendar
      ? buildDistributionMembers(accountabilitySummary, activityCalendar)
      : [];
  const leaderboardAssetItems = (memberAssetsIndex?.members ?? []).map((item) => {
    const accountabilityItem = accountabilityItemsByMemberId.get(item.memberId);

    return {
      ...item,
      photoUrl: item.photoUrl ?? accountabilityItem?.photoUrl ?? null,
      officialProfileUrl: item.officialProfileUrl ?? accountabilityItem?.officialProfileUrl ?? null,
      officialExternalUrl: item.officialExternalUrl ?? accountabilityItem?.officialExternalUrl ?? null,
      latestRealEstateTotal:
        item.latestRealEstateTotal ??
        (getLatestRealEstateTotalFromHistory(memberAssetHistories[item.memberId] ?? null) ?? undefined),
      assetAllocation:
        buildLatestAssetAllocationSummary(memberAssetHistories[item.memberId] ?? null) ?? undefined
    };
  });
  const homeAssetRatioCandidateIds = [
    ...new Set([
      ...[...leaderboardAssetItems]
        .sort((left, right) => right.latestTotal - left.latestTotal)
        .slice(0, 10)
        .map((item) => item.memberId),
      ...[...leaderboardAssetItems]
        .filter((item) => item.latestRealEstateTotal != null)
        .sort(
          (left, right) =>
            (right.latestRealEstateTotal ?? Number.NEGATIVE_INFINITY) -
            (left.latestRealEstateTotal ?? Number.NEGATIVE_INFINITY)
        )
        .slice(0, 10)
        .map((item) => item.memberId)
    ])
  ];
  const homeBehaviorSummaries = buildDistributionBehaviorSummaries(distributionMembers);
  const homeSearchOptions = combinedRankingItems.map((item) => ({
    id: item.memberId,
    label: `${item.name} · ${item.party}`
  }));
  const homeStatusMessages = [
    leaderboardError ? "책임성 랭킹 데이터를 확인하지 못해 일부 비교 요소가 비활성화되었습니다." : null,
    activityError && accountabilitySummary
      ? "활동 캘린더 데이터를 확인하지 못해 랭킹 출석 요약이 일부 비어 있습니다."
      : null
  ].filter(Boolean) as string[];
  const distributionErrors = [leaderboardError, activityError].filter(Boolean) as string[];
  const homeAssetRatioCandidateSignature = homeAssetRatioCandidateIds.join("|");

  useEffect(() => {
    if (routeState.route !== "home" || !memberAssetsIndex || homeAssetRatioCandidateIds.length === 0) {
      return;
    }

    let cancelled = false;

    void (async () => {
      for (const memberId of homeAssetRatioCandidateIds) {
        if (cancelled) {
          return;
        }

        const entry = memberAssetsIndex.members.find((member) => member.memberId === memberId);
        if (!entry) {
          continue;
        }

        if (
          memberAssetHistoriesRef.current[memberId] ||
          memberAssetHistoryLoadingRef.current[memberId]
        ) {
          continue;
        }

        await ensureMemberAssetHistoryLoadedByIndexEntry(entry);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    routeState.route,
    memberAssetsIndex,
    ensureMemberAssetHistoryLoadedByIndexEntry,
    homeAssetRatioCandidateSignature,
    homeAssetRatioCandidateIds
  ]);

  const calendarMemberName =
    routeState.route === "calendar" && routeState.memberId && activityCalendar
      ? (activityCalendar.assembly.members.find(
          (m) => m.memberId === routeState.memberId
        )?.name ?? null)
      : null;

  if (routeState.route === "distribution") {
    return (
      <>
        <GlobalNav
          route="distribution"
          assemblyLabel={currentAssemblyLabel}
          onHome={navigateHome}
        />
        <DistributionPage
        accountabilitySummary={accountabilitySummary}
        activityCalendar={activityCalendar}
        manifest={manifest}
        loading={
          (!accountabilitySummary && !leaderboardError) ||
          (!activityCalendar && !activityError)
        }
        errors={distributionErrors}
        assemblyLabel={currentAssemblyLabel}
        initialMemberId={routeState.memberId}
        initialBehaviorFilter={routeState.behaviorFilter}
        onBack={navigateHome}
        onSelectMember={(memberId, behaviorFilter) => {
          navigateToDistribution(
            memberId,
            behaviorFilter === undefined ? routeState.behaviorFilter : behaviorFilter
          );
        }}
        onSelectBehaviorFilter={(behaviorFilter, memberId) => {
          navigateToDistribution(
            memberId === undefined ? routeState.memberId : memberId,
            behaviorFilter
          );
        }}
      />
      </>
    );
  }

  if (routeState.route === "calendar") {
    return (
      <>
        <GlobalNav
          route="calendar"
          assemblyLabel={currentAssemblyLabel}
          memberName={calendarMemberName}
          onHome={navigateHome}
        />
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
            memberAssetsIndex={memberAssetsIndex}
            memberAssetsIndexError={memberAssetsIndexError}
            memberAssetHistories={memberAssetHistories}
            memberAssetHistoryErrors={memberAssetHistoryErrors}
            memberAssetHistoryLoading={memberAssetHistoryLoading}
            onEnsureMemberDetail={ensureActivityMemberDetailLoaded}
            onRetryMemberDetail={retryActivityMemberDetail}
            onEnsureMemberAssetHistory={ensureMemberAssetHistoryLoaded}
            onRetryMemberAssetHistory={retryMemberAssetHistory}
            onBack={navigateHome}
            onRetry={() => void ensureActivityCalendarLoaded()}
          />
        </main>
      </>
    );
  }

  if (routeState.route === "votes") {
    return (
      <>
        <GlobalNav
          route="votes"
          assemblyLabel={currentAssemblyLabel}
          onHome={navigateHome}
        />
        <main className="app-shell">
          <VotesPage
            latestVotes={latestVotes}
            loading={!latestVotes && !feedError}
            unavailable={Boolean(feedError)}
            assemblyLabel={currentAssemblyLabel}
          />
        </main>
      </>
    );
  }

  if (routeState.route === "trends") {
    return (
      <>
        <GlobalNav
          route="trends"
          assemblyLabel={currentAssemblyLabel}
          onHome={navigateHome}
        />
        <main className="app-shell">
          <TrendsPage
            accountabilityTrends={accountabilityTrends}
            assemblyLabel={currentAssemblyLabel}
          />
        </main>
      </>
    );
  }

  if (routeState.route === "map") {
    return (
      <>
        <GlobalNav
          route="map"
          assemblyLabel={currentAssemblyLabel}
          onHome={navigateHome}
        />
        <main className="app-shell">
          <HexmapPage
            manifest={manifest}
            accountabilitySummary={accountabilitySummary}
            memberAssetsIndex={memberAssetsIndex}
            memberAssetsIndexError={memberAssetsIndexError}
            assemblyLabel={currentAssemblyLabel}
            initialProvince={routeState.mapProvince}
            initialDistrict={routeState.mapDistrict}
            initialMetric={routeState.mapMetric}
            onNavigateToMember={navigateToCalendar}
            onChangeRoute={navigateToMap}
          />
        </main>
      </>
    );
  }


  return (
    <>
      <GlobalNav
        route="home"
        assemblyLabel={currentAssemblyLabel}
        onHome={navigateHome}
        onNavigate={handleNavNavigate}
      />
      <main className="app-shell">
        <section className="hero-panel">
          <div className="hero-panel__masthead">
            <div className="hero-panel__context">
              <p className="section-label">국회 책임성 모니터</p>
              <div className="hero-panel__chips">
                <span className="context-chip">{currentAssemblyLabel}</span>
                <span className="context-chip">공개 기록표결 기준</span>
              </div>
            </div>
            <span className="freshness-indicator">
              {freshnessText}
            </span>
          </div>
          <div className="hero-panel__headline">
            <h1>국회 책임성 모니터</h1>
            <p className="hero-panel__lede">
              공개 기록표결 기준으로 의원 활동을 추적합니다.
            </p>
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

        <section className="search-panel">
          <div className="search-panel__layout">
            <div className="search-panel__command">
              <p className="section-label">의원 직접 검색</p>
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
            <aside className="search-panel__explore" aria-label="분포 탐색">
              <p className="section-label">전체 분포</p>
              <p className="search-panel__explore-copy">
                정당 평균과 함께 전체 위치를 먼저 훑어볼 수 있습니다.
              </p>
              <button
                type="button"
                className="search-panel__explore-action"
                onClick={() => navigateToDistribution()}
              >
                국회 전체 분포 보기
              </button>
              <ul className="search-panel__browse-list">
                {homeBehaviorSummaries.map((summary) => (
                  <li key={summary.key}>
                    <button
                      type="button"
                      className="search-panel__browse-button"
                      aria-label={summary.ctaLabel}
                      onClick={() => navigateToDistribution(null, summary.key)}
                      disabled={summary.count === 0}
                    >
                      <strong>{summary.label}</strong>
                      <small>{`${formatNumber(summary.count)}명`}</small>
                    </button>
                  </li>
                ))}
              </ul>
            </aside>
          </div>
        </section>

        {accountabilitySummary ? (
          <AccountabilityLeaderboard
            items={accountabilitySummary.items}
            assemblyLabel={currentAssemblyLabel}
            attendanceByMemberId={leaderboardAttendanceByMemberId}
            assetItems={leaderboardAssetItems}
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

        <DistributionConstituencyMap
          manifest={manifest}
          members={distributionMembers}
          highlightedMemberIds={new Set(distributionMembers.map((m) => m.memberId))}
          selectedMemberId={combinedRankingItems[0]?.memberId ?? null}
          onSelectMember={(memberId) => navigateToCalendar(memberId)}
        />

        <footer className="info-panel">
          <p className="info-panel__body">
            {`${currentAssemblyLabel} 공개 기록표결 기준, 현직 의원만 집계합니다. 데이터는 평일 하루 3회 갱신됩니다.`}
          </p>
        </footer>
      </main>
    </>
  );
}
