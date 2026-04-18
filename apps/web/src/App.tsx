import { lazy, Suspense, useMemo, useState } from "react";

import { AccountabilityLeaderboard } from "./components/AccountabilityLeaderboard.js";
import { ActivityCalendarPage } from "./components/ActivityCalendarPage.js";
import { GlobalNav } from "./components/GlobalNav.js";
import { HomePage } from "./components/HomePage.js";
import { useActivityCalendarData } from "./hooks/useActivityCalendarData.js";
import { useAppBootstrapData } from "./hooks/useAppBootstrapData.js";
import { useHashRoute } from "./hooks/useHashRoute.js";
import { useMemberAssetsData } from "./hooks/useMemberAssetsData.js";
import { rankAccountabilityItems } from "./lib/accountability.js";
import {
  buildDistributionBehaviorSummaries,
  buildDistributionMembers
} from "./lib/distribution.js";
import { formatDateTime } from "./lib/format.js";
import { getMemberAttendanceSummary } from "./lib/member-activity.js";
import {
  applyMemberAssetsIndexRealEstateFallbacks,
  buildLatestAssetAllocationSummary,
  getLatestRealEstateTotalFromHistory
} from "./lib/member-assets.js";

import type {
  AccountabilitySummaryExport,
  MemberAssetsHistoryExport,
  MemberAssetsIndexExport,
  Manifest
} from "@lawmaker-monitor/schemas";

const DistributionPage = lazy(async () => {
  const module = await import("./components/DistributionPage.js");
  return { default: module.DistributionPage };
});

const HexmapPage = lazy(async () => {
  const module = await import("./components/HexmapPage.js");
  return { default: module.HexmapPage };
});

const VotesPage = lazy(async () => {
  const module = await import("./components/VotesPage.js");
  return { default: module.VotesPage };
});

const TrendsPage = lazy(async () => {
  const module = await import("./components/TrendsPage.js");
  return { default: module.TrendsPage };
});

type LeaderboardAssetItem =
  NonNullable<MemberAssetsIndexExport>["members"][number] & {
    assetAllocation?:
      | Exclude<ReturnType<typeof buildLatestAssetAllocationSummary>, null>
      | undefined;
  };

function buildLeaderboardAssetItems(args: {
  accountabilitySummary: AccountabilitySummaryExport | null;
  memberAssetsIndex: MemberAssetsIndexExport | null;
  memberAssetHistories: Record<string, MemberAssetsHistoryExport | undefined>;
}): LeaderboardAssetItem[] {
  const accountabilityItemsByMemberId = new Map(
    (args.accountabilitySummary?.items ?? []).map(
      (item) => [item.memberId, item] as const
    )
  );

  return (args.memberAssetsIndex?.members ?? []).map((item) => {
    const accountabilityItem = accountabilityItemsByMemberId.get(item.memberId);

    return {
      ...item,
      photoUrl: item.photoUrl ?? accountabilityItem?.photoUrl ?? null,
      officialProfileUrl:
        item.officialProfileUrl ??
        accountabilityItem?.officialProfileUrl ??
        null,
      officialExternalUrl:
        item.officialExternalUrl ??
        accountabilityItem?.officialExternalUrl ??
        null,
      latestRealEstateTotal:
        item.latestRealEstateTotal ??
        getLatestRealEstateTotalFromHistory(
          args.memberAssetHistories[item.memberId] ?? null
        ) ??
        undefined,
      assetAllocation:
        buildLatestAssetAllocationSummary(
          args.memberAssetHistories[item.memberId] ?? null
        ) ?? undefined
    };
  });
}

function buildCurrentAssemblyLabel(args: {
  accountabilitySummary: AccountabilitySummaryExport | null;
  latestVotes: ReturnType<typeof useAppBootstrapData>["latestVotes"];
  activityCalendar: ReturnType<
    typeof useActivityCalendarData
  >["activityCalendar"];
  manifest: Manifest | null;
}): string {
  return (
    args.accountabilitySummary?.assemblyLabel ??
    args.latestVotes?.assemblyLabel ??
    args.activityCalendar?.assemblyLabel ??
    args.manifest?.currentAssembly.label ??
    "최신 국회"
  );
}

function RouteLoadingFallback({ title }: { title: string }) {
  return (
    <main className="app-shell">
      <section className="feed-panel">
        <p className="section-label">{title}</p>
        <p className="leaderboard-panel__copy">화면을 준비하고 있습니다.</p>
      </section>
    </main>
  );
}

