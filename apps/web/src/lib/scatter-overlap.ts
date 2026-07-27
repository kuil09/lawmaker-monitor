export type ScatterSourcePoint = {
  memberId: string;
  x: number;
  y: number;
};

export type SpreadScatterPoint<T extends ScatterSourcePoint> = T & {
  plotX: number;
  plotY: number;
  overlapCount: number;
  plotAdjusted: boolean;
};

export type ScatterSpreadOptions = {
  xDomain?: [number, number];
  yDomain?: [number, number];
};

const DEFAULT_DOMAIN: [number, number] = [0, 100];
const EDGE_THRESHOLD_RATIO = 0.02;
const EDGE_INSET_RATIO = 0.008;
const HORIZONTAL_SPREAD_STEP_RATIO = 0.011;
const VERTICAL_SPREAD_STEP_RATIO = 0.054;

function clampToDomain(value: number, domain: [number, number]): number {
  const [domainMin, domainMax] = domain;
  const inset = (domainMax - domainMin) * EDGE_INSET_RATIO;
  return Math.min(domainMax - inset, Math.max(domainMin + inset, value));
}

function getAxisPosition(
  value: number,
  slot: number,
  slotCount: number,
  domain: [number, number],
  spreadStepRatio: number
): number {
  const [domainMin, domainMax] = domain;
  const domainSpan = domainMax - domainMin;
  const edgeThreshold = domainSpan * EDGE_THRESHOLD_RATIO;
  const edgeInset = domainSpan * EDGE_INSET_RATIO;
  const spreadStep = domainSpan * spreadStepRatio;

  if (value <= domainMin + edgeThreshold) {
    return domainMin + edgeInset + slot * spreadStep;
  }
  if (value >= domainMax - edgeThreshold) {
    return domainMax - edgeInset - slot * spreadStep;
  }
  return value + (slot - (slotCount - 1) / 2) * spreadStep;
}

export function spreadPercentageScatterPoints<T extends ScatterSourcePoint>(
  points: T[],
  options: ScatterSpreadOptions = {}
): Array<SpreadScatterPoint<T>> {
  const xDomain = options.xDomain ?? DEFAULT_DOMAIN;
  const yDomain = options.yDomain ?? DEFAULT_DOMAIN;
  const groupedIndices = new Map<string, number[]>();

  points.forEach((point, index) => {
    const key = `${point.x.toFixed(4)}:${point.y.toFixed(4)}`;
    const group = groupedIndices.get(key) ?? [];
    group.push(index);
    groupedIndices.set(key, group);
  });

  const result = points.map((point) => ({
    ...point,
    plotX: point.x,
    plotY: point.y,
    overlapCount: 1,
    plotAdjusted: false
  }));

  for (const indices of groupedIndices.values()) {
    if (indices.length === 1) {
      continue;
    }
    const columnCount = Math.ceil(Math.sqrt(indices.length));
    const rowCount = Math.ceil(indices.length / columnCount);
    const orderedIndices = [...indices].sort((leftIndex, rightIndex) =>
      points[leftIndex]!.memberId.localeCompare(
        points[rightIndex]!.memberId,
        "en"
      )
    );

    orderedIndices.forEach((pointIndex, slotIndex) => {
      const point = points[pointIndex]!;
      const column = slotIndex % columnCount;
      const row = Math.floor(slotIndex / columnCount);
      const plotX = clampToDomain(
        getAxisPosition(
          point.x,
          column,
          columnCount,
          xDomain,
          HORIZONTAL_SPREAD_STEP_RATIO
        ),
        xDomain
      );
      const plotY = clampToDomain(
        getAxisPosition(
          point.y,
          row,
          rowCount,
          yDomain,
          VERTICAL_SPREAD_STEP_RATIO
        ),
        yDomain
      );

      result[pointIndex] = {
        ...point,
        plotX,
        plotY,
        overlapCount: indices.length,
        plotAdjusted: plotX !== point.x || plotY !== point.y
      };
    });
  }

  return result;
}
