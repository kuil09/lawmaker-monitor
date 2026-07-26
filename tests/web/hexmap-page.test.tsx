import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createLogNormalizer,
  getSequentialMetricColor
} from "../../apps/web/src/lib/geo-utils.js";

type MockStaticState = {
  sessionKey: string;
  snapshotId: string | null;
  entries: Array<{
    cacheKey: string;
    provinceShortName: string;
    detailRes: number;
    createdAt: number;
    districts?: Array<{
      type: "Feature";
      geometry: {
        type: "Polygon";
        coordinates: number[][][];
      };
      properties: {
        districtKey: string;
        label: string;
      };
    }>;
    cells: Array<{
      h3Index: string;
      districtKey: string;
      districtLabel: string;
      provinceShortName: string;
    }>;
  }>;
  total: number;
  done: number;
  isLoading: boolean;
  error: string | null;
};

const testState = vi.hoisted(() => ({
  deckPropsLog: [] as Array<Record<string, unknown>>,
  layerInstances: [] as Array<{ id: string; props: Record<string, unknown> }>,
  ensureLoadMock: vi.fn(),
  staticState: {
    sessionKey: "session:test",
    snapshotId: "boundaries-1",
    entries: [] as Array<{
      cacheKey: string;
      provinceShortName: string;
      detailRes: number;
      createdAt: number;
      districts?: Array<{
        type: "Feature";
        geometry: {
          type: "Polygon";
          coordinates: number[][][];
        };
        properties: {
          districtKey: string;
          label: string;
        };
      }>;
      cells: Array<{
        h3Index: string;
        districtKey: string;
        districtLabel: string;
        provinceShortName: string;
      }>;
    }>,
    total: 2,
    done: 2,
    isLoading: false,
    error: null as string | null
  } as MockStaticState,
  listener: null as ((state: MockStaticState) => void) | null
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

vi.mock("@deck.gl/layers", () => ({
  GeoJsonLayer: class {
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
      viewState,
      onViewStateChange: props.onViewStateChange,
      onAfterRender: props.onAfterRender,
      style: props.style,
      ariaHidden: props["aria-hidden"]
    });

    return React.createElement(
      "div",
      {
        "data-testid": initialViewState ? "national-deck" : "detail-deck",
        "aria-hidden": props["aria-hidden"] as boolean | undefined,
        style: props.style as React.CSSProperties | undefined
      },
      children
    );
  }
}));

vi.mock("react-map-gl/maplibre", () => ({
  Map: function MockMap() {
    return React.createElement("div", { "data-testid": "mock-map" });
  }
}));

vi.mock("../../apps/web/src/lib/hexmap-static-loader.js", () => ({
  getHexmapStaticSessionKey: () => "session:test",
  getHexmapStaticState: () => testState.staticState,
  subscribeHexmapStaticState: (
    _manifest: unknown,
    listener: (state: MockStaticState) => void
  ) => {
    testState.listener = listener;
    listener(testState.staticState);
    return () => {
      if (testState.listener === listener) {
        testState.listener = null;
      }
    };
  },
  ensureHexmapStaticLoad: testState.ensureLoadMock
}));

import { HexmapPage } from "../../apps/web/src/components/HexmapPage.js";

const fixturesDir = resolve(process.cwd(), "tests/fixtures/contracts");
const accountabilitySummaryFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, "accountability_summary.json"), "utf8")
);
const memberAssetsIndexFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, "member_assets_index.json"), "utf8")
);

function getLastLayer(idPrefix: string) {
  const matches = testState.layerInstances.filter((layer) =>
    layer.id.startsWith(idPrefix)
  );
  return matches.at(-1);
}

function getLayers(idPrefix: string) {
  return testState.layerInstances.filter((layer) =>
    layer.id.startsWith(idPrefix)
  );
}

function getLastDeckProps(kind: "national" | "detail") {
  const matches = testState.deckPropsLog.filter((entry) =>
    kind === "national"
      ? Boolean(entry.initialViewState)
      : Boolean(entry.viewState)
  );
  return matches.at(-1);
}

