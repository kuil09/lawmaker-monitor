import { lazy, Suspense, useMemo } from "react";

import { ActivityCalendarPage } from "../components/ActivityCalendarPage.js";
import { useActivityCalendarData } from "../hooks/useActivityCalendarData.js";
import { useAppBootstrapData } from "../hooks/useAppBootstrapData.js";
import { useHashRoute } from "../hooks/useHashRoute.js";
import { useMemberAssetsData } from "../hooks/useMemberAssetsData.js";
import { applyMemberAssetsIndexFallbacks } from "../lib/member-assets.js";

import type {
  AccountabilitySummaryExport,
  Manifest
} from "@lawmaker-monitor/schemas";

const DistributionPage = lazy(async () => {
  const module = await import("../components/DistributionPage.js");
  return { default: module.DistributionPage };
});

const HexmapPage = lazy(async () => {
  const module = await import("../components/HexmapPage.js");
  return { default: module.HexmapPage };
});

const VotesPage = lazy(async () => {
  const module = await import("../components/VotesPage.js");
  return { default: module.VotesPage };
});

const TrendsPage = lazy(async () => {
  const module = await import("../components/TrendsPage.js");
  return { default: module.TrendsPage };
});

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
        <p className="v2-route-loading__copy">화면을 준비하고 있습니다.</p>
      </section>
    </main>
  );
}

export function V2RouteContent() {
  const {
    routeState,
    navigateHome,
    navigateToCalendar,
    navigateToDistribution,
    navigateToMap
  } = useHashRoute();
  const {
    latestVotes,
    voteMinutesOpinions,
    accountabilitySummary,
    accountabilityTrends,
    billProposalActivity,
    billProposalActivityLoaded,
    manifest,
    feedError,
    leaderboardError,
    billProposalActivityError
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
  const currentAssemblyLabel = buildCurrentAssemblyLabel({
    accountabilitySummary,
    latestVotes,
    activityCalendar: activityCalendarState.activityCalendar,
    manifest
  });
  const resolvedMemberAssetsIndex = useMemo(
    () =>
      applyMemberAssetsIndexFallbacks(
        memberAssetsState.memberAssetsIndex,
        memberAssetsState.memberAssetHistories
      ),
    [
      memberAssetsState.memberAssetHistories,
      memberAssetsState.memberAssetsIndex
    ]
  );
  const distributionErrors = useMemo(
    () =>
      [leaderboardError, activityCalendarState.activityError].filter(
        Boolean
      ) as string[],
    [activityCalendarState.activityError, leaderboardError]
  );
  if (routeState.route === "distribution") {
    return (
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
    );
  }

  if (routeState.route === "calendar") {
    return (
      <main className="app-shell">
        <ActivityCalendarPage
          activityCalendar={activityCalendarState.activityCalendar}
          loading={activityCalendarState.isActivityLoading}
          error={activityCalendarState.activityError}
          initialMemberId={routeState.memberId}
          initialCompareMemberId={routeState.compareMemberId}
          initialView={routeState.view}
          accountabilitySummary={accountabilitySummary}
          accountabilityTrends={accountabilityTrends}
          billProposalActivity={billProposalActivity}
          billProposalActivityLoaded={billProposalActivityLoaded}
          billProposalActivityError={billProposalActivityError}
          memberDetails={activityCalendarState.activityMemberDetails}
          memberDetailErrors={activityCalendarState.activityMemberDetailErrors}
          memberDetailLoading={
            activityCalendarState.activityMemberDetailLoading
          }
          memberAssetsIndex={memberAssetsState.memberAssetsIndex}
          memberAssetsIndexError={memberAssetsState.memberAssetsIndexError}
          memberAssetHistories={memberAssetsState.memberAssetHistories}
          memberAssetHistoryErrors={memberAssetsState.memberAssetHistoryErrors}
          memberAssetHistoryLoading={
            memberAssetsState.memberAssetHistoryLoading
          }
          onEnsureMemberDetail={
            activityCalendarState.ensureActivityMemberDetailLoaded
          }
          onRetryMemberDetail={activityCalendarState.retryActivityMemberDetail}
          onEnsureMemberAssetHistory={
            memberAssetsState.ensureMemberAssetHistoryLoaded
          }
          onRetryMemberAssetHistory={memberAssetsState.retryMemberAssetHistory}
          onRetry={() =>
            void activityCalendarState.ensureActivityCalendarLoaded()
          }
        />
      </main>
    );
  }

  if (routeState.route === "votes") {
    return (
      <Suspense fallback={<RouteLoadingFallback title="최근 표결" />}>
        <VotesPage
          latestVotes={latestVotes}
          voteMinutesOpinions={voteMinutesOpinions}
          memberDirectory={accountabilitySummary?.items ?? []}
          loading={!latestVotes && !feedError}
          unavailable={Boolean(feedError)}
          assemblyLabel={currentAssemblyLabel}
        />
      </Suspense>
    );
  }

  if (routeState.route === "trends") {
    return (
      <Suspense fallback={<RouteLoadingFallback title="출석 추이" />}>
        <TrendsPage
          accountabilityTrends={accountabilityTrends}
          accountabilitySummary={accountabilitySummary}
          billProposalActivity={billProposalActivity}
          assemblyLabel={currentAssemblyLabel}
        />
      </Suspense>
    );
  }

  if (routeState.route === "map") {
    return (
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
    );
  }

  return null;
}
