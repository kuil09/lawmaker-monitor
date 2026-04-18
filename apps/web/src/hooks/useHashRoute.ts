import { startTransition, useCallback, useEffect, useState } from "react";

import {
  buildHashForRoute,
  getInitialRouteState,
  parseHashRoute
} from "../lib/route-state.js";

import type { ActivityViewMode } from "../lib/calendar-route.js";
import type { DistributionBehaviorFilter } from "../lib/distribution.js";
import type { NavigateToMapArgs, RouteState } from "../lib/route-state.js";

function applyHashRoute(routeState: RouteState): void {
  if (typeof window === "undefined") {
    return;
  }

  window.location.hash = buildHashForRoute(routeState);
}

export function useHashRoute() {
  const [routeState, setRouteState] = useState<RouteState>(() =>
    getInitialRouteState()
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleHashChange = () => {
      startTransition(() => {
        setRouteState(parseHashRoute(window.location.hash));
      });
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  const navigate = useCallback((nextRoute: RouteState) => {
    applyHashRoute(nextRoute);
  }, []);

  const navigateHome = useCallback(() => {
    navigate({ route: "home" });
  }, [navigate]);

  const navigateToCalendar = useCallback(
    (memberId?: string | null, view: ActivityViewMode = "single") => {
      navigate({
        route: "calendar",
        memberId: memberId ?? null,
        compareMemberId: null,
        view
      });
    },
    [navigate]
  );

  const navigateToDistribution = useCallback(
    (
      memberId?: string | null,
      behaviorFilter?: DistributionBehaviorFilter | null
    ) => {
      navigate({
        route: "distribution",
        memberId: memberId ?? null,
        behaviorFilter: behaviorFilter ?? null
      });
    },
    [navigate]
  );

  const navigateToVotes = useCallback(() => {
    navigate({ route: "votes" });
  }, [navigate]);

  const navigateToTrends = useCallback(() => {
    navigate({ route: "trends" });
  }, [navigate]);

  const navigateToMap = useCallback(
    (args: NavigateToMapArgs = {}) => {
      navigate({
        route: "map",
        province: args.province ?? null,
        district: args.district ?? null,
        metric: args.metric ?? "absence"
      });
    },
    [navigate]
  );

  return {
    routeState,
    navigate,
    navigateHome,
    navigateToCalendar,
    navigateToDistribution,
    navigateToVotes,
    navigateToTrends,
    navigateToMap
  };
}
