const GA_MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]+$/;
const ANALYTICS_SCRIPT_ATTRIBUTE = "data-lawmaker-monitor-analytics";
const ANALYTICS_CLEANUP_KEY = "__lawmakerMonitorAnalyticsCleanup";
const CAMPAIGN_PARAMETER_PREFIX = "utm_";
const ROUTE_IDENTIFIER_PARAMETERS: Record<string, readonly string[]> = {
  calendar: ["member", "compare"],
  distribution: ["member"],
  map: ["district", "province"]
};

type GtagArguments = [command: string, ...parameters: unknown[]];
type Gtag = (...args: GtagArguments) => void;
type DataLayerCommand = GtagArguments | IArguments;

type AnalyticsWindow = Window & {
  dataLayer?: DataLayerCommand[];
  gtag?: Gtag;
  [ANALYTICS_CLEANUP_KEY]?: () => void;
};

export type AnalyticsPage = {
  location: string;
  path: string;
  title: string;
};

const ROUTE_TITLES: Record<string, string> = {
  calendar: "의원 활동",
  distribution: "의원 대장",
  map: "지역 감시",
  trends: "변화 전후",
  votes: "쟁점·표결"
};

export function normalizeGaMeasurementId(
  measurementId: string | null | undefined
): string | null {
  const normalized = measurementId?.trim().toUpperCase() ?? "";
  return GA_MEASUREMENT_ID_PATTERN.test(normalized) ? normalized : null;
}

function getRouteName(url: URL): string {
  return url.hash.slice(1).split("?")[0]?.trim().toLowerCase() || "home";
}

function buildRouteIdentifierSearch(url: URL, routeName: string): string {
  const searchStart = url.hash.indexOf("?");
  if (searchStart < 0) {
    return "";
  }

  const sourceParameters = new URLSearchParams(url.hash.slice(searchStart + 1));
  const identifierParameters = new URLSearchParams();

  for (const key of ROUTE_IDENTIFIER_PARAMETERS[routeName] ?? []) {
    const value = sourceParameters.get(key)?.trim();
    if (value) {
      identifierParameters.set(key, value);
    }
  }

  const search = identifierParameters.toString();
  return search ? `?${search}` : "";
}

function buildCampaignSearch(searchParams: URLSearchParams): string {
  const campaignParameters = new URLSearchParams();

  for (const [key, value] of searchParams.entries()) {
    if (key.toLowerCase().startsWith(CAMPAIGN_PARAMETER_PREFIX)) {
      campaignParameters.append(key, value);
    }
  }

  const search = campaignParameters.toString();
  return search ? `?${search}` : "";
}

export function buildAnalyticsPage(
  href: string,
  documentTitle = "국회 출석부"
): AnalyticsPage {
  const url = new URL(href);
  const normalizedDocumentTitle = documentTitle.trim() || "국회 출석부";
  const routeName = getRouteName(url);
  const routeIdentifierSearch = buildRouteIdentifierSearch(url, routeName);
  const routeHash =
    routeName === "home" ? "" : `#${routeName}${routeIdentifierSearch}`;
  const campaignSearch = buildCampaignSearch(url.searchParams);
  const path = `${url.pathname}${campaignSearch}${routeHash}`;
  const routeTitle = ROUTE_TITLES[routeName];

  return {
    location: `${url.origin}${path}`,
    path,
    title: routeTitle
      ? `${routeTitle} · ${normalizedDocumentTitle}`
      : normalizedDocumentTitle
  };
}

function createGtag(windowRef: AnalyticsWindow): Gtag {
  windowRef.dataLayer ??= [];
  windowRef.gtag ??= function (..._args: GtagArguments): void {
    // gtag.js requires the native Arguments object used by Google's snippet.
    // eslint-disable-next-line prefer-rest-params
    windowRef.dataLayer?.push(arguments);
  };
  return windowRef.gtag;
}

function appendAnalyticsScript(
  documentRef: Document,
  measurementId: string
): void {
  if (
    documentRef.querySelector(
      `script[${ANALYTICS_SCRIPT_ATTRIBUTE}="${measurementId}"]`
    )
  ) {
    return;
  }

  const script = documentRef.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(
    measurementId
  )}`;
  script.setAttribute(ANALYTICS_SCRIPT_ATTRIBUTE, measurementId);
  documentRef.head.append(script);
}

export function initializeGoogleAnalytics({
  measurementId,
  windowRef = window,
  documentRef = document
}: {
  measurementId: string | null | undefined;
  windowRef?: Window;
  documentRef?: Document;
}): () => void {
  const normalizedMeasurementId = normalizeGaMeasurementId(measurementId);
  if (!normalizedMeasurementId) {
    return () => undefined;
  }

  const analyticsWindow = windowRef as AnalyticsWindow;
  analyticsWindow[ANALYTICS_CLEANUP_KEY]?.();

  const gtag = createGtag(analyticsWindow);
  gtag("consent", "default", {
    ad_personalization: "denied",
    ad_storage: "denied",
    ad_user_data: "denied",
    analytics_storage: "denied"
  });
  gtag("js", new Date());
  gtag("config", normalizedMeasurementId, {
    allow_ad_personalization_signals: false,
    allow_google_signals: false,
    send_page_view: false
  });
  appendAnalyticsScript(documentRef, normalizedMeasurementId);

  let previousPage: AnalyticsPage | null = null;
  const trackPageView = () => {
    const page = buildAnalyticsPage(
      analyticsWindow.location.href,
      documentRef.title
    );
    if (page.path === previousPage?.path) {
      return;
    }

    gtag("event", "page_view", {
      page_location: page.location,
      page_path: page.path,
      page_referrer: previousPage?.location ?? documentRef.referrer,
      page_title: page.title
    });
    previousPage = page;
  };

  trackPageView();
  analyticsWindow.addEventListener("hashchange", trackPageView);
  analyticsWindow.addEventListener("popstate", trackPageView);

  const cleanup = () => {
    analyticsWindow.removeEventListener("hashchange", trackPageView);
    analyticsWindow.removeEventListener("popstate", trackPageView);
    if (analyticsWindow[ANALYTICS_CLEANUP_KEY] === cleanup) {
      delete analyticsWindow[ANALYTICS_CLEANUP_KEY];
    }
  };
  analyticsWindow[ANALYTICS_CLEANUP_KEY] = cleanup;

  return cleanup;
}
