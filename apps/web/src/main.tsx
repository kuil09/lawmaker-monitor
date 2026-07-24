import ReactDOM from "react-dom/client";

import AppEntry from "./AppEntry.js";
import "./styles/layers.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/nav.css";
import "./styles.css";
import "./styles/home-refresh.css";
import "./styles/activity-refresh.css";
import "./styles/distribution-refresh.css";
import "./styles/hexmap.css";
import "./styles/v2-observatory.css";
import "./styles/v3-observatory.css";
import "./styles/v3-unified.css";

ReactDOM.createRoot(document.getElementById("root")!).render(<AppEntry />);
