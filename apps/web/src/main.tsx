import ReactDOM from "react-dom/client";

import { V2App } from "./v2/V2App.js";
import "./styles/layers.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles.css";
import "./styles/home-refresh.css";
import "./styles/activity-refresh.css";
import "./styles/distribution-refresh.css";
import "./styles/hexmap.css";
import "./styles/v2-observatory.css";
import "./styles/v3-observatory.css";
import "./styles/v3-unified.css";
import "./styles/bill-activity.css";

ReactDOM.createRoot(document.getElementById("root")!).render(<V2App />);
