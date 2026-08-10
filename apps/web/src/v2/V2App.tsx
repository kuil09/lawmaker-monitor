import { useEffect, useMemo, useRef, useState } from "react";

import { V2GlobalNav } from "./V2GlobalNav.js";
import { V2ObservatoryPage } from "./V2ObservatoryPage.js";
import { V2RouteContent } from "./V2RouteContent.js";
import { AnalyticsConsentControl } from "../components/AnalyticsConsentControl.js";
import { WatchQueueVisualFilters } from "../components/WatchQueueVisualFilters.js";
import { useActivityCalendarData } from "../hooks/useActivityCalendarData.js";
import { useAppBootstrapData } from "../hooks/useAppBootstrapData.js";
import { useHashRoute } from "../hooks/useHashRoute.js";
import { useMemberAssetsData } from "../hooks/useMemberAssetsData.js";
import { loadAccountabilitySummary } from "../lib/data.js";
import { buildDistributionMembers } from "../lib/distribution.js";
import { formatDateTime } from "../lib/format.js";
import { formatMemberAffiliation } from "../lib/member-affiliation.js";
import { applyMemberAssetsIndexFallbacks } from "../lib/member-assets.js";
import "../styles/v3-shell.css";

import type { MemberSearchOption } from "../components/MemberSearchField.js";
import type { AnalyticsConsent } from "../lib/analytics.js";
import type { MapMetric } from "../lib/map-route.js";
import type { RouteState } from "../lib/route-state.js";
import type {
  AccountabilitySummaryExport,
  Manifest,
  MemberActivityCalendarExport
} from "@lawmaker-monitor/schemas";

type V2Routing = ReturnType<typeof useHashRoute>;

function buildAssemblyLabel(args: {
  accountabilitySummary: AccountabilitySummaryExport | null;
  activityCalendar: MemberActivityCalendarExport | null;
  manifest: Manifest | null;
}): string {
  return (
    args.accountabilitySummary?.assemblyLabel ??
    args.activityCalendar?.assemblyLabel ??
    args.manifest?.currentAssembly.label ??
    "최신 국회"
  );
}

function navigateFromV2(
  routing: V2Routing,
  target: Exclude<RouteState["route"], "home">
) {
  switch (target) {
    case "calendar":
      routing.navigateToCalendar();
      return;
    case "distribution":
      routing.navigateToDistribution();
      return;
    case "votes":
      routing.navigateToVotes();
      return;
    case "trends":
      routing.navigateToTrends();
      return;
    case "map":
      routing.navigateToMap();
  }
}

