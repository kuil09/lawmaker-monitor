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
  IconLayer: class {
    id: string;
    props: Record<string, unknown>;

    constructor(props: Record<string, unknown>) {
      this.id = String(props.id);
      this.props = props;
      testState.layerInstances.push({ id: this.id, props });
    }
  },
  ScatterplotLayer: class {
    id: string;
    props: Record<string, unknown>;

    constructor(props: Record<string, unknown>) {
      this.id = String(props.id);
      this.props = props;
      testState.layerInstances.push({ id: this.id, props });
    }
  },
  TextLayer: class {
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

  it("renders province mini cartograms and keeps the selected province member directory interactive", async () => {
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
      expect(getLastLayer("cartogram-province-서울-absence")).toBeDefined();
    });

    expect(testState.ensureLoadMock).toHaveBeenCalledTimes(1);
    expect(testState.ensureLoadMock).toHaveBeenCalledWith(null, {
      source: "map"
    });
    expect(
      screen.getByRole("img", { name: "서울 지역구 미니 카토그램" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "부산 지역구 미니 카토그램" })
    ).toBeInTheDocument();

    const nationalLayer = getLastLayer("cartogram-province-서울-absence");
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
    expect(nationalDeck?.layers).toHaveLength(5);
    expect(getLastLayer("cartogram-member-backplates-서울")).toBeDefined();
    expect(getLastLayer("cartogram-member-photos-서울")).toBeDefined();
    expect(getLastLayer("cartogram-member-initials-서울")).toBeDefined();
    expect(getLastLayer("cartogram-member-names-서울")).toBeDefined();
    expect(nationalDeck?.initialViewState).toMatchObject({
      latitude: 35.15,
      zoom: 8.6
    });
    expect(firstCell).toMatchObject({
      districtKey: "서울중구",
      districtLabel: "서울 중구",
      memberIds: ["M001"]
    });

    onClick?.({ object: firstCell });

    await waitFor(() => {
      expect(
        screen.getAllByRole("link", { name: "김아라 의원 상세 보기" }).length
      ).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole("button", { name: /부산/ }));

    await waitFor(() => {
      expect(
        screen.getAllByRole("link", { name: "박민 의원 상세 보기" }).length
      ).toBeGreaterThan(0);
      expect(getLastLayer("cartogram-province-부산-absence")).toBeDefined();
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
    expect(screen.getByLabelText("부산 의원 목록")).toBeInTheDocument();
    expect(screen.getAllByText("부산 남구").length).toBeGreaterThan(0);
    expect(screen.getAllByText("50.0%")).toHaveLength(4);
    expect(screen.getAllByText("3.2억원").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2.7억원").length).toBeGreaterThan(0);
    const accessibleMemberLink = screen.getAllByRole("link", {
      name: "박민 의원 상세 보기"
    })[0]!;
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
      "지역 지도를 준비하고 있습니다."
    );
    expect(
      document.querySelector(".hexmap-section--national .hexmap-map-container")
    ).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByTestId("national-deck")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "지역 지도를 준비하고 있습니다."
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
      expect(screen.getByTestId("national-deck")).toBeInTheDocument();
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
        screen.getAllByRole("link", { name: "박민 의원 상세 보기" }).length
      ).toBeGreaterThan(0);
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
        screen.getAllByRole("link", { name: "박민 의원 상세 보기" }).length
      ).toBeGreaterThan(0);
    });

    expect(screen.queryByText(/셀 높이/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("detail-deck")).not.toBeInTheDocument();
    expect(
      testState.layerInstances.some((layer) => layer.id.startsWith("h3-panel-"))
    ).toBe(false);
    expect(screen.getAllByText("박민").length).toBeGreaterThan(0);
    expect(screen.getAllByText("부산 남구").length).toBeGreaterThan(0);
    expect(screen.getAllByText("반대·기권").length).toBeGreaterThan(0);
    expect(
      document.querySelector(".hexmap-detail-member-card__metrics > .is-active")
    ).toHaveTextContent("반대·기권50.0%");

    fireEvent.click(
      screen.getAllByRole("link", { name: "박민 의원 상세 보기" })[0]!
    );
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
      expect(getLastLayer("cartogram-province-서울-absence")).toBeDefined();
    });

    const seoulLayer = getLastLayer("cartogram-province-서울-absence");
    const seoulCells = seoulLayer?.props.data as Array<{
      districtKey: string;
      h3Index: string;
    }>;

    expect(seoulCells).toHaveLength(1);
    expect(seoulCells[0]?.districtKey).toBe("서울중구");
    fireEvent.click(screen.getByRole("button", { name: /부산/ }));
    await waitFor(() => {
      expect(getLastLayer("cartogram-province-부산-absence")).toBeDefined();
    });
    const busanCells = getLastLayer("cartogram-province-부산-absence")?.props
      .data as Array<{ districtKey: string; h3Index: string }>;
    expect(busanCells).toHaveLength(1);
    expect(busanCells[0]?.districtKey).toBe("부산남구");
    expect(
      new Set([...seoulCells, ...busanCells].map((cell) => cell.h3Index)).size
    ).toBe(2);
    expect(screen.getByRole("heading", { name: "부산" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "프로필과 이름을 선택하면 오른쪽에서 근거 정보를 확인합니다"
      )
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
      expect(getLastLayer("cartogram-province-서울-absence")).toBeDefined();
    });

    fireEvent.click(screen.getByRole("tab", { name: "부동산" }));

    await waitFor(() => {
      expect(getLastLayer("cartogram-province-서울-realEstate")).toBeDefined();
    });

    const nationalLayer = getLastLayer("cartogram-province-서울-realEstate");
    const firstCell = (
      nationalLayer?.props.data as Array<Record<string, unknown>>
    )[0];
    const getFillColor = nationalLayer?.props.getFillColor as
      | ((cell: Record<string, unknown>) => [number, number, number, number])
      | undefined;
    const normalizeAssetMetric = createLogNormalizer([320000, 510000]);

    expect(firstCell).toMatchObject({
      districtKey: "서울중구",
      metric: 510000,
      metricMemberCount: 1,
      memberIds: ["M001"]
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
      screen.getByText(/부동산 비교는 최신 공개 건물·토지 합계 기준이며/)
    ).toBeInTheDocument();
    expect(onChangeRoute).toHaveBeenCalledWith({
      district: null,
      province: "서울",
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
      expect(getLastLayer("cartogram-province-서울-absence")).toBeDefined();
    });

    fireEvent.click(screen.getByRole("tab", { name: "총재산" }));

    await waitFor(() => {
      expect(getLastLayer("cartogram-province-서울-assetTotal")).toBeDefined();
    });

    const nationalLayer = getLastLayer("cartogram-province-서울-assetTotal");
    const firstCell = (
      nationalLayer?.props.data as Array<Record<string, unknown>>
    )[0];
    const getFillColor = nationalLayer?.props.getFillColor as
      | ((cell: Record<string, unknown>) => [number, number, number, number])
      | undefined;
    const normalizeAssetMetric = createLogNormalizer([270000, 820000]);

    expect(firstCell).toMatchObject({
      districtKey: "서울중구",
      metric: 820000,
      metricMemberCount: 1,
      memberIds: ["M001"]
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
      screen.getByText(/총재산 비교는 최신 공개 총재산 기준이며/)
    ).toBeInTheDocument();
    expect(onChangeRoute).toHaveBeenCalledWith({
      district: null,
      province: "서울",
      metric: "assetTotal"
    });
  });
});
