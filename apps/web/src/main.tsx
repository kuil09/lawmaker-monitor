import React from "react";
import ReactDOM from "react-dom/client";

import "maplibre-gl/dist/maplibre-gl.css";

import App from "./App.js";
import "./styles.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/nav.css";
import "./styles/home-refresh.css";
import "./styles/activity-refresh.css";
import "./styles/distribution-refresh.css";
import "./styles/hexmap.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