function useRouteAccessibility(route: RouteState) {
  const previousRouteRef = useRef<RouteState["route"] | null>(null);

  useEffect(() => {
    const pageLabel =
      route.route === "home"
        ? "국회 출석부"
        : route.route === "calendar"
          ? "의원 대장"
          : route.route === "distribution"
            ? "의원 대장"
            : route.route === "votes"
              ? "쟁점·표결"
              : route.route === "trends"
                ? "변화 전후"
                : "지역 감시";

    document.title = `${pageLabel} · 국회 출석부`;
    const shouldMoveFocus =
      previousRouteRef.current !== null &&
      previousRouteRef.current !== route.route;
    previousRouteRef.current = route.route;

    if (!shouldMoveFocus) {
      return;
    }

    let observer: MutationObserver | null = null;
    let timeoutId: number | null = null;
    const focusHeading = () => {
      const heading = document.querySelector<HTMLElement>(
        "#v2-main-content h1, #v2-main-content [data-route-heading]"
      );
      if (!heading) {
        return false;
      }

      if (!heading.hasAttribute("tabindex")) {
        heading.setAttribute("tabindex", "-1");
      }
      heading.focus({ preventScroll: true });
      return true;
    };
    const frame = window.requestAnimationFrame(() => {
      if (focusHeading()) {
        return;
      }

      const routeContent = document.querySelector("#v2-main-content");
      if (!routeContent) {
        return;
      }

      observer = new MutationObserver(() => {
        if (focusHeading()) {
          observer?.disconnect();
        }
      });
      observer.observe(routeContent, { childList: true, subtree: true });
      timeoutId = window.setTimeout(() => observer?.disconnect(), 2_000);
    });

    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [route]);
}

function V2HomeExperience({ routing }: { routing: V2Routing }) {
  const {
    accountabilitySummary,
    accountabilityTrends,
    billProposalActivity,
    billProposalActivityLoaded,
    manifest,
    leaderboardError,
    trendsError,
    billProposalActivityError
  } = useAppBootstrapData();
  const activityCalendarState = useActivityCalendarData({
    manifest,
    shouldLoad: true
  });
  const memberAssetsState = useMemberAssetsData({
    manifest,
    routeState: routing.routeState
  });

  const currentAssemblyLabel = buildAssemblyLabel({
    accountabilitySummary,
    activityCalendar: activityCalendarState.activityCalendar,
    manifest
  });
  const updatedAt =
    manifest?.updatedAt ??
    accountabilitySummary?.generatedAt ??
    activityCalendarState.activityCalendar?.generatedAt;
  const freshnessText = updatedAt
    ? formatDateTime(updatedAt)
    : "갱신 정보 확인 중";
  const members = useMemo(
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
      applyMemberAssetsIndexFallbacks(
        memberAssetsState.memberAssetsIndex,
        memberAssetsState.memberAssetHistories
      ),
    [
      memberAssetsState.memberAssetHistories,
      memberAssetsState.memberAssetsIndex
    ]
  );
  const errors = useMemo(
    () =>
      [
        leaderboardError,
        activityCalendarState.activityError,
        trendsError,
        memberAssetsState.memberAssetsIndexError
      ].filter(Boolean) as string[],
    [
      activityCalendarState.activityError,
      leaderboardError,
      memberAssetsState.memberAssetsIndexError,
      trendsError
    ]
  );

  return (
    <V2ObservatoryPage
      assemblyLabel={currentAssemblyLabel}
      freshnessText={freshnessText}
      manifest={manifest}
      accountabilitySummary={accountabilitySummary}
      members={members}
      activityCalendar={activityCalendarState.activityCalendar}
      accountabilityTrends={accountabilityTrends}
      memberAssetsIndex={resolvedMemberAssetsIndex}
      billProposalActivity={billProposalActivity}
      billProposalActivityLoading={!billProposalActivityLoaded}
      billProposalActivityError={billProposalActivityError}
      loading={
        (!accountabilitySummary && !leaderboardError) ||
        (!activityCalendarState.activityCalendar &&
          !activityCalendarState.activityError)
      }
      errors={errors}
      onOpenMap={(metric: MapMetric) => routing.navigateToMap({ metric })}
      onOpenDistribution={routing.navigateToDistribution}
      onOpenMember={routing.navigateToCalendar}
    />
  );
}

function V2EvidenceRouteExperience() {
  return (
    <div className="v2-route-content" id="v2-main-content">
      <V2RouteContent />
    </div>
  );
}

export function V2App({
  analyticsEnabled = false,
  initialAnalyticsConsent = null
}: {
  analyticsEnabled?: boolean;
  initialAnalyticsConsent?: AnalyticsConsent | null;
}) {
  const routing = useHashRoute();
  const [accountabilitySummary, setAccountabilitySummary] =
    useState<AccountabilitySummaryExport | null>(null);
  const [selectedSearchMemberId, setSelectedSearchMemberId] = useState<
    string | null
  >(null);
  useRouteAccessibility(routing.routeState);

  useEffect(() => {
    let active = true;
    void loadAccountabilitySummary()
      .then((payload) => {
        if (active) {
          setAccountabilitySummary(payload);
        }
      })
      .catch(() => {
        if (active) {
          setAccountabilitySummary(null);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const searchOptions = useMemo<MemberSearchOption[]>(
    () =>
      (accountabilitySummary?.items ?? []).map((item) => ({
        id: item.memberId,
        label: `${item.name} · ${formatMemberAffiliation(
          item.party,
          item.district
        )}`
      })),
    [accountabilitySummary]
  );
  const selectedSearchMemberName =
    searchOptions
      .find((option) => option.id === selectedSearchMemberId)
      ?.label.split(" · ")[0] ?? null;
  const routedMemberId =
    routing.routeState.route === "calendar" ||
    routing.routeState.route === "distribution"
      ? routing.routeState.memberId
      : null;

  useEffect(() => {
    if (
      routedMemberId &&
      searchOptions.some((option) => option.id === routedMemberId)
    ) {
      setSelectedSearchMemberId(routedMemberId);
    }
  }, [routedMemberId, searchOptions]);

  return (
    <div
      className="v2-app v3-shell watch-queue-shell"
      data-watch-route={routing.routeState.route}
    >
      <WatchQueueVisualFilters />
      <V2GlobalNav
        route={routing.routeState.route}
        assemblyLabel={accountabilitySummary?.assemblyLabel}
        memberName={selectedSearchMemberName}
        searchOptions={searchOptions}
        selectedSearchMemberId={selectedSearchMemberId}
        onHome={routing.navigateHome}
        onNavigate={(target) => navigateFromV2(routing, target)}
        onSelectSearchMemberId={setSelectedSearchMemberId}
        onSubmitSearch={() => {
          if (selectedSearchMemberId) {
            routing.navigateToCalendar(selectedSearchMemberId);
          }
        }}
      />
      {routing.routeState.route === "home" ? (
        <V2HomeExperience routing={routing} />
      ) : (
        <V2EvidenceRouteExperience />
      )}
      {analyticsEnabled ? (
        <AnalyticsConsentControl initialConsent={initialAnalyticsConsent} />
      ) : null}
    </div>
  );
}
