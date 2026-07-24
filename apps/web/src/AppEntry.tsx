import App from "./App.js";
import { V2App } from "./v2/V2App.js";

function shouldUseV2(search: string): boolean {
  return new URLSearchParams(search).get("ui") === "v2";
}

export default function AppEntry() {
  const useV2 =
    typeof window !== "undefined" && shouldUseV2(window.location.search);

  return useV2 ? <V2App /> : <App />;
}