describe("HexmapPage", () => {
  beforeEach(() => {
    testState.deckPropsLog.length = 0;
    testState.layerInstances.length = 0;
    testState.ensureLoadMock.mockReset();
    testState.listener = null;
    testState.staticState = {
      sessionKey: "session:test",
      snapshotId: "boundaries-1",
      entries: [
        {
          cacheKey: "boundaries-1:busan",
          provinceShortName: "부산",
          detailRes: 7,
          createdAt: 1,
          districts: [
            {
              type: "Feature",
              geometry: {
                type: "Polygon",
                coordinates: [
                  [
                    [129.0, 35.08],
                    [129.1, 35.08],
                    [129.1, 35.18],
                    [129.0, 35.18],
                    [129.0, 35.08]
                  ]
                ]
              },
              properties: {
                districtKey: "부산남구",
                label: "부산 남구"
              }
            }
          ],
          cells: [
            {
              h3Index: "8730c16f0ffffff",
              districtKey: "부산남구",
              districtLabel: "부산 남구",
              provinceShortName: "부산"
            }
          ]
        },
        {
          cacheKey: "boundaries-1:seoul",
          provinceShortName: "서울",
          detailRes: 7,
          createdAt: 1,
          districts: [
            {
              type: "Feature",
              geometry: {
                type: "Polygon",
                coordinates: [
                  [
                    [126.95, 37.52],
                    [127.05, 37.52],
                    [127.05, 37.62],
                    [126.95, 37.62],
                    [126.95, 37.52]
                  ]
                ]
              },
              properties: {
                districtKey: "서울중구",
                label: "서울 중구"
              }
            }
          ],
          cells: [
            {
              h3Index: "8730e1d88ffffff",
              districtKey: "서울중구",
              districtLabel: "서울 중구",
              provinceShortName: "서울"
            }
          ]
        }
      ],
      total: 2,
      done: 2,
      isLoading: false,
      error: null
    };
    testState.ensureLoadMock.mockResolvedValue(undefined);
  });

  it("renders one national map and replaces a selected region with a detailed member directory", async () => {
    const onChangeRoute = vi.fn();
    const onNavigateToMember = vi.fn();

    render(
      <HexmapPage
        manifest={null}
        accountabilitySummary={accountabilitySummaryFixture}
        memberAssetsIndex={memberAssetsIndexFixture}
        memberAssetsIndexError={null}
        assemblyLabel="제22대 국회"
        initialProvince={null}
        initialDistrict={null}
        initialMetric="absence"
        onNavigateToMember={onNavigateToMember}
        onChangeRoute={onChangeRoute}
      />
    );

    await waitFor(() => {
      expect(getLastLayer("cartogram-national-absence")).toBeDefined();
    });

    expect(testState.ensureLoadMock).toHaveBeenCalledTimes(1);
    expect(testState.ensureLoadMock).toHaveBeenCalledWith(null, {
      source: "map"
    });
    expect(screen.getByText("지역을 선택해 주세요")).toBeInTheDocument();
    expect(
      screen.getByText(
        "전국 지도나 시·도 바로가기에서 지역을 선택하면 소속 의원 목록을 보여드립니다."
      )
    ).toBeInTheDocument();
    expect(screen.queryByTestId("detail-deck")).not.toBeInTheDocument();

    const nationalLayer = getLastLayer("cartogram-national-absence");
    const nationalDeck = getLastDeckProps("national");
    const onClick = nationalLayer?.props.onClick as
      | ((info: { object?: Record<string, unknown> }) => void)
      | undefined;
    const firstCell = (
      nationalLayer?.props.data as Array<Record<string, unknown>>
    )[0];

    expect(nationalLayer?.props.extruded).toBe(false);
    expect(nationalLayer?.props).not.toHaveProperty("getElevation");
    expect(
      testState.layerInstances.some((layer) => layer.id.startsWith("h3-bloom-"))
    ).toBe(false);
    expect(nationalDeck?.layers).toHaveLength(1);
    expect(nationalDeck?.initialViewState).toMatchObject({
      pitch: 0,
      zoom: 7.1
    });
    expect(firstCell).toMatchObject({
      districtKey: "부산남구",
      districtLabel: "부산 남구",
      memberIds: ["M002"]
    });

    onClick?.({ object: firstCell });

    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: "박민 의원 상세 보기" })
      ).toBeInTheDocument();
    });

    expect(
      testState.layerInstances.some((layer) => layer.id.startsWith("h3-panel-"))
    ).toBe(false);
    expect(screen.queryByTestId("detail-deck")).not.toBeInTheDocument();
    expect(onChangeRoute).toHaveBeenCalledWith({
      district: null,
      province: "부산",
      metric: "absence"
    });
    expect(
      screen.getByText(
        "부산 지역 의원의 지역구·정당과 핵심 지표를 비교합니다. 의원을 선택하면 상세 활동 화면으로 이동합니다."
      )
    ).toBeInTheDocument();
    expect(screen.getByLabelText("부산 의원 목록")).toBeInTheDocument();
    expect(screen.getByText("부산 남구")).toBeInTheDocument();
    expect(screen.getAllByText("50.0%")).toHaveLength(2);
    expect(screen.getByText("3.2억원")).toBeInTheDocument();
    expect(screen.getByText("2.7억원")).toBeInTheDocument();
    const accessibleMemberLink = screen.getByRole("link", {
      name: "박민 의원 상세 보기"
    });
    expect(accessibleMemberLink).toHaveAttribute(
      "href",
      "#calendar?member=M002"
    );
    accessibleMemberLink.focus();
    fireEvent.click(accessibleMemberLink);
    expect(onNavigateToMember).toHaveBeenCalledWith("M002");
  });

  it("keeps the initial national map hidden until loading and the first deck render both complete", async () => {
    testState.staticState = {
      ...testState.staticState,
      entries: testState.staticState.entries.slice(0, 1),
      done: 1,
      isLoading: true
    };

    render(
      <HexmapPage
        manifest={null}
        accountabilitySummary={accountabilitySummaryFixture}
        memberAssetsIndex={memberAssetsIndexFixture}
        memberAssetsIndexError={null}
        assemblyLabel="제22대 국회"
        initialProvince={null}
        initialDistrict={null}
        initialMetric="absence"
        onNavigateToMember={vi.fn()}
        onChangeRoute={vi.fn()}
      />
    );

    const initialLoadingStatus = screen.getByRole("status");
    expect(initialLoadingStatus).toHaveTextContent(
      "전국 지도를 준비하고 있습니다."
    );
    expect(
      document.querySelector(".hexmap-section--national .hexmap-map-container")
    ).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("national-deck")).toHaveStyle({ opacity: "0" });

    const loadingDeck = getLastDeckProps("national");
    act(() => {
      (loadingDeck?.onAfterRender as (() => void) | undefined)?.();
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "전국 지도를 준비하고 있습니다."
    );

    act(() => {
      testState.listener?.({
        ...testState.staticState,
        entries: [
          ...testState.staticState.entries,
          {
            cacheKey: "boundaries-1:seoul",
            provinceShortName: "서울",
            detailRes: 7,
            createdAt: 1,
            districts: [
              {
                type: "Feature",
                geometry: {
                  type: "Polygon",
                  coordinates: [
                    [
                      [126.95, 37.52],
                      [127.05, 37.52],
                      [127.05, 37.62],
                      [126.95, 37.62],
                      [126.95, 37.52]
                    ]
                  ]
                },
                properties: {
                  districtKey: "서울중구",
                  label: "서울 중구"
                }
              }
            ],
            cells: [
              {
                h3Index: "8730e1d88ffffff",
                districtKey: "서울중구",
                districtLabel: "서울 중구",
                provinceShortName: "서울"
              }
            ]
          }
        ],
        done: 2,
        isLoading: false
      });
    });

    await waitFor(() => {
      expect(
        (
          getLastDeckProps("national")?.style as
            | { opacity?: string }
            | undefined
        )?.opacity
      ).toBe("0");
    });

    act(() => {
      (
        getLastDeckProps("national")?.onAfterRender as (() => void) | undefined
      )?.();
    });

    await waitFor(() => {
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
    expect(
      document.querySelector(".hexmap-section--national .hexmap-map-container")
    ).toHaveAttribute("aria-busy", "false");
    expect(screen.getByTestId("national-deck")).toHaveStyle({ opacity: "1" });
  });

  it("promotes legacy district routes to their parent province selection", async () => {
    const onChangeRoute = vi.fn();

    render(
      <HexmapPage
        manifest={null}
        accountabilitySummary={accountabilitySummaryFixture}
        memberAssetsIndex={memberAssetsIndexFixture}
        memberAssetsIndexError={null}
        assemblyLabel="제22대 국회"
        initialProvince={null}
        initialDistrict="부산남구"
        initialMetric="absence"
        onNavigateToMember={vi.fn()}
        onChangeRoute={onChangeRoute}
      />
    );

    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: "박민 의원 상세 보기" })
      ).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(onChangeRoute).toHaveBeenCalledWith({
        district: null,
        province: "부산",
        metric: "absence"
      });
    });
  });

  it("keeps a selected province directory interactive without triggering static loading again on metric switch", async () => {
    const onNavigateToMember = vi.fn();
    const onChangeRoute = vi.fn();

    render(
      <HexmapPage
        manifest={null}
        accountabilitySummary={accountabilitySummaryFixture}
        memberAssetsIndex={memberAssetsIndexFixture}
        memberAssetsIndexError={null}
        assemblyLabel="제22대 국회"
        initialProvince="부산"
        initialDistrict={null}
        initialMetric="negative"
        onNavigateToMember={onNavigateToMember}
        onChangeRoute={onChangeRoute}
      />
    );

    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: "박민 의원 상세 보기" })
      ).toBeInTheDocument();
    });

    expect(screen.queryByText(/셀 높이/)).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "부산 지역 의원의 지역구·정당과 핵심 지표를 비교합니다. 의원을 선택하면 상세 활동 화면으로 이동합니다."
      )
    ).toBeInTheDocument();
    expect(screen.queryByTestId("detail-deck")).not.toBeInTheDocument();
    expect(
      testState.layerInstances.some((layer) => layer.id.startsWith("h3-panel-"))
    ).toBe(false);
    expect(screen.getByText("박민")).toBeInTheDocument();
    expect(screen.getByText("부산 남구")).toBeInTheDocument();
    expect(screen.getByText("반대·기권")).toBeInTheDocument();
    expect(
      document.querySelector(".hexmap-detail-member-card__metrics > .is-active")
    ).toHaveTextContent("반대·기권50.0%");

    fireEvent.click(screen.getByRole("link", { name: "박민 의원 상세 보기" }));
    expect(onNavigateToMember).toHaveBeenCalledWith("M002");

    fireEvent.click(screen.getByRole("tab", { name: "결석 핫스팟" }));

    await waitFor(() => {
      expect(onChangeRoute).toHaveBeenCalledWith({
        district: null,
        province: "부산",
        metric: "absence"
      });
    });

    expect(testState.ensureLoadMock).toHaveBeenCalledTimes(1);
  });

  it("renders one equal-sized cartogram cell for each district", async () => {
    render(
      <HexmapPage
        manifest={null}
        accountabilitySummary={accountabilitySummaryFixture}
        memberAssetsIndex={memberAssetsIndexFixture}
        memberAssetsIndexError={null}
        assemblyLabel="제22대 국회"
        initialProvince={null}
        initialDistrict={null}
        initialMetric="absence"
        onNavigateToMember={vi.fn()}
        onChangeRoute={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(getLastLayer("cartogram-national-absence")).toBeDefined();
    });

    const cartogramLayer = getLastLayer("cartogram-national-absence");
    const cartogramCells = cartogramLayer?.props.data as Array<{
      districtKey: string;
      h3Index: string;
    }>;

    expect(cartogramCells).toHaveLength(2);
    expect(new Set(cartogramCells.map((cell) => cell.h3Index)).size).toBe(2);
    expect(cartogramCells.map((cell) => cell.districtKey)).toEqual([
      "부산남구",
      "서울중구"
    ]);
    expect(
      screen.getByRole("heading", { name: "지역구 카토그램" })
    ).toBeInTheDocument();
    expect(
      screen.getByText("한 지역구를 동일 크기 육각형 하나로 표시합니다")
    ).toBeInTheDocument();
    expect(
      testState.layerInstances.some((layer) =>
        layer.id.startsWith("district-national-")
      )
    ).toBe(false);
  });

  it("switches to the real-estate metric and uses a single sequential color scale", async () => {
    const onChangeRoute = vi.fn();

    render(
      <HexmapPage
        manifest={null}
        accountabilitySummary={accountabilitySummaryFixture}
        memberAssetsIndex={memberAssetsIndexFixture}
        memberAssetsIndexError={null}
        assemblyLabel="제22대 국회"
        initialProvince={null}
        initialDistrict={null}
        initialMetric="absence"
        onNavigateToMember={vi.fn()}
        onChangeRoute={onChangeRoute}
      />
    );

    await waitFor(() => {
      expect(getLastLayer("cartogram-national-absence")).toBeDefined();
    });

    fireEvent.click(screen.getByRole("tab", { name: "부동산" }));

    await waitFor(() => {
      expect(getLastLayer("cartogram-national-realEstate")).toBeDefined();
    });

    const nationalLayer = getLastLayer("cartogram-national-realEstate");
    const firstCell = (
      nationalLayer?.props.data as Array<Record<string, unknown>>
    )[0];
    const assetValues = getLayers("cartogram-national-realEstate").flatMap(
      (layer) =>
        (
          layer.props.data as Array<{
            metric: number;
            metricMemberCount: number;
          }>
        ).flatMap((cell) => (cell.metricMemberCount > 0 ? [cell.metric] : []))
    );
    const getFillColor = nationalLayer?.props.getFillColor as
      | ((cell: Record<string, unknown>) => [number, number, number, number])
      | undefined;
    const normalizeAssetMetric = createLogNormalizer(assetValues);

    expect(firstCell).toMatchObject({
      districtKey: "부산남구",
      metric: 320000,
      metricMemberCount: 1,
      memberIds: ["M002"]
    });
    expect(getFillColor?.(firstCell)).toEqual(
      getSequentialMetricColor(
        normalizeAssetMetric(Number(firstCell?.metric ?? 0))
      )
    );
    expect(getFillColor?.({ ...firstCell, party: "국민의힘" })).toEqual(
      getFillColor?.({ ...firstCell, party: "더불어민주당" })
    );
    expect(screen.getByLabelText("지표 색상 범례")).toBeInTheDocument();
    expect(
      screen.getByText("색이 진할수록 공개 부동산액이 큽니다.")
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /최신 공개 부동산\(건물·토지 합계\)이 클수록 타일이 진해집니다\./
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(/부동산 비교는 최신 공개 건물·토지 합계 기준이며/)
    ).toBeInTheDocument();
    expect(onChangeRoute).toHaveBeenCalledWith({
      district: null,
      province: null,
      metric: "realEstate"
    });
  });

  it("switches to the total-asset metric and keeps the sequential color scale", async () => {
    const onChangeRoute = vi.fn();

    render(
      <HexmapPage
        manifest={null}
        accountabilitySummary={accountabilitySummaryFixture}
        memberAssetsIndex={memberAssetsIndexFixture}
        memberAssetsIndexError={null}
        assemblyLabel="제22대 국회"
        initialProvince={null}
        initialDistrict={null}
        initialMetric="absence"
        onNavigateToMember={vi.fn()}
        onChangeRoute={onChangeRoute}
      />
    );

    await waitFor(() => {
      expect(getLastLayer("cartogram-national-absence")).toBeDefined();
    });

    fireEvent.click(screen.getByRole("tab", { name: "총재산" }));

    await waitFor(() => {
      expect(getLastLayer("cartogram-national-assetTotal")).toBeDefined();
    });

    const nationalLayer = getLastLayer("cartogram-national-assetTotal");
    const firstCell = (
      nationalLayer?.props.data as Array<Record<string, unknown>>
    )[0];
    const assetValues = getLayers("cartogram-national-assetTotal").flatMap(
      (layer) =>
        (
          layer.props.data as Array<{
            metric: number;
            metricMemberCount: number;
          }>
        ).flatMap((cell) => (cell.metricMemberCount > 0 ? [cell.metric] : []))
    );
    const getFillColor = nationalLayer?.props.getFillColor as
      | ((cell: Record<string, unknown>) => [number, number, number, number])
      | undefined;
    const normalizeAssetMetric = createLogNormalizer(assetValues);

    expect(firstCell).toMatchObject({
      districtKey: "부산남구",
      metric: 270000,
      metricMemberCount: 1,
      memberIds: ["M002"]
    });
    expect(getFillColor?.(firstCell)).toEqual(
      getSequentialMetricColor(
        normalizeAssetMetric(Number(firstCell?.metric ?? 0))
      )
    );
    expect(
      screen.getByText("색이 진할수록 공개 총재산이 큽니다.")
    ).toBeInTheDocument();
    expect(
      screen.getByText(/최신 공개 총재산이 클수록 타일이 진해집니다\./)
    ).toBeInTheDocument();
    expect(onChangeRoute).toHaveBeenCalledWith({
      district: null,
      province: null,
      metric: "assetTotal"
    });
  });
});
