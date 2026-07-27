import { cellToBoundary, cellToLatLng } from "h3-js";

export type ProvinceMiniCartogramCell = {
  fillColor: string;
  h3Index: string;
};

type ProjectedCell = {
  key: string;
  path: string;
};

type ProvinceMiniCartogramProps = {
  cells: readonly ProvinceMiniCartogramCell[];
  label: string;
};

const VIEWBOX_WIDTH = 104;
const VIEWBOX_HEIGHT = 58;
const VIEWBOX_PADDING = 4;

function projectCells(
  cells: readonly ProvinceMiniCartogramCell[]
): ProjectedCell[] {
  const projectedBoundaries = cells.map((cell) => {
    const [latitude] = cellToLatLng(cell.h3Index);
    const longitudeScale = Math.cos((latitude * Math.PI) / 180);
    return cellToBoundary(cell.h3Index).map(
      ([pointLatitude, pointLongitude]) =>
        [pointLongitude * longitudeScale, -pointLatitude] as const
    );
  });

  const points = projectedBoundaries.flat();
  if (points.length === 0) {
    return [];
  }

  const minX = Math.min(...points.map(([x]) => x));
  const maxX = Math.max(...points.map(([x]) => x));
  const minY = Math.min(...points.map(([, y]) => y));
  const maxY = Math.max(...points.map(([, y]) => y));
  const contentWidth = Math.max(maxX - minX, Number.EPSILON);
  const contentHeight = Math.max(maxY - minY, Number.EPSILON);
  const scale = Math.min(
    (VIEWBOX_WIDTH - VIEWBOX_PADDING * 2) / contentWidth,
    (VIEWBOX_HEIGHT - VIEWBOX_PADDING * 2) / contentHeight
  );
  const offsetX = (VIEWBOX_WIDTH - contentWidth * scale) / 2;
  const offsetY = (VIEWBOX_HEIGHT - contentHeight * scale) / 2;

  return cells.map((cell, cellIndex) => ({
    key: cell.h3Index,
    path: (projectedBoundaries[cellIndex] ?? [])
      .map(([x, y], pointIndex) => {
        const projectedX = offsetX + (x - minX) * scale;
        const projectedY = offsetY + (y - minY) * scale;
        return `${pointIndex === 0 ? "M" : "L"}${projectedX.toFixed(2)} ${projectedY.toFixed(2)}`;
      })
      .join(" ")
      .concat(" Z")
  }));
}

export function ProvinceMiniCartogram({
  cells,
  label
}: ProvinceMiniCartogramProps) {
  const projectedCells = projectCells(cells);

  return (
    <svg
      className="hexmap-region-mini-map"
      viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      aria-label={`${label} 지역구 미니 카토그램`}
      role="img"
    >
      {projectedCells.map((cell, index) => (
        <path
          key={cell.key}
          d={cell.path}
          fill={cells[index]?.fillColor ?? "#d8e0e9"}
          stroke="rgba(255, 255, 255, 0.9)"
          strokeWidth="0.75"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
