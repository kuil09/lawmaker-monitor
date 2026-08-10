import ReactDOM from "react-dom/client";

import {
  initializeGoogleAnalytics,
  isAnalyticsHostAllowed,
  normalizeGaMeasurementId,
  readStoredAnalyticsConsent
} from "./lib/analytics.js";
import { removeLegacyUiParameter } from "./lib/entry-url.js";
import { V2App } from "./v2/V2App.js";
import "./styles/layers.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles.css";
import "./styles/home-refresh.css";
import "./styles/activity-refresh.css";
import "./styles/distribution-refresh.css";
import "./styles/v2-observatory.css";
import "./styles/v3-observatory.css";
import "./styles/v3-unified.css";
import "./styles/hexmap.css";
import "./styles/bill-activity.css";
import "./styles/minutes-summary.css";
import "./styles/watch-queue.css";
import "./styles/member-evaluation.css";

removeLegacyUiParameter();
const analyticsMeasurementId = isAnalyticsHostAllowed(
  window.location.hostname,
  import.meta.env.VITE_GA_ALLOWED_HOSTS
)
  ? normalizeGaMeasurementId(import.meta.env.VITE_GA_MEASUREMENT_ID)
  : null;
const initialAnalyticsConsent = readStoredAnalyticsConsent(window.localStorage);
initializeGoogleAnalytics({
  analyticsStorage: initialAnalyticsConsent,
  measurementId: analyticsMeasurementId
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <V2App
    analyticsEnabled={Boolean(analyticsMeasurementId)}
    initialAnalyticsConsent={initialAnalyticsConsent}
  />
);
