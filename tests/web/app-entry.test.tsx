import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../apps/web/src/App.js", () => ({
  default: () => <div data-testid="legacy-app">Legacy app</div>
}));

vi.mock("../../apps/web/src/v2/V2App.js", () => ({
  V2App: () => <div data-testid="v2-app">V2 app</div>
}));

import AppEntry from "../../apps/web/src/AppEntry.js";

describe("app entry", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps the legacy app as the default", () => {
    render(<AppEntry />);

    expect(screen.getByTestId("legacy-app")).toBeInTheDocument();
    expect(screen.queryByTestId("v2-app")).not.toBeInTheDocument();
  });

  it("activates the parallel UI only for the explicit v2 query", () => {
    window.history.replaceState({}, "", "/?ui=v2#map?metric=realEstate");

    render(<AppEntry />);

    expect(screen.getByTestId("v2-app")).toBeInTheDocument();
    expect(window.location.search).toBe("?ui=v2");
    expect(window.location.hash).toBe("#map?metric=realEstate");
  });
});
