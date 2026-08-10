import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AnalyticsConsentControl } from "../../apps/web/src/components/AnalyticsConsentControl.js";
import { ANALYTICS_CONSENT_STORAGE_KEY } from "../../apps/web/src/lib/analytics.js";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value)
  });
});

describe("AnalyticsConsentControl", () => {
  it("asks for a choice and persists analytics consent", () => {
    render(<AnalyticsConsentControl initialConsent={null} />);

    expect(
      screen.getByRole("dialog", { name: "방문 통계 설정" })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "분석 허용" }));

    expect(window.localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY)).toBe(
      "granted"
    );
    expect(
      screen.getByRole("button", { name: "분석 쿠키 설정 열기" })
    ).toBeInTheDocument();
  });

  it("lets a returning visitor revoke stored consent", () => {
    render(<AnalyticsConsentControl initialConsent="granted" />);

    fireEvent.click(
      screen.getByRole("button", { name: "분석 쿠키 설정 열기" })
    );
    expect(screen.getByText("현재 선택: 분석 허용")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "거부" }));

    expect(window.localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY)).toBe(
      "denied"
    );
  });
});
