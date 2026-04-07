import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  deckPropsLog: [] as Array<Record<string, unknown>>,
  layerInstances: [] as Array<{ id: string; props: Record<string, unknown> }>,
  loadIndexMock: vi.fn(),
  loadTopologyMock: vi.fn(),
  computeMock: vi.fn(),
  workerState: {
    cells: [] as Array<Record<string, unknown>>,
    status: "done",
    error: null
  }
}));

vi.mock("@deck.gl/core", () => ({
  WebMercatorViewport: class {
    fitBounds() {
      return { longitude: 128.6, latitude: 35.15, zoom: 8.25 };
    }
  }
}));

vi.mock("@deck.gl/geo-layers", () => ({
  H3HexagonLayer: class {
    id: string;
    props: Record<string, unknown>;

    constructor(props: Record<string, unknown>) {
      this.id = String(props.id);
      this.props = props;
      testState.layerInstances.push({ id: this.id, props });
    }
  }
}));

vi.mock("@deck.gl/react", () => ({
  default: function DeckGL(props: Record<string, unknown>) {
    const { children, initialViewState, layers, viewState } = props as {
      children?: React.ReactNode;
      initialViewState?: Record<string, unknown>;
      layers?: unknown[];
      viewState?: Record<string, unknown>;
    };

    testState.deckPropsLog.push({
      initialViewState,
      layers,
      viewState
    });

    return React.createElement("div", null, children);
  }
}));

vi.mock("react-map-gl/maplibre", () => ({
  Map: function MockMap() {
    return React.createElement("div", { "data-testid": "mock-map" });
  }
}));

vi.mock("../../apps/web/src/lib/data.js", () => ({
  loadConstituencyBoundariesIndex: testState.loadIndexMock,
  loadConstituencyProvinceTopology: testState.loadTopologyMock
}));

vi.mock("../../apps/web/src/lib/hex-cells-worker.js", () => ({
  useHexCellsWorker: () => ({
    cells: testState.workerState.cells,
    status: testState.workerState.status,
    error: testState.workerState.error,
    compute: testState.computeMock
  })
}));

import { HexmapPage } from "../../apps/web/src/components/HexmapPage.js";

const fixturesDir = resolve(process.cwd(), "tests/fixtures/contracts");
const accountabilitySummaryFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, "accountability_summary.json"), "utf8")
);
const constituencyBoundariesIndexFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, "constituency_boundaries_index.json"), "utf8")
);
const constituencyProvinceFixtures = {
  "exports/constituency_boundaries/provinces/부산.topo.json": JSON.parse(
    readFileSync(resolve(fixturesDir, "constituency_province_busan.topo.json"), "utf8")
  ),
  "exports/constituency_boundaries/provinces/서울.topo.json": JSON.parse(
    readFileSync(resolve(fixturesDir, "constituency_province_seoul.topo.json"), "utf8")
  )
};
const expectedWorkerItems = accountabilitySummaryFixture.items.map((item: Record<string, unknown>) => ({
  memberId: item.memberId,
  name: item.name,
  party: item.party,
  district: item.district,
  absentRate: item.absentRate,
  noRate: item.noRate,
  abstainRate: item.abstainRate
}));

function getLastLayer(idPrefix: string) {
  const matches = testState.layerInstances.filter((layer) => layer.id.startsWith(idPrefix));
  return matches.at(-1);
}

function getLastDeckProps(kind: "national" | "detail") {
  const matches = testState.deckPropsLog.filter((entry) =>
    kind === "national" ? Boolean(entry.initialViewState) : Boolean(entry.viewState)
  );
  return matches.at(-1);
}

