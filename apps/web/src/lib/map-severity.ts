export type MapSeverityKey = "low" | "moderate" | "caution" | "high";

export type MapSeverity = {
  key: MapSeverityKey;
  label: "낮음" | "보통" | "주의" | "높음";
  percentile: number;
  topShare: number;
};

export type MapSeverityScale = {
  median: number;
  classify: (value: number) => MapSeverity;
};

const SEVERITY_LABELS: Record<MapSeverityKey, MapSeverity["label"]> = {
  low: "낮음",
  moderate: "보통",
  caution: "주의",
  high: "높음"
};

export const MAP_SEVERITY_BANDS: ReadonlyArray<{
  key: MapSeverityKey;
  label: MapSeverity["label"];
  rangeLabel: string;
}> = [
  { key: "low", label: "낮음", rangeLabel: "전국 하위 50%" },
  { key: "moderate", label: "보통", rangeLabel: "전국 50–75백분위" },
  { key: "caution", label: "주의", rangeLabel: "전국 상위 25%" },
  { key: "high", label: "높음", rangeLabel: "전국 상위 10%" }
];

function getMedian(sortedValues: readonly number[]): number {
  const middle = Math.floor(sortedValues.length / 2);
  const upper = sortedValues[middle] ?? 0;

  if (sortedValues.length % 2 === 1) {
    return upper;
  }

  const lower = sortedValues[middle - 1] ?? upper;
  return (lower + upper) / 2;
}

function getMidrankPercentile(
  sortedValues: readonly number[],
  value: number
): number {
  let lowerCount = 0;
  let equalCount = 0;

  for (const candidate of sortedValues) {
    if (candidate < value) {
      lowerCount += 1;
      continue;
    }
    if (candidate === value) {
      equalCount += 1;
      continue;
    }
    break;
  }

  return ((lowerCount + equalCount / 2) / sortedValues.length) * 100;
}

function getSeverityKey(percentile: number): MapSeverityKey {
  if (percentile >= 90) {
    return "high";
  }
  if (percentile >= 75) {
    return "caution";
  }
  if (percentile >= 50) {
    return "moderate";
  }
  return "low";
}

export function createMapSeverityScale(
  values: readonly number[]
): MapSeverityScale {
  const sortedValues = values
    .filter(Number.isFinite)
    .slice()
    .sort((left, right) => left - right);

  if (sortedValues.length === 0) {
    return {
      median: 0,
      classify: () => ({
        key: "low",
        label: SEVERITY_LABELS.low,
        percentile: 0,
        topShare: 100
      })
    };
  }

  return {
    median: getMedian(sortedValues),
    classify: (value) => {
      const percentile = getMidrankPercentile(sortedValues, value);
      const key = getSeverityKey(percentile);

      return {
        key,
        label: SEVERITY_LABELS[key],
        percentile,
        topShare: Math.max(1, Math.round(100 - percentile))
      };
    }
  };
}
