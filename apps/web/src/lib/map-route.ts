export type MapMetric = "absence" | "negative";

export function isMapMetric(value: string | null | undefined): value is MapMetric {
  return value === "absence" || value === "negative";
}

export function buildMapHash({
  province,
  metric
}: {
  province?: string | null;
  metric?: MapMetric | null;
} = {}): string {
  const params = new URLSearchParams();
  if (province) params.set("province", province);
  if (metric && metric !== "absence") params.set("metric", metric);
  const query = params.toString();
  return query ? `map?${query}` : "map";
}

export function buildMapHref(args: Parameters<typeof buildMapHash>[0]): string {
  return `#${buildMapHash(args)}`;
}