describe("HexmapPage", () => {
  beforeEach(() => {
    testState.deckPropsLog.length = 0;
    testState.layerInstances.length = 0;
    testState.loadIndexMock.mockReset();
    testState.loadTopologyMock.mockReset();
    testState.computeMock.mockReset();

    testState.workerState.cells = [
      {
        h3Index: "85283083fffffff",
        party: "미래개혁당",
        metric: 0.5,
        memberCount: 1,
        memberNames: ["박민"],
        memberParties: ["미래개혁당"],
        memberIds: ["M002"]
      }
    ];
    testState.workerState.status = "done";
    testState.workerState.error = null;

    testState.loadIndexMock.mockResolvedValue(constituencyBoundariesIndexFixture);
    testState.loadTopologyMock.mockImplementation(async (path: string) => {
      return constituencyProvinceFixtures[path as keyof typeof constituencyProvinceFixtures] ?? null;
    });
  });

  it("renders national and detail H3 layers as flat tiles without bloom or elevation", async () => {
    render(
      <HexmapPage
        manifest={null}
        accountabilitySummary={accountabilitySummaryFixture}
        assemblyLabel="제22대 국회"
        initialProvince="부산"
        initialMetric="absence"
        onNavigateToMember={vi.fn()}
        onChangeRoute={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(getLastLayer("h3-data-absence")).toBeDefined();
      expect(getLastLayer("h3-detail-absence-부산")).toBeDefined();
    });

    const nationalLayer = getLastLayer("h3-data-absence");
    const detailLayer = getLastLayer("h3-detail-absence-부산");
    const nationalDeck = getLastDeckProps("national");
    const detailDeck = getLastDeckProps("detail");

    expect(nationalLayer?.props.extruded).toBe(false);
    expect(detailLayer?.props.extruded).toBe(false);
    expect(nationalLayer?.props).not.toHaveProperty("getElevation");
    expect(detailLayer?.props).not.toHaveProperty("getElevation");
    expect(testState.layerInstances.some((layer) => layer.id.startsWith("h3-bloom-"))).toBe(false);

    expect(nationalDeck?.layers).toHaveLength(1);
    expect(detailDeck?.layers).toHaveLength(1);
    expect(nationalDeck?.initialViewState).toMatchObject({ pitch: 0 });
    expect(detailDeck?.viewState).toMatchObject({ pitch: 0 });
  });

  it("updates the copy away from pillar language and preserves detail click navigation", async () => {
    const onNavigateToMember = vi.fn();
    const onChangeRoute = vi.fn();

    render(
      <HexmapPage
        manifest={null}
        accountabilitySummary={accountabilitySummaryFixture}
        assemblyLabel="제22대 국회"
        initialProvince="부산"
        initialMetric="absence"
        onNavigateToMember={onNavigateToMember}
        onChangeRoute={onChangeRoute}
      />
    );

    await screen.findByText(
      "타일 색 진하기 = 결석률 평균(로그 정규화). 색상 hue는 셀 내 다수당을 따르며, 같은 정당 안에서는 값이 높을수록 더 진합니다."
    );
    expect(screen.queryByText(/셀 높이/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "반대·기권 인덱스" }));

    await screen.findByText(
      "타일 색 진하기 = 반대·기권율 평균(로그 정규화). 색상 hue는 셀 내 다수당을 따르며, 같은 정당 안에서는 값이 높을수록 더 진합니다."
    );

    await waitFor(() => {
      expect(testState.computeMock).toHaveBeenLastCalledWith(
        constituencyProvinceFixtures["exports/constituency_boundaries/provinces/부산.topo.json"],
        expectedWorkerItems,
        "negative"
      );
    });

    const detailLayer = getLastLayer("h3-detail-negative-부산");
    const onClick = detailLayer?.props.onClick as
      | ((info: { object?: (typeof testState.workerState.cells)[number] }) => void)
      | undefined;

    expect(onClick).toBeTypeOf("function");
    onClick?.({ object: testState.workerState.cells[0] });

    expect(onNavigateToMember).toHaveBeenCalledWith("M002");
    expect(onChangeRoute).toHaveBeenCalledWith("부산", "negative");
  });
});
