export type ScatterAxisPoint = {
  x: number;
  y: number;
};

export function getPaddedAxisDomain(
  points: ScatterAxisPoint[],
  key: keyof ScatterAxisPoint
): [number, number] {
  if (points.length === 0) {
    return [0, 100];
  }

  const values = points.map((point) => point[key]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = Math.max((max - min) * 0.12, 2);
  return [Math.max(0, Math.floor(min - padding)), Math.ceil(max + padding)];
}

export function getScatterYDomain(
  points: ScatterAxisPoint[],
  isPercentage: boolean
): [number, number] {
  const domain = getPaddedAxisDomain(points, "y");
  return isPercentage ? [domain[0], Math.min(100, domain[1])] : domain;
}
