const CLOUDFLARE_WEB_ANALYTICS_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,80}$/;
const CLOUDFLARE_BEACON_URL =
  "https://static.cloudflareinsights.com/beacon.min.js";
const ANALYTICS_SCRIPT_ATTRIBUTE = "data-lawmaker-monitor-analytics";

export function normalizeCloudflareWebAnalyticsToken(
  token: string | null | undefined
): string | null {
  const normalized = token?.trim() ?? "";
  return CLOUDFLARE_WEB_ANALYTICS_TOKEN_PATTERN.test(normalized)
    ? normalized
    : null;
}

export function isAnalyticsHostAllowed(
  hostname: string | null | undefined,
  allowedHosts: string | null | undefined
): boolean {
  const normalizedHostname = hostname?.trim().toLowerCase() ?? "";
  if (!normalizedHostname) {
    return false;
  }

  return (allowedHosts?.split(",") ?? []).some(
    (allowedHost) => allowedHost.trim().toLowerCase() === normalizedHostname
  );
}

export function initializeCloudflareWebAnalytics({
  token,
  allowedHosts,
  windowRef = window,
  documentRef = document
}: {
  token: string | null | undefined;
  allowedHosts: string | null | undefined;
  windowRef?: Window;
  documentRef?: Document;
}): boolean {
  const normalizedToken = normalizeCloudflareWebAnalyticsToken(token);
  if (
    !normalizedToken ||
    !isAnalyticsHostAllowed(windowRef.location.hostname, allowedHosts)
  ) {
    return false;
  }

  if (
    documentRef.querySelector(
      `script[${ANALYTICS_SCRIPT_ATTRIBUTE}="cloudflare"]`
    )
  ) {
    return true;
  }

  const script = documentRef.createElement("script");
  script.defer = true;
  script.src = CLOUDFLARE_BEACON_URL;
  script.setAttribute(ANALYTICS_SCRIPT_ATTRIBUTE, "cloudflare");
  script.setAttribute(
    "data-cf-beacon",
    JSON.stringify({ token: normalizedToken })
  );
  documentRef.head.append(script);

  return true;
}
