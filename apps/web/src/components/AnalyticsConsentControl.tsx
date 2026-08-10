import { useState } from "react";

import {
  storeAnalyticsConsent,
  updateGoogleAnalyticsConsent
} from "../lib/analytics.js";
import "../styles/analytics-consent.css";

import type { AnalyticsConsent } from "../lib/analytics.js";

type AnalyticsConsentControlProps = {
  initialConsent: AnalyticsConsent | null;
};

export function AnalyticsConsentControl({
  initialConsent
}: AnalyticsConsentControlProps) {
  const [consent, setConsent] = useState<AnalyticsConsent | null>(
    initialConsent
  );
  const [isOpen, setIsOpen] = useState(initialConsent === null);

  const chooseConsent = (nextConsent: AnalyticsConsent) => {
    storeAnalyticsConsent(nextConsent, window.localStorage);
    if (nextConsent !== consent) {
      updateGoogleAnalyticsConsent({ consent: nextConsent });
    }
    setConsent(nextConsent);
    setIsOpen(false);
  };

  if (!isOpen) {
    return (
      <button
        aria-label="분석 쿠키 설정 열기"
        className="analytics-consent__settings"
        onClick={() => setIsOpen(true)}
        type="button"
      >
        분석 설정
      </button>
    );
  }

  return (
    <section
      aria-describedby="analytics-consent-description"
      aria-labelledby="analytics-consent-title"
      aria-modal="false"
      className="analytics-consent"
      role="dialog"
    >
      <div className="analytics-consent__copy">
        <h2 id="analytics-consent-title">방문 통계 설정</h2>
        <p id="analytics-consent-description">
          사이트 개선을 위해 Google Analytics를 사용합니다. 허용 전에는 쿠키
          없이 제한된 신호만 전송하며, 허용한 경우 방문·이용 통계를 저장합니다.
          광고와 개인화에는 사용하지 않습니다.
        </p>
        {consent ? (
          <p aria-live="polite" className="analytics-consent__status">
            현재 선택: {consent === "granted" ? "분석 허용" : "분석 거부"}
          </p>
        ) : null}
      </div>
      <div className="analytics-consent__actions">
        <button
          className="analytics-consent__button analytics-consent__button--secondary"
          onClick={() => chooseConsent("denied")}
          type="button"
        >
          거부
        </button>
        <button
          className="analytics-consent__button analytics-consent__button--primary"
          onClick={() => chooseConsent("granted")}
          type="button"
        >
          분석 허용
        </button>
      </div>
    </section>
  );
}
