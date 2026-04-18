import { buildCalendarHash, type ActivityViewMode } from "./calendar-route.js";
import { buildDistributionHash } from "./distribution-route.js";
import { isDistributionBehaviorFilter } from "./distribution.js";
import {
  buildMapHash,
  parseMapRoute,
  type MapMetric,
  type MapRouteArgs
} from "./map-route.js";

import type { DistributionBehaviorFilter } from "./distribution.js";

export type RouteState =
  | { route: "home" }
  | {
      route: "calendar";
      memberId: string | null;
      compareMemberId: string | null;
      view: ActivityViewMode;
    }
  | {
      route: "distribution";
      memberId: string | null;
      behaviorFilter: DistributionBehaviorFilter | null;
    }
  | { route: "votes" }
  | { route: "trends" }
  | {
      route: "map";
      province: string | null;
      district: string | null;
      metric: MapMetric;
    };

export function parseHashRoute(hash: string): RouteState {
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
    const rawBehaviorFilter = params.get("behavior");
    return {
      route: "distribution",
      memberId: params.get("member"),
      behaviorFilter: isDistributionBehaviorFilter(rawBehaviorFilter)
        ? rawBehaviorFilter
        : null
    };
  }

  if (path === "votes") {
    return { route: "votes" };
  }

  if (path === "trends") {
    return { route: "trends" };
  }

  if (path === "map") {
    const mapRoute = parseMapRoute(params);
    return {
      route: "map",
      province: mapRoute.province,
      district: mapRoute.district,
      metric: mapRoute.metric
    };
  }

  return { route: "home" };
}

export function buildHashForRoute(routeState: RouteState): string {
  switch (routeState.route) {
    case "home":
      return "";
    case "calendar":
      return buildCalendarHash({
        memberId: routeState.memberId,
        compareMemberId: routeState.compareMemberId,
        view: routeState.view
      });
    case "distribution":
      return buildDistributionHash({
        memberId: routeState.memberId,
        behaviorFilter: routeState.behaviorFilter
      });
    case "votes":
      return "votes";
    case "trends":
      return "trends";
    case "map":
      return buildMapHash({
        province: routeState.province,
        district: routeState.district,
        metric: routeState.metric
      });
  }
}

export function getInitialRouteState(): RouteState {
  if (typeof window === "undefined") {
    return { route: "home" };
  }

  return parseHashRoute(window.location.hash);
}

export type NavigateToMapArgs = MapRouteArgs;
