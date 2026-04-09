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
  computeStaticMock: vi.fn()
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
    computeStatic: testState.computeStaticMock
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
const staticCellsByProvince = {
  부산: {
    cells: [
      {
        h3Index: "8730c16f0ffffff",
        districtKey: "부산남구",
        districtLabel: "부산 남구",
        provinceShortName: "부산"
      }
    ],
    detailRes: 7,
    timings: {
      reducedFeaturesMs: 1,
      fullFeaturesMs: 1,
      polygonToCellsMs: 1,
      staticHexComputeMs: 3
    }
  },
  서울: {
    cells: [
      {
        h3Index: "8730e1d88ffffff",
        districtKey: "서울중구",
        districtLabel: "서울 중구",
        provinceShortName: "서울"
      }
    ],
    detailRes: 7,
    timings: {
      reducedFeaturesMs: 1,
      fullFeaturesMs: 1,
      polygonToCellsMs: 1,
      staticHexComputeMs: 3
    }
  }
};

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
    testState.computeStaticMock.mockReset();

    testState.loadIndexMock.mockResolvedValue(constituencyBoundariesIndexFixture);
    testState.loadTopologyMock.mockImplementation(async (path: string) => {
      return constituencyProvinceFixtures[path as keyof typeof constituencyProvinceFixtures] ?? null;
    });
    testState.computeStaticMock.mockImplementation(
      async (_topology: unknown, provinceShortName: keyof typeof staticCellsByProvince) =>
        staticCellsByProvince[provinceShortName]
    );
  });

  it("renders a single national detailed H3 layer, keeps the lower panel empty until selection, and drills into a district on click", async () => {
    const onChangeRoute = vi.fn();

    render(
      <HexmapPage
        manifest={null}
        accountabilitySummary={accountabilitySummaryFixture}
        assemblyLabel="제22대 국회"
        initialProvince={null}
        initialDistrict={null}
        initialMetric="absence"
        onNavigateToMember={vi.fn()}
        onChangeRoute={onChangeRoute}
      />
    );

    await waitFor(() => {
      expect(getLastLayer("h3-national-absence")).toBeDefined();
    });

    expect(screen.getByText("아직 선택된 지역구가 없습니다")).toBeInTheDocument();
    expect(
      screen.getByText("상단 전국 지도에서 지역구를 클릭하면 이 영역에 확대 지도가 나타납니다.")
    ).toBeInTheDocument();

    const nationalLayer = getLastLayer("h3-national-absence");
    const nationalDeck = getLastDeckProps("national");

    expect(nationalLayer?.props.extruded).toBe(false);
    expect(nationalLayer?.props).not.toHaveProperty("getElevation");
    expect(testState.layerInstances.some((layer) => layer.id.startsWith("h3-bloom-"))).toBe(false);
    expect(nationalDeck?.layers).toHaveLength(1);
    expect(nationalDeck?.initialViewState).toMatchObject({ pitch: 0, zoom: 6.2 });

    const onClick = nationalLayer?.props.onClick as
      | ((info: { object?: Record<string, unknown> }) => void)
      | undefined;
    const firstCell = (nationalLayer?.props.data as Array<Record<string, unknown>>)[0];

    expect(firstCell).toMatchObject({
      districtKey: "부산남구",
      districtLabel: "부산 남구",
      memberIds: ["M002"]
    });

    onClick?.({ object: firstCell });

    await waitFor(() => {
      expect(getLastLayer("h3-panel-absence-부산남구")).toBeDefined();
    });

    expect(onChangeRoute).toHaveBeenCalledWith({
      district: "부산남구",
      province: null,
      metric: "absence"
    });
    expect(
      screen.getByText("부산 남구만 확대해 보여줍니다. 헥사곤을 클릭하면 해당 의원의 활동 캘린더로 이동합니다.")
    ).toBeInTheDocument();
  });

  it("keeps copy on color intensity, supports legacy province fallback, and preserves lower-panel member navigation", async () => {
    const onNavigateToMember = vi.fn();
    const onChangeRoute = vi.fn();

    render(
      <HexmapPage
        manifest={null}
        accountabilitySummary={accountabilitySummaryFixture}
        assemblyLabel="제22대 국회"
        initialProvince="부산"
        initialDistrict={null}
        initialMetric="negative"
        onNavigateToMember={onNavigateToMember}
        onChangeRoute={onChangeRoute}
      />
    );

    await screen.findByText(
      "타일 색 진하기 = 반대·기권율 평균(로그 정규화). 색상 hue는 셀 내 다수당을 따르며, 같은 정당 안에서는 값이 높을수록 더 진합니다."
    );

    expect(screen.queryByText(/셀 높이/)).not.toBeInTheDocument();
    expect(screen.getByText("부산 전체 지역구를 레거시 링크 호환 모드로 보여줍니다. 헥사곤을 클릭하면 해당 의원의 활동 캘린더로 이동합니다.")).toBeInTheDocument();

    await waitFor(() => {
      expect(getLastLayer("h3-panel-negative-부산")).toBeDefined();
    });

    const detailLayer = getLastLayer("h3-panel-negative-부산");
    const detailDeck = getLastDeckProps("detail");
    const onClick = detailLayer?.props.onClick as
      | ((info: { object?: Record<string, unknown> }) => void)
      | undefined;
    const firstCell = (detailLayer?.props.data as Array<Record<string, unknown>>)[0];

    expect(detailLayer?.props.extruded).toBe(false);
    expect(detailLayer?.props).not.toHaveProperty("getElevation");
    expect(detailDeck?.viewState).toMatchObject({ pitch: 0 });

    onClick?.({ object: firstCell });
    expect(onNavigateToMember).toHaveBeenCalledWith("M002");

    fireEvent.click(screen.getByRole("tab", { name: "결석 핫스팟" }));

    await waitFor(() => {
      expect(onChangeRoute).toHaveBeenCalledWith({
        district: null,
        province: "부산",
        metric: "absence"
      });
    });
  });
});