export default function App() {
  const {
    routeState,
    navigateHome,
    navigateToCalendar,
    navigateToDistribution,
    navigateToVotes,
    navigateToTrends,
    navigateToMap
  } = useHashRoute();
  const {
    latestVotes,
    accountabilitySummary,
    accountabilityTrends,
    manifest,
    feedError,
    leaderboardError
  } = useAppBootstrapData();
  const shouldLoadActivityCalendar =
    routeState.route === "calendar" ||
    routeState.route === "distribution" ||
    Boolean(accountabilitySummary);
  const activityCalendarState = useActivityCalendarData({
    manifest,
    shouldLoad: shouldLoadActivityCalendar
  });
  const memberAssetsState = useMemberAssetsData({
    manifest,
    routeState
  });
  const [selectedSearchMemberId, setSelectedSearchMemberId] = useState<
    string | null
  >(null);

  const currentAssemblyLabel = buildCurrentAssemblyLabel({
    accountabilitySummary,
    latestVotes,
    activityCalendar: activityCalendarState.activityCalendar,
    manifest
  });
  const updatedAt =
    manifest?.updatedAt ??
    latestVotes?.generatedAt ??
    accountabilitySummary?.generatedAt;
  const freshnessText = updatedAt
    ? `최종 갱신 ${formatDateTime(updatedAt)}`
    : "최종 갱신 정보 확인 중";

  const combinedRankingItems = useMemo(
    () =>
      accountabilitySummary
        ? rankAccountabilityItems(accountabilitySummary.items, "combined")
        : [],
    [accountabilitySummary]
  );
  const leaderboardAttendanceByMemberId = useMemo(
    () =>
      new Map(
        (activityCalendarState.activityCalendar?.assembly.members ?? []).map(
          (member) => [member.memberId, getMemberAttendanceSummary(member)]
        )
      ),
    [activityCalendarState.activityCalendar]
  );
  const distributionMembers = useMemo(
    () =>
      accountabilitySummary && activityCalendarState.activityCalendar
        ? buildDistributionMembers(
            accountabilitySummary,
            activityCalendarState.activityCalendar
          )
        : [],
    [accountabilitySummary, activityCalendarState.activityCalendar]
  );
  const resolvedMemberAssetsIndex = useMemo(
    () =>
      applyMemberAssetsIndexRealEstateFallbacks(
        memberAssetsState.memberAssetsIndex,
        memberAssetsState.memberAssetHistories
      ),
    [
      memberAssetsState.memberAssetHistories,
      memberAssetsState.memberAssetsIndex
    ]
  );
  const leaderboardAssetItems = useMemo(
    () =>
      buildLeaderboardAssetItems({
        accountabilitySummary,
        memberAssetsIndex: memberAssetsState.memberAssetsIndex,
        memberAssetHistories: memberAssetsState.memberAssetHistories
      }),
    [
      accountabilitySummary,
      memberAssetsState.memberAssetHistories,
      memberAssetsState.memberAssetsIndex
    ]
  );
  const homeBehaviorSummaries = useMemo(
    () => buildDistributionBehaviorSummaries(distributionMembers),
    [distributionMembers]
  );
  const homeSearchOptions = useMemo(
    () =>
      combinedRankingItems.map((item) => ({
        id: item.memberId,
        label: `${item.name} · ${item.party}`
      })),
    [combinedRankingItems]
  );
  const homeStatusMessages = useMemo(
    () =>
      [
        leaderboardError
          ? "책임성 랭킹 데이터를 확인하지 못해 일부 비교 요소가 비활성화되었습니다."
          : null,
        activityCalendarState.activityError && accountabilitySummary
          ? "활동 캘린더 데이터를 확인하지 못해 랭킹 출석 요약이 일부 비어 있습니다."
          : null
      ].filter(Boolean) as string[],
    [
      activityCalendarState.activityError,
      accountabilitySummary,
      leaderboardError
    ]
  );
  const distributionErrors = useMemo(
    () =>
      [leaderboardError, activityCalendarState.activityError].filter(
        Boolean
      ) as string[],
    [activityCalendarState.activityError, leaderboardError]
  );
  const calendarMemberName =
    routeState.route === "calendar" &&
    routeState.memberId &&
    activityCalendarState.activityCalendar
      ? (activityCalendarState.activityCalendar.assembly.members.find(
          (member) => member.memberId === routeState.memberId
        )?.name ?? null)
      : null;

  function handleNavNavigate(target: "votes" | "trends" | "map"): void {
    if (target === "votes") {
      navigateToVotes();
      return;
    }

    if (target === "trends") {
      navigateToTrends();
      return;
    }

    navigateToMap();
  }

  const homeLeaderboardContent = accountabilitySummary ? (
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
  );

  if (routeState.route === "distribution") {
    return (
      <>
        <GlobalNav
          route="distribution"
          assemblyLabel={currentAssemblyLabel}
          onHome={navigateHome}
        />
        <Suspense fallback={<RouteLoadingFallback title="전체 분포" />}>
          <DistributionPage
            accountabilitySummary={accountabilitySummary}
            activityCalendar={activityCalendarState.activityCalendar}
            loading={
              (!accountabilitySummary && !leaderboardError) ||
              (!activityCalendarState.activityCalendar &&
                !activityCalendarState.activityError)
            }
            errors={distributionErrors}
            assemblyLabel={currentAssemblyLabel}
            initialMemberId={routeState.memberId}
            initialBehaviorFilter={routeState.behaviorFilter}
            onBack={navigateHome}
            onSelectMember={(memberId, behaviorFilter) => {
              navigateToDistribution(
                memberId,
                behaviorFilter === undefined
                  ? routeState.behaviorFilter
                  : behaviorFilter
              );
            }}
            onSelectBehaviorFilter={(behaviorFilter, memberId) => {
              navigateToDistribution(
                memberId === undefined ? routeState.memberId : memberId,
                behaviorFilter
              );
            }}
          />
        </Suspense>
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
            activityCalendar={activityCalendarState.activityCalendar}
            loading={activityCalendarState.isActivityLoading}
            error={activityCalendarState.activityError}
            assemblyLabel={currentAssemblyLabel}
            initialMemberId={routeState.memberId}
            initialCompareMemberId={routeState.compareMemberId}
            initialView={routeState.view}
            memberDetails={activityCalendarState.activityMemberDetails}
            memberDetailErrors={
              activityCalendarState.activityMemberDetailErrors
            }
            memberDetailLoading={
              activityCalendarState.activityMemberDetailLoading
            }
            memberAssetsIndex={memberAssetsState.memberAssetsIndex}
            memberAssetsIndexError={memberAssetsState.memberAssetsIndexError}
            memberAssetHistories={memberAssetsState.memberAssetHistories}
            memberAssetHistoryErrors={
              memberAssetsState.memberAssetHistoryErrors
            }
            memberAssetHistoryLoading={
              memberAssetsState.memberAssetHistoryLoading
            }
            onEnsureMemberDetail={
              activityCalendarState.ensureActivityMemberDetailLoaded
            }
            onRetryMemberDetail={
              activityCalendarState.retryActivityMemberDetail
            }
            onEnsureMemberAssetHistory={
              memberAssetsState.ensureMemberAssetHistoryLoaded
            }
            onRetryMemberAssetHistory={
              memberAssetsState.retryMemberAssetHistory
            }
            onBack={navigateHome}
            onRetry={() =>
              void activityCalendarState.ensureActivityCalendarLoaded()
            }
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
        <Suspense fallback={<RouteLoadingFallback title="최근 표결" />}>
          <VotesPage
            latestVotes={latestVotes}
            loading={!latestVotes && !feedError}
            unavailable={Boolean(feedError)}
            assemblyLabel={currentAssemblyLabel}
          />
        </Suspense>
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
        <Suspense fallback={<RouteLoadingFallback title="출석 추이" />}>
          <TrendsPage
            accountabilityTrends={accountabilityTrends}
            assemblyLabel={currentAssemblyLabel}
          />
        </Suspense>
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
        <Suspense fallback={<RouteLoadingFallback title="지도" />}>
          <HexmapPage
            manifest={manifest}
            accountabilitySummary={accountabilitySummary}
            memberAssetsIndex={resolvedMemberAssetsIndex}
            memberAssetsIndexError={memberAssetsState.memberAssetsIndexError}
            assemblyLabel={currentAssemblyLabel}
            initialProvince={routeState.province}
            initialDistrict={routeState.district}
            initialMetric={routeState.metric}
            onNavigateToMember={navigateToCalendar}
            onChangeRoute={navigateToMap}
          />
        </Suspense>
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
      <HomePage
        currentAssemblyLabel={currentAssemblyLabel}
        freshnessText={freshnessText}
        homeStatusMessages={homeStatusMessages}
        homeSearchOptions={homeSearchOptions}
        homeBehaviorSummaries={homeBehaviorSummaries}
        selectedSearchMemberId={selectedSearchMemberId}
        onSelectSearchMemberId={setSelectedSearchMemberId}
        onSubmitSearch={() => {
          if (!selectedSearchMemberId) {
            return;
          }

          navigateToCalendar(selectedSearchMemberId);
        }}
        onOpenDistribution={() => navigateToDistribution()}
        onOpenDistributionBehavior={(behaviorFilter) =>
          navigateToDistribution(null, behaviorFilter)
        }
        leaderboardContent={homeLeaderboardContent}
      />
    </>
  );
}
