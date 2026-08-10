import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ANALYTICS_CONSENT_STORAGE_KEY,
  buildAnalyticsPage,
  initializeGoogleAnalytics,
  isAnalyticsHostAllowed,
  normalizeGaMeasurementId,
  readStoredAnalyticsConsent,
  storeAnalyticsConsent,
  updateGoogleAnalyticsConsent
} from "../../apps/web/src/lib/analytics.js";

type AnalyticsWindow = Window & {
  dataLayer?: ArrayLike<unknown>[];
  gtag?: (...args: [string, ...unknown[]]) => void;
  __lawmakerMonitorAnalyticsCleanup?: () => void;
};

function getDataLayerCommands() {
  const analyticsWindow = window as AnalyticsWindow;
  return analyticsWindow.dataLayer?.map((command) => Array.from(command)) ?? [];
}

function getPageViewEvents() {
  return getDataLayerCommands().filter(
    ([command, eventName]) => command === "event" && eventName === "page_view"
  );
}

afterEach(() => {
  vi.useRealTimers();
  const analyticsWindow = window as AnalyticsWindow;
  analyticsWindow.__lawmakerMonitorAnalyticsCleanup?.();
  delete analyticsWindow.dataLayer;
  delete analyticsWindow.gtag;
  document
    .querySelectorAll("script[data-lawmaker-monitor-analytics]")
    .forEach((script) => script.remove());
  window.history.replaceState({}, "", "/");
});

describe("Google Analytics integration", () => {
  it("accepts only GA4 measurement IDs", () => {
    expect(normalizeGaMeasurementId(" g-ab12cd34 ")).toBe("G-AB12CD34");
    expect(normalizeGaMeasurementId("UA-123456-1")).toBeNull();
    expect(normalizeGaMeasurementId("")).toBeNull();
  });

  it("enables analytics only for configured production hosts", () => {
    expect(isAnalyticsHostAllowed("kuil09.github.io", "kuil09.github.io")).toBe(
      true
    );
    expect(
      isAnalyticsHostAllowed(
        "KUIL09.GITHUB.IO",
        "preview.example.test, kuil09.github.io"
      )
    ).toBe(true);
    expect(isAnalyticsHostAllowed("127.0.0.1", "kuil09.github.io")).toBe(false);
    expect(isAnalyticsHostAllowed("ga-probe.example", undefined)).toBe(false);
  });

  it("persists only explicit analytics consent values", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    };
    expect(readStoredAnalyticsConsent(storage)).toBeNull();

    expect(storeAnalyticsConsent("granted", storage)).toBe(true);
    expect(storage.getItem(ANALYTICS_CONSENT_STORAGE_KEY)).toBe("granted");
    expect(readStoredAnalyticsConsent(storage)).toBe("granted");

    storage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, "unexpected");
    expect(readStoredAnalyticsConsent(storage)).toBeNull();
  });

  it("groups traffic by public route and preserves public member identifiers", () => {
    const page = buildAnalyticsPage(
      "https://example.test/lawmaker-monitor/?ui=v2&deploy=abc&utm_source=social#calendar?member=M001&compare=M002&view=compare&note=SECRET",
      "국회 출석부"
    );

    expect(page).toEqual({
      location:
        "https://example.test/lawmaker-monitor/?utm_source=social#calendar?member=M001&compare=M002",
      path: "/lawmaker-monitor/?utm_source=social#calendar?member=M001&compare=M002",
      title: "의원 활동 · 국회 출석부"
    });
  });

  it("preserves public district and province identifiers on map routes", () => {
    expect(
      buildAnalyticsPage(
        "https://example.test/lawmaker-monitor/#map?district=%EC%84%9C%EC%9A%B8%EC%A4%91%EA%B5%AC&metric=negative"
      ).path
    ).toBe(
      "/lawmaker-monitor/#map?district=%EC%84%9C%EC%9A%B8%EC%A4%91%EA%B5%AC"
    );
    expect(
      buildAnalyticsPage(
        "https://example.test/lawmaker-monitor/#map?province=%EB%B6%80%EC%82%B0&metric=assetTotal"
      ).path
    ).toBe("/lawmaker-monitor/#map?province=%EB%B6%80%EC%82%B0");
  });

  it("loads gtag with denied storage and records distinct hash routes", () => {
    window.history.replaceState(
      {},
      "",
      "/lawmaker-monitor/?deploy=test#calendar?member=M001"
    );

    const cleanup = initializeGoogleAnalytics({
      measurementId: "G-AB12CD34"
    });
    const analyticsWindow = window as AnalyticsWindow;
    const script = document.querySelector<HTMLScriptElement>(
      "script[data-lawmaker-monitor-analytics='G-AB12CD34']"
    );

    expect(script?.src).toBe(
      "https://www.googletagmanager.com/gtag/js?id=G-AB12CD34"
    );
    expect(Object.prototype.toString.call(analyticsWindow.dataLayer?.[0])).toBe(
      "[object Arguments]"
    );
    expect(getDataLayerCommands()[0]).toEqual([
      "consent",
      "default",
      {
        ad_personalization: "denied",
        ad_storage: "denied",
        ad_user_data: "denied",
        analytics_storage: "denied"
      }
    ]);
    expect(getPageViewEvents()).toHaveLength(1);
    expect(getPageViewEvents()[0]?.[2]).toMatchObject({
      page_path: "/lawmaker-monitor/#calendar?member=M001",
      page_title: "의원 활동 · 국회 출석부"
    });

    window.history.replaceState({}, "", "/lawmaker-monitor/#votes");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    window.dispatchEvent(new HashChangeEvent("hashchange"));

    expect(getPageViewEvents()).toHaveLength(2);
    expect(getPageViewEvents()[1]?.[2]).toMatchObject({
      page_path: "/lawmaker-monitor/#votes",
      page_referrer:
        "http://localhost:3000/lawmaker-monitor/#calendar?member=M001",
      page_title: "쟁점·표결 · 국회 출석부"
    });

    cleanup();
  });

  it("uses stored analytics consent before the first measurement command", () => {
    initializeGoogleAnalytics({
      analyticsStorage: "granted",
      measurementId: "G-AB12CD34"
    });

    expect(getDataLayerCommands()[0]).toEqual([
      "consent",
      "default",
      {
        ad_personalization: "denied",
        ad_storage: "denied",
        ad_user_data: "denied",
        analytics_storage: "granted"
      }
    ]);
  });

  it("updates analytics consent and records a granted choice after processing", () => {
    vi.useFakeTimers();
    initializeGoogleAnalytics({ measurementId: "G-AB12CD34" });

    updateGoogleAnalyticsConsent({ consent: "granted" });

    expect(getDataLayerCommands()).toContainEqual([
      "consent",
      "update",
      {
        ad_personalization: "denied",
        ad_storage: "denied",
        ad_user_data: "denied",
        analytics_storage: "granted"
      }
    ]);
    expect(
      getDataLayerCommands().some(
        ([command, eventName]) =>
          command === "event" && eventName === "analytics_consent_granted"
      )
    ).toBe(false);

    vi.advanceTimersByTime(250);

    expect(getDataLayerCommands()).toContainEqual([
      "event",
      "analytics_consent_granted",
      { event_category: "privacy" }
    ]);
  });

  it("does not load analytics when the measurement ID is absent", () => {
    initializeGoogleAnalytics({ measurementId: undefined });

    expect(
      document.querySelector("script[data-lawmaker-monitor-analytics]")
    ).toBeNull();
    expect((window as AnalyticsWindow).dataLayer).toBeUndefined();
  });
});
