export type MapMetric = "absence" | "negative" | "assetTotal";

export type MapRouteArgs = {
  province?: string | null;
  district?: string | null;
  metric?: MapMetric | null;
};

export type ParsedMapRoute = {
  province: string | null;
  district: string | null;
  metric: MapMetric;
};

export function isMapMetric(value: string | null | undefined): value is MapMetric {
  return value === "absence" || value === "negative" || value === "assetTotal";
}

export function parseMapRoute(input: URLSearchParams | string): ParsedMapRoute {
  const params = input instanceof URLSearchParams ? input : new URLSearchParams(input);
  const rawMetric = params.get("metric");

  return {
    province: params.get("province"),
    district: params.get("district"),
    metric: isMapMetric(rawMetric) ? rawMetric : "absence"
  };
}

export function buildMapHash({
  province,
  district,
  metric
}: MapRouteArgs = {}): string {
  const params = new URLSearchParams();
  if (district) {
    params.set("district", district);
  } else if (province) {
    params.set("province", province);
  }
  if (metric && metric !== "absence") {
    params.set("metric", metric);
  }
  const query = params.toString();
  return query ? `map?${query}` : "map";
}

export function buildMapHref(args: MapRouteArgs): string {
  return `#${buildMapHash(args)}`;
}
