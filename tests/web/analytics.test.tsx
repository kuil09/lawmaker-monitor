import { afterEach, describe, expect, it, vi } from "vitest";

import {
  initializeCloudflareWebAnalytics,
  isAnalyticsHostAllowed,
  normalizeCloudflareWebAnalyticsToken
} from "../../apps/web/src/lib/analytics.js";

const VALID_TOKEN = "0123456789abcdef0123456789abcdef";

afterEach(() => {
  vi.restoreAllMocks();
  document
    .querySelectorAll("script[data-lawmaker-monitor-analytics]")
    .forEach((script) => script.remove());
});

describe("cookie-free aggregate analytics integration", () => {
  it("accepts only plausible Cloudflare Web Analytics site tokens", () => {
    expect(normalizeCloudflareWebAnalyticsToken(` ${VALID_TOKEN} `)).toBe(
      VALID_TOKEN
    );
    expect(normalizeCloudflareWebAnalyticsToken("short-token")).toBeNull();
    expect(
      normalizeCloudflareWebAnalyticsToken("invalid token with spaces")
    ).toBeNull();
    expect(normalizeCloudflareWebAnalyticsToken(undefined)).toBeNull();
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
    expect(isAnalyticsHostAllowed("preview.example", undefined)).toBe(false);
  });

  it("loads the Cloudflare beacon once on an allowed host", () => {
    const firstResult = initializeCloudflareWebAnalytics({
      allowedHosts: "localhost",
      token: VALID_TOKEN
    });
    const secondResult = initializeCloudflareWebAnalytics({
      allowedHosts: "localhost",
      token: VALID_TOKEN
    });
    const scripts = document.querySelectorAll<HTMLScriptElement>(
      'script[data-lawmaker-monitor-analytics="cloudflare"]'
    );
    const script = scripts[0];

    expect(firstResult).toBe(true);
    expect(secondResult).toBe(true);
    expect(scripts).toHaveLength(1);
    expect(script?.defer).toBe(true);
    expect(script?.src).toBe(
      "https://static.cloudflareinsights.com/beacon.min.js"
    );
    expect(JSON.parse(script?.getAttribute("data-cf-beacon") ?? "{}")).toEqual({
      token: VALID_TOKEN
    });
  });

  it("does not load analytics without a valid token or allowed host", () => {
    expect(
      initializeCloudflareWebAnalytics({
        allowedHosts: "localhost",
        token: "invalid"
      })
    ).toBe(false);
    expect(
      initializeCloudflareWebAnalytics({
        allowedHosts: "kuil09.github.io",
        token: VALID_TOKEN
      })
    ).toBe(false);
    expect(
      document.querySelector("script[data-lawmaker-monitor-analytics]")
    ).toBeNull();
  });

  it("does not read or write browser storage or cookies", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    const clear = vi.spyOn(Storage.prototype, "clear");
    const cookieBefore = document.cookie;

    initializeCloudflareWebAnalytics({
      allowedHosts: "localhost",
      token: VALID_TOKEN
    });

    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(document.cookie).toBe(cookieBefore);
    expect(
      (window as Window & { dataLayer?: unknown }).dataLayer
    ).toBeUndefined();
  });
});
